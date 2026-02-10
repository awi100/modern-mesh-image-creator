# Smart Stock Alerts - Aggregate Demand Planning

## The Problem

Currently, stock alerts show fulfillment capacity **per design** independently:
- Design A uses 3 skeins of 310, you have 21 → "Can make 7 kits"
- Design B uses 2 skeins of 310, you have 21 → "Can make 10 kits"
- Design C uses 4 skeins of 310, you have 21 → "Can make 5 kits"

**But in reality**: If you try to make 3 kits of each design, you need (3×3) + (3×2) + (3×4) = 27 skeins of 310, and you only have 21!

Colors like **310 (Black)**, **BLANC (White)**, **ECRU** are used across many designs. The current per-design view doesn't show the aggregate demand.

---

## Proposed Solution: Global Color Demand View

### New Feature: "Color Demand Analysis"

A new view that shows each color's **total demand across all designs** and helps with ordering decisions.

#### Key Metrics Per Color

| Metric | Description |
|--------|-------------|
| **Total Demand (1 kit each)** | Skeins needed if you make 1 kit of every design using this color |
| **In Stock** | Current inventory |
| **Effective Stock** | In Stock minus skeins already reserved in assembled kits |
| **Coverage** | How many "complete rounds" of 1 kit each you can make |
| **Shortage** | Skeins needed to make 1 more complete round |

#### Example Display

```
DMC 310 - Black                                    Size 5
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Used in: 12 designs
Total demand (1 kit each): 28 skeins
─────────────────────────────────────────────────────────
In stock:          21 skeins
Reserved in kits:   6 skeins (for 2 assembled kits)
Effective stock:   15 skeins
─────────────────────────────────────────────────────────
Coverage:          0 complete rounds (15 ÷ 28 = 0.53)
To complete 1 round: Order 13 more skeins
To have 2 rounds:    Order 41 more skeins

[Show designs using this color ▼]
  • Floral Wreath - 4 skeins
  • Modern Cat - 3 skeins
  • Geometric - 3 skeins
  • ... 9 more
```

---

## Implementation Plan

### Phase 1: Enhanced API Response

**File: `/src/app/api/inventory/alerts/route.ts`**

Add new fields to `MostUsedColor`:

```typescript
interface MostUsedColor {
  // ... existing fields

  // NEW: Aggregate demand metrics
  totalDemandForOneRound: number;  // Skeins needed for 1 kit of EACH design
  coverageRounds: number;          // floor(effectiveInventory / totalDemandForOneRound)
  skeinsToNextRound: number;       // Shortage to complete next round
  skeinsForNRounds: (n: number) => number; // Helper for "order suggestions"
}
```

Calculation:
```typescript
const totalDemandForOneRound = data.designs.reduce((sum, d) => sum + d.skeinsNeeded, 0);
const coverageRounds = Math.floor(effectiveInventory / totalDemandForOneRound);
const skeinsToNextRound = totalDemandForOneRound - (effectiveInventory % totalDemandForOneRound);
```

### Phase 2: New UI Section - "Global Color Demand"

**File: `/src/app/inventory/page.tsx`**

Add a new section in the Alerts tab (or new tab) showing:

1. **Critical Colors Table**
   - Colors with coverage < 1 round (can't make 1 kit of each design)
   - Sorted by coverage (lowest first)
   - Shows: color, demand, stock, coverage, order suggestion

2. **Order Suggestions Panel**
   - Input: "I want to be able to make N kits of each design"
   - Output: Shopping list of colors to order with quantities

3. **Expandable Design Breakdown**
   - Click a color to see which designs use it
   - Shows skeins needed per design

### Phase 3: "What-If" Scenario Planner

**New Component: `<KitPlanningTool />`**

Interactive tool to plan kit production:

1. User selects designs they want to make kits for
2. User enters quantity per design
3. System shows:
   - Total thread requirements
   - Which colors are short
   - What to order
   - Which designs can be fulfilled immediately

```
┌─────────────────────────────────────────────────────────┐
│ Kit Production Planner                                  │
├─────────────────────────────────────────────────────────┤
│ Design              Qty    Can Make    Status           │
│ ─────────────────────────────────────────────────────── │
│ Floral Wreath       5      3          ⚠️ Need 310, 666  │
│ Modern Cat          3      3          ✓ Ready           │
│ Geometric           4      2          ⚠️ Need 310       │
├─────────────────────────────────────────────────────────┤
│ ORDER NEEDED:                                           │
│   DMC 310 - Black: 8 skeins                            │
│   DMC 666 - Red:   2 skeins                            │
│                                                         │
│ [Export Shopping List]  [Adjust Plan]                   │
└─────────────────────────────────────────────────────────┘
```

---

## UI Mockups

### Alerts Tab - Global Demand Section

```
┌──────────────────────────────────────────────────────────────────┐
│ GLOBAL COLOR DEMAND                                     [?] Help │
│                                                                  │
│ How many complete rounds can you make?                          │
│ (1 round = 1 kit of each design using that color)               │
│                                                                  │
│ ┌────────────────────────────────────────────────────────────┐  │
│ │ ⚠️ CRITICAL (< 1 round coverage)                            │  │
│ ├────────────────────────────────────────────────────────────┤  │
│ │ ██ 310 Black     12 designs  │  28 need │ 15 have │ 0.5x  │  │
│ │ ██ BLANC White    8 designs  │  19 need │  8 have │ 0.4x  │  │
│ │ ██ 666 Red        6 designs  │  14 need │ 10 have │ 0.7x  │  │
│ └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│ ┌────────────────────────────────────────────────────────────┐  │
│ │ ✓ HEALTHY (1+ round coverage)                              │  │
│ ├────────────────────────────────────────────────────────────┤  │
│ │ ██ 838 Brown      4 designs  │   8 need │ 24 have │ 3.0x  │  │
│ │ ██ 433 Tan        3 designs  │   5 need │ 20 have │ 4.0x  │  │
│ └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│ [Generate Order List for 1 Complete Round]                      │
└──────────────────────────────────────────────────────────────────┘
```

### Order Suggestion Panel

```
┌──────────────────────────────────────────────────────────────────┐
│ ORDER SUGGESTION                                                 │
│                                                                  │
│ To make [1▼] complete round(s), order:                          │
│                                                                  │
│   DMC 310 - Black ............... 13 skeins                     │
│   DMC BLANC - White ............. 11 skeins                     │
│   DMC 666 - Red .................  4 skeins                     │
│   ─────────────────────────────────────────                     │
│   Total: 28 skeins                                              │
│                                                                  │
│ [Copy List]  [Export CSV]  [Print]                              │
└──────────────────────────────────────────────────────────────────┘
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `/src/app/api/inventory/alerts/route.ts` | Add aggregate demand calculations |
| `/src/app/inventory/page.tsx` | Add Global Demand section to Alerts tab |
| `/src/components/KitPlanningTool.tsx` | NEW - Interactive planning tool |
| `/src/app/api/inventory/plan/route.ts` | NEW - API for "what-if" calculations |

---

## Implementation Order

1. **API Enhancement** - Add aggregate metrics to alerts endpoint
2. **Global Demand UI** - Show critical colors with coverage metrics
3. **Order Suggestion** - Generate shopping list for N rounds
4. **Kit Planning Tool** - Interactive scenario planner (optional, Phase 2)

---

## Questions

1. **Should "1 round" include draft designs?** Currently alerts exclude drafts. Probably keep it that way.

2. **How to handle different thread sizes?**
   - Option A: Separate analysis for size 5 vs size 8
   - Option B: Combined view with size indicator
   - Recommendation: Separate tabs or filter, since you order them separately

3. **Should we track "minimum stock level" per color?**
   - Could set alerts like "notify me when 310 drops below 10 skeins"
   - Nice to have, not essential for MVP

4. **Historical sales data integration?**
   - Could weight demand by sales velocity (310 sells 2x as fast)
   - Future enhancement after we have sales data

