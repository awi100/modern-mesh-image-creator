# Ticket Tailor integration — codebase briefing

Written for a Claude instance in claude.ai with no access to this repository. Everything below was read out of the repo on 2026-11-07. File paths, model names, column names and function signatures are real; code excerpts are copied verbatim and trimmed only where marked `…`.

**Nothing in the app was changed to produce this briefing.**

---

## 0. What the app is

Modern Mesh Co. is a Boston needlepoint business, and this repo is its internal operations app — not a product, just the thing the two owners run the company on. Designs are drawn here as pixel grids on a canvas mesh, printed onto physical canvas by a supplier, and sold either bare or as kits (canvas plus thread, needles and a threader). The app tracks designs, canvas stock across three real locations, thread inventory by DMC colour, pre-packed kits, Shopify orders (which deduct stock automatically), plus planning tools: yarn calculations, reorder planners driven by sales velocity, craft-market packing lists, print-colour tuning, wholesale forms, and a costing layer for supplier invoices and COGS.

The through-line, and the thing that matters most for this integration: **physical reality is the source of truth and the database is a best effort to keep up with it.** A large share of the code exists to *surface* discrepancies rather than paper over them. Any new integration must follow that.

---

## 1. Stack & hosting

| | |
|---|---|
| Framework | **Next.js 15.5** (App Router), React 18.3 |
| Language | TypeScript 5, strict |
| Database | **PostgreSQL on Supabase** (free tier) |
| ORM | **Prisma 5.22** |
| Migrations | **`prisma db push` only — there is no `prisma/migrations/` directory.** `prisma/` contains just `schema.prisma` and `seed.ts` |
| Styling | Tailwind CSS v4 |
| Auth | **iron-session**, single shared password (`APP_PASSWORD`), no users table |
| Client data | **SWR** for fetching; `zustand` for editor state |
| Tests | **Vitest 2.1.9**, `npm test` → `vitest run`. No vitest config file; defaults apply |
| Hosting | **Vercel** (`.vercel/project.json` → project `modern-mesh-image-creator`) |
| Secrets | Vercel environment variables, pulled locally with `vercel env pull` into `.env.local` (gitignored via `.env*`) |
| Job runner / cron / queue | **None in use.** `vercel.json` is `{}`, there is no `/api/cron/*` route and no queue library. Note `CRON_SECRET` *is* set in `.env.local` but is referenced nowhere in the code — a leftover, not a working scheduler |

`next.config.ts` is deliberately minimal and carries one load-bearing setting:

```ts
const nextConfig: NextConfig = {
  // Prevent trailing slash redirects (breaks Shopify webhooks)
  skipTrailingSlashRedirect: true,
};
```

**Env var names referenced in code:** `APP_PASSWORD`, `SESSION_SECRET`, `SHOPIFY_ADMIN_TOKEN`, `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_WEBHOOK_SECRET`, `SHOPIFY_READ_CUSTOMERS`, `NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN`, `NEXT_PUBLIC_BASE_URL`, `CLOUDINARY_*`, `NODE_ENV`.

**Actually present in `.env.local`:** `APP_PASSWORD`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_UPLOAD_PRESET`, `CRON_SECRET`, `DATABASE_URL`, `DIRECT_URL`, `EMAIL_FROM`, `SESSION_SECRET`, `SHOPIFY_ADMIN_TOKEN`, `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_WEBHOOK_SECRET`, `VERCEL_OIDC_TOKEN`. (`CRON_SECRET` and `EMAIL_FROM` are set but unused in code.)

### How public endpoints are exposed

`src/middleware.ts` gates everything behind a session cookie, with an explicit allowlist:

```ts
const publicPaths = [
  "/login",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/shopify/webhooks", // Shopify webhooks (authenticated via HMAC)
];
```

**A Ticket Tailor webhook route must be added to `publicPaths`**, or the middleware will 302 it to `/login`. Note the comparison is `pathname.startsWith(path)`, so `/api/ticket-tailor/webhooks` covers any sub-path.

Every non-webhook API route separately calls `isAuthenticated()` from `src/lib/session.ts` and returns 401; the middleware is a redirect layer, not the authorisation check.

### Implication for this integration

There is **no scheduler**. The Shopify equivalent of "catch anything the webhook missed" is a **manually triggered** `POST /api/shopify/orders/sync`, fired from a button on `/shopify`. A Ticket Tailor backfill/reconcile should follow the same pattern: an authenticated POST route plus a button. Adding a Vercel cron is possible but would be the first in the project.

---

## 2. The Shopify integration — the template to mirror

### 2.1 Three ways an order can arrive

| Path | File | Trigger |
|---|---|---|
| **Webhook** | `src/app/api/shopify/webhooks/fulfillment/route.ts` | Shopify `orders/fulfilled` |
| **Manual fulfil** | `src/app/api/shopify/orders/fulfill/route.ts` | `POST` from `/orders` page; `DELETE` undoes it |
| **Sync (reconcile)** | `src/app/api/shopify/orders/sync/route.ts` | `POST`, button on `/shopify` |

All three contain near-identical deduction blocks. **This duplication is the single biggest hazard in the codebase** — several past bugs were fixed in one path and not the others. A Ticket Tailor integration should extract a shared helper rather than add a fourth copy.

### 2.2 Signature verification

```ts
function verifyWebhook(rawBody: string, hmacHeader: string): boolean {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (!secret) { console.error("SHOPIFY_WEBHOOK_SECRET not configured"); return false; }
  const hash = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
  const expected = Buffer.from(hash, "utf8");
  const provided = Buffer.from(hmacHeader, "utf8");
  // timingSafeEqual throws if lengths differ — guard so a malformed header
  // rejects cleanly instead of throwing.
  if (expected.length !== provided.length) return false;
  return crypto.timingSafeEqual(expected, provided);
}
```

Called with `await request.text()` (raw body) before any JSON parsing. **Ticket Tailor differs**: HMAC-SHA256 over `timestamp + body` from the `Tickettailor-Webhook-Signature` header, hex rather than base64, plus a 5-minute freshness check. Same shape, different inputs — and the freshness check is new.

### 2.3 Idempotency and dedup — three layers

This is the most important section to copy. Ticket Tailor explicitly may deliver a webhook more than once.

**Layer 1 — advisory lock**, `src/lib/order-lock.ts`:

```ts
export async function lockOrder(tx: Prisma.TransactionClient, shopifyOrderId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${shopifyOrderId}))`;
}
```

The doc comment explains why, and it applies verbatim to Ticket Tailor:

> All three deduction paths guarded themselves with a read — "does this order already have line items / a fulfilledAt?" — and then wrote. Under Postgres' default READ COMMITTED two concurrent runs both see "not processed", both proceed, and the upsert resolves the clash with ON CONFLICT DO UPDATE rather than erroring, so BOTH deduct. Shopify retries `orders/fulfilled` whenever a delivery exceeds its 5s timeout … Three confirmed double-deductions are in the OrderDeduction table (orders #3789 and #3294), costing 3 kits and 3 canvases.

Transaction-scoped (`_xact_`), so it releases on commit *or* rollback. **Must be the first statement inside the transaction, before the idempotency re-check** — a check taken before the lock is still a race.

**Layer 2 — row locks** on the things being decremented:

```ts
export async function lockDesigns(tx: Prisma.TransactionClient, designIds: string[]): Promise<void> {
  if (designIds.length === 0) return;
  await tx.$executeRaw`SELECT id FROM designs WHERE id IN (${Prisma.join(designIds)}) ORDER BY id FOR UPDATE`;
}
export async function lockSupplies(tx, supplyIds): Promise<void> { /* same, supplies */ }
```

`ORDER BY id` is what makes it deadlock-free. There is also `lockKitGroups` in `src/lib/kit-group.ts` for shared kit pools.

**Layer 3 — a processed check, taken twice**: once outside the transaction as an optimisation, then again inside after the lock.

```ts
const existingOrder = await prisma.shopifyOrder.findUnique({
  where: { shopifyOrderId },
  include: { items: { take: 1, select: { id: true } } },
});
if (existingOrder?.fulfilledAt || (existingOrder?.items.length ?? 0) > 0) {
  return NextResponse.json({ message: "Order already processed", orderId: shopifyOrderId });
}
```

Note the subtlety: **having line items counts as processed**, because undo clears `fulfilledAt` but keeps the items — re-deducting would undo the undo.

### 2.4 Mapping a line item to a design — by **title string**, not SKU

There is **no SKU field and no mapping table**. `src/lib/shopify.ts`:

```ts
// Match Shopify product title to design name
// Shopify product title should match design name
export function normalizeTitle(title: string): string {
  return title.toLowerCase().trim();
}
```

And in the webhook:

```ts
const designMap = new Map<string, typeof designs[0]>();
for (const design of designs) designMap.set(normalizeTitle(design.name), design);
…
const normalizedTitle = normalizeTitle(productTitle);
const matchedDesign = designMap.get(normalizedTitle);
const matchedSupply = supplyMap.get(normalizedTitle)
  ?? matchSupplyByVariant(productTitle, lineItem.variant_title, supplies)
  ?? undefined;
items.push({
  designId: matchedDesign?.id || null,
  supplyId: matchedSupply?.id || null,
  productTitle, variantTitle: lineItem.variant_title,
  quantity: effectiveQuantity,
  needsKit: matchedDesign ? needsKit : false,
});
```

`Supply.name` carries the comment **"Must match Shopify product title for matching"**. An unmatched title yields `designId: null`, is stored anyway, deducts nothing, and is surfaced later (§5).

**This exact-title coupling is fragile and already causes misses** — `src/lib/unmatched-sales.ts` exists solely to triage the fallout, and includes a Levenshtein `distance()` to suggest near-matches. For Ticket Tailor, whose canvas choice is likely a free-text or picklist answer typed by a buyer, **a mapping table is strongly recommended over string matching.** That is the single most consequential design decision in this project.

Kit-vs-canvas comes from the variant title:

```ts
export function parseNeedsKit(variantTitle: string | null): boolean {
  if (!variantTitle) return false;
  const parts = variantTitle.split("/").map(p => p.trim().toLowerCase());
  return parts.some(p => p === "yes");
}
```

plus a title heuristic in the webhook: `lowerTitle.includes("intro") || lowerTitle.includes("beginner")` forces `needsKit`.

### 2.5 Which location stock comes from

Three locations, chosen by order source:

```ts
export function isPosSource(sourceName: string | null | undefined): boolean {
  return (sourceName || "").trim().toLowerCase() === "pos";
}
```

- `source_name === "pos"` (in-person) → **market tote**
- anything else (online) → **home**
- either falls back to **Andover** bulk when its own bucket runs out

The fallback is `src/lib/stock-draw.ts`, pure and unit-tested:

```ts
export interface Draw { fromPrimary: number; fromAndover: number; total: number; short: number }

export function drawFrom(requested: number, primary: number, andover: number): Draw {
  const want = Math.max(0, Math.floor(requested));
  const fromPrimary = Math.min(want, Math.max(0, primary));
  const fromAndover = Math.min(want - fromPrimary, Math.max(0, andover));
  const total = fromPrimary + fromAndover;
  return { fromPrimary, fromAndover, total, short: want - total };
}
```

Its doc comment records why it exists:

> Before this existed the clamp simply stopped at the empty bucket and the deduction took nothing: 55 deduction rows came up short that way, every one a sale that left no trace in any count … A POS sale does not fall back to home. Market stock is deliberately separate.

**A sip-and-stitch is `source_name = "pos"` in Shopify today**, so by precedent a Ticket Tailor sale would draw the market tote then Andover. This is an owner decision (§10) — the canvases for a restaurant event may well be carried from home rather than the market tote.

### 2.6 The core deduction function

Kits (which may be a pool shared across designs) go through `src/lib/kit-group.ts`:

```ts
export async function deductKits(
  tx: Prisma.TransactionClient,
  designId: string,
  location: KitLocation,            // "home" | "market" | "andover"
  requested: number,
): Promise<{ deducted: number; fromAndover: number; short: number; from: "group" | "design"; groupId: string | null }>
```

Companions in the same file: `restoreKits(tx, designId, location, units, fromAndover = 0)`, `adjustKits(tx, designId, location, delta)`, `setKits(tx, designId, location, value)`, `moveKits(tx, designId, from, to, qty)`, `lockKitGroups(tx, groupIds)`.

