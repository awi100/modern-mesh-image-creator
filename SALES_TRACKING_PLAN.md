# Sales Tracking - Total Sold Per Design

## Goal
Track and display the total number of each design sold through Shopify.

---

## Data Strategy

### Option A: Store in Database (Recommended)
Add a `totalSold` field to the Design model that gets incremented when orders are synced.

**Pros:**
- Fast to display (no Shopify API calls)
- Works offline
- Already have sync logic in place

**Cons:**
- Only counts orders since implementation
- Need to backfill historical data

### Option B: Query Shopify on Demand
Fetch sales data from Shopify when needed.

**Pros:**
- Always accurate
- No schema changes

**Cons:**
- Slow (API calls)
- Rate limited
- Can't show on list views efficiently

**Recommendation:** Option A - Store in database, update during sync

---

## Implementation Plan

### 1. Database Schema Change

Add to `Design` model in `prisma/schema.prisma`:
```prisma
model Design {
  // ... existing fields
  totalSold     Int       @default(0)  // Total units sold (kits + canvas-only)
  totalKitsSold Int       @default(0)  // Units sold with kit
}
```

### 2. Update Sync Logic

Modify `/lib/shopify-sync.ts` to increment `totalSold` when processing fulfilled orders:

```typescript
// When processing a line item:
if (designId) {
  await tx.design.update({
    where: { id: designId },
    data: {
      totalSold: { increment: lineItem.quantity },
      totalKitsSold: needsKit ? { increment: lineItem.quantity } : undefined,
    },
  });
}
```

### 3. Backfill Historical Sales

Create a one-time script/endpoint to fetch all historical orders from Shopify and populate `totalSold`.

Option: `/api/admin/backfill-sales` endpoint that:
1. Fetches all fulfilled orders from Shopify (paginated)
2. Counts quantities per product
3. Updates Design.totalSold for each matched design

### 4. Display Locations

| Location | What to Show |
|----------|--------------|
| Home page design cards | Small badge: "42 sold" |
| Design editor header | "42 sold" next to design name |
| Kit page | "Total Sold: 42 (38 kits, 4 canvas only)" |
| Orders page (kits view) | Column showing total sold |
| Inventory/Kits overview | Sort/filter by best sellers |

### 5. API Changes

Update design API responses to include `totalSold`:
- `GET /api/designs` - include in list
- `GET /api/designs/[id]` - include in detail

---

## Files to Modify

| File | Changes |
|------|---------|
| `prisma/schema.prisma` | Add `totalSold`, `totalKitsSold` fields |
| `/lib/shopify-sync.ts` | Increment totalSold during sync |
| `/api/admin/backfill-sales/route.ts` | New - one-time backfill |
| `/app/page.tsx` | Show sold count on design cards |
| `/components/editor/Header.tsx` | Show sold count |
| `/app/design/[id]/kit/page.tsx` | Show detailed sales breakdown |
| `/app/orders/page.tsx` | Show sold count in kits view |

---

## UI Mockups

### Design Card (Home Page)
```
┌─────────────────────┐
│    [Preview Image]  │
│                     │
├─────────────────────┤
│ Design Name         │
│ 8.5" × 11" · 14mesh │
│ 🛒 42 sold          │
└─────────────────────┘
```

### Kit Page Header
```
┌─────────────────────────────────────────┐
│ Design Name                    42 sold  │
│ 8.5" × 11" at 14 mesh                   │
│                                         │
│ Sales Breakdown:                        │
│ • 38 with kit                           │
│ • 4 canvas only                         │
└─────────────────────────────────────────┘
```

---

## Implementation Order

1. **Schema** - Add fields, run migration
2. **Sync logic** - Update to increment on fulfillment
3. **Backfill** - Create endpoint, run once to populate historical
4. **Display** - Add to UI in priority order:
   - Kit page (most useful)
   - Home page cards
   - Orders page

---

## Questions

1. **Do you want to track kits vs canvas-only separately?** (Plan includes both)
2. **Should we show "0 sold" or hide when zero?**
3. **Any other places you want to display sales count?**
