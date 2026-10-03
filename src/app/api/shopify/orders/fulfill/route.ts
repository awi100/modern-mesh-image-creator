import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";
import { isMysteryBagTitle, picksRequiredForItems } from "@/lib/mystery-bag";
import { isPosSource, normalizeTitle } from "@/lib/shopify";
import { lockOrder, lockDesigns, lockSupplies } from "@/lib/order-lock";
import { buildBundleMap, expandBundle, type BundleData } from "@/lib/bundles";

interface FulfillItem {
  designId?: string;
  supplyId?: string;
  productTitle: string;
  variantTitle?: string | null;
  quantity: number;
  needsKit: boolean;
  customAttributes?: { key: string; value: string }[];
}

interface FulfillRequest {
  shopifyOrderId: string;
  orderNumber: string;
  customerName?: string;
  sourceName?: string | null;
  items: FulfillItem[];
}

// Aggregated updates per design
interface DesignUpdates {
  canvasDeduction: number;
  kitDeduction: number;
  misprintDeduction: number;
  totalSold: number;
  totalKitsSold: number;
}

// Sentinel thrown from inside the fulfill transaction when saved mystery-bag
// picks don't match the required count — rolls back the transaction and is
// translated to a 400 response in the outer handler.
class MysteryPicksError extends Error {
  required: number;
  saved: number;
  constructor(required: number, saved: number) {
    super(`Mystery Misprint Bag picks not complete: required ${required}, saved ${saved}`);
    this.name = "MysteryPicksError";
    this.required = required;
    this.saved = saved;
  }
}

// Load active bundles + supplies for expanding bundle line items into their
// component supply deductions (used by both fulfill and undo).
async function loadBundleContext() {
  const [bundlesRaw, supplies] = await Promise.all([
    prisma.bundle.findMany({
      where: { active: true },
      include: { components: { include: { supply: { select: { name: true } } } } },
    }),
    prisma.supply.findMany({ select: { id: true, name: true } }),
  ]);
  const bundleData: BundleData[] = bundlesRaw.map((b) => ({
    id: b.id,
    title: b.title,
    components: b.components.map((c) => ({ quantity: c.quantity, supplyId: c.supplyId, supplyName: c.supply?.name ?? null, chooseFrom: c.chooseFrom })),
  }));
  return { bundleMap: buildBundleMap(bundleData), supplyLite: supplies };
}

