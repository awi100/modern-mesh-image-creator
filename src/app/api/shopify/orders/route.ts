import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";
import {
  fetchUnfulfilledOrders,
  fetchOpenDraftOrders,
  parseNeedsKit,
  normalizeTitle,
  ShopifyOrderNode,
  visibleCustomAttributes,
  isExpressShippingTitle,
} from "@/lib/shopify";
import { isMysteryBagTitle, PICKS_PER_BAG } from "@/lib/mystery-bag";
import { buildBundleMap, expandBundle, type BundleData } from "@/lib/bundles";

export type ItemType = "canvas" | "supply" | "mystery_bag" | "bundle";

export interface MysteryBagPickInfo {
  id: string;
  designId: string;
  designName: string;
  previewImageUrl: string | null;
  meshCount: number;
  misprintCount: number;
  kitsReady: number;
}

export interface MysteryBagState {
  required: number;     // total picks needed across all bag line items
  picks: MysteryBagPickInfo[];
}

export interface OrderItem {
  lineItemId: string;
  productTitle: string;
  variantTitle: string | null;
  quantity: number;
  needsKit: boolean;
  itemType: ItemType;
  productType: string | null; // Shopify product type
  // Design info (for canvas items)
  designId: string | null;
  designName: string | null;
  previewImageUrl: string | null;
  kitsReady: number;
  canvasPrinted: number;
  folderId: string | null;
  folderName: string | null;
  totalSold: number;
  // Supply info (for supply items)
  supplyId: string | null;
  supplyName: string | null;
  supplyQuantity: number; // Stock count
  // Bundle info (for bundle items) — the component supplies it will deduct
  isBundle: boolean;
  bundleComponents: { name: string; quantity: number }[];
  // Customer-entered line-item attributes (e.g. "Special instructions"
  // on a Mystery Misprint Bag). `_`-prefixed keys are filtered out.
  customAttributes: { key: string; value: string }[];
}

export interface Order {
  shopifyOrderId: string;
  orderNumber: string;
  customerName: string;
  createdAt: string;
  items: OrderItem[];
  // Channel: "pos" = in-person/market sale (deducts market tote), else online
  sourceName: string | null;
  // True for Shopify draft orders (manually created, not yet completed)
  isDraft: boolean;
  // Local fulfillment tracking
  locallyFulfilled: boolean;
  locallyFulfilledAt: string | null;
  // Mystery Misprint Bag state (null if the order has no bag line items)
  mysteryBag: MysteryBagState | null;
  // Shipping
  shippingTitle: string | null; // e.g. "Express", "Standard"
  isExpress: boolean;           // derived from shippingTitle (express / priority / overnight / etc.)
}

export interface OrdersResponse {
  orders: Order[];
  summary: {
    totalOrders: number;
    totalKitsNeeded: number;
    totalKitsReady: number;
    totalCanvasesNeeded: number;
    totalCanvasesReady: number;
    totalMysteryBags: number;
    totalMysteryBagPicksMade: number;
    totalMysteryBagPicksNeeded: number;
    totalSupplies: number;
    totalSuppliesReady: number;
    unmatchedProducts: string[];
  };
}

// Classify item type based on whether it matches a design or supply
function classifyItemType(
  productTitle: string,
  matchedDesign: boolean,
  matchedSupply: boolean
): ItemType {
  // Mystery Misprint Bag wins over everything else (special multi-design bundle)
  if (isMysteryBagTitle(productTitle)) {
    return "mystery_bag";
  }

  // If it matches a design in our system, it's a canvas
  if (matchedDesign) {
    return "canvas";
  }

  // If it matches a supply in our system, it's a supply
  if (matchedSupply) {
    return "supply";
  }

  // Default to canvas for unmatched products (they might be new designs not yet added)
  // The user can see unmatched products in the warning and decide
  return "canvas";
}