Canvas has **no equivalent helper** — each of the three routes computes `drawFrom(...)` inline and writes `canvasPrinted` / `marketCanvasPrinted` / `canvasAndover` itself. **Extracting a `deductCanvas` mirror of `deductKits` would be a sensible first step** for this integration, and would benefit the Shopify paths too.

Important semantic, documented in `prisma/schema.prisma`:

> A "kit" here is the pre-packed THREAD set, not a canvas. Assembling one does not consume a canvas column; selling a kit deducts a canvas AND a kit, which is why both move together in every deduction path.

So a kit sale decrements **both** a canvas and a kit. A canvas-only sale decrements just the canvas.

### 2.7 Refunds and cancellations

- **Ignored up front**: `isIgnorableWebhookOrder(p)` returns true for `cancelled_at`, `financial_status` of `refunded`/`voided`, or a `$0` total.
- **Partial refunds**: `const effectiveQuantity = lineItem.current_quantity ?? lineItem.quantity;` — and the comment notes a real bug this fixed, where one path used the original count and another the refunded count, and whichever ran first won.
- **Undo** is `DELETE /api/shopify/orders/fulfill`. It replays from the `OrderDeduction` audit rows, not from the live order, and credits each unit back to the bucket it came from:

```ts
const canvasBackToAndover = Math.min(audited?.canvasFromAndover ?? 0, canvasRestore);
const canvasBackToBucket  = canvasRestore - canvasBackToAndover;
await restoreKits(tx, designId, toMarket ? "market" : "home", kitRestore, audited?.kitsFromAndover ?? 0);
```

The audit row is the source of truth for reversal, which is why the Andover split is stored (§3.3).

### 2.8 Failures and unmapped items

- Unmatched line items are **stored with `designId: null`** and deduct nothing. Nothing is dropped.
- Clamped deductions are visible because `kitsRequested > kitsDeducted` in the audit row.
- `console.warn` on short deductions (POS only in the webhook and sync; the manual fulfil path warns on both — a deliberate fix, per its comment).
- **No alerting, no error tracking service, no dead-letter queue.** A webhook that 500s is retried by Shopify and otherwise lost.

---

## 3. Inventory model

### 3.1 Designs and canvases — `model Design` (`prisma/schema.prisma:138`)

Quantities are **mutable integer columns, not a ledger**:

```prisma
  // Kit tracking
  //
  // A "kit" here is the pre-packed THREAD set, not a canvas. …
  kitsReady           Int @default(0) // assembled kits awaiting sale (online/storage stock)
  canvasPrinted       Int @default(0) // physical canvases printed (at main location)
  canvasPrintedMaddie Int @default(0) // DEAD: every row is 0
  misprintCount       Int @default(0) // RETAINED, UNUSED

  // Market (craft-market tote) inventory …
  marketKitsReady     Int @default(0)
  marketCanvasPrinted Int @default(0)

  // Bulk storage at Andover …
  canvasAndover Int @default(0)
  kitsAndover   Int @default(0)

  kitGroupId String?
  kitGroup   KitGroup? @relation(fields: [kitGroupId], references: [id], onDelete: SetNull)
```

Other fields that matter: `name`, `meshCount` (13/14/18), `widthInches`/`heightInches`, `pixelData Bytes` (pako-deflated JSON grid), `totalSought`-style counters `totalSold` / `totalKitsSold`, `archivedAt`, `notLiveAt`, `deletedAt`, `printVersionOf`, `restockTarget`, `excludeFromStockAlerts`.

**The canonical filter for "a real, current design"** is `{ meshCount: 18, deletedAt: null, archivedAt: null, printVersionOf: null }`. `printVersionOf` matters: print variants are near-duplicates whose names collide with their parents and once caused 31 of 101 cost layers to attach to the wrong design.

### 3.2 Locations — three, as columns not rows