// POST - Fulfill an order (deduct kitsReady and canvasPrinted, record local fulfillment)
// Consolidates all updates per design into a single atomic operation
export async function POST(request: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body: FulfillRequest = await request.json();
    const { shopifyOrderId, orderNumber, customerName, sourceName, items } = body;
    // POS (in-person/market) sales draw down the market tote; online orders
    // draw down main/online stock.
    const isPos = isPosSource(sourceName);

    if (!shopifyOrderId || !orderNumber) {
      return NextResponse.json({ error: "Missing shopifyOrderId or orderNumber" }, { status: 400 });
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: "No items provided" }, { status: 400 });
    }

    // Check if already locally fulfilled
    const existingOrder = await prisma.shopifyOrder.findUnique({
      where: { shopifyOrderId },
    });

    if (existingOrder?.fulfilledAt) {
      return NextResponse.json(
        { error: "Order already fulfilled locally", fulfilledAt: existingOrder.fulfilledAt },
        { status: 400 }
      );
    }

    const { bundleMap, supplyLite } = await loadBundleContext();

    // Aggregate updates by designId to consolidate into single updates
    const designUpdatesMap = new Map<string, DesignUpdates>();
    const supplyUpdatesMap = new Map<string, number>();

    for (const item of items) {
      // Mystery Bag line items aren't backed by a designId — deductions for
      // them are derived from saved MysteryBagPick rows below.
      if (isMysteryBagTitle(item.productTitle)) continue;

      // Bundle line item → deduct each component supply.
      const bundle = bundleMap.get(normalizeTitle(item.productTitle));
      if (bundle) {
        const { components } = expandBundle(bundle, item.variantTitle ?? null, supplyLite);
        for (const comp of components) {
          supplyUpdatesMap.set(comp.supplyId, (supplyUpdatesMap.get(comp.supplyId) || 0) + comp.quantity * item.quantity);
        }
        continue;
      }

      if (item.designId) {
        const existing = designUpdatesMap.get(item.designId) || {
          canvasDeduction: 0,
          kitDeduction: 0,
          misprintDeduction: 0,
          totalSold: 0,
          totalKitsSold: 0,
        };
        existing.canvasDeduction += item.quantity;
        existing.totalSold += item.quantity;
        if (item.needsKit) {
          existing.kitDeduction += item.quantity;
          existing.totalKitsSold += item.quantity;
        }
        designUpdatesMap.set(item.designId, existing);
      }

      if (item.supplyId) {
        const existing = supplyUpdatesMap.get(item.supplyId) || 0;
        supplyUpdatesMap.set(item.supplyId, existing + item.quantity);
      }
    }

    // Mystery Bag picks: each pick = 1 kit + 1 misprint canvas for that design.
    // Picks are saved separately via /api/shopify/orders/mystery-bag and we
    // require the count to match the bag quantities before fulfilling.
    // We read picks INSIDE the transaction below so a concurrent PUT picks
    // can't change them between the read and the deduction.
    const requiredPicks = picksRequiredForItems(items);

    // Process all updates in a single transaction with idempotency check
    const result = await prisma.$transaction(async (tx) => {
      // Serialise against the webhook and sync paths before re-checking.
      await lockOrder(tx, shopifyOrderId);

      // Check again inside transaction to prevent race conditions with webhook
      const existingInTx = await tx.shopifyOrder.findUnique({
        where: { shopifyOrderId },
      });

      // Deliberately checks fulfilledAt ONLY, unlike the webhook and sync
      // guards which also treat "has line items" as processed. Undo clears
      // fulfilledAt but KEEPS the items, and re-fulfilling an undone order by
      // hand is the whole point of the Undo button — the items check belongs
      // only on the automatic paths, which must not re-deduct what a human
      // deliberately reversed.
      if (existingInTx?.fulfilledAt) {
        // Already processed (possibly by webhook)
        return { alreadyProcessed: true, kitsDeducted: 0, canvasesDeducted: 0, suppliesDeducted: 0, misprintsDeducted: 0 };
      }

      // Read mystery bag picks atomically with the rest of this transaction —
      // a concurrent PUT picks cannot change them between this read and the
      // deductions below.
      let mysteryPicks: { designId: string }[] = [];
      if (requiredPicks > 0 && existingInTx) {
        mysteryPicks = await tx.mysteryBagPick.findMany({
          where: { shopifyOrderId: existingInTx.id },
          select: { designId: true },
        });
      }
      if (requiredPicks > 0 && mysteryPicks.length !== requiredPicks) {
        // Throw a sentinel so the transaction rolls back and the outer handler
        // can map it to a 400.
        throw new MysteryPicksError(requiredPicks, mysteryPicks.length);
      }

      // Fold picks into the per-design update map. Each pick = 1 kit + 1 misprint.
      for (const pick of mysteryPicks) {
        const existing = designUpdatesMap.get(pick.designId) || {
          canvasDeduction: 0,
          kitDeduction: 0,
          misprintDeduction: 0,
          totalSold: 0,
          totalKitsSold: 0,
        };
        existing.kitDeduction += 1;
        existing.misprintDeduction += 1;
        existing.totalSold += 1;
        existing.totalKitsSold += 1;
        designUpdatesMap.set(pick.designId, existing);
      }

      let kitsDeducted = 0;
      let canvasesDeducted = 0;
      let suppliesDeducted = 0;
      let misprintsDeducted = 0;

      // Create or update ShopifyOrder record
      const shopifyOrder = await tx.shopifyOrder.upsert({
        where: { shopifyOrderId },
        create: {
          shopifyOrderId,
          orderNumber,
          customerName: customerName || null,
          sourceName: sourceName || null,
          fulfilledAt: new Date(),
        },
        update: {
          sourceName: sourceName || null,
          fulfilledAt: new Date(),
        },
      });

      // NOT deleting the previous (undone) line items: every consumer already
      // filters processed:true, so the stale set is invisible to them, and the
      // client only sends back lines it could match — deleting would destroy the
      // unmatched ones permanently.
      //
      // Create ShopifyOrderItem records
      for (const item of items) {
        await tx.shopifyOrderItem.create({
          data: {
            shopifyOrderId: shopifyOrder.id,
            designId: item.designId || null,
            supplyId: item.supplyId || null,
            productTitle: item.productTitle,
            variantTitle: item.variantTitle || null,
            quantity: item.quantity,
            needsKit: item.needsKit,
            processed: true,
            customAttributes: item.customAttributes && item.customAttributes.length > 0
              ? item.customAttributes
              : undefined,
          },
        });
      }

      // Process design updates - ONE update per design
      // Lock every design and supply this order touches, in id order, BEFORE
      // reading their current counts. The clamp below is a read-modify-write and
      // the order lock does not cover it: a different order for the same design
      // runs under a different key, so both could read the same stock, both
      // clamp to it, and the second decrement would drive the column negative.
      await lockDesigns(tx, [...designUpdatesMap.keys()].sort());
      await lockSupplies(tx, [...supplyUpdatesMap.keys()].sort());

      for (const [designId, updates] of designUpdatesMap) {
        const design = await tx.design.findUnique({
          where: { id: designId },
          select: { name: true, kitsReady: true, canvasPrinted: true, marketKitsReady: true, marketCanvasPrinted: true, misprintCount: true },
        });

        if (design) {
          // POS sales draw from the market tote; online from main stock.
          // Misprint (mystery-bag) canvases are online-only regardless.
          const availCanvas = isPos ? design.marketCanvasPrinted : design.canvasPrinted;
          const availKit = isPos ? design.marketKitsReady : design.kitsReady;
          // Floored at 0 — Math.min alone returns a negative deduction when the
          // bucket is already negative, corrupting the audit row.
          const actualCanvasDeduction = Math.max(0, Math.min(updates.canvasDeduction, availCanvas));
          const actualKitDeduction = Math.max(0, Math.min(updates.kitDeduction, availKit));
          const actualMisprintDeduction = Math.max(0, Math.min(updates.misprintDeduction, design.misprintCount));

          // The webhook and sync paths both warn here; this one was silent, so a
          // manual fulfil that deducted nothing reported success with no trace
          // anywhere but the OrderDeduction row.
          if (actualCanvasDeduction < updates.canvasDeduction || actualKitDeduction < updates.kitDeduction) {
            console.warn(
              `Fulfill: order ${orderNumber} exceeded ${isPos ? "market tote" : "online"} stock for design ${designId} ` +
              `(wanted ${updates.kitDeduction} kits/${updates.canvasDeduction} canvases, ` +
              `took ${actualKitDeduction}/${actualCanvasDeduction})`
            );
          }

          // Single consolidated update per design
          await tx.design.update({
            where: { id: designId },
            data: {
              ...(isPos
                ? {
                    marketCanvasPrinted: actualCanvasDeduction > 0 ? { decrement: actualCanvasDeduction } : undefined,
                    marketKitsReady: actualKitDeduction > 0 ? { decrement: actualKitDeduction } : undefined,
                  }
                : {
                    canvasPrinted: actualCanvasDeduction > 0 ? { decrement: actualCanvasDeduction } : undefined,
                    kitsReady: actualKitDeduction > 0 ? { decrement: actualKitDeduction } : undefined,
                  }),
              misprintCount: actualMisprintDeduction > 0 ? { decrement: actualMisprintDeduction } : undefined,
              totalSold: { increment: updates.totalSold },
              totalKitsSold: updates.totalKitsSold > 0 ? { increment: updates.totalKitsSold } : undefined,
            },
          });

          await tx.orderDeduction.create({
            data: {
              shopifyOrderId, orderNumber, sourceName: sourceName || null,
              bucket: isPos ? "market" : "online", via: "fulfill",
              designId, designName: design.name,
              kitsRequested: updates.kitDeduction, kitsDeducted: actualKitDeduction,
              canvasRequested: updates.canvasDeduction, canvasDeducted: actualCanvasDeduction,
            },
          });

          canvasesDeducted += actualCanvasDeduction;
          kitsDeducted += actualKitDeduction;
          misprintsDeducted += actualMisprintDeduction;
        }
      }

      // Process supply updates - ONE update per supply
      for (const [supplyId, deduction] of supplyUpdatesMap) {
        const supply = await tx.supply.findUnique({
          where: { id: supplyId },
          select: { quantity: true, marketQuantity: true },
        });

        if (supply) {
          const avail = isPos ? supply.marketQuantity : supply.quantity;
          const actualDeduction = Math.max(0, Math.min(deduction, avail));
          if (actualDeduction > 0) {
            await tx.supply.update({
              where: { id: supplyId },
              data: isPos
                ? { marketQuantity: { decrement: actualDeduction } }
                : { quantity: { decrement: actualDeduction } },
            });
            suppliesDeducted += actualDeduction;
          }
        }
      }

      return { alreadyProcessed: false, kitsDeducted, canvasesDeducted, suppliesDeducted, misprintsDeducted };
    }, { maxWait: 10_000, timeout: 20_000 });

    if (result.alreadyProcessed) {
      return NextResponse.json({
        success: true,
        message: "Order already processed (possibly by webhook)",
        kitsDeducted: 0,
        canvasesDeducted: 0,
        suppliesDeducted: 0,
        misprintsDeducted: 0,
      });
    }

    return NextResponse.json({
      success: true,
      kitsDeducted: result.kitsDeducted,
      canvasesDeducted: result.canvasesDeducted,
      suppliesDeducted: result.suppliesDeducted,
      misprintsDeducted: result.misprintsDeducted,
    });
  } catch (error) {
    if (error instanceof MysteryPicksError) {
      return NextResponse.json(
        {
          error: "Mystery Misprint Bag picks not complete",
          requiredPicks: error.required,
          savedPicks: error.saved,
        },
        { status: 400 }
      );
    }
    console.error("Error fulfilling order:", error);
    return NextResponse.json(
      { error: "Failed to fulfill order" },
      { status: 500 }
    );
  }
}

