import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";
import { buildUnmatchedReport } from "@/lib/unmatched-sales";
import { type BundleData } from "@/lib/bundles";

/**
 * Every sale that deducted nothing, classified.
 *
 * The /orders page already warns about unmatched line items, but it is built
 * from Shopify's *unfulfilled* feed, so a line disappears from it the moment
 * you fulfil the order — which is exactly the moment the deduction was
 * skipped. This is the same question asked of the whole order history.
 *
 * All the judgement lives in lib/unmatched-sales (and the reason a stored
 * title can't be taken at face value is documented there); this route is just
 * the query.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [designs, supplies, bundlesRaw, items] = await Promise.all([
      prisma.design.findMany({
        where: { deletedAt: null },
        select: { id: true, name: true },
      }),
      prisma.supply.findMany({ select: { id: true, name: true } }),
      prisma.bundle.findMany({
        where: { active: true },
        include: { components: { include: { supply: { select: { name: true } } } } },
      }),
      prisma.shopifyOrderItem.findMany({
        where: { processed: true },
        select: {
          productTitle: true,
          variantTitle: true,
          quantity: true,
          designId: true,
          supplyId: true,
          order: { select: { orderNumber: true, orderDate: true, createdAt: true } },
        },
      }),
    ]);

    const bundles: BundleData[] = bundlesRaw.map((b) => ({
      id: b.id,
      title: b.title,
      components: b.components.map((c) => ({
        quantity: c.quantity,
        supplyId: c.supplyId,
        supplyName: c.supply?.name ?? null,
        chooseFrom: c.chooseFrom,
      })),
    }));

    return NextResponse.json(buildUnmatchedReport(items, designs, supplies, bundles));
  } catch (error) {
    console.error("Error building unmatched sales report:", error);
    return NextResponse.json({ error: "Failed to build unmatched sales report" }, { status: 500 });
  }
}
