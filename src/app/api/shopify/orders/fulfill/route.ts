import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";
import { isMysteryBagTitle, picksRequiredForItems } from "@/lib/mystery-bag";
import { isPosSource, normalizeTitle } from "@/lib/shopify";
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
      // Check again inside transaction to prevent race conditions with webhook
      const existingInTx = await tx.shopifyOrder.findUnique({
        where: { shopifyOrderId },
      });

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
          const actualCanvasDeduction = Math.min(updates.canvasDeduction, availCanvas);
          const actualKitDeduction = Math.min(updates.kitDeduction, availKit);
          const actualMisprintDeduction = Math.min(updates.misprintDeduction, design.misprintCount);

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
          const actualDeduction = Math.min(deduction, avail);
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
    });

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

    // Find the local order record with its items and any mystery-bag picks
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

    let kitsRestored = 0;
    let canvasesRestored = 0;
    let suppliesRestored = 0;
    let misprintsRestored = 0;

    // Restore inventory in a transaction
    await prisma.$transaction(async (tx) => {
      // Restore design inventory
      for (const [designId, restore] of designRestoreMap) {
        await tx.design.update({
          where: { id: designId },
          data: {
            ...(isPos
              ? {
                  marketCanvasPrinted: restore.canvasRestore > 0 ? { increment: restore.canvasRestore } : undefined,
                  marketKitsReady: restore.kitRestore > 0 ? { increment: restore.kitRestore } : undefined,
                }
              : {
                  canvasPrinted: restore.canvasRestore > 0 ? { increment: restore.canvasRestore } : undefined,
                  kitsReady: restore.kitRestore > 0 ? { increment: restore.kitRestore } : undefined,
                }),
            // Misprint restores are always main (mystery bags are online-only).
            misprintCount: restore.misprintRestore > 0 ? { increment: restore.misprintRestore } : undefined,
            totalSold: { decrement: restore.totalSoldRestore },
            totalKitsSold: restore.totalKitsSoldRestore > 0 ? { decrement: restore.totalKitsSoldRestore } : undefined,
          },
        });

        canvasesRestored += restore.canvasRestore;
        kitsRestored += restore.kitRestore;
        misprintsRestored += restore.misprintRestore;
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
    });

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
