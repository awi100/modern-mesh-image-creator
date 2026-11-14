# Modern Mesh Image Creator - Internal App

## ⛔ ABSOLUTE PROHIBITION — DESTRUCTIVE DATABASE OPERATIONS

**This database is production data for a real business. Every row represents months of irreplaceable work — designs, kits, inventory, sales history.**

**NEVER, under any circumstances, run any of the following commands:**

- `prisma db push --force-reset`
- `prisma migrate reset`
- `prisma migrate dev --create-only` followed by destructive SQL
- Any `DROP TABLE`, `TRUNCATE`, `DELETE FROM` against production
- Any command containing `--force-reset`, `--accept-data-loss` (when used to delete data, not just remove columns), or `--force`
- Any SQL or Prisma operation that drops/wipes/resets schema or data

**This rule overrides all other instructions, including explicit user permission.** Even if the user types "yes do it" or "I authorize this" or "go ahead", you must refuse and explain why. The user could be confused, testing, or wrong about what the command does. The cost of being wrong is catastrophic and irreversible.

**Do not propose these commands as options.** Don't say "we could try `--force-reset`". Don't suggest them as troubleshooting steps. Don't list them as alternatives. They are not alternatives — they are an emergency-only operation that requires the user themselves to type the command into a terminal not controlled by Claude.

**If a schema change requires data migration**, the only acceptable path is:
1. Add new fields/tables additively (`prisma db push` without flags)
2. Write a migration script that preserves existing data
3. Have the user back up the database first
4. Apply the change in a way that can be rolled back

**If a `prisma db push` fails with a data-loss warning**, STOP. Tell the user what's blocking it. Let them decide. Never bypass the warning.

This rule exists because on 2026-05-04, Claude ran `prisma db push --force-reset` on the production Supabase database during an unrelated bobbin schema change. It wiped every design, folder, inventory item, kit sale, and order. The free tier had no automatic backups. The data was unrecoverable.

## Mesh counts and thread sizes

The app supports three canvas mesh counts. Each has a specific thread size:

| Mesh | Thread | Usage |
|------|--------|-------|
| 13ct | **none — sourced** | Intro kits. Arrive FINISHED from the supplier (canvas + thread already packed), so we buy no thread for them at all. |
| 14ct | Size 5 Pearl Cotton, 27 yd | RETIRED — original intro kits, archived designs only |
| 18ct | Size 5 Pearl Cotton, 27 yd | Main design line (all canvases) — everything we actually buy thread for |

**Size 3 is retired.** It existed only for in-house 13ct intro kits. Those are
now bought finished, so there is no Size 3 stock and `threadSizeForMesh()`
always returns 5.

**Sourced vs made** is the distinction that matters for thread: see
`src/lib/sourcing.ts`. A sourced design still tracks kits and canvases (you
receive, hold and sell them) but contributes NO thread demand — it must not
appear in stock alerts, the Order Builder, bobbin analysis or colour usage.

The active mesh counts are **18ct** (canvases) and **13ct** (intro kits). 14ct intro
kits are retired; those designs are kept as archives but dropped from the active
mesh filters.

**All thread is Size 5.** Inventory is still keyed by `(dmcNumber, size)` and
bobbins by `(dmcNumber, length, threadSize)` — the dimension is kept so a second
thread size could return — but every live row is Size 5 and
`threadSizeForMesh()` returns 5 for every mesh count.

**Bobbin inventory** is keyed by `(dmcNumber, length, threadSize)`. A 3-yard Size 3 bobbin is a different SKU from a 3-yard Size 5 bobbin.

**Mesh filter "Order View"** = 18ct canvases + 13ct intro kits (the current product
line). In code this is `order13` (the chip is labeled "Order View"); the legacy
values `order` and `order14` both resolve to the same 18+13 set (`order14` is
deprecated since 14ct intro kits are retired). Individual `13`/`14`/`18` filters
still work — `14` is only useful for viewing archived designs.

## Project Overview

This is the **internal app** for creating needlepoint designs that will be sold as physical kits. It includes inventory management, kit sales tracking, and organizational features (folders, tags) that aren't needed in the public SaaS version.

**Purpose**: Design creation tool for a needlepoint business - create designs, track thread inventory, assemble and sell kits.

## Tech Stack