// DELETE - Undo a local fulfillment (restore inventory)
export async function DELETE(request: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const shopifyOrderId = searchParams.get("shopifyOrderId");

    if (!shopifyOrderId) {
      return NextResponse.json({ error: "Missing shopifyOrderId" }, { status: 400 });
    }

    // Read for validation only. The authoritative re-read happens INSIDE the
    // transaction, under the lock — this commit's own rule is that a check made
    // before the lock is still a race, and the undo path was the one place that
    // didn't apply it: two Undo clicks (two tabs, or a retried DELETE) both read
    // fulfilledAt as set, both queued on the lock, and both restored, doubling
    // the stock returned.
    const localOrder = await prisma.shopifyOrder.findUnique({
      where: { shopifyOrderId },
      include: {
        items: true,
        mysteryBagPicks: true,
      },
    });

    if (!localOrder) {
      return NextResponse.json({ error: "Order not found locally" }, { status: 404 });
    }

    if (!localOrder.fulfilledAt) {
      return NextResponse.json({ error: "Order was not fulfilled locally" }, { status: 400 });
    }

    // POS orders deducted from the market tote — restore there. Online orders
    // restore to main/online stock. Mystery-bag misprint restores always go to
    // main (mystery bags are online-only).
    const isPos = isPosSource(localOrder.sourceName);

    // Aggregate what needs to be restored by designId and supplyId
    const designRestoreMap = new Map<string, {
      canvasRestore: number;
      kitRestore: number;
      misprintRestore: number;
      totalSoldRestore: number;
      totalKitsSoldRestore: number;
    }>();
    const supplyRestoreMap = new Map<string, number>();
    const { bundleMap: undoBundleMap, supplyLite: undoSupplyLite } = await loadBundleContext();

    for (const item of localOrder.items) {
      // Mystery Bag line items don't carry designId; we restore from picks below.
      if (isMysteryBagTitle(item.productTitle)) continue;

      // Bundle line item → restore each component supply (re-expanded from the
      // stored title + variant, same as when it was deducted).
      if (item.processed) {
        const bundle = undoBundleMap.get(normalizeTitle(item.productTitle));
        if (bundle) {
          const { components } = expandBundle(bundle, item.variantTitle ?? null, undoSupplyLite);
          for (const comp of components) {
            supplyRestoreMap.set(comp.supplyId, (supplyRestoreMap.get(comp.supplyId) || 0) + comp.quantity * item.quantity);
          }
          continue;
        }
      }

      if (item.designId && item.processed) {
        const existing = designRestoreMap.get(item.designId) || {
          canvasRestore: 0,
          kitRestore: 0,
          misprintRestore: 0,
          totalSoldRestore: 0,
          totalKitsSoldRestore: 0,
        };
        existing.canvasRestore += item.quantity;
        existing.totalSoldRestore += item.quantity;
        if (item.needsKit) {
          existing.kitRestore += item.quantity;
          existing.totalKitsSoldRestore += item.quantity;
        }
        designRestoreMap.set(item.designId, existing);
      }

      // Restore supply inventory using stored supplyId
      if (item.supplyId && item.processed) {
        const existing = supplyRestoreMap.get(item.supplyId) || 0;
        supplyRestoreMap.set(item.supplyId, existing + item.quantity);
      }
    }

    // Restore one kit + one misprint canvas per saved Mystery Bag pick.
    for (const pick of localOrder.mysteryBagPicks) {
      const existing = designRestoreMap.get(pick.designId) || {
        canvasRestore: 0,
        kitRestore: 0,
        misprintRestore: 0,
        totalSoldRestore: 0,
        totalKitsSoldRestore: 0,
      };
      existing.kitRestore += 1;
      existing.misprintRestore += 1;
      existing.totalSoldRestore += 1;
      existing.totalKitsSoldRestore += 1;
      designRestoreMap.set(pick.designId, existing);
    }

    // What was ACTUALLY taken off the shelf, per design.
    //
    // The restore map above is built from the line items, i.e. what the order
    // ASKED for — but deduction clamps to what was in stock. Undoing a clamped
    // order therefore handed back stock that was never taken: a POS order for 3
    // kits against a tote of 1 deducted 1 and restored 3, inventing 2 kits. The
    // OrderDeduction table has recorded the real figures all along and nothing
    // read them; this is the one place that has to.
    //
    // Orders predating that table (1,403 of them) have no rows, so they fall
    // back to the line-item amounts — the old behaviour, which is the best
    // available answer when there is no record of what was taken.
    // Newest first, and we keep only the FIRST row seen per design: a
    // fulfil -> undo -> fulfil leaves two sets of audit rows for one order, and
    // summing them would restore both fulfillments' worth. Each fulfil writes
    // exactly one row per design (the update map is keyed by designId), so the
    // newest row per design is precisely the current fulfillment.
    const auditRows = await prisma.orderDeduction.findMany({
      where: { shopifyOrderId },
      select: { designId: true, kitsDeducted: true, canvasDeducted: true, bucket: true },
      orderBy: { createdAt: "desc" },
    });
    const actualByDesign = new Map<string, { kits: number; canvas: number; bucket: string }>();
    for (const row of auditRows) {
      if (!row.designId || actualByDesign.has(row.designId)) continue;
      actualByDesign.set(row.designId, {
        kits: row.kitsDeducted,
        canvas: row.canvasDeducted,
        bucket: row.bucket,
      });
    }
    // Whether this order was ever audited at all. Used to tell "no audit row for
    // this design because nothing was deducted for it" apart from "no audit rows
    // at all because the order predates the table".
    const orderWasAudited = actualByDesign.size > 0;

    let kitsRestored = 0;
    let canvasesRestored = 0;
    let suppliesRestored = 0;
    let misprintsRestored = 0;

    // Restore inventory in a transaction
    const undoResult = await prisma.$transaction(async (tx) => {
      await lockOrder(tx, shopifyOrderId);

      // Authoritative check, under the lock. Without it the lock merely queued a
      // second concurrent undo and then let it restore everything a second time.
      const stillFulfilled = await tx.shopifyOrder.findUnique({
        where: { shopifyOrderId },
        select: { fulfilledAt: true },
      });
      if (!stillFulfilled?.fulfilledAt) {
        return { alreadyUndone: true };
      }

      // Restore design inventory
      for (const [designId, restore] of designRestoreMap) {
        // Bucket columns restore what was taken; totalSold/totalKitsSold restore
        // what was requested, because the deduct side increments those by the
        // requested amount regardless of clamping.
        const audited = actualByDesign.get(designId);

        // A design with no audit row on an order that WAS audited had nothing
        // deducted for it. That is the mystery-bag case: the webhook and sync
        // paths have no pick-based deduction at all, so a bag fulfilled by
        // webhook has picks recorded but no stock taken — and restoring from the
        // picks invented a kit and a misprint canvas per pick. Orders #2779 and
        // #3058 are in exactly that state today.
        const neverDeducted = orderWasAudited && !audited;

        const canvasRestore = audited ? Math.max(0, audited.canvas) : neverDeducted ? 0 : restore.canvasRestore;
        const kitRestore = audited ? Math.max(0, audited.kits) : neverDeducted ? 0 : restore.kitRestore;
        const misprintRestore = neverDeducted ? 0 : restore.misprintRestore;

        // Restore to the bucket the deduction actually came OUT of. isPos is
        // recomputed from sourceName, which the fulfil POST overwrites on every
        // call, so a channel change between fulfil and undo would otherwise
        // credit the wrong column.
        const toMarket = audited ? audited.bucket === "market" : isPos;

        await tx.design.update({
          where: { id: designId },
          data: {
            ...(toMarket
              ? {
                  marketCanvasPrinted: canvasRestore > 0 ? { increment: canvasRestore } : undefined,
                  marketKitsReady: kitRestore > 0 ? { increment: kitRestore } : undefined,
                }
              : {
                  canvasPrinted: canvasRestore > 0 ? { increment: canvasRestore } : undefined,
                  kitsReady: kitRestore > 0 ? { increment: kitRestore } : undefined,
                }),
            // Misprint restores are always main (mystery bags are online-only).
            // NOTE: misprint deductions are clamped but OrderDeduction has no
            // misprint columns, so a bag fulfilled against misprintCount 0 still
            // over-restores. Fixing that needs an additive schema change.
            misprintCount: misprintRestore > 0 ? { increment: misprintRestore } : undefined,
            totalSold: { decrement: restore.totalSoldRestore },
            totalKitsSold: restore.totalKitsSoldRestore > 0 ? { decrement: restore.totalKitsSoldRestore } : undefined,
          },
        });

        canvasesRestored += canvasRestore;
        kitsRestored += kitRestore;
        misprintsRestored += misprintRestore;
      }

      // Restore supply inventory to the bucket it was deducted from.
      for (const [supplyId, quantity] of supplyRestoreMap) {
        await tx.supply.update({
          where: { id: supplyId },
          data: isPos
            ? { marketQuantity: { increment: quantity } }
            : { quantity: { increment: quantity } },
        });
        suppliesRestored += quantity;
      }

      // Clear fulfillment status (but keep the record for history)
      await tx.shopifyOrder.update({
        where: { shopifyOrderId },
        data: {
          fulfilledAt: null,
        },
      });

      // Mark items as not processed
      await tx.shopifyOrderItem.updateMany({
        where: { shopifyOrderId: localOrder.id },
        data: { processed: false },
      });

      return { alreadyUndone: false };
    }, { maxWait: 10_000, timeout: 20_000 });

    if (undoResult.alreadyUndone) {
      // A concurrent undo (or a retried request) got there first. Report success
      // with zero restored rather than an error — the desired end state holds.
      return NextResponse.json({
        success: true,
        kitsRestored: 0,
        canvasesRestored: 0,
        suppliesRestored: 0,
        misprintsRestored: 0,
        message: "Fulfillment was already undone",
      });
    }

    return NextResponse.json({
      success: true,
      kitsRestored,
      canvasesRestored,
      suppliesRestored,
      misprintsRestored,
      message: "Fulfillment undone, inventory restored",
    });
  } catch (error) {
    console.error("Error undoing fulfillment:", error);
    return NextResponse.json(
      { error: "Failed to undo fulfillment" },
      { status: 500 }
    );
  }
}
