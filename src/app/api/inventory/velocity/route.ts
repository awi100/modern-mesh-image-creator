import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";

// Velocity category thresholds (units per week)
const FAST_THRESHOLD = 3; // 3+ units/week
const MEDIUM_THRESHOLD = 1; // 1-3 units/week
// Below 1 = slow

// New design criteria
const NEW_DESIGN_MIN_WEEKS = 1;
const NEW_DESIGN_MIN_SALES = 6;

// Weights for each week (most recent = highest weight)
// Week 1 (most recent): 40%, Week 2: 30%, Week 3: 20%, Week 4: 10%
const WEEK_WEIGHTS = [0.4, 0.3, 0.2, 0.1];

function determineVelocityCategory(
  velocity: number,
  totalSales: number,
  designAgeWeeks: number,
  override?: string | null
): string {
  // Manual override takes precedence
  if (override && ["fast", "medium", "slow"].includes(override)) {
    return override;
  }

  // Check if design is "new" (less than 1 week old OR less than 6 total sales)
  if (designAgeWeeks < NEW_DESIGN_MIN_WEEKS || totalSales < NEW_DESIGN_MIN_SALES) {
    return "new";
  }

  // Categorize based on velocity
  if (velocity >= FAST_THRESHOLD) {
    return "fast";
  } else if (velocity >= MEDIUM_THRESHOLD) {
    return "medium";
  } else {
    return "slow";
  }
}

// POST - Recalculate velocities for all designs
export async function POST(request: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const now = new Date();
    const fourWeeksAgo = new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000);

    // Get all non-deleted designs
    const designs = await prisma.design.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        totalSold: true,
        velocityCategoryOverride: true,
        createdAt: true,
      },
    });

    // Get all fulfilled orders from the last 4 weeks with their items
    const recentOrders = await prisma.shopifyOrder.findMany({
      where: {
        fulfilledAt: { not: null },
        createdAt: { gte: fourWeeksAgo },
      },
      include: {
        items: {
          where: { designId: { not: null } },
          select: {
            designId: true,
            quantity: true,
          },
        },
      },
    });

    // Calculate weekly sales per design
    const designWeeklySales = new Map<string, number[]>();

    // Initialize all designs with empty weeks
    for (const design of designs) {
      designWeeklySales.set(design.id, [0, 0, 0, 0]);
    }

    // Bucket orders into weeks
    for (const order of recentOrders) {
      const orderDate = order.createdAt;
      const weekIndex = Math.floor((now.getTime() - orderDate.getTime()) / (7 * 24 * 60 * 60 * 1000));

      if (weekIndex >= 0 && weekIndex < 4) {
        for (const item of order.items) {
          if (item.designId) {
            const weeks = designWeeklySales.get(item.designId);
            if (weeks) {
              weeks[weekIndex] += item.quantity;
            }
          }
        }
      }
    }

    // Calculate weighted velocity and update designs
    const updates: { id: string; velocity: number; category: string }[] = [];

    for (const design of designs) {
      const weeklySales = designWeeklySales.get(design.id) || [0, 0, 0, 0];

      // Calculate weighted average
      let weightedSum = 0;
      let totalWeight = 0;

      for (let i = 0; i < 4; i++) {
        weightedSum += weeklySales[i] * WEEK_WEIGHTS[i];
        totalWeight += WEEK_WEIGHTS[i];
      }

      const velocity = weightedSum / totalWeight;

      // Calculate design age in weeks
      const designAgeMs = now.getTime() - design.createdAt.getTime();
      const designAgeWeeks = designAgeMs / (7 * 24 * 60 * 60 * 1000);

      // Determine category
      const category = determineVelocityCategory(
        velocity,
        design.totalSold,
        designAgeWeeks,
        design.velocityCategoryOverride
      );

      updates.push({ id: design.id, velocity, category });
    }

    // Batch update all designs
    await prisma.$transaction(
      updates.map((u) =>
        prisma.design.update({
          where: { id: u.id },
          data: {
            salesVelocity: u.velocity,
            velocityCategory: u.category,
            lastVelocityUpdate: now,
          },
        })
      )
    );

    // Calculate summary stats
    const summary = {
      total: updates.length,
      fast: updates.filter((u) => u.category === "fast").length,
      medium: updates.filter((u) => u.category === "medium").length,
      slow: updates.filter((u) => u.category === "slow").length,
      new: updates.filter((u) => u.category === "new").length,
    };

    return NextResponse.json({
      success: true,
      updated: updates.length,
      summary,
      updatedAt: now.toISOString(),
    });
  } catch (error) {
    console.error("Error calculating velocities:", error);
    return NextResponse.json(
      { error: "Failed to calculate velocities" },
      { status: 500 }
    );
  }
}