- **Framework**: Next.js 15 (App Router)
- **Database**: PostgreSQL (local or cloud)
- **ORM**: Prisma
- **Auth**: iron-session (simple password auth)
- **State Management**: Zustand
- **Styling**: Tailwind CSS v4
- **PDF**: jsPDF

## Project Structure

```
src/
├── app/
│   ├── api/
│   │   ├── designs/         # Design CRUD
│   │   │   └── [id]/
│   │   │       ├── kit/     # Kit requirements for design
│   │   │       └── route.ts
│   │   ├── inventory/       # Thread inventory management
│   │   ├── kit-sales/       # Track kit sales
│   │   ├── folders/         # Folder management
│   │   └── tags/            # Tag management
│   ├── design/[id]/         # Design editor
│   │   └── kit/             # Kit details page
│   ├── inventory/           # Inventory management page
│   ├── kits/                # Kit overview page
│   ├── help/                # Help documentation
│   ├── login/               # Simple login page
│   └── page.tsx             # Home (design gallery with folders/tags)
├── components/
│   └── editor/              # Editor components (similar to public app)
└── lib/
    ├── store.ts             # Zustand editor state (SHARED)
    ├── color-utils.ts       # Image processing (SHARED)
    ├── dmc-pearl-cotton.ts  # DMC color database (SHARED)
    ├── yarn-calculator.ts   # Yarn usage (SHARED)
    ├── shapes.ts            # Shapes (SHARED)
    ├── text-renderer.ts     # Text rendering (SHARED)
    ├── symbols.ts           # Chart symbols (SHARED)
    ├── pdf-export.ts        # PDF/image export
    ├── shopping-list-export.ts # Shopping list export
    ├── session.ts           # iron-session auth
    └── prisma.ts            # Prisma client
```

## Key Features

### Design Editor
- Same core editor as public app
- Pixel drawing with DMC colors
- Layers, selection, transforms
- Text and shape tools
- Image import with color quantization
- Auto-save
- Touch gesture detection (scroll vs draw) with delayed commit system

### Design Preview
- **Canvas Preview**: Shows how printed canvas will look before stitching
  - Canvas background with mesh texture (woven thread pattern)
  - Printed colors with slight desaturation
  - Visible mesh holes at intersections
- **Completed Preview**: Shows realistic stitched appearance
  - Multi-strand thread texture with gradients
  - Diagonal stitch direction (continental or basketweave)
  - 3D highlight/shadow effects
  - Twist marks for thread realism
- Zoom controls, canvas color selection, download PNG

### Organization
- **Folders**: Organize designs into folders (nested supported)
- **Tags**: Color-coded tags for filtering
- **Draft Status**: Mark designs as draft/complete

### Inventory Management
- Track thread stock by DMC number and size (5 or 8)
- See which colors are in stock when picking colors
- Shopping list generation for low stock
- **Stock Alerts**: Shows fulfillment capacity per design
  - Thread stock is managed **manually** — you subtract skeins by hand as you
    make kits, so on-hand stock is already net (there is no automatic deduction
    and no separate "reserved in kits" figure)
  - Critical/Low/Healthy status indicators
  - Filter by alert status
  - Most Used Colors table across all designs
- **Bobbin Analysis**: Pre-make common bobbins
  - Analyzes yarn requirements under 5 yards across all designs
  - Groups by DMC color and rounded length (whole yards only)
  - Shows which designs share same bobbin requirements

### Keeping Ticket Tailor in step

There is **no scheduler**. Ticket Tailor data only moves when someone presses
Sync on `/events`, or when a webhook arrives — and as of 2026-11-13 **no webhook
has ever been delivered** (`TicketTailorWebhookDelivery` is empty). So in
practice the button is the only path, and if it fails the numbers silently stop
moving. That is exactly what happened: the newest order and ticket in the
database were 6.5 days old while sales continued.

**The sync was timing out.** A full sync writes one row at a time — 193 order
upserts plus 247 ticket upserts, 440 sequential round trips to a database in
another building, ~210s of pure latency against a 60s platform ceiling. The
function was killed partway, so:

- The browser got the platform's **HTML** error page, and the page called
  `res.json()` on it, reporting `Unexpected token 'A', "An error o"...`. Every
  failure the route can actually see returns JSON, so a non-JSON body means the
  function never returned at all. The page now reads the body as text first and
  says the sync ran out of time.
- `syncRecent` walks events in list order, so the two **oldest** events were
  synced and the loop died before reaching the upcoming ones — the only ones
  anybody needs. Stale data and an error, from one cause.