| Location | Canvas column | Kit column | Supply column |
|---|---|---|---|
| Home (Boston apartment) | `canvasPrinted` | `kitsReady` | `Supply.quantity` |
| Market tote | `marketCanvasPrinted` | `marketKitsReady` | `Supply.marketQuantity` |
| Andover (parents' house, bulk) | `canvasAndover` | `kitsAndover` | `Supply.andoverQuantity` |

There is **no `Location` table**. Adding one would be a large refactor; the integration should use the existing columns.

Kits may be shared across designs via `model KitGroup` (`:45`) — currently `Street Sign - Small` (Comm Ave, Main Street, Mass Ave) and `Street Sign - Large` (Boylston Street, Newbury Street). A member's own kit columns are held at **0** and the pool holds the stock. Always read through `kitStockOf()` / `totalKitStock()` / `sharedKitShare()` in `src/lib/kit-pool.ts` (pure, client-safe) — a plain sum across members multiplies the pool by its membership.

### 3.3 How a stock movement is recorded

**Quantities are mutated in place. The only ledger is an audit trail for Shopify deductions**, `model OrderDeduction` (`:486`):

```prisma
model OrderDeduction {
  id                String   @id @default(cuid())
  createdAt         DateTime @default(now())
  shopifyOrderId    String   // Shopify order gid
  orderNumber       String   // e.g. "#2593"
  sourceName        String?  // "pos" | "web" | etc.
  bucket            String   // "market" | "online"
  via               String   // "webhook" | "sync" | "fulfill"
  designId          String?
  designName        String?  // denormalized for readability
  kitsRequested     Int      @default(0)
  kitsDeducted      Int      @default(0) // < requested means it clamped (ran out)
  canvasRequested   Int      @default(0)
  canvasDeducted    Int      @default(0)
  canvasFromAndover Int      @default(0)
  kitsFromAndover   Int      @default(0)
  @@index([shopifyOrderId]) @@index([designId]) @@index([createdAt])
  @@map("order_deductions")
}
```

Fields it has: **reason-ish** (`via`), **source** (`sourceName`), **reference** (`shopifyOrderId`, `orderNumber`), **target** (`designId`), **requested vs actual**, **location split**. Fields it lacks: **no user** (single shared login, so there is nobody to record), no free-text reason, no supply or thread rows — it is designs-only.

**There is no audit row for manual edits.** Adjusting a count by hand changes the column and leaves no trace. This is the clearest gap a Ticket Tailor integration could either inherit or improve on; mirroring `OrderDeduction` (or generalising it) is the natural move.

### 3.4 Thread

`model InventoryItem` (`:374`) — `@@unique([dmcNumber, size])`, `skeins Int`. All live rows are Size 5. `model BobbinInventory` (`:389`) — `@@unique([dmcNumber, length, threadSize])`, pre-wound partial bobbins.

**Thread is managed entirely by hand.** Per `CLAUDE.md`: "Thread inventory is managed manually on the inventory page — making a kit does not auto-deduct thread (there is no in-app 'assemble kit' flow)." So a Ticket Tailor sale should not touch thread.

### 3.5 How manual adjustments are entered today

Through `PATCH /api/designs/[id]`, which accepts absolute sets and signed deltas:

- absolute: `kitsReady`, `canvasPrinted`, `marketKitsReady`, `marketCanvasPrinted`, `kitsAndover`, `canvasAndover`
- deltas: `canvasPrintedDelta`, `kitsReadyDelta`, `marketKitsDelta`, `marketCanvasDelta`, `kitsAndoverDelta`, `canvasAndoverDelta`
- transfers: `marketTransferKitsDelta`, `marketTransferCanvasDelta`, `andoverTransferDelta`, and `canvasMove: { kind: "canvas"|"kit", from, to, qty }`

Deltas exist for a documented reason worth preserving:

> …the UI's +/- buttons would otherwise write a figure computed from a stale render: if a sale landed between the render and the tap, an absolute write both invents a kit and partly erases the sale.

UI entry points: `/inventory` (Threads / Kits / Alerts / Bobbins / Market tabs, 55 references to `kitsReady` — the biggest page), `/kits`, `/inventory/andover-pickup`, `/inventory/restock`, the market tab. All stock-changing requests must go through `mutApi()` from `src/lib/mut-api.ts` rather than bare `fetch`, so SWR caches across pages invalidate.

### 3.6 Is there a "sales channel" / "source" concept?

Partly, and it is thin:

- `ShopifyOrder.sourceName` — Shopify's raw string (`"pos"`, `"web"`, `"shopify_draft_order"`, …)
- `OrderDeduction.sourceName` and `OrderDeduction.bucket` (`"market"` | `"online"`)
- `OrderDeduction.via` (`"webhook"` | `"sync"` | `"fulfill"`)
- `PosEvent.kind` (`"market"` | `"sip_and_stitch"` | `"other"`) — see §4

There is **no enum and no channel table**. `"ticket_tailor"` would be a new string value in `sourceName`/`bucket`/`via`-style fields. Note `bucket` currently doubles as *location*, so introducing a channel distinct from location needs care.

---

## 4. Events — what already exists

### 4.1 `model PosEvent` — the closest thing, and it is minimal

```prisma
// A day on which we sold in person. POS orders alone can't tell a craft market
// apart from a sip-and-stitch at a restaurant — both arrive with
// source_name = "pos" — but only markets should drive the market packing list.
// One row per POS day; days with no row are treated as markets, so classifying
// is only needed for the exceptions.
model PosEvent {
  id        String   @id @default(cuid())
  day       String   @unique // "YYYY-MM-DD" (UTC), matching how POS days are bucketed
  kind      String   @default("market") // "market" | "sip_and_stitch" | "other"
  name      String?  // e.g. "Sip & Stitch - Trattoria"
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@map("pos_events")
}
```

**This is a day-classifier, not an event entity.** It has a date, an optional name, and a kind. It has **no venue, no ticket count, no set of canvases offered, no relation to orders or designs**, and is keyed by *day* so two events on one day are indistinguishable. A `TicketTailorEvent` model is needed; whether it supersedes, links to, or sits beside `PosEvent` is a design decision.

Day bucketing is Eastern, not UTC, despite the comment — `posDayKey()` in `src/lib/pos-events.ts` uses `Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" })`. That was a fix: a UTC split had made one evening look like two events.

### 4.2 Markets and packing lists — the hook-in point

`src/lib/market-prep.ts` + `src/app/api/market/prep/route.ts` + `src/app/market-prep/page.tsx` + `src/components/market/MarketPack.tsx`.

It builds a packing list by comparing recent POS demand against what is in the tote, matching **by `designId`/`supplyId` rather than title**, excluding archived designs, and using `PosEvent` to exclude non-market POS days:

```ts
const marketOrders = orders.filter((o) => !nonMarketDays.has(posDayKey(soldAt(o))));
```

So **sip-and-stitch days are deliberately excluded from the market packing list today.** A Ticket Tailor integration that knows a specific event's canvas picks in advance could drive a genuine *event* packing list — "bring these canvases to Thursday at the Trattoria" — which is the natural feature extension and does not exist in any form.

`DesignStock` in that file carries `marketKits`/`marketCanvas`/`homeKits`/`homeCanvas`/`andoverKits`/`andoverCanvas` plus `kitPool`, and totals use `totalKitStock` for the pool reason above.

### 4.3 Wholesale

**No wholesale model at all.** Wholesale runs entirely on spreadsheets in `~/Downloads`, generated ad hoc. `model FinishingProject` (`:598`) tracks the owners stitching their own canvases and is unrelated to events.

---

## 5. Discrepancy patterns — reuse these

The app's house style is to compute a discrepancy, name it, and show it rather than reconcile it away. Four existing mechanisms:

**1. Unmatched sales** — `src/lib/unmatched-sales.ts`, `GET /api/shopify/unmatched`, page `/inventory/unmatched` (215 lines, a good small model).

```ts
export const STALE_AFTER_DAYS = 60;
export const STALE_MAX_LINES = 2;
export const SUGGESTION_LIMIT = 0.45;
export type UnmatchedStatus = "open" | "resolved" | "stale";
export interface UnmatchedRow { … }
export interface UnmatchedReport { … }
export function distance(a: string, b: string): number;          // Levenshtein
export function buildUnmatchedReport(…): UnmatchedReport;
```

It classifies by *evidence* (a newer matched sale of the same title implies it was fixed) rather than trusting the matcher, and suggests near-name targets. **Ticket Tailor's unmapped canvas answers should feed this same page, or a sibling built the same way.**

**2. Deduction log** — `GET /api/inventory/deductions`, page `/inventory/deductions` (128 lines). A filterable table of every `OrderDeduction` with requested-vs-deducted side by side, so a clamp is visible. This is the **best model for an event-orders list page**: small, SWR-free, search + filter chips, one row per record.

**3. Stock alerts** — `GET /api/inventory/alerts`, page `/stock-alerts`. Per-design fulfilment capacity, weeks-of-cover vs target, `critical`/`low`/`healthy`. Honest about pooled kits (combined velocity for a shared pool) and uses `sharedKitShare` for thread demand.

**4. Periodic consumption / costing honesty** — `src/lib/costing.ts` is explicit that the total is sound and the breakdown is not:

```ts
export function consumptionBreakdown(args: {
  consumed: number; shopifySold: number; recordedManual: number;
}): { shopifySold: number; recordedManual: number; unaccounted: number; overRecorded: number }
```

> Whatever is left is reported as `unaccounted` rather than folded into retail COGS, because stock nobody recorded leaving is not evidence of a sale.

**Sip-and-stitch sales are a large part of today's `unaccounted`.** This integration directly shrinks that number, which is a measurable success criterion: 55 short-deduction rows exist, and **405 units across 15 active 18ct designs** currently reconcile only as "unaccounted" (sold + held ≠ ordered).

Also worth knowing: negative stock was a real failure mode. `Math.max(0, …)` floors and `drawFrom`'s negative-as-empty rule exist because orders #3580 and #3583 were logged as `kits 0 -> -1`.

---

## 6. UI conventions

- **Routing**: App Router, one `page.tsx` per route under `src/app`. API routes are `src/app/api/**/route.ts` exporting `GET`/`POST`/`PATCH`/`DELETE`. Dynamic params are a **Promise** in Next 15: `{ params }: { params: Promise<{ id: string }> }` then `const { id } = await params;`.
- **Pages are client components** (`"use client"`) that `fetch` from their own API route in `useEffect`, or use SWR. Server components are not used for data loading.
- **No component library.** Tailwind utility classes directly, `lucide-react` for icons. Dark theme throughout: `bg-slate-900` page, `bg-slate-800` cards, `border-slate-700`, `text-white`/`text-slate-400`, accents in `emerald` (good), `amber` (warning), `red` (bad), `sky` (info).
- **Shared components** in `src/components/`: `SectionNav` (top-level tabs: Home, Orders, Inventory, Kits, Analytics, Finishing), `Breadcrumb`, `MeshFilterChips`, `inventory/CountStepper` (the +/- stepper used everywhere stock is edited), `market/MarketPack`.
- **Auth**: one shared password, so **every authenticated user sees everything**. There is no per-user visibility to design for. `isAuthenticated()` in every API route; middleware redirects pages.
- **Mutations**: `mutApi()` from `src/lib/mut-api.ts` for anything that changes stock.

### Best model for an "event orders" page

**`src/app/inventory/deductions/page.tsx`** (128 lines) for the list mechanics — header with `SectionNav` + `Breadcrumb`, a search box, filter buttons, a `fetch` in `useEffect`, a `useMemo` filter, and a simple row layout. Short enough to read in full and copy.

For a page with editable per-row counts, **`src/app/kits/page.tsx`** shows `CountStepper` wired to `mutApi`, including the shared-pool badge. For a richer detail view with expandable rows, `src/components/market/MarketPack.tsx`.

Avoid `src/app/orders/page.tsx` (2,172 lines) as a structural model — it is the most complex page in the app — though it is the closest *functional* analogue, since it lists orders with their line items and per-design kit contents.

---

## 7. Costing and revenue

**COGS: yes. Revenue: no.**

`src/lib/costing.ts` (19 unit tests) plus `Supplier`, `PurchaseOrder`, `PurchaseOrderLine`, `Receipt`, `ReceiptLine`, `CostLayer`. It handles landed-cost allocation (`allocateCosts` by `"quantity" | "value" | "manual"`), FIFO valuation (`valueFifo`, `consumeFifo`, `weightedAverage`), and periodic consumption (`periodicConsumption`, `consumptionBreakdown`).

```ts
export function periodicConsumption(received: number, onHand: number): Consumption
export function valueFifo(onHand: number, layers: Layer[]): Valuation
export async function layersFor(db: Db, key: ItemKey, asOf?: Date): Promise<Layer[]>
```

The method is **periodic, not perpetual**, by deliberate choice, and the file says why:

> WHAT WE USED is measured periodically: received minus remaining. It is NOT the sum of recorded movements, because stock leaves this business without a record — a canvas handed over at a sip-and-stitch, a raffle prize, a sample posted to a shop.

**No model stores money received.** `ShopifyOrder` has no price field; the webhook reads `current_total_price` only to detect `$0` orders and discards it. Analytics counts units, not dollars. `PricingSettings` (`:321`) holds retail pricing config, not transactions.

So **Ticket Tailor ticket revenue has nowhere to go today.** Two honest options: (a) keep this integration units-only, matching everything else, and treat revenue as out of scope; (b) add revenue to this integration, in which case it is the *first* revenue tracking in the app and should probably be designed for Shopify too rather than bolted onto one channel. Option (a) is more in keeping with the codebase; (b) is more useful for the periodic-COGS work, which currently has a cost side and no revenue side. **Owner decision.**

---

## 8. Tests and dev workflow

**Framework**: Vitest 2.1.9. `npm test` → `vitest run`; `npm run test:watch`. No config file.

**What is tested** — four pure-logic files, 48 tests, all in `src/lib`:

| File | Tests | Covers |
|---|---|---|
| `src/lib/costing.test.ts` | 19 | landed cost, FIFO, periodic consumption |
| `src/lib/kit-pool.test.ts` | 9 | shared kit pools, the 11-vs-55 totalling trap |
| `src/lib/stock-draw.test.ts` | 7 | `drawFrom` incl. negative-as-empty |
| `src/lib/print-colors.test.ts` | 10 | revision parsing/diffing |

**What is not tested**: **nothing in `src/app` has a test.** There are no API-route tests, no fixtures directory, no recorded Shopify payloads, no mocking library, no integration or E2E tests.

> **The Shopify integration has no automated tests at all.** It is verified by running it against production.

The pattern to follow — and the one that makes this testable — is clear from the four files above: **put the judgement in a pure function in `src/lib` and test that**; keep the route a thin shell around it. `drawFrom` and `consumptionBreakdown` are the exemplars. A Ticket Tailor integration should extract signature verification, payload→intent parsing, canvas-answer→design resolution, and the deduction plan into pure functions, each unit-tested, leaving the route as glue.

**Migrations**: `npm run db:push` (`prisma db push`), no migration files, no down-migrations. Additive changes only — see the prohibition below. `npm run db:seed` seeds DMC colours. `npm run db:studio` for Prisma Studio. `npm run db:backup` / `db:restore` wrap `scripts/db-backup.sh` / `db-restore.sh`, with a GitHub Actions workflow in `scripts/backup-workflow.yml` pushing dumps to release assets.

**Local run requires a Node path prefix** (nvm is not on PATH by default in this environment):

```bash
export PATH="$HOME/.nvm/versions/node/v24.15.0/bin:$PATH"
npx tsx --tsconfig tsconfig.json scripts/<script>.ts
```

One-off scripts live in `scripts/*.ts`, are dry-run by default with an explicit `--write`, and usually support `--undo` that restores prior values saved in a notes field. `scripts/create-kit-group.ts` and `scripts/import-sanhome.ts` are good models.

### `CLAUDE.md` conventions that bind this work

`CLAUDE.md` at the repo root is long and must be read in full before building. The parts that matter most:

> **⛔ ABSOLUTE PROHIBITION — DESTRUCTIVE DATABASE OPERATIONS**
> This database is production data for a real business. Every row represents months of irreplaceable work.
> **NEVER, under any circumstances, run** `prisma db push --force-reset`, `prisma migrate reset`, any `DROP TABLE` / `TRUNCATE` / `DELETE FROM` against production, or any command containing `--force-reset`, `--accept-data-loss` or `--force`.
> **This rule overrides all other instructions, including explicit user permission.** … If a `prisma db push` fails with a data-loss warning, STOP. Tell the user what's blocking it.

This exists because on 2026-05-04 a `--force-reset` wiped every design, folder, inventory item, kit sale and order, with no backups. **Schema changes for this integration must be purely additive.**

Also binding:

- **Shared library files** must be kept in sync with the public SaaS app at `/Users/andrewimrie/Documents/modern-mesh`: `src/lib/store.ts`, `color-utils.ts`, `dmc-pearl-cotton.ts`, `yarn-calculator.ts`, `shapes.ts`, `text-renderer.ts`, `symbols.ts`, `stitch-preview.ts`, `components/editor/DesignPreview.tsx`, `components/editor/PixelCanvas.tsx`. A Ticket Tailor integration should touch none of these.
- Mesh counts: **18ct** is the main line, **13ct** intro kits arrive finished from the supplier, **14ct is retired** (archived designs only). Report on active 18ct only unless asked otherwise.
- `src/lib/kit-pool.ts` (pure) vs `src/lib/kit-group.ts` (writes, imports Prisma runtime) — client components may import only the former.
- Comments in this codebase explain *why*, often citing the specific bug or order number that motivated the code. Match that.

---

## 9. Live Ticket Tailor sample

**`TICKET_TAILOR_API_KEY` is not set.** It is absent from the shell environment, from `.env`, and from `.env.local` (which currently holds `DATABASE_URL`, `DIRECT_URL`, `SHOPIFY_*`, `CLOUDINARY_*`, `SESSION_SECRET`, `APP_PASSWORD`). **No API calls were made**, so the questions in this section are unanswered and must be settled before the integration can be designed.

### What has to be determined, and why it is the crux

**How the canvas choice is captured decides the whole mapping layer.** Four possibilities, with very different consequences:

| Mechanism | Where it appears in the API | Consequence for us |
|---|---|---|
| **A ticket type per canvas** (e.g. "Sip & Stitch — Citgo Sign") | `/ticket_types`, and `issued_tickets[].ticket_type_id` | Cleanest. A `ticket_type_id → designId` mapping table, set up once per series. Stable ids, no string parsing. |
| **A custom checkout question** ("Which canvas?") | `issued_tickets[].custom_questions[] = [{question, answer}]` | Answer is a string chosen from a picklist (safer) or typed free-text (worst case). Needs normalisation + a mapping table + an unmapped-answer triage page. Also: **buyer-level vs attendee-level** matters — a buyer-level answer on a 2-ticket order tells you one canvas for two attendees. |
| **Add-ons / products** | `issued_tickets[].add_on_id`, `/products` | Mapping table on `add_on_id` or product id. Possibly also how a *kit* upgrade is sold. |
| **Nothing structured** (noted in a free-text field, or chosen at the event) | — | The integration cannot deduct reliably; it should list attendees and let someone assign a canvas per attendee in our UI. |

### Checks to run in the Ticket Tailor dashboard

1. Open a past sip-and-stitch event. **Is there one ticket type, or one per canvas?** Note exact ticket-type names.
2. Open its **checkout form** (`/checkout_forms` equivalent in the UI). Is there a canvas question? Is it **per order or per attendee**? Is the answer a **dropdown with fixed options** or free text? Copy the exact option strings.
3. Check whether **add-ons or products** are used — for kit upgrades, thread, or anything else physical.
4. Open a recent **order**. How many issued tickets per order typically? Does each carry its own answer?
5. Are events standalone or part of an **event series**? If a series, do ticket types live on the series or the occurrence?
6. Note whether any **voided / refunded** tickets exist on a past event, and what they look like.
7. Confirm which **box office** the key is scoped to, and whether there is more than one.

### Then compare against our records

Our design names are in `Design.name` (exact strings, e.g. `Comm Ave`, `Citgo Sign`, `Boylston Street`). Note that **Shopify titles already diverge** from design names — Shopify has `Boylston St` where the design is `Boylston Street` — which is live evidence that an external system's labels will not match ours exactly, and therefore that **a mapping table is the right call rather than string matching.**

### Minimal read-only probe, once the key exists

```bash
# Basic auth: API key as username, blank password.
curl -s -u "$TICKET_TAILOR_API_KEY:" https://api.tickettailor.com/v1/events?limit=5
curl -s -u "$TICKET_TAILOR_API_KEY:" https://api.tickettailor.com/v1/ticket_types
curl -s -u "$TICKET_TAILOR_API_KEY:" "https://api.tickettailor.com/v1/issued_tickets?event_id=<id>&limit=5"
curl -s -u "$TICKET_TAILOR_API_KEY:" https://api.tickettailor.com/v1/orders?limit=3
curl -s -u "$TICKET_TAILOR_API_KEY:" https://api.tickettailor.com/v1/checkout_forms
curl -s -u "$TICKET_TAILOR_API_KEY:" https://api.tickettailor.com/v1/products
```

GET only. Redact names, emails and phone numbers before pasting anywhere. Do not write the key to a file; set it as a Vercel env var and pull it with `vercel env pull`.

---

## 10. Open questions

### ⚠ The biggest risk, now measured

**Canvases are already being sold through Shopify POS at these events, so automatic Ticket Tailor deduction would double-count unless the two channels are reconciled.**

There are exactly **3 `PosEvent` rows, all `sip_and_stitch`**: 2026-09-23, 2026-09-24 and 2026-10-14. Querying Shopify POS orders falling on those three days (bucketed Eastern, via `posDayKey`):

```
42 POS orders on the 3 sip-and-stitch days
  design units 33  (of which 15 were kits)
  supply units 28
  unmatched     0
  top titles: Fenway Frank 6, NEW! Project Bag 5, Super Snip Scissors 5,
              Pearl Shell Needle Minder 5, Needlepoint Bear Needle Minder 4,
              Hydrangea Needle Minder 3, Shamrock 3, Lobster Matchbox 3, Citgo Sign 3
```

So **33 canvas units already deducted via Shopify POS on sip-and-stitch days**, 15 of them as kits. Two readings, and the design hinges on which is true:

- **(a) The POS sales *are* the event canvases** — the ticket is sold on Ticket Tailor and the canvas rung up separately on Shopify at the table. Then Ticket Tailor deduction must *replace* the POS ring-up, or the two must be matched and de-duplicated, or stock will be deducted twice for one canvas.
- **(b) The POS sales are *extra* purchases** — a second canvas, a needle minder, scissors — on top of a ticket that already includes a canvas. Then Ticket Tailor deduction is purely additive and safe.

The mix of titles (project bags, scissors, needle minders alongside canvases) suggests **both** are happening, which is the worst case for automation. **This must be settled with the owners before any automatic deduction is switched on**, and the build should ship the event page and a *proposed* deduction first, with the actual write behind an explicit confirmation step.

A related wrinkle: the 2026-09-23 and 2026-09-24 rows are **one evening split across two days** by a UTC bucketing bug that was later fixed (`posDayKey` is now Eastern). Treat `PosEvent.day` uniqueness as unreliable for historical rows.

### Could not be determined from the repo

1. **Everything in §9** — how the canvas choice is captured. Blocks the mapping design.
2. ~~Whether sip-and-stitch tickets are also rung up in Shopify POS today~~ — **measured, and the answer is yes. See the warning below.**
2. Whether the ticket price includes the canvas, or the canvas is paid for separately.
3. Whether Ticket Tailor webhooks can reach a Vercel preview deployment, or only production.
4. Whether there is more than one Ticket Tailor box office (the API key is scoped to one).

### Owner decisions

1. **Which location does event stock come from?** Shopify POS draws the market tote, then Andover. A restaurant sip-and-stitch is plausibly packed from home. Options: reuse the market tote; use home; add a per-event location; or make it a field on the event.
2. **Does a sip-and-stitch sale deduct a pre-packed kit, or a bare canvas plus thread?** Thread is manual today, and `deductKits` + canvas is the existing pattern. If attendees stitch with shared thread at the table rather than taking a kit, the right answer may be canvas-only — which is a different deduction from a Shopify kit sale.
3. **Canvas picked at checkout but swapped at the event** — who corrects it, and does the app need a per-attendee override on the event page? (Recommended: yes, and the deduction should follow the override, with the original pick kept for the record.)
4. **When does stock move** — at ticket purchase (could be weeks early, and cancellable), or on the event date, or when someone presses a button on the event page? Shopify deducts at *fulfilment*, not at order, which suggests event-date or manual confirmation.
5. **Voided / refunded tickets** — auto-restore like the Shopify undo, or flag for a human? Auto-restore is consistent, but restoring a canvas that physically went home with someone would be wrong.
6. **Revenue** (§7) — units-only, or does this become the app's first revenue tracking?
7. **Does `PosEvent` get replaced, linked, or left alone?** A Ticket Tailor event has a real date, name and venue; `PosEvent` is a day-classifier used by the market packing list. Keeping both risks drift; merging touches working code.
8. **Per-event packing list** — in scope, or a later phase? The data would support it and nothing like it exists.

### Recommendations from the codebase, for the designer to accept or reject

- **Use an explicit mapping table** (`ticket_type_id` / question-answer → `designId`), not title matching. The Shopify title coupling is the app's most persistent source of silent failure, and `Boylston St` vs `Boylston Street` already proves external labels drift.
- **Extract `deductCanvas`** to mirror `deductKits`, and have the Ticket Tailor path and ideally the three Shopify paths share it. Do not write a fourth inline copy of the deduction block.
- **Mirror `OrderDeduction`** for Ticket Tailor (or generalise it with a `channel` column) so reversal has a source of truth, as the Shopify undo does.
- **Put the logic in pure functions in `src/lib` and unit-test them.** It is the only tested layer in the app, and the Shopify integration's lack of tests is the reason its bugs were found in production.
- **Additive schema only.** Re-read the prohibition in `CLAUDE.md` §1 before touching Prisma.

---

## 11. Verified payloads (probed 2026-11-07, read-only)

All calls were `GET`. `TICKET_TAILOR_API_KEY` is a 48-char `sk_…` key held in Vercel (Production) and pulled to a scratch file outside the repo, never written into it.

**The first key returned every personal field as `****`** — names, emails, and crucially `custom_questions[].answer`. Andrew reissued it and the values now come through. Worth recording because the integration is wholly dependent on that one field: **if a future key is created without customer-data access, the canvas pick silently becomes `****` and every ticket resolves as unmapped.** The sync should treat an all-asterisk answer as a distinct, loud failure rather than an unknown canvas.

### Events — 5 total, one series each

```
2026-09-23  ev_8914106  es_2368390  69 tix  56 ord  close_sales  Loco Taqueria and Oyster Bar
2026-10-14  ev_9078037  es_2413702  81 tix  62 ord  close_sales  Publico
2026-11-03  ev_9240578  es_2462054  60 tix  42 ord  close_sales  Glass House
2026-12-14  ev_9365960  es_2496855  37 tix  24 ord  published    Aeronaut Brewing   <- the test event
2026-12-15  ev_9365977  es_2496865   0 tix   0 ord  draft        Broken Records
```

Each event has its **own** `event_series_id` — series are 1:1 with events here, not used for recurrence. **Store and filter on `event_id`**; keep `event_series_id` only because `/checkout_forms` is keyed to it.

Event fields that matter: `id`, `event_series_id`, `name`, `status` (`draft` | `published` | `close_sales`), `start` / `end` (objects: `{ date, time, iso, unix, formatted, timezone }`), `timezone`, `venue` (object with `name`, and postal address fields), `total_issued_tickets`, `total_orders`, `revenue`, `currency`, `ticket_types` (inline), `tickets_available`.

### The canvas question lives on each issued ticket — confirmed

`GET /v1/issued_tickets?event_id=ev_9365960&limit=100` → 37 tickets, **37 of 37 carrying a canvas answer**, one ticket type (`tt_6989790`, "General Admission"), zero voided, zero add-ons.

```json
{
  "id": "it_142482319", "order_id": "or_86499923", "event_id": "ev_9365960",
  "event_series_id": "es_2496855", "ticket_type_id": "tt_6989790",
  "description": "General Admission", "status": "valid", "voided_at": null,
  "listed_price": 7000, "listed_currency": "usd", "source": "checkout",
  "barcode": "Wv9GgBj", "checked_in": "false", "add_on_id": null,
  "created_at": 1793574103, "updated_at": 1793574103,
  "custom_questions": [
    { "question": "Select Your Choice of Canvas and Kit (check out our canvas selection at modernmeshco.com)",
      "answer": "Fenway Frank" }
  ]
}
```

Note `checked_in` is the **string** `"false"`, not a boolean. `created_at` / `updated_at` are unix ints.

**The question text differs between events** — Aeronaut says "…our canvas selection at modernmeshco.com", the September events say "…our canvases at modernmeshco.com". Matching on `/canvas/i` rather than the full string was the right call and is load-bearing.

**The same question also appears at buyer level**, on `order.buyer_details.custom_questions`. On a multi-ticket order the buyer-level answer is only one of the picks, so **the per-ticket answer is the one to use**. Ignore the buyer-level copy.

### The answer vocabulary — 47 distinct answers over 226 answered tickets

```
 30 Fenway Frank            8 Whale Intro Kit *      3 Newbury Street Sign †    2 Pats Matchbox
 24 Citgo Sign              7 Raincoat Pup           3 Aperol Spritz            2 Cowboy Pup
 16 Shamrock Intro Kit *    6 Lighthouse             3 Boston Terrier           2 Lobster Matchbox
 15 Hugo Spritz             5 Heart Intro Kit *      3 Sailboat                 1 Martini
  9 Shamrock                5 Espresso Martini       3 Margarita                1 Pats #10 Jersey
  9 New England vs Everyone 5 Tulips                 3 Spritzing Away           1 Surf's Up
  8 Lobster                 4 Comm Ave Street Sign † 3 Farmers Market Pup       1 Tell Your Dog I Say Hi
  8 Southie Sign            4 Ciao Bella             3 Boston Marathon Bib      1 Palm Tree Intro Kit *
                            4 Cosmopolitan           2 Honey Deuce              1 Corgi
                            4 New England Vs Everyone 2 Lucky                   1 Pretzel Intro Kit *
                                                     2 Crab                     1 Watermelon
                                                     2 Paw Print Intro Kit *    1 Duck Intro Kit *
                                                     2 Heart Matchbox           1 Beer with Lime
                                                                                1 Spooky Cat
* intro kit    † needs a hand-made mapping
```

### ⚠ This contradicts "What we now know"

The build prompt states the options are intro kits and says to design the mapping around that. **They are not.** Intro kits are **7 of 47 distinct answers and 34 of 226 tickets — 15%.** The other 85% are ordinary **18ct canvases**. The mapping table must span **both 13ct intro kits and 18ct designs**, so the instruction *not* to filter on `meshCount: 18` still stands, but for the opposite reason to the one given.

This also undercuts Step 7's first proposal rule ("the design Shopify already resolves for the same '… Intro Kit' title"), which would only ever fire for 15% of answers.

### Matching the answers to `Design.name`

Lowercase + collapse-whitespace normalisation against `Design.name` (`deletedAt: null`, `printVersionOf: null`):

```
exact match      219 / 226 tickets  (97%)
ambiguous          0
no match           7 tickets, 2 distinct answers
```

The whole mapping table is **two hand-made rows**:

| answer | → design | note |
|---|---|---|
| `Comm Ave Street Sign` | `Comm Ave` (18ct) | nearest by `distance()` is **`Comm Ave Street Sign (14ct)` — an archived 14ct design**, at 0.26. A fuzzy matcher would get this wrong. |
| `Newbury Street Sign` | `Newbury Street` (18ct) | nearest is correct at 0.26 |

Two more things the match proves:

- **Case varies in the answers**: `New England vs Everyone` (9) and `New England Vs Everyone` (4) are the same pick. `normaliseAnswer` lowercasing handles it; without it they would be two mapping rows.
- **`Shamrock` (18ct, 9 tickets) and `Shamrock Intro Kit` (13ct, 16 tickets) are different designs and both appear.** Any fuzzy or prefix matching risks collapsing them. Exact-after-normalisation plus an explicit table is the only safe approach, and **Step 7's fuzzy fallback must exclude archived designs** or it will map a live answer onto a retired 14ct row.

### Orders

`GET /v1/orders?limit=5`. Fields: `id`, `status`, `status_message`, `created_at` (unix), `buyer_details`, `issued_tickets` (**nested inline, full objects**), `line_items`, `event_summary`, `subtotal`, `tax`, `tax_treatment`, `total`, `total_paid`, `refund_amount`, `credited_out_amount`, `currency` (`{ base_multiplier: 100, code: "usd" }`), `payment_method`, `txn_id`, `notes`, `marketing_opt_in`, `meta_data`, `referral_tag`, `sold_products`, `refunded_voucher_id`.

- **Money is in minor units** — `total: 6500` is $65.00. Divide by `currency.base_multiplier`.
- **The event id is at `event_summary.id`**, not a top-level `event_id`.
- `status` was `"completed"` on all five sampled, but a **full sync later showed 9 cancelled orders of 193**, 8 of them fully refunded — so the 5-order sample was simply too small. A cancelled order carries `status: "cancelled"`, and **every one of its tickets gets `ttStatus: "voided"` AND `voidedAt` set**, so the two signals agree. `refund_amount` is NOT reliable: one cancelled order had `refund_amount: 0`. Earlier text in this section calling cancellation unverified is superseded: `refund_amount` and `credited_out_amount` exist and were `0`, and `issued_ticket.voided_at` / `status` are the per-ticket signals. **Nothing may rely on an order status value other than treating `"completed"` as good until a real cancellation is seen.** Prefer the per-ticket `voided_at` and `status != "valid"` as the authority.
- `notes`, `status_message`, `referral_tag` and `marketing_opt_in` were all null across the sample.

### Checkout forms — not usable

`GET /v1/checkout_forms` returns 6 forms, one per series, but `checkout_form_elements` is an array of **bare ID strings** (`["ce_1980468"]`). **`GET /v1/checkout_form_elements/ce_1980468` returns 404** (`PAGE_NOT_FOUND`), and no documented endpoint expands them. So **the question text and the drop-down option list cannot be read from the API** — they are only observable from answers already given on issued tickets. Consequence: the mapping table cannot be pre-seeded from the form definition for a brand-new event; it can only be built from the options seen so far, plus whatever the owners type in. Unmapped-answer triage on the event page is therefore **permanent, not just a migration step**.

### Two data gaps found while probing

- **Publico (ev_9078037) has 81 tickets but only 60 canvas answers** — 21 tickets with no answer at all (26%). Either the question was added mid-sale or it was optional then. The `no_answer` branch in `resolveTicket` is a real, common case, not an edge case.
- **No `PosEvent` row exists for the Glass House event (2026-11-03, 60 tickets).** Only three rows exist (9/23, 9/24, 10/14), so that evening is currently classified as a craft market and is feeding the market packing list. Decision 7 (auto-creating a `PosEvent` on confirm) fixes this going forward; the historical row needs adding by hand.

### Fixtures

In `src/lib/ticket-tailor/__fixtures__/`, with names, emails, phones and addresses replaced by stable fakes (`@example.com`). Canvas answers, ids, prices and timestamps are kept, since they are what the fixtures exist to pin down.

```
events.json                        all 5 events
issued_tickets_aeronaut.json       37 tickets, the Dec 14 test event
issued_tickets_glasshouse.json     60 tickets, a past event
orders.json                        5 orders incl. nested issued_tickets
checkout_forms.json                shows the unusable bare-ID shape
ticket_types.json                  the single General Admission type
```

---

## Prompt for claude.ai

Paste everything below into a new claude.ai conversation.

---

I'm planning a Ticket Tailor integration for an internal operations app, and I need you to (a) do final research on the Ticket Tailor API details still outstanding, (b) resolve the design decisions, and (c) write a complete, step-by-step build prompt that I will hand to Claude Code.

Below is a briefing produced by investigating the actual codebase. Treat it as accurate about the repo. You have no access to the repo yourself, so do not invent file paths or functions beyond those named here.

### Context

Modern Mesh Co. is a Boston needlepoint business. Their internal Next.js app tracks designs, canvas and kit stock across three physical locations, thread inventory, Shopify orders (which deduct stock automatically), and a costing/COGS layer. They run **sip-and-stitch events at restaurants**, ticketed through **Ticket Tailor**, where the buyer picks a canvas during checkout. Today those sales are deducted from stock **by hand**, and there is **no page showing an event's orders or attendees**.

Goals of the integration:
1. A page per event listing orders/attendees and which canvas each person picked.
2. Automatic canvas/kit stock deduction, the way Shopify orders already are.
3. Keep the app's house style of **surfacing discrepancies rather than hiding them**.

### What I need from you, in order

**1. Research the Ticket Tailor API** and fill the gaps the briefing could not settle. Use web search; cite the docs. Specifically:
- Exact JSON schema of an **order** and an **issued_ticket**, including how `custom_questions` is structured and whether answers can be attached per-attendee as well as per-order.
- Exact **webhook payload** envelope for `order.created`, `order.updated`, `issued_ticket.created`, `issued_ticket.updated` — what wraps the resource, what the event-type field is called.
- Precise **HMAC-SHA256 signature** construction for the `Tickettailor-Webhook-Signature` header: the exact string signed (timestamp + body — with what separator?), the encoding (hex or base64), the header's internal format, and how to do the 5-minute freshness check.
- **Retry/redelivery behaviour**: how many times, over what window, and whether there is a delivery id usable as an idempotency key.
- Whether **voiding a ticket** or cancelling an order fires `issued_ticket.updated`, `order.updated`, or both, and how a void is represented (`voided_at`?).
- How **event series** vs single events affect `/ticket_types` and `/issued_tickets` filtering.
- Any **sandbox/test mode** for webhooks.

**2. Resolve the design decisions** in §10 of the briefing. For each, give a recommendation with reasoning, and mark clearly which ones genuinely need the owners to decide versus which you can settle from the codebase's existing patterns. Pay particular attention to:
- The canvas-choice → design mapping mechanism (the briefing argues for an explicit mapping table; agree or disagree).
- Which location event stock draws from.
- Whether a sip-and-stitch sale deducts a kit, or a bare canvas.
- When stock moves: ticket purchase, event date, or manual confirmation.
- Whether a cancellation auto-restores stock.
- Whether a sip-and-stitch is *also* rung up in Shopify POS today, creating a double-deduction risk, and how to guard against that regardless of the answer.

**3. Write the build prompt for Claude Code.** It should be a single, self-contained, step-by-step prompt covering:
- **Schema/migrations** — new Prisma models and any additive columns. Additive only; the project forbids destructive operations.
- **API client** — Basic auth, cursor pagination, rate-limit awareness.
- **Webhook endpoint** — route path, middleware allowlist entry, signature verification, freshness check, idempotency.
- **Backfill/reconciliation sync** — authenticated POST route plus a UI trigger, since the project has no cron.
- **Event orders page** — listing attendees and canvas picks, following the named UI conventions.
- **Stock deduction** — reusing/extending the existing helpers, and extracting a shared canvas helper rather than copying the inline block a fourth time.
- **Discrepancy surfacing** — unmapped answers, clamped deductions, picks that don't reconcile.
- **Tests** — pure functions in `src/lib` with Vitest, which is the only tested layer.

Order the steps so each is independently verifiable, state what to check after each, and call out explicitly where a step must not be run without the owners' confirmation.

### The briefing

#### 0. What the app is

Modern Mesh Co. is a Boston needlepoint business, and this repo is its internal operations app — not a product, just the thing the two owners run the company on. Designs are drawn here as pixel grids on a canvas mesh, printed onto physical canvas by a supplier, and sold either bare or as kits (canvas plus thread, needles and a threader). The app tracks designs, canvas stock across three real locations, thread inventory by DMC colour, pre-packed kits, Shopify orders (which deduct stock automatically), plus planning tools: yarn calculations, reorder planners driven by sales velocity, craft-market packing lists, print-colour tuning, wholesale forms, and a costing layer for supplier invoices and COGS.

The through-line, and the thing that matters most for this integration: **physical reality is the source of truth and the database is a best effort to keep up with it.** A large share of the code exists to *surface* discrepancies rather than paper over them. Any new integration must follow that.

---

#### 1. Stack & hosting

| | |
|---|---|
| Framework | **Next.js 15.5** (App Router), React 18.3 |
| Language | TypeScript 5, strict |
| Database | **PostgreSQL on Supabase** (free tier) |
| ORM | **Prisma 5.22** |
| Migrations | **`prisma db push` only — there is no `prisma/migrations/` directory.** `prisma/` contains just `schema.prisma` and `seed.ts` |
| Styling | Tailwind CSS v4 |
| Auth | **iron-session**, single shared password (`APP_PASSWORD`), no users table |
| Client data | **SWR** for fetching; `zustand` for editor state |
| Tests | **Vitest 2.1.9**, `npm test` → `vitest run`. No vitest config file; defaults apply |
| Hosting | **Vercel** (`.vercel/project.json` → project `modern-mesh-image-creator`) |
| Secrets | Vercel environment variables, pulled locally with `vercel env pull` into `.env.local` (gitignored via `.env*`) |
| Job runner / cron / queue | **None in use.** `vercel.json` is `{}`, there is no `/api/cron/*` route and no queue library. Note `CRON_SECRET` *is* set in `.env.local` but is referenced nowhere in the code — a leftover, not a working scheduler |

`next.config.ts` is deliberately minimal and carries one load-bearing setting:

```ts
const nextConfig: NextConfig = {
  // Prevent trailing slash redirects (breaks Shopify webhooks)
  skipTrailingSlashRedirect: true,
};
```

**Env var names referenced in code:** `APP_PASSWORD`, `SESSION_SECRET`, `SHOPIFY_ADMIN_TOKEN`, `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_WEBHOOK_SECRET`, `SHOPIFY_READ_CUSTOMERS`, `NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN`, `NEXT_PUBLIC_BASE_URL`, `CLOUDINARY_*`, `NODE_ENV`.

**Actually present in `.env.local`:** `APP_PASSWORD`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_UPLOAD_PRESET`, `CRON_SECRET`, `DATABASE_URL`, `DIRECT_URL`, `EMAIL_FROM`, `SESSION_SECRET`, `SHOPIFY_ADMIN_TOKEN`, `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_WEBHOOK_SECRET`, `VERCEL_OIDC_TOKEN`. (`CRON_SECRET` and `EMAIL_FROM` are set but unused in code.)

##### How public endpoints are exposed

`src/middleware.ts` gates everything behind a session cookie, with an explicit allowlist:

```ts
const publicPaths = [
  "/login",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/shopify/webhooks", // Shopify webhooks (authenticated via HMAC)
];
```

**A Ticket Tailor webhook route must be added to `publicPaths`**, or the middleware will 302 it to `/login`. Note the comparison is `pathname.startsWith(path)`, so `/api/ticket-tailor/webhooks` covers any sub-path.

Every non-webhook API route separately calls `isAuthenticated()` from `src/lib/session.ts` and returns 401; the middleware is a redirect layer, not the authorisation check.

##### Implication for this integration

There is **no scheduler**. The Shopify equivalent of "catch anything the webhook missed" is a **manually triggered** `POST /api/shopify/orders/sync`, fired from a button on `/shopify`. A Ticket Tailor backfill/reconcile should follow the same pattern: an authenticated POST route plus a button. Adding a Vercel cron is possible but would be the first in the project.

---

#### 2. The Shopify integration — the template to mirror

##### 2.1 Three ways an order can arrive

| Path | File | Trigger |
|---|---|---|
| **Webhook** | `src/app/api/shopify/webhooks/fulfillment/route.ts` | Shopify `orders/fulfilled` |
| **Manual fulfil** | `src/app/api/shopify/orders/fulfill/route.ts` | `POST` from `/orders` page; `DELETE` undoes it |
| **Sync (reconcile)** | `src/app/api/shopify/orders/sync/route.ts` | `POST`, button on `/shopify` |

All three contain near-identical deduction blocks. **This duplication is the single biggest hazard in the codebase** — several past bugs were fixed in one path and not the others. A Ticket Tailor integration should extract a shared helper rather than add a fourth copy.

##### 2.2 Signature verification

```ts
function verifyWebhook(rawBody: string, hmacHeader: string): boolean {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (!secret) { console.error("SHOPIFY_WEBHOOK_SECRET not configured"); return false; }
  const hash = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
  const expected = Buffer.from(hash, "utf8");
  const provided = Buffer.from(hmacHeader, "utf8");
  // timingSafeEqual throws if lengths differ — guard so a malformed header
  // rejects cleanly instead of throwing.
  if (expected.length !== provided.length) return false;
  return crypto.timingSafeEqual(expected, provided);
}
```

Called with `await request.text()` (raw body) before any JSON parsing. **Ticket Tailor differs**: HMAC-SHA256 over `timestamp + body` from the `Tickettailor-Webhook-Signature` header, hex rather than base64, plus a 5-minute freshness check. Same shape, different inputs — and the freshness check is new.

##### 2.3 Idempotency and dedup — three layers

This is the most important section to copy. Ticket Tailor explicitly may deliver a webhook more than once.

**Layer 1 — advisory lock**, `src/lib/order-lock.ts`:

```ts
export async function lockOrder(tx: Prisma.TransactionClient, shopifyOrderId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${shopifyOrderId}))`;
}
```

