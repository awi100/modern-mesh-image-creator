import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";
import { countStitchesByColor } from "@/lib/color-utils";
import { calculateYarnUsage, skeinYardsForMesh, MeshCount } from "@/lib/yarn-calculator";
import pako from "pako";

const SETTINGS_ID = "default";

type Settings = Awaited<ReturnType<typeof loadSettings>>;

async function loadSettings() {
  const existing = await prisma.pricingSettings.findUnique({ where: { id: SETTINGS_ID } });
  if (existing) return existing;
  return prisma.pricingSettings.create({ data: { id: SETTINGS_ID } });
}

function tierFor(area: number, mesh: number, s: Settings): "Intro" | "Small" | "Medium" | "Large" | "XL" {
  if (mesh === 13) return "Intro";
  if (area <= s.smallMaxArea) return "Small";
  if (area <= s.mediumMaxArea) return "Medium";
  if (area <= s.largeMaxArea) return "Large";
  return "XL";
}

function canvasCostForTier(tier: string, s: Settings): number {
  switch (tier) {
    case "Intro": return s.canvasCostSmall;
    case "Small": return s.canvasCostSmall;
    case "Medium": return s.canvasCostMedium;
    case "Large": return s.canvasCostLarge;
    default: return s.canvasCostXL;
  }
}

function roundUp(raw: number, s: Settings): number {
  const step = s.roundTo > 0 ? s.roundTo : 1;
  return Math.ceil(raw / step) * step;
}

// Fixed per-order costs the base (canvas-only) sale must carry: packaging, the
// shortfall between the label and what we collect for shipping, and the ad cost
// to acquire the order.
function perOrderFixed(s: Settings): number {
  return s.orderPackCost + (s.shippingLabelCost - s.shippingCollected) + s.cacPerOrder;
}

// Canvas-only price targets a NET margin AFTER everything (COGS + fees + the
// per-order fixed costs incl. CAC):
//   net = price - cogs - perOrderFixed - fee,  fee = price*feePercent + feeFixed
//   net/price = target  ->  price = (cogs + perOrderFixed + feeFixed) / (1 - feePercent - target)
function recommendCanvas(canvasCogs: number, s: Settings): number {
  const denom = 1 - s.feePercent - s.targetNetMargin;
  if (denom <= 0.02) return 0; // impossible target
  return roundUp((canvasCogs + perOrderFixed(s) + s.feeFixed) / denom, s);
}

// The +kit upcharge is an attach on an order we've already paid to acquire, so
// it carries NO extra CAC — just its own incremental cost marked up to the
// attach margin:  upcharge = kitAddonCogs / (1 - feePercent - kitAttachMargin)
function kitUpcharge(kitAddonCogs: number, s: Settings): number {
  const denom = 1 - s.feePercent - s.kitAttachMargin;
  if (denom <= 0.02) return roundUp(kitAddonCogs, s);
  return roundUp(kitAddonCogs / denom, s);
}

