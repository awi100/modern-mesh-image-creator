import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseNeedsKit, normalizeTitle, matchSupplyByVariant, isPosSource } from "@/lib/shopify";
import { lockOrder } from "@/lib/order-lock";
import { buildBundleMap, expandBundle, type BundleData } from "@/lib/bundles";
import { isMysteryBagTitle } from "@/lib/mystery-bag";
import crypto from "crypto";

// Shopify webhook payload types
interface ShopifyLineItem {
  id: number;
  title: string;
  variant_title: string | null;
  quantity: number;
  // Original quantity minus refunded/removed units. Shopify omits it on older
  // API versions, hence optional — we fall back to `quantity`.
  current_quantity?: number | null;
  product_id: number;
}

interface ShopifyFulfillment {
  id: number;
  order_id: number;
  status: string;
  line_items: ShopifyLineItem[];
}

interface ShopifyWebhookPayload {
  id: number; // Order ID
  name: string; // Order number like "#1001"
  admin_graphql_api_id: string; // "gid://shopify/Order/123"
  source_name?: string | null; // "pos" = Point of Sale, "web"/checkout = online
  created_at?: string | null; // real order-placed date
  cancelled_at?: string | null;
  financial_status?: string | null; // "refunded" | "voided" | "paid" | ...
  current_total_price?: string | null;
  total_price?: string | null;
  billing_address?: {
    name?: string;
  };
  fulfillments: ShopifyFulfillment[];
  line_items: ShopifyLineItem[];
}

// Mirror of isIgnorableOrder (lib/shopify) for the REST-shaped webhook payload:
// cancelled, fully refunded/voided, or $0 total orders must be ignored so the
// webhook never deducts inventory the rest of the system skips.
function isIgnorableWebhookOrder(p: ShopifyWebhookPayload): boolean {
  if (p.cancelled_at) return true;
  const fin = (p.financial_status || "").toLowerCase();
  if (fin === "refunded" || fin === "voided") return true;
  const totalStr = p.current_total_price ?? p.total_price;
  if (totalStr !== undefined && totalStr !== null && parseFloat(totalStr) === 0) return true;
  return false;
}

// Verify Shopify webhook HMAC signature
function verifyWebhook(rawBody: string, hmacHeader: string): boolean {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (!secret) {
    console.error("SHOPIFY_WEBHOOK_SECRET not configured");
    return false;
  }

  const hash = crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("base64");

  const expected = Buffer.from(hash, "utf8");
  const provided = Buffer.from(hmacHeader, "utf8");
  // timingSafeEqual throws if lengths differ — guard so a malformed header
  // rejects cleanly instead of throwing.
  if (expected.length !== provided.length) return false;
  return crypto.timingSafeEqual(expected, provided);
}