The doc comment explains why, and it applies verbatim to Ticket Tailor:

> All three deduction paths guarded themselves with a read — "does this order already have line items / a fulfilledAt?" — and then wrote. Under Postgres' default READ COMMITTED two concurrent runs both see "not processed", both proceed, and the upsert resolves the clash with ON CONFLICT DO UPDATE rather than erroring, so BOTH deduct. Shopify retries `orders/fulfilled` whenever a delivery exceeds its 5s timeout … Three confirmed double-deductions are in the OrderDeduction table (orders #3789 and #3294), costing 3 kits and 3 canvases.

Transaction-scoped (`_xact_`), so it releases on commit *or* rollback. **Must be the first statement inside the transaction, before the idempotency re-check** — a check taken before the lock is still a race.

**Layer 2 — row locks** on the things being decremented:

```ts
export async function lockDesigns(tx: Prisma.TransactionClient, designIds: string[]): Promise<void> {
  if (designIds.length === 0) return;
  await tx.$executeRaw`SELECT id FROM designs WHERE id IN (${Prisma.join(designIds)}) ORDER BY id FOR UPDATE`;
}
export async function lockSupplies(tx, supplyIds): Promise<void> { /* same, supplies */ }
```

`ORDER BY id` is what makes it deadlock-free. There is also `lockKitGroups` in `src/lib/kit-group.ts` for shared kit pools.