// GET - Get velocity data for all designs
export async function GET() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const designs = await prisma.design.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        name: true,
        previewImageUrl: true,
        totalSold: true,
        totalKitsSold: true,
        salesVelocity: true,
        velocityCategory: true,
        velocityCategoryOverride: true,
        targetStockWeeks: true,
        lastVelocityUpdate: true,
        kitsReady: true,
        canvasPrinted: true,
        kitSkeinCount: true,
        createdAt: true,
      },
      orderBy: [
        { salesVelocity: "desc" },
        { totalSold: "desc" },
      ],
    });

    // Calculate weeks of stock for each design
    const designsWithStock = designs.map((design) => {
      const velocity = design.salesVelocity ?? 0;
      const kitsReady = design.kitsReady ?? 0;

      // Weeks of stock = kits ready / weekly velocity
      const weeksOfStock = velocity > 0 ? kitsReady / velocity : kitsReady > 0 ? 999 : 0;

      // Determine target weeks based on velocity category
      let targetWeeks = design.targetStockWeeks;
      if (!targetWeeks) {
        switch (design.velocityCategory) {
          case "fast": targetWeeks = 6; break;
          case "medium": targetWeeks = 8; break;
          case "slow": targetWeeks = 12; break;
          case "new": targetWeeks = 4; break;
          default: targetWeeks = 8;
        }
      }

      // Determine stock status
      let stockStatus: "critical" | "low" | "healthy";
      const criticalThreshold = targetWeeks * 0.33; // 1/3 of target
      const lowThreshold = targetWeeks * 0.66; // 2/3 of target

      if (weeksOfStock < criticalThreshold) {
        stockStatus = "critical";
      } else if (weeksOfStock < lowThreshold) {
        stockStatus = "low";
      } else {
        stockStatus = "healthy";
      }

      return {
        ...design,
        weeksOfStock: Math.round(weeksOfStock * 10) / 10,
        targetWeeks,
        stockStatus,
        kitsNeededForTarget: Math.max(0, Math.ceil(velocity * targetWeeks) - kitsReady),
      };
    });

    // Summary
    const summary = {
      total: designs.length,
      fast: designs.filter((d) => d.velocityCategory === "fast").length,
      medium: designs.filter((d) => d.velocityCategory === "medium").length,
      slow: designs.filter((d) => d.velocityCategory === "slow").length,
      new: designs.filter((d) => d.velocityCategory === "new").length,
      critical: designsWithStock.filter((d) => d.stockStatus === "critical").length,
      low: designsWithStock.filter((d) => d.stockStatus === "low").length,
      healthy: designsWithStock.filter((d) => d.stockStatus === "healthy").length,
    };

    return NextResponse.json({
      designs: designsWithStock,
      summary,
    });
  } catch (error) {
    console.error("Error fetching velocity data:", error);
    return NextResponse.json(
      { error: "Failed to fetch velocity data" },
      { status: 500 }
    );
  }
}

// PATCH - Update velocity override for a specific design
export async function PATCH(request: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { designId, velocityCategoryOverride, targetStockWeeks } = body;

    if (!designId) {
      return NextResponse.json({ error: "designId is required" }, { status: 400 });
    }

    const data: Record<string, unknown> = {};

    if (velocityCategoryOverride !== undefined) {
      // Allow null to clear override, or valid category
      if (velocityCategoryOverride === null || ["fast", "medium", "slow"].includes(velocityCategoryOverride)) {
        data.velocityCategoryOverride = velocityCategoryOverride;

        // If setting an override, also update the category itself
        if (velocityCategoryOverride) {
          data.velocityCategory = velocityCategoryOverride;
        }
      } else {
        return NextResponse.json({ error: "Invalid velocity category" }, { status: 400 });
      }
    }

    if (targetStockWeeks !== undefined) {
      data.targetStockWeeks = targetStockWeeks;
    }

    const design = await prisma.design.update({
      where: { id: designId },
      data,
      select: {
        id: true,
        name: true,
        velocityCategory: true,
        velocityCategoryOverride: true,
        targetStockWeeks: true,
      },
    });

    return NextResponse.json(design);
  } catch (error) {
    console.error("Error updating velocity override:", error);
    return NextResponse.json(
      { error: "Failed to update velocity override" },
      { status: 500 }
    );
  }
}
