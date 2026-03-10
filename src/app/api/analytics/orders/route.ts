import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";
import { fetchRecentlyFulfilledOrders, ShopifyOrderNode } from "@/lib/shopify";
import { getDmcColorByNumber } from "@/lib/dmc-pearl-cotton";

interface DesignAnalytics {
  designId: string;
  designName: string;
  previewImageUrl: string | null;
  totalUnitsSold: number;
  totalKitsSold: number;
  kitAttachmentRate: number;
  kitsReady: number;
  canvasPrinted: number;
  velocityCategory: string | null;
  stockAlert: "critical" | "low" | "ok" | null; // New: alert if fast seller with low stock
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

interface PeriodComparison {
  orders: { current: number; previous: number; change: number };
  units: { current: number; previous: number; change: number };
  kitRate: { current: number; previous: number; change: number };
  avgOrderSize: { current: number; previous: number; change: number };
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
  comparison: PeriodComparison | null;
  designPerformance: DesignAnalytics[];
  geographicDistribution: StateAnalytics[];
  weeklyTrends: TimeAnalytics[];
  colorDemand: ColorDemand[];
  bundleOpportunities: {
    design1: string;
    design2: string;
    coOccurrences: number;
  }[];
  stockAlerts: {
    designId: string;
    designName: string;
    previewImageUrl: string | null;
    salesLast30Days: number;
    kitsReady: number;
    canvasPrinted: number;
    daysOfStock: number;
    alertLevel: "critical" | "low";
  }[];
}

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

function processOrders(orders: ShopifyOrderNode[], designByName: Map<string, { id: string; name: string }>) {
  const stateStats = new Map<string, { orders: Set<string>; units: number; kitUnits: number }>();
  const weeklyStats = new Map<string, { orders: number; units: number; kitUnits: number }>();
  const designStats = new Map<string, { units: number; kitUnits: number }>();
  const customerOrders = new Map<string, number>();
  const orderDesigns = new Map<string, Set<string>>();

  let totalOrders = 0;
  let totalUnits = 0;
  let totalKitUnits = 0;

  for (const order of orders) {
    totalOrders++;

    // Track customer by billing name (more reliable than city)
    const customerKey = order.billingAddress?.name?.toLowerCase().trim() || order.name;
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

    const orderDesignSet = new Set<string>();

    for (const item of order.lineItems.nodes) {
      const productTitle = item.title;
      const normalizedTitle = productTitle.toLowerCase().trim();
      const matchedDesign = designByName.get(normalizedTitle);

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

  const repeatCustomers = Array.from(customerOrders.values()).filter((c) => c > 1).length;

  return {
    totalOrders,
    totalUnits,
    totalKitUnits,
    stateStats,
    weeklyStats,
    designStats,
    customerOrders,
    orderDesigns,
    uniqueCustomers: customerOrders.size,
    repeatCustomers,
  };
}

export async function GET(request: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Get period from query params (default 90 days)
    const { searchParams } = new URL(request.url);
    const periodDays = parseInt(searchParams.get("days") || "90", 10);
    const validPeriods = [30, 90, 180, 365];
    const days = validPeriods.includes(periodDays) ? periodDays : 90;

    const periodStart = new Date();
    periodStart.setDate(periodStart.getDate() - days);

    // For comparison, get the previous period too
    const previousPeriodStart = new Date();
    previousPeriodStart.setDate(previousPeriodStart.getDate() - (days * 2));

    let allOrders: ShopifyOrderNode[] = [];

    if (process.env.SHOPIFY_STORE_DOMAIN && process.env.SHOPIFY_ADMIN_TOKEN) {
      try {
        const data = await fetchRecentlyFulfilledOrders(previousPeriodStart);
        allOrders = data.orders.nodes;
      } catch (e) {
        console.error("Error fetching from Shopify:", e);
      }
    }

    // Split orders into current and previous period
    const currentPeriodOrders = allOrders.filter(o => new Date(o.createdAt) >= periodStart);
    const previousPeriodOrders = allOrders.filter(o => {
      const date = new Date(o.createdAt);
      return date >= previousPeriodStart && date < periodStart;
    });

    // Fetch all designs
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

    const designByName = new Map<string, typeof designs[0]>();
    for (const design of designs) {
      designByName.set(design.name.toLowerCase().trim(), design);
    }

    // Process current period
    const current = processOrders(currentPeriodOrders, designByName);

    // Process previous period for comparison
    const previous = processOrders(previousPeriodOrders, designByName);

    // Calculate comparison
    const comparison: PeriodComparison = {
      orders: {
        current: current.totalOrders,
        previous: previous.totalOrders,
        change: previous.totalOrders > 0
          ? Math.round(((current.totalOrders - previous.totalOrders) / previous.totalOrders) * 100)
          : 0,
      },
      units: {
        current: current.totalUnits,
        previous: previous.totalUnits,
        change: previous.totalUnits > 0
          ? Math.round(((current.totalUnits - previous.totalUnits) / previous.totalUnits) * 100)
          : 0,
      },
      kitRate: {
        current: current.totalUnits > 0 ? Math.round((current.totalKitUnits / current.totalUnits) * 100) : 0,
        previous: previous.totalUnits > 0 ? Math.round((previous.totalKitUnits / previous.totalUnits) * 100) : 0,
        change: 0, // Calculate difference, not percentage change
      },
      avgOrderSize: {
        current: current.totalOrders > 0 ? Math.round((current.totalUnits / current.totalOrders) * 10) / 10 : 0,
        previous: previous.totalOrders > 0 ? Math.round((previous.totalUnits / previous.totalOrders) * 10) / 10 : 0,
        change: 0,
      },
    };
    comparison.kitRate.change = comparison.kitRate.current - comparison.kitRate.previous;
    comparison.avgOrderSize.change = Math.round((comparison.avgOrderSize.current - comparison.avgOrderSize.previous) * 10) / 10;

    // Calculate design performance with stock alerts
    const designPerformance: DesignAnalytics[] = designs
      .map((design) => {
        const stats = current.designStats.get(design.id) || { units: 0, kitUnits: 0 };
        const totalStock = design.kitsReady + design.canvasPrinted;
        const salesRate = stats.units / (days / 30); // monthly rate

        let stockAlert: "critical" | "low" | "ok" | null = null;
        if (stats.units > 0) {
          const daysOfStock = salesRate > 0 ? (totalStock / salesRate) * 30 : Infinity;
          if (daysOfStock < 14) stockAlert = "critical";
          else if (daysOfStock < 30) stockAlert = "low";
          else stockAlert = "ok";
        }

        return {
          designId: design.id,
          designName: design.name,
          previewImageUrl: design.previewImageUrl,
          totalUnitsSold: design.totalSold || stats.units,
          totalKitsSold: design.totalKitsSold || stats.kitUnits,
          kitAttachmentRate: design.totalSold > 0
            ? Math.round((design.totalKitsSold / design.totalSold) * 100)
            : 0,
          kitsReady: design.kitsReady,
          canvasPrinted: design.canvasPrinted,
          velocityCategory: design.velocityCategory,
          stockAlert,
        };
      })
      .filter((d) => d.totalUnitsSold > 0)
      .sort((a, b) => b.totalUnitsSold - a.totalUnitsSold);

    // Calculate stock alerts (designs selling fast with low stock)
    const stockAlerts = designs
      .map((design) => {
        const stats = current.designStats.get(design.id) || { units: 0, kitUnits: 0 };
        const totalStock = design.kitsReady + design.canvasPrinted;
        const salesLast30Days = days === 30 ? stats.units : Math.round(stats.units / (days / 30));
        const dailyRate = salesLast30Days / 30;
        const daysOfStock = dailyRate > 0 ? Math.round(totalStock / dailyRate) : Infinity;

        return {
          designId: design.id,
          designName: design.name,
          previewImageUrl: design.previewImageUrl,
          salesLast30Days,
          kitsReady: design.kitsReady,
          canvasPrinted: design.canvasPrinted,
          daysOfStock: daysOfStock === Infinity ? 999 : daysOfStock,
          alertLevel: daysOfStock < 14 ? "critical" as const : "low" as const,
        };
      })
      .filter((d) => d.salesLast30Days > 0 && d.daysOfStock < 30)
      .sort((a, b) => a.daysOfStock - b.daysOfStock)
      .slice(0, 10);

    // Geographic distribution
    const geographicDistribution: StateAnalytics[] = Array.from(current.stateStats.entries())
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

    // Weekly trends
    const weeklyTrends: TimeAnalytics[] = Array.from(current.weeklyStats.entries())
      .map(([period, stats]) => ({
        period,
        orderCount: stats.orders,
        totalUnits: stats.units,
        kitUnits: stats.kitUnits,
      }))
      .sort((a, b) => a.period.localeCompare(b.period));

    // Color demand
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
          cd.skeins += design.totalSold;
        }
      } catch {
        // Skip invalid JSON
      }
    }

