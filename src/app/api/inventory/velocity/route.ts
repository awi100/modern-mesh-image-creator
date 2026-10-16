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
      where: { deletedAt: null, archivedAt: null, notLiveAt: null, isDraft: false, printVersionOf: null },
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
        // Window by the REAL order date; fall back to our row createdAt only for
        // legacy rows that predate the orderDate column (else a batch/backfill
        // sync would dump every historical order into the current week).
        OR: [
          { orderDate: { gte: fourWeeksAgo } },
          { orderDate: null, createdAt: { gte: fourWeeksAgo } },
        ],
      },
      include: {
        items: {
          // processed:true only — an undo sets items processed=false but keeps
          // the rows, and a re-fulfill adds a fresh set; without this filter a
          // re-fulfilled order's line items are counted twice.
          where: { designId: { not: null }, processed: true },
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

    // Bucket orders into weeks by the real order date (fallback: row createdAt)
    for (const order of recentOrders) {
      const orderDate = order.orderDate ?? order.createdAt;
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
// GET removed. It duplicated the weeksOfStock / targetWeeks / stockStatus
// logic from /api/inventory/alerts off the same stale Design.salesVelocity
// column, and nothing ever called it — a third copy to keep in sync, silently
// wrong. Velocity is now derived on read in lib/velocity.ts; /velocity reads
// /api/inventory/alerts, which uses it.
