import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";
import { fetchRecentlyFulfilledOrders, ShopifyOrderNode } from "@/lib/shopify";

interface DesignAnalytics {
  designId: string;
  designName: string;
  previewImageUrl: string | null;
  totalUnitsSold: number;
  totalKitsSold: number;
  kitAttachmentRate: number; // percentage
  revenue: number; // estimated based on quantity
  kitsReady: number;
  canvasPrinted: number;
  velocityCategory: string | null;
}

interface StateAnalytics {
  state: string;
  stateCode: string;
  orderCount: number;
  totalUnits: number;
  kitUnits: number;
  kitRate: number;
}

interface TimeAnalytics {
  period: string;
  orderCount: number;
  totalUnits: number;
  kitUnits: number;
}

interface ColorDemand {
  dmcNumber: string;
  colorName: string;
  hex: string;
  totalSkeinsNeeded: number;
  designCount: number;
  topDesigns: { name: string; skeins: number }[];
}

interface OrderAnalytics {
  summary: {
    totalOrders: number;
    totalUnits: number;
    totalKitUnits: number;
    overallKitRate: number;
    uniqueCustomers: number;
    repeatCustomerRate: number;
    avgUnitsPerOrder: number;
    periodDays: number;
  };
  designPerformance: DesignAnalytics[];
  geographicDistribution: StateAnalytics[];
  weeklyTrends: TimeAnalytics[];
  colorDemand: ColorDemand[];
  bundleOpportunities: {
    design1: string;
    design2: string;
    coOccurrences: number;
  }[];
}

// State code to name mapping
const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri",
  MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio",
  OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
  VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  DC: "District of Columbia", PR: "Puerto Rico",
};

