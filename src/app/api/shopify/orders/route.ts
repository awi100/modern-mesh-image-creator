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
  designId: string | null;
  designName: string | null;
  previewImageUrl: string | null;
  kitsReady: number;
  canvasPrinted: number;
  folderId: string | null;
  folderName: string | null;
  totalSold: number;
}

export interface Order {
  shopifyOrderId: string;
  orderNumber: string;
  customerName: string;
  createdAt: string;
  items: OrderItem[];
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

// Supply product types (exact match, case-insensitive)
// Products with these EXACT types are classified as supplies, not canvases
const SUPPLY_PRODUCT_TYPES = new Set([
  "supplies",
  "supply",
  "accessory",
  "accessories",
  "needle",
  "needles",
  "finisher",
  "finishers",
  "needle minder",
  "needle minders",
  "tool",
  "tools",
]);

// Classify item type based on product type and whether it matches a design
function classifyItemType(productType: string | null, matchedDesign: boolean): ItemType {
  // If it matches a design in our system, it's always a canvas
  if (matchedDesign) {
    return "canvas";
  }

  // If product type EXACTLY matches a supply type, it's a supply
  if (productType) {
    const normalized = productType.toLowerCase().trim();
    if (SUPPLY_PRODUCT_TYPES.has(normalized)) {
      return "supply";
    }
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

    // Create a map for fast lookup by normalized name
    const designMap = new Map<string, typeof designs[0]>();
    for (const design of designs) {
      designMap.set(normalizeTitle(design.name), design);
    }

    // Fetch unfulfilled orders from Shopify
    const shopifyData = await fetchUnfulfilledOrders();
    const shopifyOrders = shopifyData.orders.nodes;

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
        const needsKit = parseNeedsKit(lineItem.variantTitle);

        // Try to match to a design
        const normalizedTitle = normalizeTitle(productTitle);
        const matchedDesign = designMap.get(normalizedTitle);

        // Classify item type
        const itemType = classifyItemType(productType, !!matchedDesign);

        if (!matchedDesign && itemType === "canvas") {
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

      orders.push({
        shopifyOrderId: shopifyOrder.id,
        orderNumber: shopifyOrder.name,
        customerName: shopifyOrder.billingAddress?.name || "Guest",
        createdAt: shopifyOrder.createdAt,
        items,
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
