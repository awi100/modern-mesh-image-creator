import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";
import { shopifyGraphQL, parseNeedsKit, normalizeTitle, OrdersQueryResult } from "@/lib/shopify";

// Fetch ALL fulfilled orders with pagination
async function fetchAllFulfilledOrders(): Promise<OrdersQueryResult["orders"]["nodes"]> {
  const allOrders: OrdersQueryResult["orders"]["nodes"] = [];
  let cursor: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const query = `
      query GetAllFulfilledOrders($cursor: String) {
        orders(
          first: 100
          after: $cursor
          query: "fulfillment_status:fulfilled"
          sortKey: CREATED_AT
          reverse: false
        ) {
          nodes {
            id
            name
            createdAt
            displayFulfillmentStatus
            lineItems(first: 50) {
              nodes {
                id
                title
                variantTitle
                quantity
                product {
                  id
                  title
                }
              }
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `;

    const result: OrdersQueryResult = await shopifyGraphQL<OrdersQueryResult>(query, { cursor });
    allOrders.push(...result.orders.nodes);
    hasNextPage = result.orders.pageInfo.hasNextPage;
    cursor = result.orders.pageInfo.endCursor;

    console.log(`[Backfill] Fetched ${allOrders.length} orders so far...`);
  }

  return allOrders;
}

// POST - Backfill historical sales from Shopify (one-time use)
export async function POST(request: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    console.log("[Backfill] Starting sales backfill...");

    // Fetch all designs for matching
    const designs = await prisma.design.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        name: true,
      },
    });

    const designMap = new Map<string, string>();
    for (const design of designs) {
      designMap.set(normalizeTitle(design.name), design.id);
    }

    console.log(`[Backfill] Found ${designs.length} designs to match against`);

    // Fetch all fulfilled orders
    const orders = await fetchAllFulfilledOrders();
    console.log(`[Backfill] Fetched ${orders.length} total fulfilled orders`);

    // Aggregate sales by design
    const salesByDesign = new Map<string, { total: number; kits: number }>();

    for (const order of orders) {
      for (const lineItem of order.lineItems.nodes) {
        const productTitle = lineItem.product?.title || lineItem.title;
        const normalizedTitle = normalizeTitle(productTitle);
        const designId = designMap.get(normalizedTitle);

        if (designId) {
          const existing = salesByDesign.get(designId) || { total: 0, kits: 0 };
          existing.total += lineItem.quantity;
          if (parseNeedsKit(lineItem.variantTitle)) {
            existing.kits += lineItem.quantity;
          }
          salesByDesign.set(designId, existing);
        }
      }
    }

    console.log(`[Backfill] Found sales for ${salesByDesign.size} designs`);

    // Update designs with sales counts
    let updated = 0;
    for (const [designId, sales] of salesByDesign) {
      await prisma.design.update({
        where: { id: designId },
        data: {
          totalSold: sales.total,
          totalKitsSold: sales.kits,
        },
      });
      updated++;
    }

    console.log(`[Backfill] Updated ${updated} designs with sales data`);

    // Return summary
    const summary = Array.from(salesByDesign.entries()).map(([id, sales]) => {
      const design = designs.find(d => d.id === id);
      return {
        designName: design?.name || id,
        totalSold: sales.total,
        totalKitsSold: sales.kits,
      };
    }).sort((a, b) => b.totalSold - a.totalSold);

    return NextResponse.json({
      success: true,
      ordersProcessed: orders.length,
      designsUpdated: updated,
      summary: summary.slice(0, 20), // Top 20 sellers
    });
  } catch (error) {
    console.error("[Backfill] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Backfill failed" },
      { status: 500 }
    );
  }
}