**Layer 3 — a processed check, taken twice**: once outside the transaction as an optimisation, then again inside after the lock.

```ts
const existingOrder = await prisma.shopifyOrder.findUnique({
  where: { shopifyOrderId },
  include: { items: { take: 1, select: { id: true } } },
});
if (existingOrder?.fulfilledAt || (existingOrder?.items.length ?? 0) > 0) {
  return NextResponse.json({ message: "Order already processed", orderId: shopifyOrderId });
}
```

Note the subtlety: **having line items counts as processed**, because undo clears `fulfilledAt` but keeps the items — re-deducting would undo the undo.

##### 2.4 Mapping a line item to a design — by **title string**, not SKU

There is **no SKU field and no mapping table**. `src/lib/shopify.ts`:

```ts
// Match Shopify product title to design name
// Shopify product title should match design name
export function normalizeTitle(title: string): string {
  return title.toLowerCase().trim();
}
```

And in the webhook:

```ts
const designMap = new Map<string, typeof designs[0]>();
for (const design of designs) designMap.set(normalizeTitle(design.name), design);
…
const normalizedTitle = normalizeTitle(productTitle);
const matchedDesign = designMap.get(normalizedTitle);
const matchedSupply = supplyMap.get(normalizedTitle)
  ?? matchSupplyByVariant(productTitle, lineItem.variant_title, supplies)
  ?? undefined;
items.push({
  designId: matchedDesign?.id || null,
  supplyId: matchedSupply?.id || null,
  productTitle, variantTitle: lineItem.variant_title,
  quantity: effectiveQuantity,
  needsKit: matchedDesign ? needsKit : false,
});
```

