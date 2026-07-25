import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";
import { countStitchesByColor } from "@/lib/color-utils";
import { calculateYarnUsage, MeshCount } from "@/lib/yarn-calculator";
import pako from "pako";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;

    const design = await prisma.design.findUnique({
      where: { id },
      include: {
        folder: true,
        tags: {
          include: {
            tag: true,
          },
        },
      },
    });

    if (!design) {
      return NextResponse.json({ error: "Design not found" }, { status: 404 });
    }

    // Decompress pixel data
    let grid: (string | null)[][] = [];
    if (design.pixelData) {
      try {
        const decompressed = pako.inflate(design.pixelData);
        const jsonStr = new TextDecoder().decode(decompressed);
        grid = JSON.parse(jsonStr);
      } catch {
        // If decompression fails, it might be stored as plain JSON
        const jsonStr = design.pixelData.toString();
        grid = JSON.parse(jsonStr);
      }
    }

    return NextResponse.json({
      ...design,
      pixelData: undefined,
      grid,
      tags: design.tags.map((dt) => dt.tag),
    });
  } catch (error) {
    console.error("Error fetching design:", error);
    return NextResponse.json(
      { error: "Failed to fetch design" },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const body = await request.json();

    const {
      name,
      widthInches,
      heightInches,
      meshCount,
      gridWidth,
      gridHeight,
      pixelData,
      stitchType,
      bufferPercent,
      referenceImageUrl,
      referenceImageOpacity,
      folderId,
      isDraft,
      tagIds,
      previewImageUrl,
    } = body;

    // Convert base64 to Buffer
    const pixelDataBuffer = pixelData
      ? Buffer.from(pixelData, "base64")
      : undefined;

    // Precompute kit summary from pixel data
    let kitColorCount: number | undefined;
    let kitSkeinCount: number | undefined;
    let colorsUsed: string | undefined;
    let totalStitches: number | undefined;
    if (pixelDataBuffer) {
      try {
        const decompressed = pako.inflate(pixelDataBuffer, { to: "string" });
        const grid: (string | null)[][] = JSON.parse(decompressed);
        const stitchCounts = countStitchesByColor(grid);
        // Calculate total stitches
        totalStitches = 0;
        for (const count of stitchCounts.values()) {
          totalStitches += count;
        }
        const yarnUsage = calculateYarnUsage(
          stitchCounts,
          (meshCount || 14) as MeshCount,
          (stitchType || "continental") as "continental" | "basketweave",
          bufferPercent ?? 20
        );
        kitColorCount = yarnUsage.length;
        kitSkeinCount = yarnUsage.reduce((sum, u) => sum + (u.usesFullSkein ? u.skeinsNeeded : 0), 0);
        // Store the DMC numbers used (stitchCounts is a Map)
        colorsUsed = JSON.stringify(Array.from(stitchCounts.keys()));
      } catch (e) {
        console.error("Error computing kit summary:", e);
      }
    }

    // Log what we're about to save
    console.log("[PUT /api/designs] Saving:", {
      id,
      name,
      gridWidth,
      gridHeight,
      hasPixelData: !!pixelDataBuffer,
      pixelDataSize: pixelDataBuffer?.length,
      totalStitches,
      kitColorCount,
    });

    // Update design (increment version for offline sync conflict detection)
    const design = await prisma.design.update({
      where: { id },
      data: {
        name,
        widthInches,
        heightInches,
        meshCount,
        gridWidth,
        gridHeight,
        pixelData: pixelDataBuffer,
        stitchType,
        bufferPercent,
        referenceImageUrl,
        referenceImageOpacity,
        folderId,
        isDraft,
        previewImageUrl,
        kitColorCount,
        kitSkeinCount,
        colorsUsed,
        totalStitches,
        version: { increment: 1 },
      },
      include: {
        folder: true,
        tags: {
          include: {
            tag: true,
          },
        },
      },
    });

    // Sync print version if grid data changed
    if (pixelDataBuffer) {
      try {
        const printVersion = await prisma.design.findUnique({
          where: { printVersionOf: id },
          select: { id: true },
        });
        if (printVersion) {
          await prisma.design.update({
            where: { id: printVersion.id },
            data: {
              pixelData: pixelDataBuffer,
              widthInches,
              heightInches,
              meshCount,
              gridWidth,
              gridHeight,
              kitColorCount,
              kitSkeinCount,
              colorsUsed,
              totalStitches,
              previewImageUrl: null, // Clear so it regenerates
            },
          });
        }
      } catch (e) {
        console.error("Error syncing print version:", e);
      }
    }

    // Update tags if provided
    if (tagIds !== undefined) {
      // Remove existing tags
      await prisma.designTag.deleteMany({
        where: { designId: id },
      });

      // Add new tags
      if (tagIds.length > 0) {
        await prisma.designTag.createMany({
          data: tagIds.map((tagId: string) => ({ designId: id, tagId })),
        });
      }
    }

    console.log("[PUT /api/designs] Save SUCCESS:", {
      id: design.id,
      name: design.name,
      updatedAt: design.updatedAt,
    });

    return NextResponse.json({
      ...design,
      pixelData: undefined,
      tags: design.tags.map((dt) => dt.tag),
    });
  } catch (error) {
    // Get ID again for logging (may have failed earlier)
    let designIdForLog = "unknown";
    try {
      const { id } = await params;
      designIdForLog = id;
    } catch {}

    console.error("[PUT /api/designs] Save failed:", {
      designId: designIdForLog,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      timestamp: new Date().toISOString(),
    });
    return NextResponse.json(
      { error: "Failed to update design", details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const permanent = searchParams.get("permanent") === "true";

    if (permanent) {
      // Permanent delete - actually remove from database
      await prisma.design.delete({
        where: { id },
      });
    } else {
      // Soft delete - move to trash (also soft-delete print version)
      await prisma.design.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
      await prisma.design.updateMany({
        where: { printVersionOf: id },
        data: { deletedAt: new Date() },
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting design:", error);
    return NextResponse.json(
      { error: "Failed to delete design" },
      { status: 500 }
    );
  }
}

// PATCH for partial updates (folder, canvas printed counter, kits ready, restore from trash)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const body = await request.json();

    // Validate & coerce all counter fields to integers up front. These feed
    // Prisma atomic increments and Math.max clamps; a string or NaN would
    // corrupt the stored count (e.g. 3 + "5" -> "35") or throw a 500.
    const numericFields = [
      "kitsReady", "canvasPrinted", "canvasPrintedMaddie",
      "marketKitsReady", "marketCanvasPrinted", "canvasAndover",
      "canvasPrintedDelta", "kitsReadyDelta", "canvasPrintedMaddieDelta",
      "marketTransferKitsDelta", "marketTransferCanvasDelta",
      "andoverTransferDelta", "canvasAndoverDelta",
    ] as const;
    for (const field of numericFields) {
      if (body[field] !== undefined) {
        const n = Number(body[field]);
        if (!Number.isInteger(n)) {
          return NextResponse.json({ error: `${field} must be an integer` }, { status: 400 });
        }
        body[field] = n;
      }
    }

    const data: Record<string, unknown> = {};

    // Restore from trash (also restore print version)
    if (body.restore === true) {
      data.deletedAt = null;
      await prisma.design.updateMany({
        where: { printVersionOf: id },
        data: { deletedAt: null },
      });
    }

    // Archive / unarchive (also cascades to the print version so it stays in
    // sync and out of any exports).
    if (body.archived !== undefined) {
      const archivedAt = body.archived ? new Date() : null;
      data.archivedAt = archivedAt;
      await prisma.design.updateMany({
        where: { printVersionOf: id },
        data: { archivedAt },
      });
    }

    // Not Live: printed but not for sale yet. Marking Not Live also clears the
    // WIP draft flag (it's past draft) and the archived flag; marking Live
    // clears notLiveAt. Cascades to the print version.
    if (body.notLive !== undefined) {
      const notLiveAt = body.notLive ? new Date() : null;
      data.notLiveAt = notLiveAt;
      if (body.notLive) {
        data.isDraft = false;
        data.archivedAt = null;
      }
      await prisma.design.updateMany({
        where: { printVersionOf: id },
        data: { notLiveAt },
      });
    }

    if (body.name !== undefined) {
      data.name = body.name;
    }

    if (body.folderId !== undefined) {
      data.folderId = body.folderId;
    }

    if (body.skillLevel !== undefined) {
      data.skillLevel = body.skillLevel || null;
    }

    if (body.sizeCategory !== undefined) {
      data.sizeCategory = body.sizeCategory || null;
    }

    if (body.excludeFromStockAlerts !== undefined) {
      data.excludeFromStockAlerts = !!body.excludeFromStockAlerts;
    }

    // Handle absolute value updates for counters
    if (body.kitsReady !== undefined) {
      data.kitsReady = Math.max(0, body.kitsReady);
    }

    if (body.canvasPrinted !== undefined) {
      data.canvasPrinted = Math.max(0, body.canvasPrinted);
    }

    if (body.canvasPrintedMaddie !== undefined) {
      data.canvasPrintedMaddie = Math.max(0, body.canvasPrintedMaddie);
    }

    // Direct set of the market-tote counts (does NOT touch online stock).
    // Used by "match kits to canvases", which adjusts the market count only.
    if (body.marketKitsReady !== undefined) {
      data.marketKitsReady = Math.max(0, body.marketKitsReady);
    }

    if (body.marketCanvasPrinted !== undefined) {
      data.marketCanvasPrinted = Math.max(0, body.marketCanvasPrinted);
    }

    // Direct set of Andover bulk-storage canvases (e.g. logging a bulk order).
    if (body.canvasAndover !== undefined) {
      data.canvasAndover = Math.max(0, Math.floor(body.canvasAndover));
    }

    // Handle delta updates for counters using atomic increment
    // This prevents race conditions when multiple requests update simultaneously
    // Market transfer deltas move stock between main and the market tote,
    // conserving the total. Positive = main -> market ("bring to market" /
    // "restock the tote"); negative = market -> main ("return from market").
    const hasMarketTransfer = body.marketTransferKitsDelta !== undefined ||
                              body.marketTransferCanvasDelta !== undefined;

    // Andover transfer moves canvases between Andover storage and home,
    // conserving the total. Positive = Andover -> home ("restock from Andover");
    // negative = home -> Andover ("return to storage").
    const hasAndoverUpdate = body.andoverTransferDelta !== undefined ||
                             body.canvasAndoverDelta !== undefined;

    const hasDeltaUpdates = body.canvasPrintedDelta !== undefined ||
                            body.kitsReadyDelta !== undefined ||
                            body.canvasPrintedMaddieDelta !== undefined ||
                            hasMarketTransfer ||
                            hasAndoverUpdate;

    if (hasDeltaUpdates) {
      // Use transaction for atomic delta updates with floor check
      const design = await prisma.$transaction(async (tx) => {
        // First, get current values to check if delta would go negative
        const current = await tx.design.findUnique({
          where: { id },
          select: {
            canvasPrinted: true,
            kitsReady: true,
            canvasPrintedMaddie: true,
            marketKitsReady: true,
            marketCanvasPrinted: true,
            canvasAndover: true,
          },
        });

        if (!current) {
          throw new Error("Design not found");
        }

        // Andover -> home restock (or home -> Andover return), clamped so
        // neither side goes below 0.
        if (body.andoverTransferDelta !== undefined) {
          const requested = Math.trunc(body.andoverTransferDelta);
          const moved = requested >= 0
            ? Math.min(requested, current.canvasAndover)
            : -Math.min(-requested, current.canvasPrinted);
          if (moved !== 0) {
            data.canvasAndover = { increment: -moved };
            data.canvasPrinted = { increment: moved };
          }
        }

        // Receive/adjust Andover stock by a signed delta (clamped at 0).
        if (body.canvasAndoverDelta !== undefined) {
          const newVal = current.canvasAndover + body.canvasAndoverDelta;
          data.canvasAndover = newVal < 0 ? 0 : { increment: body.canvasAndoverDelta };
        }

        // Market transfers: clamp the moved quantity so neither side goes below 0.
        if (body.marketTransferKitsDelta !== undefined) {
          const requested = Math.trunc(body.marketTransferKitsDelta);
          // moving to market is limited by main stock; moving back is limited by market stock
          const moved = requested >= 0
            ? Math.min(requested, current.kitsReady)
            : -Math.min(-requested, current.marketKitsReady);
          if (moved !== 0) {
            data.kitsReady = { increment: -moved };
            data.marketKitsReady = { increment: moved };
          }
        }

        if (body.marketTransferCanvasDelta !== undefined) {
          const requested = Math.trunc(body.marketTransferCanvasDelta);
          const moved = requested >= 0
            ? Math.min(requested, current.canvasPrinted)
            : -Math.min(-requested, current.marketCanvasPrinted);
          if (moved !== 0) {
            data.canvasPrinted = { increment: -moved };
            data.marketCanvasPrinted = { increment: moved };
          }
        }

        // Calculate safe deltas (prevent going below 0)
        if (body.canvasPrintedDelta !== undefined) {
          const newVal = current.canvasPrinted + body.canvasPrintedDelta;
          if (newVal < 0) {
            // Clamp to 0 - set absolute value instead of increment
            data.canvasPrinted = 0;
          } else {
            data.canvasPrinted = { increment: body.canvasPrintedDelta };
          }
        }

        if (body.canvasPrintedMaddieDelta !== undefined) {
          const newVal = current.canvasPrintedMaddie + body.canvasPrintedMaddieDelta;
          if (newVal < 0) {
            data.canvasPrintedMaddie = 0;
          } else {
            data.canvasPrintedMaddie = { increment: body.canvasPrintedMaddieDelta };
          }
        }

        if (body.kitsReadyDelta !== undefined) {
          const newVal = current.kitsReady + body.kitsReadyDelta;
          if (newVal < 0) {
            data.kitsReady = 0;
          } else {
            data.kitsReady = { increment: body.kitsReadyDelta };
          }
        }

        // Apply all updates atomically
        return tx.design.update({
          where: { id },
          data,
          include: { folder: true },
        });
      });

      return NextResponse.json(design);
    }

    // Non-delta updates (absolute values only)
    const design = await prisma.design.update({
      where: { id },
      data,
      include: {
        folder: true,
      },
    });

    return NextResponse.json(design);
  } catch (error) {
    console.error("Error updating design:", error);
    return NextResponse.json(
      { error: "Failed to update design" },
      { status: 500 }
    );
  }
}