// GET - Fetch unfulfilled Shopify orders and match to designs
export async function GET() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Check if Shopify is configured
    if (!process.env.SHOPIFY_STORE_DOMAIN || !process.env.SHOPIFY_ADMIN_TOKEN) {
      return NextResponse.json(
        { error: "Shopify not configured. Add SHOPIFY_STORE_DOMAIN and SHOPIFY_ADMIN_TOKEN to environment." },
        { status: 500 }
      );
    }

    // Fetch all designs for matching (include folder info and sales data)
    const designs = await prisma.design.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        name: true,
        previewImageUrl: true,
        kitsReady: true,
        canvasPrinted: true,
        totalSold: true,
        folderId: true,
        folder: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    // Fetch all supplies for matching
    const supplies = await prisma.supply.findMany({
      select: {
        id: true,
        name: true,
        quantity: true,
      },
    });

    // Create maps for fast lookup by normalized name
    const designMap = new Map<string, typeof designs[0]>();
    for (const design of designs) {
      designMap.set(normalizeTitle(design.name), design);
    }

    // Bundles: a bundle line item expands into component supplies.
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

    const supplyMap = new Map<string, typeof supplies[0]>();
    for (const supply of supplies) {
      supplyMap.set(normalizeTitle(supply.name), supply);
    }

    // Fetch unfulfilled orders from Shopify, plus open draft orders (manually
    // created in the admin — these never appear in the normal orders list).
    // Drafts are shown first so they're easy to find and act on.
    const shopifyData = await fetchUnfulfilledOrders();
    let shopifyOrders = shopifyData.orders.nodes;
    try {
      const draftOrders = await fetchOpenDraftOrders();
      shopifyOrders = [...draftOrders, ...shopifyOrders];
    } catch (e) {
      console.error("Failed to fetch draft orders:", e);
    }

    // Fetch local order records (fulfillment + mystery bag picks) for all orders
    const localOrders = await prisma.shopifyOrder.findMany({
      where: {
        shopifyOrderId: {
          in: shopifyOrders.map((o) => o.id),
        },
      },
      select: {
        shopifyOrderId: true,
        fulfilledAt: true,
        mysteryBagPicks: {
          orderBy: { createdAt: "asc" },
          include: {
            design: {
              select: {
                id: true,
                name: true,
                previewImageUrl: true,
                meshCount: true,
                misprintCount: true,
                kitsReady: true,
              },
            },
          },
        },
      },
    });

    const localFulfillmentMap = new Map(
      localOrders.map((f) => [f.shopifyOrderId, f.fulfilledAt])
    );
    const localPicksMap = new Map(
      localOrders.map((f) => [f.shopifyOrderId, f.mysteryBagPicks])
    );

    // Process orders
    const orders: Order[] = [];
    let totalKitsNeeded = 0;
    let totalCanvasesNeeded = 0;
    let totalSupplies = 0;
    const unmatchedProducts = new Set<string>();

    // Track demand per design/supply for calculating "ready" counts
    const designDemand = new Map<string, { canvasesNeeded: number; kitsNeeded: number; canvasesReady: number; kitsReady: number }>();
    const supplyDemand = new Map<string, { needed: number; ready: number }>();

    for (const shopifyOrder of shopifyOrders) {
      const items: OrderItem[] = [];

      for (const lineItem of shopifyOrder.lineItems.nodes) {
        const productTitle = lineItem.product?.title || lineItem.title;
        const productType = lineItem.product?.productType || null;

        // Check if this is an intro/beginner product (always includes kit)
        const lowerTitle = productTitle.toLowerCase();
        const isIntroProduct = lowerTitle.includes("intro") || lowerTitle.includes("beginner");

        // Intro products always need a kit, otherwise check variant
        const needsKit = isIntroProduct || parseNeedsKit(lineItem.variantTitle);

        // Try to match to a design or supply
        const normalizedTitle = normalizeTitle(productTitle);
        const matchedDesign = designMap.get(normalizedTitle);
        const matchedSupply = supplyMap.get(normalizedTitle);

        // A bundle line item deducts several component supplies.
        const matchedBundle = bundleMap.get(normalizedTitle);
        const bundleComponents = matchedBundle
          ? expandBundle(matchedBundle, lineItem.variantTitle, supplyLite).components.map((c) => ({ name: c.supplyName, quantity: c.quantity }))
          : [];

        // Classify item type based on matches
        const itemType: ItemType = matchedBundle
          ? "bundle"
          : classifyItemType(productTitle, !!matchedDesign, !!matchedSupply);

        if (!matchedDesign && !matchedSupply && !matchedBundle && itemType === "canvas") {
          unmatchedProducts.add(productTitle);
        }

        items.push({
          lineItemId: lineItem.id,
          productTitle,
          variantTitle: lineItem.variantTitle,
          quantity: lineItem.quantity,
          needsKit: itemType === "canvas" ? needsKit : false, // Supplies don't have kits
          itemType,
          productType,
          designId: matchedDesign?.id || null,
          designName: matchedDesign?.name || null,
          previewImageUrl: matchedDesign?.previewImageUrl || null,
          kitsReady: matchedDesign?.kitsReady || 0,
          canvasPrinted: matchedDesign?.canvasPrinted || 0,
          folderId: matchedDesign?.folderId || null,
          folderName: matchedDesign?.folder?.name || null,
          totalSold: matchedDesign?.totalSold || 0,
          supplyId: matchedSupply?.id || null,
          supplyName: matchedSupply?.name || null,
          supplyQuantity: matchedSupply?.quantity || 0,
          isBundle: !!matchedBundle,
          bundleComponents,
          customAttributes: visibleCustomAttributes(lineItem.customAttributes),
        });

        // Bundle line items carry their own demand as component supplies; they
        // aren't a canvas/supply/kit of their own, so skip the counters below.
        if (itemType === "bundle") continue;

        // Mystery bag items have no design/supply demand of their own — their
        // demand is on misprintCount + kitsReady of the designs the team picks,
        // applied during fulfillment.
        if (itemType === "mystery_bag") continue;

        // Count what's needed based on item type
        if (itemType === "canvas") {
          if (needsKit) {
            totalKitsNeeded += lineItem.quantity;
          }
          totalCanvasesNeeded += lineItem.quantity;

          // Track per-design demand
          if (matchedDesign) {
            const existing = designDemand.get(matchedDesign.id) || {
              canvasesNeeded: 0,
              kitsNeeded: 0,
              canvasesReady: matchedDesign.canvasPrinted,
              kitsReady: matchedDesign.kitsReady,
            };
            existing.canvasesNeeded += lineItem.quantity;
            if (needsKit) {
              existing.kitsNeeded += lineItem.quantity;
            }
            designDemand.set(matchedDesign.id, existing);
          }
        } else {
          totalSupplies += lineItem.quantity;

          // Track per-supply demand
          if (matchedSupply) {
            const existing = supplyDemand.get(matchedSupply.id) || {
              needed: 0,
              ready: matchedSupply.quantity,
            };
            existing.needed += lineItem.quantity;
            supplyDemand.set(matchedSupply.id, existing);
          }
        }
      }

      const localFulfilledAt = localFulfillmentMap.get(shopifyOrder.id);

      // Compute Mystery Bag state if any line items are mystery bags
      let mysteryBag: MysteryBagState | null = null;
      const bagQuantity = items
        .filter((i) => i.itemType === "mystery_bag")
        .reduce((sum, i) => sum + i.quantity, 0);
      if (bagQuantity > 0) {
        const required = bagQuantity * PICKS_PER_BAG;
        const savedPicks = localPicksMap.get(shopifyOrder.id) || [];
        mysteryBag = {
          required,
          picks: savedPicks.map((p) => ({
            id: p.id,
            designId: p.design.id,
            designName: p.design.name,
            previewImageUrl: p.design.previewImageUrl,
            meshCount: p.design.meshCount,
            misprintCount: p.design.misprintCount,
            kitsReady: p.design.kitsReady,
          })),
        };
      }

      const shippingTitle = shopifyOrder.shippingLine?.title || null;
      orders.push({
        shopifyOrderId: shopifyOrder.id,
        orderNumber: shopifyOrder.name,
        customerName: shopifyOrder.billingAddress?.name || "Guest",
        createdAt: shopifyOrder.createdAt,
        sourceName: shopifyOrder.sourceName || null,
        isDraft: !!shopifyOrder.isDraftOrder,
        items,
        locallyFulfilled: !!localFulfilledAt,
        locallyFulfilledAt: localFulfilledAt?.toISOString() || null,
        mysteryBag,
        shippingTitle,
        isExpress: isExpressShippingTitle(shippingTitle),
      });
    }

    // Calculate "ready" totals (capped at what's needed per design/supply)
    let totalCanvasesReady = 0;
    let totalKitsReady = 0;
    for (const demand of designDemand.values()) {
      totalCanvasesReady += Math.min(demand.canvasesReady, demand.canvasesNeeded);
      totalKitsReady += Math.min(demand.kitsReady, demand.kitsNeeded);
    }

    let totalSuppliesReady = 0;
    for (const demand of supplyDemand.values()) {
      totalSuppliesReady += Math.min(demand.ready, demand.needed);
    }

    // Mystery Misprint Bag totals: count orders that contain at least one
    // mystery bag line item (not bag-units sold), plus aggregate picks-state
    // for the summary chip.
    let totalMysteryBags = 0;
    let totalMysteryBagPicksMade = 0;
    let totalMysteryBagPicksNeeded = 0;
    for (const order of orders) {
      if (!order.mysteryBag) continue;
      totalMysteryBags += 1;
      totalMysteryBagPicksMade += order.mysteryBag.picks.length;
      totalMysteryBagPicksNeeded += order.mysteryBag.required;
    }

    const response: OrdersResponse = {
      orders,
      summary: {
        totalOrders: orders.length,
        totalKitsNeeded,
        totalKitsReady,
        totalCanvasesNeeded,
        totalCanvasesReady,
        totalMysteryBags,
        totalMysteryBagPicksMade,
        totalMysteryBagPicksNeeded,
        totalSupplies,
        totalSuppliesReady,
        unmatchedProducts: Array.from(unmatchedProducts),
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Error fetching Shopify orders:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch orders" },
      { status: 500 }
    );
  }
}