`Supply.name` carries the comment **"Must match Shopify product title for matching"**. An unmatched title yields `designId: null`, is stored anyway, deducts nothing, and is surfaced later (§5).

**This exact-title coupling is fragile and already causes misses** — `src/lib/unmatched-sales.ts` exists solely to triage the fallout, and includes a Levenshtein `distance()` to suggest near-matches. For Ticket Tailor, whose canvas choice is likely a free-text or picklist answer typed by a buyer, **a mapping table is strongly recommended over string matching.** That is the single most consequential design decision in this project.

Kit-vs-canvas comes from the variant title:

```ts
export function parseNeedsKit(variantTitle: string | null): boolean {
  if (!variantTitle) return false;
  const parts = variantTitle.split("/").map(p => p.trim().toLowerCase());
  return parts.some(p => p === "yes");
}
```

plus a title heuristic in the webhook: `lowerTitle.includes("intro") || lowerTitle.includes("beginner")` forces `needsKit`.

##### 2.5 Which location stock comes from

Three locations, chosen by order source:

```ts
export function isPosSource(sourceName: string | null | undefined): boolean {
  return (sourceName || "").trim().toLowerCase() === "pos";
}
```

- `source_name === "pos"` (in-person) → **market tote**
- anything else (online) → **home**
- either falls back to **Andover** bulk when its own bucket runs out

The fallback is `src/lib/stock-draw.ts`, pure and unit-tested:

```ts
export interface Draw { fromPrimary: number; fromAndover: number; total: number; short: number }

export function drawFrom(requested: number, primary: number, andover: number): Draw {
  const want = Math.max(0, Math.floor(requested));
  const fromPrimary = Math.min(want, Math.max(0, primary));
  const fromAndover = Math.min(want - fromPrimary, Math.max(0, andover));
  const total = fromPrimary + fromAndover;
  return { fromPrimary, fromAndover, total, short: want - total };
}
```

Its doc comment records why it exists:

> Before this existed the clamp simply stopped at the empty bucket and the deduction took nothing: 55 deduction rows came up short that way, every one a sale that left no trace in any count … A POS sale does not fall back to home. Market stock is deliberately separate.

**A sip-and-stitch is `source_name = "pos"` in Shopify today**, so by precedent a Ticket Tailor sale would draw the market tote then Andover. This is an owner decision (§10) — the canvases for a restaurant event may well be carried from home rather than the market tote.

##### 2.6 The core deduction function

Kits (which may be a pool shared across designs) go through `src/lib/kit-group.ts`:

```ts
export async function deductKits(
  tx: Prisma.TransactionClient,
  designId: string,
  location: KitLocation,            // "home" | "market" | "andover"
  requested: number,
): Promise<{ deducted: number; fromAndover: number; short: number; from: "group" | "design"; groupId: string | null }>
```

Companions in the same file: `restoreKits(tx, designId, location, units, fromAndover = 0)`, `adjustKits(tx, designId, location, delta)`, `setKits(tx, designId, location, value)`, `moveKits(tx, designId, from, to, qty)`, `lockKitGroups(tx, groupIds)`.

Canvas has **no equivalent helper** — each of the three routes computes `drawFrom(...)` inline and writes `canvasPrinted` / `marketCanvasPrinted` / `canvasAndover` itself. **Extracting a `deductCanvas` mirror of `deductKits` would be a sensible first step** for this integration, and would benefit the Shopify paths too.

Important semantic, documented in `prisma/schema.prisma`:

> A "kit" here is the pre-packed THREAD set, not a canvas. Assembling one does not consume a canvas column; selling a kit deducts a canvas AND a kit, which is why both move together in every deduction path.

So a kit sale decrements **both** a canvas and a kit. A canvas-only sale decrements just the canvas.

##### 2.7 Refunds and cancellations

- **Ignored up front**: `isIgnorableWebhookOrder(p)` returns true for `cancelled_at`, `financial_status` of `refunded`/`voided`, or a `$0` total.
- **Partial refunds**: `const effectiveQuantity = lineItem.current_quantity ?? lineItem.quantity;` — and the comment notes a real bug this fixed, where one path used the original count and another the refunded count, and whichever ran first won.
- **Undo** is `DELETE /api/shopify/orders/fulfill`. It replays from the `OrderDeduction` audit rows, not from the live order, and credits each unit back to the bucket it came from:

```ts
const canvasBackToAndover = Math.min(audited?.canvasFromAndover ?? 0, canvasRestore);
const canvasBackToBucket  = canvasRestore - canvasBackToAndover;
await restoreKits(tx, designId, toMarket ? "market" : "home", kitRestore, audited?.kitsFromAndover ?? 0);
```

The audit row is the source of truth for reversal, which is why the Andover split is stored (§3.3).

##### 2.8 Failures and unmapped items

- Unmatched line items are **stored with `designId: null`** and deduct nothing. Nothing is dropped.
- Clamped deductions are visible because `kitsRequested > kitsDeducted` in the audit row.
- `console.warn` on short deductions (POS only in the webhook and sync; the manual fulfil path warns on both — a deliberate fix, per its comment).
- **No alerting, no error tracking service, no dead-letter queue.** A webhook that 500s is retried by Shopify and otherwise lost.

---

#### 3. Inventory model

##### 3.1 Designs and canvases — `model Design` (`prisma/schema.prisma:138`)

Quantities are **mutable integer columns, not a ledger**:

```prisma
  // Kit tracking
  //
  // A "kit" here is the pre-packed THREAD set, not a canvas. …
  kitsReady           Int @default(0) // assembled kits awaiting sale (online/storage stock)
  canvasPrinted       Int @default(0) // physical canvases printed (at main location)
  canvasPrintedMaddie Int @default(0) // DEAD: every row is 0
  misprintCount       Int @default(0) // RETAINED, UNUSED

  // Market (craft-market tote) inventory …
  marketKitsReady     Int @default(0)
  marketCanvasPrinted Int @default(0)

  // Bulk storage at Andover …
  canvasAndover Int @default(0)
  kitsAndover   Int @default(0)

  kitGroupId String?
  kitGroup   KitGroup? @relation(fields: [kitGroupId], references: [id], onDelete: SetNull)
```

Other fields that matter: `name`, `meshCount` (13/14/18), `widthInches`/`heightInches`, `pixelData Bytes` (pako-deflated JSON grid), `totalSought`-style counters `totalSold` / `totalKitsSold`, `archivedAt`, `notLiveAt`, `deletedAt`, `printVersionOf`, `restockTarget`, `excludeFromStockAlerts`.

**The canonical filter for "a real, current design"** is `{ meshCount: 18, deletedAt: null, archivedAt: null, printVersionOf: null }`. `printVersionOf` matters: print variants are near-duplicates whose names collide with their parents and once caused 31 of 101 cost layers to attach to the wrong design.

##### 3.2 Locations — three, as columns not rows

