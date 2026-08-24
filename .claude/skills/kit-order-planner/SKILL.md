---
name: kit-order-planner
description: Calculate how many kits to order from the kit supplier for 18ct designs, plus the thread (yards per color) those kits need. Use when asked "how many kits should we order", to build/refresh a kit-supplier order sheet, to compute thread/yardage for a kit order, or to plan a kit reorder that nets out current inventory + orders already placed.
---

# Kit Order Planner

Computes, per active 18ct design, **how many kits to order from the kit supplier**, then the **thread (yards per color)** those kits require. The kit supplier assembles kits (canvas + thread); we're moving kit assembly to them.

## The core formula (per design)

```
onHand   = canvasPrinted + marketCanvasPrinted + canvasAndover   # bare canvas, all locations
made     = kitsReady + marketKitsReady                           # kits already assembled
onOrder  = canvas already coming (canvas order sheet + outstanding POs)
velocity = units sold / week over a trailing 90-day Shopify window

projectedCanvas = max(0, onHand - round(velocity * LEAD_WEEKS))  # sell-down during lead
                  + made + onOrder
kitsToOrder     = max(0, round(projectedCanvas * ATTACH) - made)
```

## Parameters (defaults)
- **ATTACH = 0.72** — historical 18ct kit-attach rate (kit units ÷ all units, from order history). Only ~72% of canvases sell as kits, so we only kit that share. Recompute from Shopify history if it drifts.
- **LEAD_WEEKS = 13** (~3 months) — kit-supplier lead time. We subtract ~3 months of projected sales from on-hand canvas first, because that canvas sells before the kits land — otherwise we over-order for stock we won't still have.
- **WINDOW_DAYS = 90** — sales-velocity window.

## Why each term
- **Sell-down** (`- velocity*lead`): don't order kits for canvas you'll sell during the wait.
- **`+ made + onOrder`, then `- made`**: net out the whole pipeline so you don't double-order kits you already have or already have canvas coming for.
- **`* ATTACH`**: kit only the share of canvas that actually sells as kits; the rest sells canvas-only.

## Scope
Active 18ct designs only: `meshCount = 18`, `deletedAt = null`, `archivedAt = null`, `printVersionOf = null`. Include not-live designs too (they may be launching). Skip any design with `onHand + made + onOrder == 0`.

## Velocity source (important)
Bucket/window by the **real order date** (`ShopifyOrder.orderDate ?? createdAt`) and only count `ShopifyOrderItem.processed = true`. `createdAt` is our local sync time, so windowing by it dumps backfilled orders into the current window; `processed` avoids double-counting undo/re-fulfill rows. (Both were review fixes — keep them.)

## Thread (yards per color)
For each design's `kitsToOrder`, run `calculateYarnUsage` and take each color's **buffered** yards (`withBuffer`) per kit × kitsToOrder, aggregated by DMC. Report totals in **yards**, not skeins — the supplier breaks skeins/hanks differently than we do. Per-kit breakdown = the buffered yards for ONE kit of each design.

## How to run
1. Update the `ON_ORDER` map in `compute-kit-order.ts` (this skill's folder) with canvas already coming — the latest canvas order sheet quantities + any outstanding POs (e.g. Fenway 300 / Lobster 150 / Hydrangea 200). Keys are design names (whitespace/case-insensitive).
2. Run it (needs Node 24 + the repo's `.env` with `DATABASE_URL`):
   ```bash
   export PATH="$HOME/.nvm/versions/node/v24.15.0/bin:$PATH"
   npx tsx --tsconfig tsconfig.json .claude/skills/kit-order-planner/compute-kit-order.ts
   ```
   It queries live inventory + velocity and writes three CSVs to the repo root:
   `kit-order.csv` (design → kits), `kit-order-thread.csv` (DMC → total yards), `kit-order-per-kit.csv` (design/DMC → yards per kit).
3. Adjust `ATTACH` / `LEAD_WEEKS` at the top of the script to run scenarios.
4. Optional formatted `.xlsx`: load the three CSVs into an openpyxl workbook (one sheet each), highlight the editable "Kits to Order" column, and add live formulas so changing a kit qty recalcs the thread totals (see git history around Aug 2026 for the exact xlsx builder).

## Caveats to restate whenever you deliver numbers
- **72% is a blended rate** — brand-new / never-sold designs have no real attach yet, so their numbers are assumptions.
- Verify big on-order-driven lines (e.g. Fenway) actually reflect intended POs before sending.
- Thread yards use our tiered buffer; confirm the supplier wants buffered yards (not raw) and our cushion level.