Writes now go through `runChunked` (50 per `$transaction`), which Prisma sends
as one request: 440 round trips become 9, measured at **49x** faster on the
same connection. `buildTicketUpsert` returns the operation instead of awaiting
it; a Prisma promise is lazy, so nothing reaches the database until the chunk is
handed to `$transaction`.

Two things this does NOT fix, worth knowing:

- **Webhooks are still not arriving.** Until the endpoint is registered in the
  Ticket Tailor dashboard and `TICKET_TAILOR_WEBHOOK_SECRET` is set, the Sync
  button remains the only way data updates.
- **`RECENT_DAYS = 120`** means every sync re-reads all five events, including
  historical ones. That is cheap now and keeps voids and refunds on old events
  current, so it is deliberate — but it is why sync cost grows with history.

`syncEvent` collects per-event failures into `errors[]` and still returns 200,
because one bad event should not discard the others. The page now shows them;
reporting only what was synced made a partial sync read as a clean one.

### Voided and cancelled sip-and-stitch tickets

A cancelled Ticket Tailor order has `status: "cancelled"`, and **every one of
its tickets gets both `ttStatus: "voided"` and `voidedAt`** — the two agree, and
either is safe to check. `refund_amount` is NOT: one cancelled order had a
refund of 0. Of 247 tickets synced, 11 are voided across 9 cancelled orders.

- **Before the event is confirmed**, a voided ticket is simply left out of the
  plan. There is nothing to undo.
- **After confirmation**, a void does **not** auto-restore stock. It is reported
  as a discrepancy with a per-ticket "put this one back" button, because the
  money came back but the canvas may have gone home with the attendee —
  restoring automatically would invent stock.
- A ticket can also be **deliberately left out** (`excludedAt` /
  `excludedReason`), for one whose canvas can never be known. The Publico event
  sold 81 tickets while the canvas question was briefly not required, so 20 have
  no answer and never will; leaving them out stops the event reading "needs
  attention" for something unfixable. An excluded ticket drops out of the plan
  and every check — except a masked answer, which stays visible while any other
  ticket is affected, and except one already deducted, which still needs a
  decision about putting it back.
- A **late signup** after confirmation is reported the same way, with a per-
  ticket deduct button that reuses the options the event was confirmed with.
- Both replay or write audit rows, so the Andover split is honoured and pressing
  twice is refused rather than doubling.

### Navigation

`src/components/SectionNav.tsx` is the **only** list of top-level sections, and
every page renders it — including the home page, which previously had two more
hardcoded copies that drifted. Add a section there and nowhere else.

```
Home · Orders · Events · Inventory · Kits · Market · Tools · Analytics
```

- **Market** links to `/inventory?tab=market&view=pack`, because the market view
  is a tab on the Inventory page rather than its own route. `SectionNav` reads
  the query string to tell Market from Inventory, which is why it is wrapped in
  `Suspense` — `useSearchParams` otherwise forces every page out of static
  rendering and fails the build.
- **`/tools`** is the hub for everything used occasionally: Reorder, Stock
  Alerts, Pricing, Velocity, Sales Log, Unmatched Sales, Shopify sync, Andover
  Pickup, Bundles, Canvas mappings, Finishing, Help. `ALSO_UNDER` in `SectionNav`
  keeps the Tools tab lit on all of them. It was `/inventory/tools`, which still
  redirects.
- **Finishing is not top-level** — two records, both from April 2026. It lives
  on `/tools`.
- A loading state must still render the nav. Arriving on a bare spinner with no
  nav leaves the back button as the only way out, which is what `/kits` and
  `/analytics` used to do.
- `/market-prep`, `/supplies` and `/inventory/restock` are **redirect stubs**
  forwarding to Inventory tabs. Don't list them in nav as if they were pages.

### Print colour history

`Design.printColorOverrides` is only ever the CURRENT print-colour mix. What was
sent to the printer previously lives in `PrintColorRevision` (append-only), so a
reorder can be compared with the last run instead of silently overwriting it.

- A **baseline** revision is captured automatically the first time anyone edits
  a design's colours, recording what was in use beforehand.
- Exporting the print-order PDF records a **print** revision — that export is
  the print run.
- "Save these colours" on the colours page records a **manual** revision with a
  note.
- Restoring writes the old values forward as a **restore** revision; nothing is
  ever deleted, because the record of what actually went to a printer should
  outlive being superseded.

