import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";
import { countStitchesByColor } from "@/lib/color-utils";
import { calculateYarnUsage, MeshCount, threadSizeForMesh, skeinYardsForMesh, bobbinThresholdsForMesh, skeinBreakdownForColor } from "@/lib/yarn-calculator";
import { meshCountWhere } from "@/lib/mesh-filter";
import pako from "pako";


interface DesignUsage {
  id: string;
  name: string;
  previewImageUrl: string | null;
  meshCount: number;
  threadSize: 3 | 5;
  stitchCount: number;
  skeinsNeeded: number;
  yardsWithBuffer: number;
  fullSkeins: number;
  bobbinYards: number;
}

interface BackupUsage {
  id: string;
  name: string;
  previewImageUrl: string | null;
  meshCount: number;
  primaryDmcNumbers: string[]; // the primary color(s) this color backs up in the design
}

interface ColorUsage {
  dmcNumber: string;
  designs: DesignUsage[];
  backupFor: BackupUsage[];
}

// GET - Fetch which designs use each color, including yarn usage
export async function GET(request: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const meshFilter = new URL(request.url).searchParams.get("meshCount");
    const meshWhere = meshCountWhere(meshFilter);

    // Fetch non-draft designs (filtered by mesh count if specified)
    const designs = await prisma.design.findMany({
      where: {
        // Sourced kits buy no thread (lib/sourcing): 13ct intro kits arrive
        // finished from the supplier, so counting their colours here invents
        // demand for thread nobody orders.
        meshCount: { not: 13 },
        isDraft: false,
        deletedAt: null,
        archivedAt: null,
        notLiveAt: null,
        printVersionOf: null,
        ...meshWhere,
      },
      select: {
        id: true,
        name: true,
        previewImageUrl: true,
        meshCount: true,
        colorsUsed: true,
        pixelData: true,
        stitchType: true,
        bufferPercent: true,
        backupColors: true,
      },
      orderBy: { name: "asc" },
    });

    // Global (bidirectional) backup pairs, merged per design with any
    // design-specific overrides to get each design's effective backup map.
    const globalBackups = await prisma.colorBackup.findMany();
    const globalBackupMap: Record<string, string> = {};
    for (const b of globalBackups) {
      globalBackupMap[b.dmcNumber] = b.backupDmcNumber;
      globalBackupMap[b.backupDmcNumber] = b.dmcNumber;
    }

    // Build a map of DMC number -> designs using it with yarn usage
    const colorUsageMap = new Map<string, DesignUsage[]>();
    // DMC number -> designs that have it as a BACKUP color (keyed by designId)
    const backupUsageMap = new Map<string, Map<string, BackupUsage>>();

    for (const design of designs) {
      if (!design.colorsUsed || !design.pixelData) continue;

      try {
        // Decompress pixel data and count stitches
        const compressed = Buffer.from(design.pixelData);
        const decompressed = pako.inflate(compressed, { to: "string" });
        const grid: (string | null)[][] = JSON.parse(decompressed);
        const stitchCounts = countStitchesByColor(grid);

        const meshCount = (design.meshCount || 14) as MeshCount;
        const threadSize = threadSizeForMesh(meshCount);

        // Calculate yarn usage for all colors
        const stitchType = (design.stitchType || "continental") as "continental" | "basketweave";
        const yarnUsage = calculateYarnUsage(
          stitchCounts,
          meshCount,
          stitchType,
          design.bufferPercent || 20
        );

        // Create a lookup map for this design's yarn usage
        const usageByColor = new Map<string, typeof yarnUsage[0]>();
        for (const usage of yarnUsage) {
          usageByColor.set(usage.dmcNumber, usage);
        }

        // Add each color to the map
        const colors: string[] = JSON.parse(design.colorsUsed);

        // Record where this design's primary colors have a backup: the backup
        // color "belongs to" this design via that primary. Design-specific
        // backups override the global pairing.
        const designBackups: Record<string, string> = design.backupColors ? JSON.parse(design.backupColors) : {};
        const effectiveBackups = { ...globalBackupMap, ...designBackups };
        for (const primary of colors) {
          const backup = effectiveBackups[primary];
          if (!backup) continue;
          if (!backupUsageMap.has(backup)) backupUsageMap.set(backup, new Map());
          const perDesign = backupUsageMap.get(backup)!;
          const existing = perDesign.get(design.id);
          if (existing) {
            if (!existing.primaryDmcNumbers.includes(primary)) existing.primaryDmcNumbers.push(primary);
          } else {
            perDesign.set(design.id, {
              id: design.id,
              name: design.name,
              previewImageUrl: design.previewImageUrl,
              meshCount: design.meshCount,
              primaryDmcNumbers: [primary],
            });
          }
        }

        for (const dmcNumber of colors) {
          if (!colorUsageMap.has(dmcNumber)) {
            colorUsageMap.set(dmcNumber, []);
          }

          const usage = usageByColor.get(dmcNumber);
          const yardsWithBuffer = usage?.withBuffer || 0;
          const { fullSkeins, bobbinYards } = skeinBreakdownForColor(yardsWithBuffer, meshCount);

          colorUsageMap.get(dmcNumber)!.push({
            id: design.id,
            name: design.name,
            previewImageUrl: design.previewImageUrl,
            meshCount: design.meshCount,
            threadSize,
            stitchCount: usage?.stitchCount || stitchCounts.get(dmcNumber) || 0,
            skeinsNeeded: usage?.skeinsNeeded || 0,
            yardsWithBuffer,
            fullSkeins,
            bobbinYards,
          });
        }
      } catch {
        // Skip designs with invalid data
        continue;
      }
    }

    // Convert to array format — include colors that appear as a backup even if
    // no design uses them directly.
    const allColors = new Set<string>([...colorUsageMap.keys(), ...backupUsageMap.keys()]);
    const colorUsage: ColorUsage[] = Array.from(allColors).map((dmcNumber) => ({
      dmcNumber,
      designs: colorUsageMap.get(dmcNumber) || [],
      backupFor: Array.from(backupUsageMap.get(dmcNumber)?.values() || []),
    }));

    return NextResponse.json(colorUsage);
  } catch (error) {
    console.error("Error fetching color usage:", error);
    return NextResponse.json(
      { error: "Failed to fetch color usage" },
      { status: 500 }
    );
  }
}