// POST - Handle Shopify fulfillment webhook
// This is called by Shopify when an order is fulfilled
export async function POST(request: NextRequest) {
  try {
    // Get raw body for HMAC verification
    const rawBody = await request.text();
    const hmacHeader = request.headers.get("x-shopify-hmac-sha256");

    // Verify webhook authenticity
    if (!hmacHeader || !verifyWebhook(rawBody, hmacHeader)) {
      console.error("Webhook verification failed");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Parse the webhook payload
    const payload: ShopifyWebhookPayload = JSON.parse(rawBody);

    // Ignore cancelled / fully-refunded / $0 orders (consistent with sync
    // and analytics, which never count these).
    if (isIgnorableWebhookOrder(payload)) {
      return NextResponse.json({ message: "Order ignored (cancelled/refunded/$0)" });
    }

    // Orders that originated from a draft order are handled through the draft
    // flow + sync (which reconciles drafts already fulfilled in-app so they
    // aren't deducted twice). Defer them to sync rather than deduct here.
    if ((payload.source_name || "").toLowerCase() === "shopify_draft_order") {
      return NextResponse.json({ message: "Draft-originated order — deferred to sync" });
    }

    // Only process if there are fulfillments
    if (!payload.fulfillments || payload.fulfillments.length === 0) {
      return NextResponse.json({ message: "No fulfillments to process" });
    }

    const shopifyOrderId = payload.admin_graphql_api_id;
    // POS (in-person/craft market) sales deduct from the market tote; online
    // orders deduct from main/online stock.
    const isPos = isPosSource(payload.source_name);

    // Quick check outside transaction (optimization, not relied upon for correctness).
    // Treat an order that already has line items as processed too — that catches
    // orders fulfilled and then deliberately UNDONE (undo keeps the items but
    // clears fulfilledAt); re-deducting them would undo the undo.
    const existingOrder = await prisma.shopifyOrder.findUnique({
      where: { shopifyOrderId },
      include: { items: { take: 1, select: { id: true } } },
    });

    if (existingOrder?.fulfilledAt || (existingOrder?.items.length ?? 0) > 0) {
      console.log(`Webhook: Order ${payload.name} already processed, skipping`);
      return NextResponse.json({
        message: "Order already processed",
        orderId: shopifyOrderId
      });
    }

    // Fetch all designs and supplies for matching
    const designs = await prisma.design.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        name: true,
        kitsReady: true,
        canvasPrinted: true,
      },
    });

    const supplies = await prisma.supply.findMany({
      select: {
        id: true,
        name: true,
        quantity: true,
      },
    });

    const designMap = new Map<string, typeof designs[0]>();
    for (const design of designs) {
      designMap.set(normalizeTitle(design.name), design);
    }

    const supplyMap = new Map<string, typeof supplies[0]>();
    for (const supply of supplies) {
      supplyMap.set(normalizeTitle(supply.name), supply);
    }

    // Bundles → component supply deductions
    const bundlesRaw = await prisma.bundle.findMany({
      where: { active: true },
      include: { components: { include: { supply: { select: { name: true } } } } },
    });
    const bundleData: BundleData[] = bundlesRaw.map((b) => ({
      id: b.id,
      title: b.title,
      components: b.components.map((c) => ({ quantity: c.quantity, supplyId: c.supplyId, supplyName: c.supply?.name ?? null, chooseFrom: c.chooseFrom })),
    }));
    const bundleMap = buildBundleMap(bundleData);
    const supplyLite = supplies.map((s) => ({ id: s.id, name: s.name }));

    // Build items list with design/supply matching
    const items: {
      designId: string | null;
      supplyId: string | null;
      productTitle: string;
      variantTitle: string | null;
      quantity: number;
      needsKit: boolean;
    }[] = [];

    for (const lineItem of payload.line_items) {
      // Refunded/removed units. The GraphQL fetchers normalise `quantity` to
      // `currentQuantity` via applyLineItemRefunds (lib/shopify.ts), but this
      // REST payload was read raw — so a partially refunded line deducted the
      // ORIGINAL count here and the refunded count via sync, and whichever path
      // ran first decided the number. A fully refunded line deducts nothing.
      const effectiveQuantity = lineItem.current_quantity ?? lineItem.quantity;
      if (effectiveQuantity <= 0) continue;

      const productTitle = lineItem.title;
      const lowerTitle = productTitle.toLowerCase();
      const isIntroProduct = lowerTitle.includes("intro") || lowerTitle.includes("beginner");
      const needsKit = isIntroProduct || parseNeedsKit(lineItem.variant_title);

      const normalizedTitle = normalizeTitle(productTitle);
      const matchedDesign = designMap.get(normalizedTitle);
      const matchedSupply = supplyMap.get(normalizedTitle) ?? matchSupplyByVariant(productTitle, lineItem.variant_title, supplies) ?? undefined;

      items.push({
        designId: matchedDesign?.id || null,
        supplyId: matchedSupply?.id || null,
        productTitle,
        variantTitle: lineItem.variant_title,
        quantity: effectiveQuantity,
        needsKit: matchedDesign ? needsKit : false,
      });
    }

    // Aggregate updates by designId
    const designUpdatesMap = new Map<string, {
      canvasDeduction: number;
      kitDeduction: number;
      totalSold: number;
      totalKitsSold: number;
    }>();
    const supplyUpdatesMap = new Map<string, number>();

    for (const item of items) {
      // Mystery Bag lines aren't backed by a designId — their deductions come
      // from saved MysteryBagPick rows. The other two paths skip them here; this
      // one didn't, which is harmless only while no design is named like the
      // bag, and would start double-deducting the day one is.
      if (isMysteryBagTitle(item.productTitle)) continue;

      // Bundle line → deduct its components, and nothing else. Checked first and
      // `continue`d, matching orders/fulfill: this path previously fell through
      // and ALSO deducted a design/supply of the same name.
      const bundle = bundleMap.get(normalizeTitle(item.productTitle));
      if (bundle) {
        const { components } = expandBundle(bundle, item.variantTitle, supplyLite);
        for (const comp of components) {
          supplyUpdatesMap.set(comp.supplyId, (supplyUpdatesMap.get(comp.supplyId) || 0) + comp.quantity * item.quantity);
        }
        continue;
      }

      if (item.designId) {
        const existing = designUpdatesMap.get(item.designId) || {
          canvasDeduction: 0,
          kitDeduction: 0,
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

    // Process in transaction with idempotency check inside
    const result = await prisma.$transaction(async (tx) => {
      // Serialise against the other deduction paths AND against Shopify's own
      // webhook retries. Must come before the re-check below: a check taken
      // before the lock is still a race.
      await lockOrder(tx, shopifyOrderId);

      // Check again inside transaction to prevent race conditions
      const existingInTx = await tx.shopifyOrder.findUnique({
        where: { shopifyOrderId },
        include: { items: { take: 1, select: { id: true } } },
      });

      if (existingInTx?.fulfilledAt || (existingInTx?.items.length ?? 0) > 0) {
        // Already processed by another request (race condition avoided) or
        // previously fulfilled-then-undone.
        return { alreadyProcessed: true };
      }

      // Create ShopifyOrder record
      const order = await tx.shopifyOrder.upsert({
        where: { shopifyOrderId },
        create: {
          shopifyOrderId,
          orderNumber: payload.name,
          customerName: payload.billing_address?.name || null,
          sourceName: payload.source_name || null,
          fulfilledAt: new Date(),
          orderDate: payload.created_at ? new Date(payload.created_at) : null,
        },
        update: {
          sourceName: payload.source_name || null,
          fulfilledAt: new Date(),
          orderDate: payload.created_at ? new Date(payload.created_at) : undefined,
        },
      });

      // Create ShopifyOrderItem records
      for (const item of items) {
        await tx.shopifyOrderItem.create({
          data: {
            shopifyOrderId: order.id,
            designId: item.designId,
            supplyId: item.supplyId,
            productTitle: item.productTitle,
            variantTitle: item.variantTitle,
            quantity: item.quantity,
            needsKit: item.needsKit,
            processed: true,
          },
        });
      }

      let kitsDeducted = 0;
      let canvasesDeducted = 0;
      let suppliesDeducted = 0;

      // Process design updates. POS sales draw down the market tote; online
      // sales draw down main/online stock. totalSold/totalKitsSold always
      // increment (a sale is a sale for velocity), regardless of channel.
      for (const [designId, updates] of designUpdatesMap) {
        const design = await tx.design.findUnique({
          where: { id: designId },
          select: { name: true, kitsReady: true, canvasPrinted: true, marketKitsReady: true, marketCanvasPrinted: true },
        });

        if (design) {
          const availCanvas = isPos ? design.marketCanvasPrinted : design.canvasPrinted;
          const availKit = isPos ? design.marketKitsReady : design.kitsReady;
          // Floored at 0: Math.min alone returns a NEGATIVE deduction when the
          // bucket is already negative, which the audit row then records as a
          // negative "deducted" and the response counts as a negative total
          // (see orders #3580/#3583, logged as kits 0 -> -1).
          const actualCanvasDeduction = Math.max(0, Math.min(updates.canvasDeduction, availCanvas));
          const actualKitDeduction = Math.max(0, Math.min(updates.kitDeduction, availKit));

          if (isPos && (actualCanvasDeduction < updates.canvasDeduction || actualKitDeduction < updates.kitDeduction)) {
            console.warn(`Webhook: POS order ${payload.name} exceeded market stock for design ${designId} (market tote count likely drifted)`);
          }

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
              totalSold: { increment: updates.totalSold },
              totalKitsSold: updates.totalKitsSold > 0 ? { increment: updates.totalKitsSold } : undefined,
            },
          });

          await tx.orderDeduction.create({
            data: {
              shopifyOrderId, orderNumber: payload.name, sourceName: payload.source_name || null,
              bucket: isPos ? "market" : "online", via: "webhook",
              designId, designName: design.name,
              kitsRequested: updates.kitDeduction, kitsDeducted: actualKitDeduction,
              canvasRequested: updates.canvasDeduction, canvasDeducted: actualCanvasDeduction,
            },
          });

          canvasesDeducted += actualCanvasDeduction;
          kitsDeducted += actualKitDeduction;
        }
      }

      // Process supply updates. POS sales draw down the market tote; online
      // sales draw down main/online stock.
      for (const [supplyId, deduction] of supplyUpdatesMap) {
        const supply = await tx.supply.findUnique({
          where: { id: supplyId },
          select: { quantity: true, marketQuantity: true },
        });

        if (supply) {
          const avail = isPos ? supply.marketQuantity : supply.quantity;
          const actualDeduction = Math.max(0, Math.min(deduction, avail));
          if (isPos && actualDeduction < deduction) {
            console.warn(`Webhook: POS order ${payload.name} exceeded market supply stock for supply ${supplyId}`);
          }
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

      return { alreadyProcessed: false, kitsDeducted, canvasesDeducted, suppliesDeducted };
    }, { maxWait: 10_000, timeout: 20_000 });

    if (result.alreadyProcessed) {
      console.log(`Webhook: Order ${payload.name} was already processed (race condition avoided)`);
      return NextResponse.json({
        message: "Order already processed",
        orderId: shopifyOrderId
      });
    }

    console.log(`Webhook processed order ${payload.name}: ${result.canvasesDeducted} canvases, ${result.kitsDeducted} kits, ${result.suppliesDeducted} supplies`);

    return NextResponse.json({
      success: true,
      orderNumber: payload.name,
      kitsDeducted: result.kitsDeducted,
      canvasesDeducted: result.canvasesDeducted,
      suppliesDeducted: result.suppliesDeducted,
    });
  } catch (error) {
    console.error("Error processing fulfillment webhook:", error);
    // Return 500 so Shopify retries — a transient DB failure here would
    // otherwise silently drop the order's deduction with no retry. The
    // transaction is atomic, so a failed attempt leaves no partial state.
    return NextResponse.json({
      error: "Failed to process webhook",
      message: error instanceof Error ? error.message : "Unknown error",
    }, { status: 500 });
  }
}
