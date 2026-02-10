# Automatic Shopify Order Fulfillment Sync

## Goal
When an order is fulfilled on Shopify, automatically decrement `kitsReady` and `canvasPrinted` from our inventory.

---

## Options

### Option A: Shopify Webhooks (Recommended)
**Real-time sync when orders are fulfilled**

**How it works:**
1. Shopify sends a POST request to our app when an order is fulfilled
2. Our app receives the webhook, verifies it, and processes the order
3. Inventory is updated immediately

**Pros:**
- Real-time updates (within seconds)
- No polling/cron overhead
- Shopify handles retry logic if our endpoint is down

**Cons:**
- Requires webhook endpoint to be publicly accessible
- Need to handle webhook signature verification for security
- Need to register webhook with Shopify

---

### Option B: Vercel Cron Job
**Periodic sync every X minutes**

**How it works:**
1. Vercel runs a cron job every 5-15 minutes
2. Cron job calls our existing sync API
3. Sync API checks for newly fulfilled orders and processes them

**Pros:**
- Simple to implement (just add vercel.json cron config)
- Uses existing sync logic
- No webhook setup needed

**Cons:**
- Not real-time (5-15 minute delay)
- Uses Vercel function invocations (minor cost)

---

## Recommended: Option A - Webhooks

### Implementation Steps

#### 1. Create Webhook Endpoint
Create `/api/webhooks/shopify/order-fulfilled/route.ts`

```typescript
// Receives POST from Shopify when order is fulfilled
// Verifies HMAC signature
// Processes order and decrements inventory
```

#### 2. Verify Webhook Signature
Shopify signs webhooks with HMAC-SHA256. We need to verify to prevent spoofing.

```typescript
import crypto from 'crypto';

function verifyShopifyWebhook(body: string, hmacHeader: string): boolean {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET!;
  const hash = crypto
    .createHmac('sha256', secret)
    .update(body, 'utf8')
    .digest('base64');
  return hash === hmacHeader;
}
```

#### 3. Register Webhook with Shopify
Two options:
- **Manual**: Go to Shopify Admin → Settings → Notifications → Webhooks
- **Programmatic**: Use Shopify Admin API to register

Webhook event: `orders/fulfilled`
URL: `https://your-domain.vercel.app/api/webhooks/shopify/order-fulfilled`

#### 4. Process the Order
Reuse existing logic from sync API:
- Match product titles to designs
- Check if variant includes kit
- Decrement `kitsReady` and/or `canvasPrinted`
- Mark order as processed to avoid duplicates

#### 5. Environment Variables
Add to Vercel:
```
SHOPIFY_WEBHOOK_SECRET=your_webhook_signing_secret
```

---

## Alternative: Option B - Cron Job

### Implementation Steps

#### 1. Add Vercel Cron Config
Create/update `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/cron/sync-shopify",
      "schedule": "*/10 * * * *"
    }
  ]
}
```

#### 2. Create Cron Endpoint
Create `/api/cron/sync-shopify/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  // Verify cron secret (Vercel adds this header)
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Call existing sync logic
  // ... reuse code from /api/shopify/sync

  return NextResponse.json({ success: true });
}
```

#### 3. Environment Variables
Add to Vercel:
```
CRON_SECRET=your_random_secret
```

---

## Files to Create/Modify

| File | Purpose |
|------|---------|
| `/api/webhooks/shopify/order-fulfilled/route.ts` | Webhook endpoint (Option A) |
| `/api/cron/sync-shopify/route.ts` | Cron endpoint (Option B) |
| `/lib/shopify-sync.ts` | Shared sync logic (extract from current sync route) |
| `vercel.json` | Cron configuration (Option B) |

---

## Security Considerations

1. **Webhook signature verification** - Always verify Shopify's HMAC signature
2. **Idempotency** - Track processed orders to avoid double-processing
3. **Rate limiting** - Handle burst of webhooks gracefully
4. **Error handling** - Log failures, don't lose data

---

## Recommendation

**Start with Option A (Webhooks)** for real-time sync. It's more work upfront but provides the best user experience.

If you want something quick, **Option B (Cron)** can be set up in 10 minutes using existing code, with the trade-off of a 5-15 minute delay.

---

## Questions to Decide

1. **Which option do you prefer?** Webhooks (real-time) or Cron (simpler)?
2. **How critical is real-time?** Can you wait 5-10 minutes for sync?
3. **Do you have access to Shopify webhook settings?** (Admin → Settings → Notifications)