    // Use local DMC color data (more reliable than database lookup)
    const colorDemand: ColorDemand[] = Array.from(colorDemandMap.entries())
      .map(([dmcNumber, data]) => {
        const color = getDmcColorByNumber(dmcNumber);
        return {
          dmcNumber,
          colorName: color?.name || "Unknown",
          hex: color?.hex || "#888888",
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

    // Bundle opportunities
    const pairCounts = new Map<string, number>();
    for (const designSet of current.orderDesigns.values()) {
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

    const repeatCustomerRate = current.uniqueCustomers > 0
      ? Math.round((current.repeatCustomers / current.uniqueCustomers) * 100)
      : 0;

    const analytics: OrderAnalytics = {
      summary: {
        totalOrders: current.totalOrders,
        totalUnits: current.totalUnits,
        totalKitUnits: current.totalKitUnits,
        overallKitRate: current.totalUnits > 0 ? Math.round((current.totalKitUnits / current.totalUnits) * 100) : 0,
        uniqueCustomers: current.uniqueCustomers,
        repeatCustomerRate,
        avgUnitsPerOrder: current.totalOrders > 0 ? Math.round((current.totalUnits / current.totalOrders) * 10) / 10 : 0,
        periodDays: days,
      },
      comparison: previous.totalOrders > 0 ? comparison : null,
      designPerformance,
      geographicDistribution,
      weeklyTrends,
      colorDemand,
      bundleOpportunities,
      stockAlerts,
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