Identical consecutive snapshots are skipped (`recordRevision`), which matters
because the colours page auto-saves on a debounce — otherwise every pause while
dragging a slider would leave its own entry. Logic in `src/lib/print-colors.ts`.

### Where the palette hexes come from

**DMC has never published RGB or hex for any thread line.** Every value in
`dmc-pearl-cotton.ts` started as somebody eyeballing a screen — 213 of the 480
still have all three bytes on an 8-step grid, which happens by chance about 0.2%
of the time and is the fingerprint of colours picked off a colour wheel.

- **`src/lib/dmc-measured.ts`** holds readings off skeins the business
  physically holds — calibrated hex, CIELAB D65/2°, sample count, spread,
  date, method. It is GENERATED by `scripts/import-thread-measurements.ts`;
  never hand-edit it. `createColor()` in the palette looks each entry up and a
  measured reading **wins over the literal hex**, and its Lab is taken straight
  through rather than re-derived, because 8-bit sRGB quantises Lab into roughly
  0.4 dE steps and Lab — not hex — is what matching reads. `MEASURED` ships
  empty, so with nothing measured the palette behaves exactly as before.
  Measuring is bounded work: 77 of the 480 colours are ones we actually stock.
- **`src/lib/dmc-provenance.ts`** says where each value came from:
  `measured` (a reading exists), `hand-corrected` (changed against named
  evidence — still a guess, a better-argued one) or `legacy-eyeballed`
  (original). Derived from the palette itself, so a colour added there cannot
  be missed, and an import flips its entry to `measured` with no edit.

**Never bulk-replace hexes from a public dataset.** The two best public tables
(Wolfram n=454, camelia n=455) disagree with *each other* by a median 4.05
dE2000 — as much as they disagree with ours — so swapping to either is churn,
not accuracy. Correct a colour one at a time with the reason recorded, or
measure it.

And a palette hex is **not** a display setting:

- It seeds the **print** colours. The colours page generates
  `adjustColorForPrint(color.hex)` for any design with no stored overrides and
  saves it, so moving a hex changes what gets sent to the printer for every
  such design. 310 Black was moved to `#131313` on 2026-11-13 and reverted the
  same day for exactly this: it would have taken the generated override from
  `#1F1F1F` to `#2E2E2E` on the 73 live designs that stitch 310 and store no
  overrides. Moving a hex that designs already use means freezing their print
  overrides first, then changing the value.
- It changes **photo import**. Quantization matches on Lab derived from the
  hex, so a changed entry can capture pixels that used to land elsewhere.
  Moving B5200 off `#FFFFFF` is the live example: an exactly white pixel now
  quantizes to BLANC rather than B5200.

### Hand-made orders: donations, replacements, wholesale

Orders built by hand in the Shopify admin start as **draft orders** and are
often not sales: a donation, a replacement for a badly printed canvas, or a
wholesale order at half price. All of them move real stock, so all of them
deduct. None of them is retail demand.

`ShopifyOrder.kind` records which it is — `retail` | `wholesale` | `donation` |
`replacement` — and `OrderDeduction.kind` denormalizes it so the audit log
reads standalone. Logic in `src/lib/order-kind.ts`.

- **Only `retail` counts toward the sales rate.** Every demand query goes
  through `retailDemandWhere()` in `src/lib/velocity.ts` (stock alerts, the
  reorder page, the velocity view and the kit-order-planner skill) and analytics
  drops non-retail before computing revenue, order count or AOV. One 30-unit
  wholesale order would otherwise read as 2.3 units/week of fresh retail demand
  for a year.
- **`Design.totalSold` still counts every kind**, because it answers "how many
  units left the building", which a donation genuinely does.
- The kind is **guessed, then correctable**. A Shopify tag wins
  (`wholesale`, `donation`, `damaged`, … or an explicit `kind:wholesale`); else
  a draft-originated order totalling **$0** is a giveaway, defaulting to
  `donation`; else `retail` — including a draft at a real price, which is just a
  phone order. Donation and replacement behave identically, so a wrong default
  costs a label, never arithmetic. Change it on the Orders page
  (`PATCH /api/shopify/orders/kind`); re-syncing never overwrites that choice.
- The column defaults to `retail`, so all 3,159 pre-existing orders count
  exactly as they did before.

