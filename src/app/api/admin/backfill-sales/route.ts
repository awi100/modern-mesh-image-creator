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
    const titleCollisions: string[] = [];
    for (const design of designs) {
      const key = normalizeTitle(design.name);
      if (designMap.has(key)) {
        // Two designs normalize to the same title — sales can't be attributed
        // unambiguously. Surface it instead of silently keeping the last one.
        titleCollisions.push(design.name);
      }
      designMap.set(key, design.id);
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

    // Recompute from scratch: zero every design first so designs that no
    // longer match any order don't keep stale counts from a prior run, then
    // set the matched totals. Idempotent — safe to run repeatedly.
    let updated = 0;
    await prisma.$transaction(async (tx) => {
      await tx.design.updateMany({
        where: { deletedAt: null },
        data: { totalSold: 0, totalKitsSold: 0 },
      });
      for (const [designId, sales] of salesByDesign) {
        await tx.design.update({
          where: { id: designId },
          data: {
            totalSold: sales.total,
            totalKitsSold: sales.kits,
          },
        });
        updated++;
      }
    });

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
      titleCollisions, // designs whose normalized name collides with another
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
