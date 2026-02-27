import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";
import {
  fetchUnfulfilledOrders,
  parseNeedsKit,
  normalizeTitle,
  ShopifyOrderNode,
} from "@/lib/shopify";

export type ItemType = "canvas" | "supply";

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
}

export interface Order {
  shopifyOrderId: string;
  orderNumber: string;
  customerName: string;
  createdAt: string;
  items: OrderItem[];
  // Local fulfillment tracking
  locallyFulfilled: boolean;
  locallyFulfilledAt: string | null;
}

export interface OrdersResponse {
  orders: Order[];
  summary: {
    totalOrders: number;
    totalKitsNeeded: number;
    totalCanvasesNeeded: number;
    totalSupplies: number;
    unmatchedProducts: string[];
  };
}

// Classify item type based on whether it matches a design or supply
function classifyItemType(matchedDesign: boolean, matchedSupply: boolean): ItemType {
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

    const supplyMap = new Map<string, typeof supplies[0]>();
    for (const supply of supplies) {
      supplyMap.set(normalizeTitle(supply.name), supply);
    }

    // Fetch unfulfilled orders from Shopify
    const shopifyData = await fetchUnfulfilledOrders();
    const shopifyOrders = shopifyData.orders.nodes;

    // Fetch local fulfillment status for all orders
    const localFulfillments = await prisma.shopifyOrder.findMany({
      where: {
        shopifyOrderId: {
          in: shopifyOrders.map((o) => o.id),
        },
        fulfilledAt: { not: null },
      },
      select: {
        shopifyOrderId: true,
        fulfilledAt: true,
      },
    });

    const localFulfillmentMap = new Map(
      localFulfillments.map((f) => [f.shopifyOrderId, f.fulfilledAt])
    );

    // Process orders
    const orders: Order[] = [];
    let totalKitsNeeded = 0;
    let totalCanvasesNeeded = 0;
    let totalSupplies = 0;
    const unmatchedProducts = new Set<string>();

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

        // Classify item type based on matches
        const itemType = classifyItemType(!!matchedDesign, !!matchedSupply);

        if (!matchedDesign && !matchedSupply && itemType === "canvas") {
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
        });

        // Count what's needed based on item type
        if (itemType === "canvas") {
          if (needsKit) {
            totalKitsNeeded += lineItem.quantity;
          }
          totalCanvasesNeeded += lineItem.quantity;
        } else {
          totalSupplies += lineItem.quantity;
        }
      }

      const localFulfilledAt = localFulfillmentMap.get(shopifyOrder.id);

      orders.push({
        shopifyOrderId: shopifyOrder.id,
        orderNumber: shopifyOrder.name,
        customerName: shopifyOrder.billingAddress?.name || "Guest",
        createdAt: shopifyOrder.createdAt,
        items,
        locallyFulfilled: !!localFulfilledAt,
        locallyFulfilledAt: localFulfilledAt?.toISOString() || null,
      });
    }

    const response: OrdersResponse = {
      orders,
      summary: {
        totalOrders: orders.length,
        totalKitsNeeded,
        totalCanvasesNeeded,
        totalSupplies,
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