// GET - Fetch order analytics
export async function GET() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Fetch order data from Shopify (last 90 days for good sample)
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    let shopifyOrders: ShopifyOrderNode[] = [];

    // Try to fetch from Shopify
    if (process.env.SHOPIFY_STORE_DOMAIN && process.env.SHOPIFY_ADMIN_TOKEN) {
      try {
        const data = await fetchRecentlyFulfilledOrders(ninetyDaysAgo);
        shopifyOrders = data.orders.nodes;
      } catch (e) {
        console.error("Error fetching from Shopify:", e);
      }
    }

    // Fetch all designs for matching and kit info
    const designs = await prisma.design.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        name: true,
        previewImageUrl: true,
        kitsReady: true,
        canvasPrinted: true,
        totalSold: true,
        totalKitsSold: true,
        velocityCategory: true,
        colorsUsed: true,
      },
    });

    // Create design lookup by normalized name
    const designByName = new Map<string, typeof designs[0]>();
    for (const design of designs) {
      const normalized = design.name.toLowerCase().trim();
      designByName.set(normalized, design);
    }

    // Process orders
    const stateStats = new Map<string, { orders: Set<string>; units: number; kitUnits: number }>();
    const weeklyStats = new Map<string, { orders: number; units: number; kitUnits: number }>();
    const designStats = new Map<string, { units: number; kitUnits: number }>();
    const customerOrders = new Map<string, number>(); // customer name -> order count
    const orderDesigns = new Map<string, Set<string>>(); // order ID -> design names (for bundle analysis)

    let totalOrders = 0;
    let totalUnits = 0;
    let totalKitUnits = 0;

    for (const order of shopifyOrders) {
      totalOrders++;

      // Track customer for repeat analysis
      const customerKey = order.billingAddress?.city
        ? `${order.billingAddress.city.toLowerCase()}`
        : order.name;
      customerOrders.set(customerKey, (customerOrders.get(customerKey) || 0) + 1);

      // Track state
      const stateCode = order.billingAddress?.provinceCode ?? "Unknown";
      if (!stateStats.has(stateCode)) {
        stateStats.set(stateCode, { orders: new Set(), units: 0, kitUnits: 0 });
      }
      const stateStat = stateStats.get(stateCode)!;
      stateStat.orders.add(order.id);

      // Track weekly
      const orderDate = new Date(order.createdAt);
      const weekStart = new Date(orderDate);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay());
      const weekKey = weekStart.toISOString().split("T")[0];
      if (!weeklyStats.has(weekKey)) {
        weeklyStats.set(weekKey, { orders: 0, units: 0, kitUnits: 0 });
      }
      const weekStat = weeklyStats.get(weekKey)!;
      weekStat.orders++;

      // Track designs in this order for bundle analysis
      const orderDesignSet = new Set<string>();

      // Process line items
      for (const item of order.lineItems.nodes) {
        const productTitle = item.title;
        const normalizedTitle = productTitle.toLowerCase().trim();
        const matchedDesign = designByName.get(normalizedTitle);

        // Determine if kit was included
        const variantTitle = item.variantTitle?.toLowerCase() || "";
        const isIntro = normalizedTitle.includes("intro") || normalizedTitle.includes("beginner");
        const needsKit = isIntro || variantTitle.includes("yes");

        totalUnits += item.quantity;
        stateStat.units += item.quantity;
        weekStat.units += item.quantity;

        if (needsKit) {
          totalKitUnits += item.quantity;
          stateStat.kitUnits += item.quantity;
          weekStat.kitUnits += item.quantity;
        }

        if (matchedDesign) {
          orderDesignSet.add(matchedDesign.name);

          if (!designStats.has(matchedDesign.id)) {
            designStats.set(matchedDesign.id, { units: 0, kitUnits: 0 });
          }
          const dStat = designStats.get(matchedDesign.id)!;
          dStat.units += item.quantity;
          if (needsKit) {
            dStat.kitUnits += item.quantity;
          }
        }
      }

      orderDesigns.set(order.id, orderDesignSet);
    }

    // Calculate design performance
    const designPerformance: DesignAnalytics[] = designs
      .map((design) => {
        const stats = designStats.get(design.id) || { units: 0, kitUnits: 0 };
        return {
          designId: design.id,
          designName: design.name,
          previewImageUrl: design.previewImageUrl,
          totalUnitsSold: design.totalSold || stats.units,
          totalKitsSold: design.totalKitsSold || stats.kitUnits,
          kitAttachmentRate: design.totalSold > 0
            ? Math.round((design.totalKitsSold / design.totalSold) * 100)
            : 0,
          revenue: 0, // Would need price data
          kitsReady: design.kitsReady,
          canvasPrinted: design.canvasPrinted,
          velocityCategory: design.velocityCategory,
        };
      })
      .filter((d) => d.totalUnitsSold > 0)
      .sort((a, b) => b.totalUnitsSold - a.totalUnitsSold);

    // Calculate geographic distribution
    const geographicDistribution: StateAnalytics[] = Array.from(stateStats.entries())
      .map(([stateCode, stats]) => ({
        state: STATE_NAMES[stateCode] || stateCode,
        stateCode,
        orderCount: stats.orders.size,
        totalUnits: stats.units,
        kitUnits: stats.kitUnits,
        kitRate: stats.units > 0 ? Math.round((stats.kitUnits / stats.units) * 100) : 0,
      }))
      .filter((s) => s.stateCode !== "Unknown")
      .sort((a, b) => b.orderCount - a.orderCount);

    // Calculate weekly trends
    const weeklyTrends: TimeAnalytics[] = Array.from(weeklyStats.entries())
      .map(([period, stats]) => ({
        period,
        orderCount: stats.orders,
        totalUnits: stats.units,
        kitUnits: stats.kitUnits,
      }))
      .sort((a, b) => a.period.localeCompare(b.period));

    // Calculate color demand from sold designs
    const colorDemandMap = new Map<string, { skeins: number; designs: Set<string>; topDesigns: Map<string, number> }>();

    for (const design of designs) {
      if (!design.colorsUsed || design.totalSold === 0) continue;

      try {
        const colors: string[] = JSON.parse(design.colorsUsed);
        for (const dmcNumber of colors) {
          if (!colorDemandMap.has(dmcNumber)) {
            colorDemandMap.set(dmcNumber, { skeins: 0, designs: new Set(), topDesigns: new Map() });
          }
          const cd = colorDemandMap.get(dmcNumber)!;
          cd.designs.add(design.name);
          cd.topDesigns.set(design.name, (cd.topDesigns.get(design.name) || 0) + design.totalSold);
          cd.skeins += design.totalSold; // Simplified - actual calculation would need kit contents
        }
      } catch {
        // Skip if colorsUsed is not valid JSON
      }
    }

    // Fetch DMC colors for display
    const dmcColors = await prisma.dmcColor.findMany({
      where: { dmcNumber: { in: Array.from(colorDemandMap.keys()) } },
      select: { dmcNumber: true, name: true, hexColor: true },
    });
    const dmcColorMap = new Map(dmcColors.map((c) => [c.dmcNumber, c]));

    const colorDemand: ColorDemand[] = Array.from(colorDemandMap.entries())
      .map(([dmcNumber, data]) => {
        const color = dmcColorMap.get(dmcNumber);
        return {
          dmcNumber,
          colorName: color?.name || "Unknown",
          hex: color?.hexColor || "#888888",
          totalSkeinsNeeded: data.skeins,
          designCount: data.designs.size,
          topDesigns: Array.from(data.topDesigns.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([name, skeins]) => ({ name, skeins })),
        };
      })
      .sort((a, b) => b.totalSkeinsNeeded - a.totalSkeinsNeeded)
      .slice(0, 20);

    // Calculate bundle opportunities (designs frequently bought together)
    const pairCounts = new Map<string, number>();
    for (const designSet of orderDesigns.values()) {
      const designArray = Array.from(designSet);
      for (let i = 0; i < designArray.length; i++) {
        for (let j = i + 1; j < designArray.length; j++) {
          const pair = [designArray[i], designArray[j]].sort().join("|||");
          pairCounts.set(pair, (pairCounts.get(pair) || 0) + 1);
        }
      }
    }

    const bundleOpportunities = Array.from(pairCounts.entries())
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([pair, count]) => {
        const [design1, design2] = pair.split("|||");
        return { design1, design2, coOccurrences: count };
      });

    // Calculate repeat customer rate
    const repeatCustomers = Array.from(customerOrders.values()).filter((c) => c > 1).length;
    const uniqueCustomers = customerOrders.size;
    const repeatCustomerRate = uniqueCustomers > 0
      ? Math.round((repeatCustomers / uniqueCustomers) * 100)
      : 0;

    const analytics: OrderAnalytics = {
      summary: {
        totalOrders,
        totalUnits,
        totalKitUnits,
        overallKitRate: totalUnits > 0 ? Math.round((totalKitUnits / totalUnits) * 100) : 0,
        uniqueCustomers,
        repeatCustomerRate,
        avgUnitsPerOrder: totalOrders > 0 ? Math.round((totalUnits / totalOrders) * 10) / 10 : 0,
        periodDays: 90,
      },
      designPerformance,
      geographicDistribution,
      weeklyTrends,
      colorDemand,
      bundleOpportunities,
    };

    return NextResponse.json(analytics);
  } catch (error) {
    console.error("Error fetching order analytics:", error);
    return NextResponse.json(
      { error: "Failed to fetch analytics" },
      { status: 500 }
    );
  }
}