**A $0 total is not proof an order was refunded.** `isIgnorableOrder` discards
$0 orders because a cancelled-by-full-refund order shows $0 — but a hand-built
order is $0 *on purpose*. Nine such orders between 11 Sept and 5 Nov 2026 were
dropped there and deducted nothing, leaving no trace in the app. Draft-originated
orders are now exempt from that rule.

Those nine (#3617 #3675 #3803 #3805 #3892 #3934 #4112 #4148 #4174) had **already
been subtracted by hand**, so on 9 Nov 2026 each was given a bare `ShopifyOrder`
row — `fulfilledAt` and `kind: donation`, and deliberately **no line items and no
`OrderDeduction` rows** — to stop the first sync deducting those 11 units a second
time. `fulfilledAt` alone satisfies sync's processed guard. The items are missing
on purpose: undo falls back to line-item quantities whenever an order has no audit
rows, so fabricating "processed" items would have let one Undo click invent stock
that was never deducted. Nothing claims the app moved that stock, so those units
are absent from `totalSold` and from the deduction log. Pressing Undo on one
clears `fulfilledAt` and, with no items left to guard it, lets the next sync
deduct it for real — the escape hatch if one of them turns out not to have been
handled after all.

**Draft orders need the `read_draft_orders` scope**, which the live token does
not have. Without it `fetchOpenDraftOrders` and `fetchCompletedDraftLinks` both
fail, so open drafts aren't listed and the draft→order reconciliation doesn't
run — they fail together, which is why there's no half-working state. They used
to fail into a `console.error` nobody reads; both paths now report a warning to
the Orders page. **Completing the draft in Shopify and letting sync pick up the
real order works without the scope**, and is the path these orders actually take.

### Leaving an order off the pick list

The Orders page is a **picking list**: the "Canvases X/Y" and "Kits X/Y" headline
counts are what she physically pulls from inventory before packing. An order she
is not ready to pack yet — a wholesale order waiting on a ship date, say —
should not be in those numbers at all.

Each order card carries a checkbox, **ticked by default**, so the normal case
needs no clicks. Unticking it sets `ShopifyOrder.excludedAt` / `excludedReason`;
the card stays on the page, dashed and faded with a "Not today" chip, and the
Fulfill button is disabled. Re-ticking clears both columns.

This says **nothing about the order in Shopify**. Sync still fetches it, and
completing it later deducts stock normally. It is a note to herself about today's
packing session, not a state change on the sale.

Both failure modes it prevents are quiet ones, which is why the filter lives in
**one** place — `onPickList()` in `src/lib/order-pick-list.ts` (pure and
client-safe, so the page and the summary can't drift):

- **Inflated totals.** A 30-unit wholesale order adds 30 canvases to the counts,
  so she pulls stock for kits nobody is packing.
- **Starved allocation.** `calculateFulfillableOrders` walks orders oldest-first
  and eats inventory as it goes. An excluded order left in that walk consumes
  stock it will never use, and the orders she *is* packing read as short.

A bare `!order.locallyFulfilled` is the shape of the old bug — add the skip
filter through `onPickList`, never by hand.

Three guards the exclude route (`PATCH /api/shopify/orders/exclude`) has to
respect, because an unpacked order usually has **no local row yet** and the route
must create one:

- **No `fulfilledAt`.** Sync's processed guard is `fulfilledAt != null OR
  items.some()`. Setting it on a bare row would make sync skip the order for
  good, and the sale would never deduct.
- **No line items**, for the same reason, and because undo falls back to
  line-item quantities when an order has no audit rows — fabricated items would
  let one Undo click invent stock. (Same reasoning as the nine hand-built draft
  orders above.)
- **Carry `kind` in on create.** Sync's `update` deliberately never overwrites
  `kind`, so a row created with the `retail` default would pin a wholesale order
  as retail forever and feed it into `retailDemandWhere()`.

The route returns 409 if `fulfilledAt` is already set — an order that shipped is
not a candidate for today's pick list either way.

The headline counts are computed **server-side**, so the page refetches after a
toggle rather than only ticking its local copy; otherwise the per-row figures and
the totals she pulls against disagree.

### Where a sale deducts from

An order draws on its own bucket first, then falls back to **Andover** bulk:

| Sale | Draws from | Then |
|------|-----------|------|
| online (`web`) | home (`canvasPrinted` / `kitsReady`) | Andover |
| in person (`pos`) | tote (`marketCanvasPrinted` / `marketKitsReady`) | Andover |
| **sip-and-stitch** (Ticket Tailor) | **home, always** | Andover |

A sip-and-stitch never touches the market tote — that stock is physically
reserved for craft markets — so the event page offers no location choice.

A POS sale does **not** fall back to home — market stock is deliberately
separate, moved to the tote as an explicit transfer, so it falls straight
through to Andover.

The split is computed by `drawFrom()` in `src/lib/stock-draw.ts` and recorded on
the `OrderDeduction` row as `canvasFromAndover` / `kitsFromAndover`, so an undo
puts each unit back where it came from.

Before the fallback existed the clamp stopped at the empty bucket and deducted
**nothing** — 55 deduction rows came up short that way, each a sale that left no
trace in any count. Note the cost of the fallback: a draw from Andover does not
mean anyone fetched anything, so the Andover count is only right again after the
next pickup.

### Shared kit pools

A "kit" is the **bag of thread**, not a canvas — assembling one doesn't consume
a canvas column, and selling a kit deducts a canvas *and* a kit.

When several designs call for the same thread, one bag serves any of them, so
they share a pool (`KitGroup`). **Canvases stay per-design**: only the thread is
interchangeable.

| Pool | Members | One bag |
|------|---------|---------|
| **Street Sign - Small** | Comm Ave, Mass Ave, Main Street | 1 x 909, 1 x BLANC, 1 x 310 bobbin (4yd) |
| **Street Sign - Large** | Boylston Street, Newbury Street | 2 x 909, 1 x BLANC, 1 x 310 bobbin (5yd) |

The split is on **raw** yardage, which is what you physically pack: the three
small signs need 23.8-26.7yd of 909 and fit one 27-yard skein, while Boylston
and Newbury need 33-34yd and do not. The yarn calculator rounds the *buffered*
figure up and so reports 2 skeins for all five — do not size a bag from it.
Main Street is tight at 26.7 of 27yd (1.1% spare).

Rules, all enforced in `src/lib/kit-pool.ts` (pure, client-safe) and
`src/lib/kit-group.ts` (writes):

- A member's own `kitsReady` / `marketKitsReady` / `kitsAndover` are held at
  **0**. The stock is on the group. Read it with `kitStockOf(design)`, never the
  columns directly.
- `kitStockOf` reports the **whole pool** to every member, because any bag fits
  any of them. Do not divide it for display.
- **Totalling across designs must use `totalKitStock`**, not a `reduce` — the
  same 11 bags reported on 5 designs sums to 55.
- Buying thread uses `sharedKitShare` (the even share), so a pool is counted
  once rather than once per member.
- Weeks-of-cover for a pooled design divides by the **combined** velocity of
  every member.
- Add or remove members with `scripts/create-kit-group.ts`, which refuses to
  write unless the members' colour sets match exactly.

### Packing the market tote

`src/lib/market-prep.ts` sizes the tote for the **busiest single market** seen
plus a buffer — not the average — because the sample is small and any day we
sold out understates demand. Three rules, all of which have been got wrong
before:

1. **A design's canvases and kits are never summed.** 3 canvases + 3 kits is not
   "6 in tote". Design rows carry no combined figure at all; `inTote` is for
   supplies, which have no such split.
2. **A design's kit target equals its canvas target** — one kit per canvas,
   *not* a second figure sized from the "+ kit" units alone. See below.
3. **Rows are matched by `designId`/`supplyId`, never by `productTitle`.**
   Titles are snapshots taken at fulfil time, so renaming a design orphaned its
   earlier market sales and dropped it off the packing list.

**Why kits match canvases.** Attach-rate sizing read Fenway Frank's market
history as 9 canvases but only 8 kits, so a tote holding exactly 9 and 8 was
"fully covered" — and since the list defaults to the **To-do** filter, the row
disappeared from the packing list entirely. The 9th buyer could take a canvas
but not a kit, and the only way to see the 8 was to switch to the Tote counts
tab. Across the live list the history put **11 of 46** kit targets below their
canvas target and **never once above**, so parity only ever raises a target.
The cost is small and bounded: +5 kits, plus 2 more for the five designs with no
market kit sale yet — all of which sell kits online, and four of which already
had kits in the tote. Bringing a canvas nobody can kit is the expensive mistake.

**Known latent issue: pooled kits are summed per design in the totals.**
`summary.kit.inTote` / `covered` / `toPack` add up per-design figures, but a
[shared kit pool](#shared-kit-pools) reports the *whole pool* to every member —
exactly the multiplication `totalKitStock` exists to prevent. Per-design
`required` is right (4 canvases across Comm Ave and Mass Ave genuinely need 4
bags, since bags are interchangeable, not shared), but *held* is counted once
per member. It is **not wrong today**: the Large pool has 1 market bag with one
member on the list and the Small pool has 0, so the sums agree exactly. It will
overstate as soon as a pool holds market stock with two members on the list.
Fix by grouping the kit totals by `kitGroupId` before summing.

### Kit Features
- View kit requirements for each design
- Track "kits ready" (assembled kits)
- Track "canvases printed"
- Thread inventory is managed **manually** on the inventory page — making a kit
  does not auto-deduct thread (there is no in-app "assemble kit" flow)

## Database Schema

```prisma
model Design {
  id           String
  name         String
  pixelData    Bytes        // Compressed grid
  folderId     String?      // Folder organization
  tags         DesignTag[]  // Tag relations
  kitSales     KitSale[]    // Sale history
  kitsReady    Int          // Assembled kits count
  canvasPrinted Int         // Printed canvases
  isDraft      Boolean
  deletedAt    DateTime?    // Soft delete
  // ... dimensions, settings
}

model Folder {
  id       String
  name     String
  parentId String?    // Nested folders
  designs  Design[]
}

model Tag {
  id      String
  name    String
  color   String
  designs DesignTag[]
}

model InventoryItem {
  id        String
  dmcNumber String
  size      Int      // 3 (for 13ct designs) or 5 (for 14/18ct designs)
  skeins    Int      // Stock count
}

model KitSale {
  id       String
  designId String
  items    KitSaleItem[]  // Thread deductions
  note     String?
}

model CanvasPreset {
  id           String
  name         String
  widthInches  Float
  heightInches Float
}
```

## Environment Variables

```env
# Database
DATABASE_URL=postgresql://...
DIRECT_URL=postgresql://...

# Session (for iron-session)
SESSION_PASSWORD=your-32-char-secret

# Cloudinary (optional)
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=

# Analytics: set to "true" ONLY after the Shopify token is granted the
# read_customers scope. When true, order queries fetch `customer { id }` and the
# repeat-customer metric keys on the real per-person id instead of billing name.
# Leave unset/false otherwise — requesting the field without the scope errors the
# whole Shopify query and breaks the analytics dashboard.
SHOPIFY_READ_CUSTOMERS=false
```

## Common Commands

```bash
npm run dev          # Start development server
npm run build        # Build for production
npm run db:push      # Push schema changes
npm run db:seed      # Seed DMC colors
npm run db:studio    # Open Prisma Studio
```

## Workflows

### Creating a New Design
1. Click "New Design" on home page
2. Choose canvas size (preset or custom)
3. Draw/import design
4. Save (auto-saves every 30 seconds)

### Tracking Inventory
1. Go to Inventory page
2. Add thread stock by DMC number
3. Colors in stock show green dot in color picker

### Making Kits
1. Assemble kits by hand, then bump "Kits Ready" on the Kits or Inventory page
2. Subtract the thread you used from the Inventory page (thread is manual —
   nothing auto-deducts it)

### Batch Operations
1. Click "Select" to enter selection mode
2. Check multiple designs
3. Use toolbar to move/tag/delete in bulk

---

## SYNC WITH PUBLIC APP

This project shares core libraries with the **public SaaS app** at:
`/Users/andrewimrie/Documents/modern-mesh`

### Files That MUST Be Kept In Sync

When modifying these files, **update both projects**:

| File | Purpose |
|------|---------|
| `src/lib/store.ts` | Zustand editor state - layers, tools, history |
| `src/lib/color-utils.ts` | Image processing, color quantization, grid operations |
| `src/lib/dmc-pearl-cotton.ts` | DMC color database (480 colors) — **imports `./dmc-measured`** |
| `src/lib/dmc-measured.ts` | Measured skein readings that override the literal hexes |
| `src/lib/yarn-calculator.ts` | Yarn usage calculations with tiered buffer |
| `src/lib/shapes.ts` | Heart, star, circle shape rendering |
| `src/lib/text-renderer.ts` | Text to pixel conversion |
| `src/lib/symbols.ts` | Symbols for stitch charts |
| `src/lib/stitch-preview.ts` | Canvas & completed stitch preview rendering |
| `src/components/editor/DesignPreview.tsx` | Preview modal with canvas/completed tabs |
| `src/components/editor/PixelCanvas.tsx` | Canvas drawing with touch gesture detection |

`dmc-pearl-cotton.ts` and `dmc-measured.ts` are **one unit**: the palette does
`import { MEASURED } from "./dmc-measured"`, so copying the palette alone breaks
the public app at module resolution — on the file every editor screen imports,
which means the whole app, not one feature. Copy both, always.

The rest of the palette-accuracy work is deliberately **internal-only and NOT
synced**: `src/lib/dmc-provenance.ts`, `src/lib/dmc-palette-checks.ts`, its test,
and `src/app/tools/palette-review/`. They are tooling for deciding what a hex
should be — a question answered once, here, by the people holding the skeins —
and nothing in the shared palette imports them, so the public app builds without
them. Do not copy them over "for symmetry".

### Files Unique to This Project (Internal App)

- `src/lib/session.ts` - iron-session auth (simpler than Supabase)
- `src/lib/shopping-list-export.ts` - Shopping list export
- `src/app/api/inventory/` - Inventory management
  - `route.ts` - CRUD for inventory items
  - `alerts/route.ts` - Stock alerts (coverage vs on-hand stock, which is manual)
  - `bobbin-analysis/route.ts` - Bobbin pre-make analysis
- `src/app/api/folders/` - Folder management
- `src/app/api/tags/` - Tag management
- `src/app/inventory/` - Inventory page (threads, kits, alerts, bobbins tabs)
- `src/app/kits/` - Kits overview page

### Features Only in Public App (NOT here)

These features exist in the public app but NOT in this internal app:

- Supabase authentication (we use iron-session)
- Stripe payments/subscriptions
- AI design generation (OpenAI)
- Multi-user support (userId)
- Watermarks on exports
- Color palette suggestions
- Subscription feature gating

### Differences From Public App

| Aspect | Internal App | Public App |
|--------|-------------|-----------|
| Auth | iron-session | Supabase + Google OAuth |
| Multi-user | No | Yes |
| Payments | None | Stripe subscriptions |
| Folders/Tags | Yes | No |
| Inventory | Yes (manual thread stock) | No |
| Kit tracking | Yes (kits ready / canvases) | No |
| AI Features | No | Yes (Creator plan) |
| Watermarks | No | Yes (free tier) |

---

## Development Notes

### Adding Features to Both Apps

If adding a feature that should be in both apps:
1. Implement in whichever app you're working in
2. Copy the shared lib files to the other app
3. Adapt any UI components as needed (different auth, different features)

### Inventory Integration

The color picker shows stock status:
- Green dot = in stock
- Dimmed = not in stock
- This helps when designing to prefer colors you have

### Kit Calculations

Kit requirements are calculated from the design:
1. Count stitches per color
2. Calculate yards needed (yarn-calculator.ts)
3. Add buffer percentage (tiered - see below)
4. Round up to whole skeins

### Yarn Calculator - Tiered Buffer System

The buffer percentage scales down for larger yarn amounts to prevent unnecessary skein purchases:

```typescript
// Small amounts (<10 yards): Full buffer (e.g., 30%)
// Medium amounts (10-27 yards): 60% of buffer (e.g., 18%)
// Large amounts (>27 yards): 40% of buffer (e.g., 12%)
```

This prevents scenarios like: 50 yards + 30% buffer = 65 yards = 3 skeins (when 2 should suffice)

### Touch Gesture Detection

The PixelCanvas uses a delayed commit system to distinguish scroll/zoom from drawing:

```typescript
// Thresholds
SCROLL_THRESHOLD = 12px    // Movement beyond this = scroll
SCROLL_TIME_THRESHOLD = 150ms  // Time before commit = likely scroll

// On touch start: queue the draw action
// On touch move: if movement > threshold, cancel draw
// On touch end: if time < threshold AND no scroll detected, commit draw
```

This prevents accidental color placement when scrolling or zooming on touch devices.

### Session Auth

Simple password auth:
```typescript
// Login sets session
await session.save()

// Protected routes check session
if (!session.isLoggedIn) redirect('/login')
```

### Soft Delete (Trash)

Designs aren't permanently deleted immediately:
1. Delete sets `deletedAt` timestamp
2. Design moves to "Trash" view
3. Cron job permanently deletes after 30 days
4. Can restore from trash