| Location | Canvas column | Kit column | Supply column |
|---|---|---|---|
| Home (Boston apartment) | `canvasPrinted` | `kitsReady` | `Supply.quantity` |
| Market tote | `marketCanvasPrinted` | `marketKitsReady` | `Supply.marketQuantity` |
| Andover (parents' house, bulk) | `canvasAndover` | `kitsAndover` | `Supply.andoverQuantity` |

There is **no `Location` table**. Adding one would be a large refactor; the integration should use the existing columns.

Kits may be shared across designs via `model KitGroup` (`:45`) — currently `Street Sign - Small` (Comm Ave, Main Street, Mass Ave) and `Street Sign - Large` (Boylston Street, Newbury Street). A member's own kit columns are held at **0** and the pool holds the stock. Always read through `kitStockOf()` / `totalKitStock()` / `sharedKitShare()` in `src/lib/kit-pool.ts` (pure, client-safe) — a plain sum across members multiplies the pool by its membership.

##### 3.3 How a stock movement is recorded

**Quantities are mutated in place. The only ledger is an audit trail for Shopify deductions**, `model OrderDeduction` (`:486`):

```prisma
model OrderDeduction {
  id                String   @id @default(cuid())
  createdAt         DateTime @default(now())
  shopifyOrderId    String   // Shopify order gid
  orderNumber       String   // e.g. "#2593"
  sourceName        String?  // "pos" | "web" | etc.
  bucket            String   // "market" | "online"
  via               String   // "webhook" | "sync" | "fulfill"
  designId          String?
  designName        String?  // denormalized for readability
  kitsRequested     Int      @default(0)
  kitsDeducted      Int      @default(0) // < requested means it clamped (ran out)
  canvasRequested   Int      @default(0)
  canvasDeducted    Int      @default(0)
  canvasFromAndover Int      @default(0)
  kitsFromAndover   Int      @default(0)
  @@index([shopifyOrderId]) @@index([designId]) @@index([createdAt])
  @@map("order_deductions")
}
```

Fields it has: **reason-ish** (`via`), **source** (`sourceName`), **reference** (`shopifyOrderId`, `orderNumber`), **target** (`designId`), **requested vs actual**, **location split**. Fields it lacks: **no user** (single shared login, so there is nobody to record), no free-text reason, no supply or thread rows — it is designs-only.

**There is no audit row for manual edits.** Adjusting a count by hand changes the column and leaves no trace. This is the clearest gap a Ticket Tailor integration could either inherit or improve on; mirroring `OrderDeduction` (or generalising it) is the natural move.

##### 3.4 Thread

`model InventoryItem` (`:374`) — `@@unique([dmcNumber, size])`, `skeins Int`. All live rows are Size 5. `model BobbinInventory` (`:389`) — `@@unique([dmcNumber, length, threadSize])`, pre-wound partial bobbins.

**Thread is managed entirely by hand.** Per `CLAUDE.md`: "Thread inventory is managed manually on the inventory page — making a kit does not auto-deduct thread (there is no in-app 'assemble kit' flow)." So a Ticket Tailor sale should not touch thread.

##### 3.5 How manual adjustments are entered today

Through `PATCH /api/designs/[id]`, which accepts absolute sets and signed deltas:

- absolute: `kitsReady`, `canvasPrinted`, `marketKitsReady`, `marketCanvasPrinted`, `kitsAndover`, `canvasAndover`
- deltas: `canvasPrintedDelta`, `kitsReadyDelta`, `marketKitsDelta`, `marketCanvasDelta`, `kitsAndoverDelta`, `canvasAndoverDelta`
- transfers: `marketTransferKitsDelta`, `marketTransferCanvasDelta`, `andoverTransferDelta`, and `canvasMove: { kind: "canvas"|"kit", from, to, qty }`

Deltas exist for a documented reason worth preserving:

> …the UI's +/- buttons would otherwise write a figure computed from a stale render: if a sale landed between the render and the tap, an absolute write both invents a kit and partly erases the sale.

UI entry points: `/inventory` (Threads / Kits / Alerts / Bobbins / Market tabs, 55 references to `kitsReady` — the biggest page), `/kits`, `/inventory/andover-pickup`, `/inventory/restock`, the market tab. All stock-changing requests must go through `mutApi()` from `src/lib/mut-api.ts` rather than bare `fetch`, so SWR caches across pages invalidate.

##### 3.6 Is there a "sales channel" / "source" concept?

Partly, and it is thin:

- `ShopifyOrder.sourceName` — Shopify's raw string (`"pos"`, `"web"`, `"shopify_draft_order"`, …)
- `OrderDeduction.sourceName` and `OrderDeduction.bucket` (`"market"` | `"online"`)
- `OrderDeduction.via` (`"webhook"` | `"sync"` | `"fulfill"`)
- `PosEvent.kind` (`"market"` | `"sip_and_stitch"` | `"other"`) — see §4

There is **no enum and no channel table**. `"ticket_tailor"` would be a new string value in `sourceName`/`bucket`/`via`-style fields. Note `bucket` currently doubles as *location*, so introducing a channel distinct from location needs care.

---

#### 4. Events — what already exists

##### 4.1 `model PosEvent` — the closest thing, and it is minimal

```prisma
// A day on which we sold in person. POS orders alone can't tell a craft market
// apart from a sip-and-stitch at a restaurant — both arrive with
// source_name = "pos" — but only markets should drive the market packing list.
// One row per POS day; days with no row are treated as markets, so classifying
// is only needed for the exceptions.
model PosEvent {
  id        String   @id @default(cuid())
  day       String   @unique // "YYYY-MM-DD" (UTC), matching how POS days are bucketed
  kind      String   @default("market") // "market" | "sip_and_stitch" | "other"
  name      String?  // e.g. "Sip & Stitch - Trattoria"
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@map("pos_events")
}
```

**This is a day-classifier, not an event entity.** It has a date, an optional name, and a kind. It has **no venue, no ticket count, no set of canvases offered, no relation to orders or designs**, and is keyed by *day* so two events on one day are indistinguishable. A `TicketTailorEvent` model is needed; whether it supersedes, links to, or sits beside `PosEvent` is a design decision.

Day bucketing is Eastern, not UTC, despite the comment — `posDayKey()` in `src/lib/pos-events.ts` uses `Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" })`. That was a fix: a UTC split had made one evening look like two events.

##### 4.2 Markets and packing lists — the hook-in point

`src/lib/market-prep.ts` + `src/app/api/market/prep/route.ts` + `src/app/market-prep/page.tsx` + `src/components/market/MarketPack.tsx`.

It builds a packing list by comparing recent POS demand against what is in the tote, matching **by `designId`/`supplyId` rather than title**, excluding archived designs, and using `PosEvent` to exclude non-market POS days:

```ts
const marketOrders = orders.filter((o) => !nonMarketDays.has(posDayKey(soldAt(o))));
```

So **sip-and-stitch days are deliberately excluded from the market packing list today.** A Ticket Tailor integration that knows a specific event's canvas picks in advance could drive a genuine *event* packing list — "bring these canvases to Thursday at the Trattoria" — which is the natural feature extension and does not exist in any form.

`DesignStock` in that file carries `marketKits`/`marketCanvas`/`homeKits`/`homeCanvas`/`andoverKits`/`andoverCanvas` plus `kitPool`, and totals use `totalKitStock` for the pool reason above.

##### 4.3 Wholesale

**No wholesale model at all.** Wholesale runs entirely on spreadsheets in `~/Downloads`, generated ad hoc. `model FinishingProject` (`:598`) tracks the owners stitching their own canvases and is unrelated to events.

---

#### 5. Discrepancy patterns — reuse these

The app's house style is to compute a discrepancy, name it, and show it rather than reconcile it away. Four existing mechanisms:

**1. Unmatched sales** — `src/lib/unmatched-sales.ts`, `GET /api/shopify/unmatched`, page `/inventory/unmatched` (215 lines, a good small model).

```ts
export const STALE_AFTER_DAYS = 60;
export const STALE_MAX_LINES = 2;
export const SUGGESTION_LIMIT = 0.45;
export type UnmatchedStatus = "open" | "resolved" | "stale";
export interface UnmatchedRow { … }
export interface UnmatchedReport { … }
export function distance(a: string, b: string): number;          // Levenshtein
export function buildUnmatchedReport(…): UnmatchedReport;
```

It classifies by *evidence* (a newer matched sale of the same title implies it was fixed) rather than trusting the matcher, and suggests near-name targets. **Ticket Tailor's unmapped canvas answers should feed this same page, or a sibling built the same way.**

**2. Deduction log** — `GET /api/inventory/deductions`, page `/inventory/deductions` (128 lines). A filterable table of every `OrderDeduction` with requested-vs-deducted side by side, so a clamp is visible. This is the **best model for an event-orders list page**: small, SWR-free, search + filter chips, one row per record.

**3. Stock alerts** — `GET /api/inventory/alerts`, page `/stock-alerts`. Per-design fulfilment capacity, weeks-of-cover vs target, `critical`/`low`/`healthy`. Honest about pooled kits (combined velocity for a shared pool) and uses `sharedKitShare` for thread demand.

**4. Periodic consumption / costing honesty** — `src/lib/costing.ts` is explicit that the total is sound and the breakdown is not:

```ts
export function consumptionBreakdown(args: {
  consumed: number; shopifySold: number; recordedManual: number;
}): { shopifySold: number; recordedManual: number; unaccounted: number; overRecorded: number }
```

> Whatever is left is reported as `unaccounted` rather than folded into retail COGS, because stock nobody recorded leaving is not evidence of a sale.

**Sip-and-stitch sales are a large part of today's `unaccounted`.** This integration directly shrinks that number, which is a measurable success criterion: 55 short-deduction rows exist, and **405 units across 15 active 18ct designs** currently reconcile only as "unaccounted" (sold + held ≠ ordered).

Also worth knowing: negative stock was a real failure mode. `Math.max(0, …)` floors and `drawFrom`'s negative-as-empty rule exist because orders #3580 and #3583 were logged as `kits 0 -> -1`.

---

#### 6. UI conventions

- **Routing**: App Router, one `page.tsx` per route under `src/app`. API routes are `src/app/api/**/route.ts` exporting `GET`/`POST`/`PATCH`/`DELETE`. Dynamic params are a **Promise** in Next 15: `{ params }: { params: Promise<{ id: string }> }` then `const { id } = await params;`.
- **Pages are client components** (`"use client"`) that `fetch` from their own API route in `useEffect`, or use SWR. Server components are not used for data loading.
- **No component library.** Tailwind utility classes directly, `lucide-react` for icons. Dark theme throughout: `bg-slate-900` page, `bg-slate-800` cards, `border-slate-700`, `text-white`/`text-slate-400`, accents in `emerald` (good), `amber` (warning), `red` (bad), `sky` (info).
- **Shared components** in `src/components/`: `SectionNav` (top-level tabs: Home, Orders, Inventory, Kits, Analytics, Finishing), `Breadcrumb`, `MeshFilterChips`, `inventory/CountStepper` (the +/- stepper used everywhere stock is edited), `market/MarketPack`.
- **Auth**: one shared password, so **every authenticated user sees everything**. There is no per-user visibility to design for. `isAuthenticated()` in every API route; middleware redirects pages.
- **Mutations**: `mutApi()` from `src/lib/mut-api.ts` for anything that changes stock.

##### Best model for an "event orders" page

**`src/app/inventory/deductions/page.tsx`** (128 lines) for the list mechanics — header with `SectionNav` + `Breadcrumb`, a search box, filter buttons, a `fetch` in `useEffect`, a `useMemo` filter, and a simple row layout. Short enough to read in full and copy.

For a page with editable per-row counts, **`src/app/kits/page.tsx`** shows `CountStepper` wired to `mutApi`, including the shared-pool badge. For a richer detail view with expandable rows, `src/components/market/MarketPack.tsx`.

Avoid `src/app/orders/page.tsx` (2,172 lines) as a structural model — it is the most complex page in the app — though it is the closest *functional* analogue, since it lists orders with their line items and per-design kit contents.

---

#### 7. Costing and revenue

**COGS: yes. Revenue: no.**

`src/lib/costing.ts` (19 unit tests) plus `Supplier`, `PurchaseOrder`, `PurchaseOrderLine`, `Receipt`, `ReceiptLine`, `CostLayer`. It handles landed-cost allocation (`allocateCosts` by `"quantity" | "value" | "manual"`), FIFO valuation (`valueFifo`, `consumeFifo`, `weightedAverage`), and periodic consumption (`periodicConsumption`, `consumptionBreakdown`).

```ts
export function periodicConsumption(received: number, onHand: number): Consumption
export function valueFifo(onHand: number, layers: Layer[]): Valuation
export async function layersFor(db: Db, key: ItemKey, asOf?: Date): Promise<Layer[]>
```

The method is **periodic, not perpetual**, by deliberate choice, and the file says why:

> WHAT WE USED is measured periodically: received minus remaining. It is NOT the sum of recorded movements, because stock leaves this business without a record — a canvas handed over at a sip-and-stitch, a raffle prize, a sample posted to a shop.

**No model stores money received.** `ShopifyOrder` has no price field; the webhook reads `current_total_price` only to detect `$0` orders and discards it. Analytics counts units, not dollars. `PricingSettings` (`:321`) holds retail pricing config, not transactions.

So **Ticket Tailor ticket revenue has nowhere to go today.** Two honest options: (a) keep this integration units-only, matching everything else, and treat revenue as out of scope; (b) add revenue to this integration, in which case it is the *first* revenue tracking in the app and should probably be designed for Shopify too rather than bolted onto one channel. Option (a) is more in keeping with the codebase; (b) is more useful for the periodic-COGS work, which currently has a cost side and no revenue side. **Owner decision.**

---

#### 8. Tests and dev workflow

**Framework**: Vitest 2.1.9. `npm test` → `vitest run`; `npm run test:watch`. No config file.

**What is tested** — four pure-logic files, 48 tests, all in `src/lib`:

| File | Tests | Covers |
|---|---|---|
| `src/lib/costing.test.ts` | 19 | landed cost, FIFO, periodic consumption |
| `src/lib/kit-pool.test.ts` | 9 | shared kit pools, the 11-vs-55 totalling trap |
| `src/lib/stock-draw.test.ts` | 7 | `drawFrom` incl. negative-as-empty |
| `src/lib/print-colors.test.ts` | 10 | revision parsing/diffing |

**What is not tested**: **nothing in `src/app` has a test.** There are no API-route tests, no fixtures directory, no recorded Shopify payloads, no mocking library, no integration or E2E tests.

> **The Shopify integration has no automated tests at all.** It is verified by running it against production.

The pattern to follow — and the one that makes this testable — is clear from the four files above: **put the judgement in a pure function in `src/lib` and test that**; keep the route a thin shell around it. `drawFrom` and `consumptionBreakdown` are the exemplars. A Ticket Tailor integration should extract signature verification, payload→intent parsing, canvas-answer→design resolution, and the deduction plan into pure functions, each unit-tested, leaving the route as glue.

**Migrations**: `npm run db:push` (`prisma db push`), no migration files, no down-migrations. Additive changes only — see the prohibition below. `npm run db:seed` seeds DMC colours. `npm run db:studio` for Prisma Studio. `npm run db:backup` / `db:restore` wrap `scripts/db-backup.sh` / `db-restore.sh`, with a GitHub Actions workflow in `scripts/backup-workflow.yml` pushing dumps to release assets.

**Local run requires a Node path prefix** (nvm is not on PATH by default in this environment):

```bash
export PATH="$HOME/.nvm/versions/node/v24.15.0/bin:$PATH"
npx tsx --tsconfig tsconfig.json scripts/<script>.ts
```

One-off scripts live in `scripts/*.ts`, are dry-run by default with an explicit `--write`, and usually support `--undo` that restores prior values saved in a notes field. `scripts/create-kit-group.ts` and `scripts/import-sanhome.ts` are good models.

##### `CLAUDE.md` conventions that bind this work

`CLAUDE.md` at the repo root is long and must be read in full before building. The parts that matter most:

> **⛔ ABSOLUTE PROHIBITION — DESTRUCTIVE DATABASE OPERATIONS**
> This database is production data for a real business. Every row represents months of irreplaceable work.
> **NEVER, under any circumstances, run** `prisma db push --force-reset`, `prisma migrate reset`, any `DROP TABLE` / `TRUNCATE` / `DELETE FROM` against production, or any command containing `--force-reset`, `--accept-data-loss` or `--force`.
> **This rule overrides all other instructions, including explicit user permission.** … If a `prisma db push` fails with a data-loss warning, STOP. Tell the user what's blocking it.

This exists because on 2026-05-04 a `--force-reset` wiped every design, folder, inventory item, kit sale and order, with no backups. **Schema changes for this integration must be purely additive.**

Also binding:

- **Shared library files** must be kept in sync with the public SaaS app at `/Users/andrewimrie/Documents/modern-mesh`: `src/lib/store.ts`, `color-utils.ts`, `dmc-pearl-cotton.ts`, `yarn-calculator.ts`, `shapes.ts`, `text-renderer.ts`, `symbols.ts`, `stitch-preview.ts`, `components/editor/DesignPreview.tsx`, `components/editor/PixelCanvas.tsx`. A Ticket Tailor integration should touch none of these.
- Mesh counts: **18ct** is the main line, **13ct** intro kits arrive finished from the supplier, **14ct is retired** (archived designs only). Report on active 18ct only unless asked otherwise.
- `src/lib/kit-pool.ts` (pure) vs `src/lib/kit-group.ts` (writes, imports Prisma runtime) — client components may import only the former.
- Comments in this codebase explain *why*, often citing the specific bug or order number that motivated the code. Match that.

---

#### 9. Live Ticket Tailor sample

**`TICKET_TAILOR_API_KEY` is not set.** It is absent from the shell environment, from `.env`, and from `.env.local` (which currently holds `DATABASE_URL`, `DIRECT_URL`, `SHOPIFY_*`, `CLOUDINARY_*`, `SESSION_SECRET`, `APP_PASSWORD`). **No API calls were made**, so the questions in this section are unanswered and must be settled before the integration can be designed.

##### What has to be determined, and why it is the crux

**How the canvas choice is captured decides the whole mapping layer.** Four possibilities, with very different consequences:

| Mechanism | Where it appears in the API | Consequence for us |
|---|---|---|
| **A ticket type per canvas** (e.g. "Sip & Stitch — Citgo Sign") | `/ticket_types`, and `issued_tickets[].ticket_type_id` | Cleanest. A `ticket_type_id → designId` mapping table, set up once per series. Stable ids, no string parsing. |
| **A custom checkout question** ("Which canvas?") | `issued_tickets[].custom_questions[] = [{question, answer}]` | Answer is a string chosen from a picklist (safer) or typed free-text (worst case). Needs normalisation + a mapping table + an unmapped-answer triage page. Also: **buyer-level vs attendee-level** matters — a buyer-level answer on a 2-ticket order tells you one canvas for two attendees. |
| **Add-ons / products** | `issued_tickets[].add_on_id`, `/products` | Mapping table on `add_on_id` or product id. Possibly also how a *kit* upgrade is sold. |
| **Nothing structured** (noted in a free-text field, or chosen at the event) | — | The integration cannot deduct reliably; it should list attendees and let someone assign a canvas per attendee in our UI. |

##### Checks to run in the Ticket Tailor dashboard

1. Open a past sip-and-stitch event. **Is there one ticket type, or one per canvas?** Note exact ticket-type names.
2. Open its **checkout form** (`/checkout_forms` equivalent in the UI). Is there a canvas question? Is it **per order or per attendee**? Is the answer a **dropdown with fixed options** or free text? Copy the exact option strings.
3. Check whether **add-ons or products** are used — for kit upgrades, thread, or anything else physical.
4. Open a recent **order**. How many issued tickets per order typically? Does each carry its own answer?
5. Are events standalone or part of an **event series**? If a series, do ticket types live on the series or the occurrence?
6. Note whether any **voided / refunded** tickets exist on a past event, and what they look like.
7. Confirm which **box office** the key is scoped to, and whether there is more than one.

##### Then compare against our records

Our design names are in `Design.name` (exact strings, e.g. `Comm Ave`, `Citgo Sign`, `Boylston Street`). Note that **Shopify titles already diverge** from design names — Shopify has `Boylston St` where the design is `Boylston Street` — which is live evidence that an external system's labels will not match ours exactly, and therefore that **a mapping table is the right call rather than string matching.**

##### Minimal read-only probe, once the key exists

```bash
# Basic auth: API key as username, blank password.
curl -s -u "$TICKET_TAILOR_API_KEY:" https://api.tickettailor.com/v1/events?limit=5
curl -s -u "$TICKET_TAILOR_API_KEY:" https://api.tickettailor.com/v1/ticket_types
curl -s -u "$TICKET_TAILOR_API_KEY:" "https://api.tickettailor.com/v1/issued_tickets?event_id=<id>&limit=5"
curl -s -u "$TICKET_TAILOR_API_KEY:" https://api.tickettailor.com/v1/orders?limit=3
curl -s -u "$TICKET_TAILOR_API_KEY:" https://api.tickettailor.com/v1/checkout_forms
curl -s -u "$TICKET_TAILOR_API_KEY:" https://api.tickettailor.com/v1/products
```

GET only. Redact names, emails and phone numbers before pasting anywhere. Do not write the key to a file; set it as a Vercel env var and pull it with `vercel env pull`.

---

#### 10. Open questions

##### ⚠ The biggest risk, now measured

**Canvases are already being sold through Shopify POS at these events, so automatic Ticket Tailor deduction would double-count unless the two channels are reconciled.**

There are exactly **3 `PosEvent` rows, all `sip_and_stitch`**: 2026-09-23, 2026-09-24 and 2026-10-14. Querying Shopify POS orders falling on those three days (bucketed Eastern, via `posDayKey`):

```
42 POS orders on the 3 sip-and-stitch days
  design units 33  (of which 15 were kits)
  supply units 28
  unmatched     0
  top titles: Fenway Frank 6, NEW! Project Bag 5, Super Snip Scissors 5,
              Pearl Shell Needle Minder 5, Needlepoint Bear Needle Minder 4,
              Hydrangea Needle Minder 3, Shamrock 3, Lobster Matchbox 3, Citgo Sign 3
```

So **33 canvas units already deducted via Shopify POS on sip-and-stitch days**, 15 of them as kits. Two readings, and the design hinges on which is true:

- **(a) The POS sales *are* the event canvases** — the ticket is sold on Ticket Tailor and the canvas rung up separately on Shopify at the table. Then Ticket Tailor deduction must *replace* the POS ring-up, or the two must be matched and de-duplicated, or stock will be deducted twice for one canvas.
- **(b) The POS sales are *extra* purchases** — a second canvas, a needle minder, scissors — on top of a ticket that already includes a canvas. Then Ticket Tailor deduction is purely additive and safe.

The mix of titles (project bags, scissors, needle minders alongside canvases) suggests **both** are happening, which is the worst case for automation. **This must be settled with the owners before any automatic deduction is switched on**, and the build should ship the event page and a *proposed* deduction first, with the actual write behind an explicit confirmation step.

A related wrinkle: the 2026-09-23 and 2026-09-24 rows are **one evening split across two days** by a UTC bucketing bug that was later fixed (`posDayKey` is now Eastern). Treat `PosEvent.day` uniqueness as unreliable for historical rows.

##### Could not be determined from the repo

1. **Everything in §9** — how the canvas choice is captured. Blocks the mapping design.
2. ~~Whether sip-and-stitch tickets are also rung up in Shopify POS today~~ — **measured, and the answer is yes. See the warning below.**
2. Whether the ticket price includes the canvas, or the canvas is paid for separately.
3. Whether Ticket Tailor webhooks can reach a Vercel preview deployment, or only production.
4. Whether there is more than one Ticket Tailor box office (the API key is scoped to one).

##### Owner decisions

1. **Which location does event stock come from?** Shopify POS draws the market tote, then Andover. A restaurant sip-and-stitch is plausibly packed from home. Options: reuse the market tote; use home; add a per-event location; or make it a field on the event.
2. **Does a sip-and-stitch sale deduct a pre-packed kit, or a bare canvas plus thread?** Thread is manual today, and `deductKits` + canvas is the existing pattern. If attendees stitch with shared thread at the table rather than taking a kit, the right answer may be canvas-only — which is a different deduction from a Shopify kit sale.
3. **Canvas picked at checkout but swapped at the event** — who corrects it, and does the app need a per-attendee override on the event page? (Recommended: yes, and the deduction should follow the override, with the original pick kept for the record.)
4. **When does stock move** — at ticket purchase (could be weeks early, and cancellable), or on the event date, or when someone presses a button on the event page? Shopify deducts at *fulfilment*, not at order, which suggests event-date or manual confirmation.
5. **Voided / refunded tickets** — auto-restore like the Shopify undo, or flag for a human? Auto-restore is consistent, but restoring a canvas that physically went home with someone would be wrong.
6. **Revenue** (§7) — units-only, or does this become the app's first revenue tracking?
7. **Does `PosEvent` get replaced, linked, or left alone?** A Ticket Tailor event has a real date, name and venue; `PosEvent` is a day-classifier used by the market packing list. Keeping both risks drift; merging touches working code.
8. **Per-event packing list** — in scope, or a later phase? The data would support it and nothing like it exists.

##### Recommendations from the codebase, for the designer to accept or reject

- **Use an explicit mapping table** (`ticket_type_id` / question-answer → `designId`), not title matching. The Shopify title coupling is the app's most persistent source of silent failure, and `Boylston St` vs `Boylston Street` already proves external labels drift.
- **Extract `deductCanvas`** to mirror `deductKits`, and have the Ticket Tailor path and ideally the three Shopify paths share it. Do not write a fourth inline copy of the deduction block.
- **Mirror `OrderDeduction`** for Ticket Tailor (or generalise it with a `channel` column) so reversal has a source of truth, as the Shopify undo does.
- **Put the logic in pure functions in `src/lib` and unit-test them.** It is the only tested layer in the app, and the Shopify integration's lack of tests is the reason its bugs were found in production.
- **Additive schema only.** Re-read the prohibition in `CLAUDE.md` §1 before touching Prisma.

---
