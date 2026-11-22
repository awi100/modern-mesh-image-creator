import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";
import { isOnPickList } from "@/lib/order-pick-list";
import {
  fetchUnfulfilledOrders,
  fetchOpenDraftOrders,
  parseNeedsKit,
  normalizeTitle,
  ShopifyOrderNode,
  visibleCustomAttributes,
  isExpressShippingTitle,
} from "@/lib/shopify";
import { classifyOrderKind, toOrderKind, type OrderKind } from "@/lib/order-kind";
import { KIT_GROUP_INCLUDE, kitStockOf } from "@/lib/kit-group";
import { isMysteryBagTitle } from "@/lib/mystery-bag";
import { isOtherItemTitle } from "@/lib/other-items";
import { buildBundleMap, expandBundle, type BundleData } from "@/lib/bundles";
import { resolveSupply, supplyNameMap } from "@/lib/supply-match";
import { designNameIndex, resolveDesign } from "@/lib/design-match";

export type ItemType = "canvas" | "supply" | "mystery_bag" | "bundle" | "other";

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
  /**
   * Kit bags this design can ship from HOME.
   *
   * For a design in a shared kit pool this is the WHOLE pool, not a share of
   * it — any bag fits any member, so a share would be a fiction. It therefore
   * must NOT be summed across designs: see `kitGroupId`.
   */
  kitsReady: number;
  /**
   * Set when `kitsReady` above is a pool shared with other designs. Anything
   * that allocates or totals kits must key on `kitGroupId ?? designId`, or the
   * same bags get spent once per member.
   */
  kitGroupId: string | null;
  kitPool: { name: string; members: number; contents: string | null } | null;
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
  // Why the order exists. Either the kind stored against an order we've already
  // processed — including a correction made here — or, for one we haven't, the
  // guess from its source, tags and total. Anything but "retail" deducts stock
  // the same way but stays out of the sales rate. See lib/order-kind.
  kind: OrderKind;
  // Local fulfillment tracking
  locallyFulfilled: boolean;
  locallyFulfilledAt: string | null;
  // Deliberately left off the pick list — see src/lib/order-pick-list.ts. Null
  // for the overwhelming majority; set only when someone unticked this order.
  excludedAt: string | null;
  excludedReason: string | null;
  // Does this order contain a Mystery Misprint Bag line? We no longer track
  // which misprints go in it — this only drives the Orders page filter.
  hasMysteryBag: boolean;
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
    totalOther: number;
    totalSupplies: number;
    totalSuppliesReady: number;
    unmatchedProducts: string[];
  };
  /**
   * Why the open-draft list is missing, when it is. Draft orders need the
   * read_draft_orders scope on the Shopify token; without it this request used
   * to fail into a console.error nobody reads, so drafts looked like a feature
   * that didn't exist. Completed drafts still arrive through sync regardless.
   */
  draftWarning?: string;
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

  // A service or credit — a private class, a gift card, a shipping top-up.
  // Checked before the design/supply lookups because the list is explicit and
  // curated: nothing lands here by accident, so nothing here should be second-
  // guessed by a coincidental name match. Crucially it is also checked before
  // the "unmatched defaults to canvas" rule at the bottom, which is what put a
  // private class on the picking list as a canvas to go and fetch.
  if (isOtherItemTitle(productTitle)) {
    return "other";
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
        // Kit stock for a pooled design is held at 0 on these columns and
        // lives on the group instead, so read it through kitStockOf. Selecting
        // kitsReady alone is how this page came to report 0 kits for every
        // street sign while the shelf had three bags on it.
        kitsReady: true,
        marketKitsReady: true,
        kitsAndover: true,
        kitGroupId: true,
        ...KIT_GROUP_INCLUDE,
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
    const designIndex = designNameIndex(designs);

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

    const supplyMap = supplyNameMap(supplies);

    // Fetch unfulfilled orders from Shopify, plus open draft orders (manually
    // created in the admin — these never appear in the normal orders list).
    // Drafts are shown first so they're easy to find and act on.
    const shopifyData = await fetchUnfulfilledOrders();
    let shopifyOrders = shopifyData.orders.nodes;
    let draftWarning: string | undefined;
    try {
      const draftOrders = await fetchOpenDraftOrders();
      shopifyOrders = [...draftOrders, ...shopifyOrders];
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      draftWarning = /access denied|ACCESS_DENIED/i.test(msg)
        ? "Open draft orders aren't shown: the Shopify token is missing the read_draft_orders scope. Completing a draft in Shopify still brings it in on the next sync."
        : `Open draft orders couldn't be loaded: ${msg}`;
      console.error("Failed to fetch draft orders:", e);
    }

    // Fetch local fulfillment state for all orders
    const localOrders = await prisma.shopifyOrder.findMany({
      where: {
        shopifyOrderId: {
          in: shopifyOrders.map((o) => o.id),
        },
      },
      select: {
        shopifyOrderId: true,
        fulfilledAt: true,
        kind: true,
        excludedAt: true,
        excludedReason: true,
      },
    });

    const localFulfillmentMap = new Map(
      localOrders.map((f) => [f.shopifyOrderId, f.fulfilledAt])
    );
    // A stored kind wins over the guess: it may be a correction someone made
    // here, and re-reading the order must not quietly revert it.
    const localKindMap = new Map(localOrders.map((f) => [f.shopifyOrderId, f.kind]));
    // Orders deliberately left off the pick list: still owed, just not today.
    // They keep their card so they can be put back, but they are kept out of
    // the headline totals below — those are what gets pulled from the shelf.
    const excludedMap = new Map(
      localOrders.map((f) => [f.shopifyOrderId, { at: f.excludedAt, reason: f.excludedReason }])
    );

    // Process orders
    const orders: Order[] = [];
    let totalKitsNeeded = 0;
    let totalCanvasesNeeded = 0;
    let totalSupplies = 0;
    let totalOther = 0;
    const unmatchedProducts = new Set<string>();

    // Track demand per design/supply for calculating "ready" counts
    const designDemand = new Map<string, { canvasesNeeded: number; canvasesReady: number }>();
    // Kits are tracked separately from canvases and keyed by POOL, because a
    // shared bag serves any member: `kitStockOf` reports the whole pool to each
    // of them, so a per-design map would count the same three bags once per
    // street sign. Canvases are not interchangeable and stay per design.
    const kitDemand = new Map<string, { needed: number; ready: number }>();
    const supplyDemand = new Map<string, { needed: number; ready: number }>();

    for (const shopifyOrder of shopifyOrders) {
      const items: OrderItem[] = [];
      // Both halves of the pick-list filter, through the same predicate the
      // page uses. This used to test `excludedAt` alone, so an order already
      // deducted kept adding its canvases and kits to the headline totals —
      // stock that has physically left the building, counted as still owed.
      const offPickList = !isOnPickList({
        locallyFulfilled: localFulfillmentMap.get(shopifyOrder.id) != null,
        excludedAt: excludedMap.get(shopifyOrder.id)?.at ?? null,
      });

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
        // Variant first, product title second — see lib/design-match.ts. A
        // bundle's canvas component is titled by its OPTION ("Intro Kit"), so
        // only the variant says which design it is.
        const matchedDesign = resolveDesign(productTitle, lineItem.variantTitle, designIndex) ?? undefined;
        // Where this design's kit bags actually live — its own columns, or the
        // shared pool's. `.home` only: the market tote is deliberately separate
        // stock and an online order never draws on it.
        const matchedKits = matchedDesign ? kitStockOf(matchedDesign) : null;
        // Variant first, product title second — see lib/supply-match.ts. A
        // bare title can collide with a retired row (the "Project Bag" rename)
        // and report its zero stock for a bag there are hundreds of.
        const matchedSupply =
          resolveSupply(productTitle, lineItem.variantTitle, supplies, supplyMap) ?? undefined;

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
          kitsReady: matchedKits?.home ?? 0,
          kitGroupId: matchedKits?.groupId ?? null,
          kitPool: matchedKits?.shared
            ? { name: matchedKits.groupName!, members: matchedKits.memberCount, contents: matchedKits.contents }
            : null,
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

        // Mystery bag lines have no design or supply demand of their own.
        if (itemType === "mystery_bag") continue;

        // Services and credits are not picked, packed or deducted. They are
        // counted here only so the Other tab can show a figure; falling
        // through would add them to `totalSupplies` via the else branch below.
        if (itemType === "other") {
          if (!offPickList) totalOther += lineItem.quantity;
          continue;
        }

        // Count what's needed based on item type. An order that is off the
        // pick list still builds its items, so its card renders and can be put
        // back, but it adds nothing to the totals — those are the shelf-pull
        // figures, and neither an order nobody is packing today nor one whose
        // stock has already been deducted must inflate them.
        if (offPickList) continue;

        if (itemType === "canvas") {
          if (needsKit) {
            totalKitsNeeded += lineItem.quantity;
          }
          totalCanvasesNeeded += lineItem.quantity;

          // Track per-design demand
          if (matchedDesign) {
            const existing = designDemand.get(matchedDesign.id) || {
              canvasesNeeded: 0,
              canvasesReady: matchedDesign.canvasPrinted,
            };
            existing.canvasesNeeded += lineItem.quantity;
            designDemand.set(matchedDesign.id, existing);

            if (needsKit) {
              const key = matchedKits?.groupId ?? matchedDesign.id;
              const kits = kitDemand.get(key) || { needed: 0, ready: matchedKits?.home ?? 0 };
              kits.needed += lineItem.quantity;
              kitDemand.set(key, kits);
            }
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

      const hasMysteryBag = items.some((i) => i.itemType === "mystery_bag");

      const shippingTitle = shopifyOrder.shippingLine?.title || null;
      const storedKind = localKindMap.get(shopifyOrder.id);
      orders.push({
        shopifyOrderId: shopifyOrder.id,
        orderNumber: shopifyOrder.name,
        customerName: shopifyOrder.billingAddress?.name || "Guest",
        createdAt: shopifyOrder.createdAt,
        sourceName: shopifyOrder.sourceName || null,
        isDraft: !!shopifyOrder.isDraftOrder,
        kind: storedKind
          ? toOrderKind(storedKind)
          : classifyOrderKind({
              sourceName: shopifyOrder.sourceName,
              tags: shopifyOrder.tags,
              totalAmount: shopifyOrder.currentTotalPriceSet?.shopMoney?.amount ?? null,
            }),
        items,
        locallyFulfilled: !!localFulfilledAt,
        locallyFulfilledAt: localFulfilledAt?.toISOString() || null,
        excludedAt: excludedMap.get(shopifyOrder.id)?.at?.toISOString() || null,
        excludedReason: excludedMap.get(shopifyOrder.id)?.reason || null,
        hasMysteryBag,
        shippingTitle,
        isExpress: isExpressShippingTitle(shippingTitle),
      });
    }

    // Calculate "ready" totals (capped at what's needed per design/supply)
    let totalCanvasesReady = 0;
    let totalKitsReady = 0;
    for (const demand of designDemand.values()) {
      totalCanvasesReady += Math.min(demand.canvasesReady, demand.canvasesNeeded);
    }
    for (const demand of kitDemand.values()) {
      totalKitsReady += Math.min(demand.ready, demand.needed);
    }

    let totalSuppliesReady = 0;
    for (const demand of supplyDemand.values()) {
      totalSuppliesReady += Math.min(demand.ready, demand.needed);
    }

    // Orders containing at least one mystery bag line (not bag-units sold).
    const totalMysteryBags = orders.filter((o) => o.hasMysteryBag).length;

    const response: OrdersResponse = {
      orders,
      summary: {
        totalOrders: orders.length,
        totalKitsNeeded,
        totalKitsReady,
        totalCanvasesNeeded,
        totalCanvasesReady,
        totalMysteryBags,
        totalOther,
        totalSupplies,
        totalSuppliesReady,
        unmatchedProducts: Array.from(unmatchedProducts),
      },
      draftWarning,
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