export async function GET() {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const s = await loadSettings();

    const designs = await prisma.design.findMany({
      where: { deletedAt: null, archivedAt: null, isDraft: false, printVersionOf: null, meshCount: { in: [13, 18] } },
      select: {
        id: true, name: true, previewImageUrl: true, meshCount: true,
        widthInches: true, heightInches: true, stitchType: true, bufferPercent: true, pixelData: true,
      },
      orderBy: { name: "asc" },
    });

    const rows: {
      id: string; name: string; previewImageUrl: string | null; meshCount: number;
      width: number; height: number; area: number; tier: string; yards: number;
      threadCost: number; canvasCogs: number; kitVerCogs: number; recCanvas: number;
      recKit: number; netKitAfterCac: number; netKitMarginPct: number; computed: boolean;
    }[] = [];
    const needsBackfill: string[] = [];

    for (const d of designs) {
      const area = Math.round(d.widthInches * d.heightInches * 10) / 10;
      let yards = 0;
      let computed = false;
      if (d.pixelData) {
        try {
          const grid: (string | null)[][] = JSON.parse(pako.inflate(Buffer.from(d.pixelData), { to: "string" }));
          const counts = countStitchesByColor(grid);
          if (counts.size > 0) {
            const usage = calculateYarnUsage(counts, (d.meshCount || 18) as MeshCount, (d.stitchType as "continental" | "basketweave") || "continental", d.bufferPercent || 20);
            yards = usage.reduce((sum, u) => sum + (u.withBuffer || 0), 0);
            computed = true;
          }
        } catch { /* fall through */ }
      }
      if (!computed) needsBackfill.push(d.name);

      const tier = tierFor(area, d.meshCount, s);
      const skeinYards = skeinYardsForMesh((d.meshCount || 18) as MeshCount);
      const threadCost = (yards / skeinYards) * s.skeinCost;
      const canvasCost = canvasCostForTier(tier, s);
      const canvasCogs = canvasCost + s.canvasPackCost;
      const kitAddonCogs = threadCost + s.kitHardwareCost;     // incremental kit cost
      const kitVerCogs = canvasCogs + kitAddonCogs;            // full canvas + kit COGS

      const recCanvas = recommendCanvas(canvasCogs, s);
      const recKit = recCanvas + kitUpcharge(kitAddonCogs, s);
      // Net on a single-item, ad-driven order at the recommended kit price.
      const netKit = recKit - kitVerCogs - (recKit * s.feePercent + s.feeFixed) - perOrderFixed(s);

      rows.push({
        id: d.id, name: d.name, previewImageUrl: d.previewImageUrl, meshCount: d.meshCount,
        width: d.widthInches, height: d.heightInches, area, tier,
        yards: Math.round(yards * 10) / 10,
        threadCost: round2(threadCost),
        canvasCogs: round2(canvasCogs),
        kitVerCogs: round2(kitVerCogs),
        recCanvas, recKit,
        netKitAfterCac: round2(netKit),
        netKitMarginPct: recKit > 0 ? Math.round((netKit / recKit) * 100) : 0,
        computed,
      });
    }

    // Tier summary (recommended prices are consistent within a tier for canvas;
    // kit varies with thread, so report the range).
    const tiers = ["Intro", "Small", "Medium", "Large", "XL"];
    const tierSummary = tiers.map((t) => {
      const g = rows.filter((r) => r.tier === t);
      if (!g.length) return null;
      const kitPrices = g.map((r) => r.recKit);
      return {
        tier: t,
        count: g.length,
        canvasCogs: round2(g.reduce((a, r) => a + r.canvasCogs, 0) / g.length),
        recCanvas: g[0].recCanvas, // canvas cost is flat per tier
        kitCogsMin: round2(Math.min(...g.map((r) => r.kitVerCogs))),
        kitCogsMax: round2(Math.max(...g.map((r) => r.kitVerCogs))),
        recKitMin: Math.min(...kitPrices),
        recKitMax: Math.max(...kitPrices),
      };
    }).filter(Boolean);

    return NextResponse.json({ settings: s, rows, tierSummary, needsBackfill });
  } catch (error) {
    console.error("Error building pricing:", error);
    return NextResponse.json({ error: "Failed to build pricing" }, { status: 500 });
  }
}

const NUMERIC_FIELDS = [
  "skeinCost", "kitHardwareCost", "canvasPackCost", "orderPackCost", "shippingLabelCost",
  "shippingCollected", "feePercent", "feeFixed", "cacPerOrder",
  "targetNetMargin", "kitAttachMargin",
  "canvasCostSmall", "canvasCostMedium", "canvasCostLarge", "canvasCostXL",
  "smallMaxArea", "mediumMaxArea", "largeMaxArea", "roundTo",
] as const;

export async function PATCH(request: NextRequest) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json();
    const data: Record<string, number> = {};
    for (const f of NUMERIC_FIELDS) {
      if (body[f] === undefined) continue;
      const n = Number(body[f]);
      if (!Number.isFinite(n) || n < 0) return NextResponse.json({ error: `${f} must be a non-negative number` }, { status: 400 });
      data[f] = f === "roundTo" ? Math.max(1, Math.round(n)) : n;
    }
    // Keep the recommended-price formulas solvable.
    if (data.targetNetMargin !== undefined) data.targetNetMargin = Math.min(0.9, data.targetNetMargin);
    if (data.kitAttachMargin !== undefined) data.kitAttachMargin = Math.min(0.9, data.kitAttachMargin);
    if (data.feePercent !== undefined) data.feePercent = Math.min(0.5, data.feePercent);

    await loadSettings(); // ensure the row exists
    const updated = await prisma.pricingSettings.update({ where: { id: SETTINGS_ID }, data });
    return NextResponse.json(updated);
  } catch (error) {
    console.error("Error updating pricing settings:", error);
    return NextResponse.json({ error: "Failed to update settings" }, { status: 500 });
  }
}

function round2(n: number) { return Math.round(n * 100) / 100; }
