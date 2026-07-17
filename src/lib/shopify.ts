// Shopify Admin API client

const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const SHOPIFY_ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;

if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_ADMIN_TOKEN) {
  console.warn("Shopify credentials not configured");
}

interface ShopifyResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

export async function shopifyGraphQL<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_ADMIN_TOKEN) {
    throw new Error("Shopify credentials not configured");
  }

  const response = await fetch(
    `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-01/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN,
      },
      body: JSON.stringify({ query, variables }),
    }
  );

  if (!response.ok) {
    throw new Error(`Shopify API error: ${response.status} ${response.statusText}`);
  }

  const json: ShopifyResponse<T> = await response.json();

  if (json.errors && json.errors.length > 0) {
    throw new Error(`Shopify GraphQL error: ${json.errors.map(e => e.message).join(", ")}`);
  }

  return json.data as T;
}

// Types for Shopify orders
export interface ShopifyLineItem {
  id: string;
  title: string;
  variantTitle: string | null;
  quantity: number;
  product: {
    id: string;
    title: string;
    productType: string;
  } | null;
  // Line-item custom attributes set by the customer at checkout (e.g. a
  // "Special instructions" field on the product page). Keys starting with
  // "_" are Shopify-internal/hidden and should not be displayed to staff.
  customAttributes: { key: string; value: string | null }[];
}

export interface ShopifyOrderNode {
  id: string;
  name: string; // Order number like "#1001"
  createdAt: string;
  cancelledAt: string | null;
  // Order origin: "pos" = Shopify Point of Sale (in-person/craft market),
  // "web"/"shopify_draft_order"/etc. = online. Used to route inventory
  // deduction to the market tote (POS) vs main/online stock.
  sourceName: string | null;
  displayFulfillmentStatus: string;
  // PAID, PARTIALLY_REFUNDED, REFUNDED, VOIDED, etc.
  displayFinancialStatus: string | null;
  // Order total after refunds/edits — fully refunded orders show "0.00"
  currentTotalPriceSet: {
    shopMoney: { amount: string } | null;
  } | null;
  // Note: customer field requires read_customers scope
  billingAddress: {
    name: string | null;
    city: string | null;
    province: string | null;
    provinceCode: string | null;
    country: string | null;
    countryCodeV2: string | null;
  } | null;
  // The selected shipping method at checkout, e.g. { title: "Express" } or
  // { title: "Standard" }. May be null on draft/free orders.
  shippingLine: {
    title: string | null;
  } | null;
  lineItems: {
    nodes: ShopifyLineItem[];
  };
  // True when this node was mapped from a Shopify DRAFT order (see
  // fetchOpenDraftOrders). Draft orders are manually created in the Shopify
  // admin and never appear in the normal `orders` connection.
  isDraftOrder?: boolean;
}

// Heuristic: the customer paid for an express/expedited/priority/overnight
// shipping option. Matched case-insensitively against the shipping line title.
export function isExpressShippingTitle(title: string | null | undefined): boolean {
  if (!title) return false;
  const t = title.toLowerCase();
  return (
    t.includes("express") ||
    t.includes("expedited") ||
    t.includes("priority") ||
    t.includes("overnight") ||
    t.includes("rush") ||
    t.includes("next day") ||
    t.includes("next-day") ||
    t.includes("1-day")
  );
}

// An order the app should ignore entirely: cancelled, fully refunded/voided,
// or with a $0 current total (e.g. placed then "cancelled" via full refund).
// Partial refunds do NOT exclude an order.
export function isIgnorableOrder(order: ShopifyOrderNode): boolean {
  if (order.cancelledAt) return true;
  const fin = order.displayFinancialStatus?.toUpperCase();
  if (fin === "REFUNDED" || fin === "VOIDED") return true;
  const amount = order.currentTotalPriceSet?.shopMoney?.amount;
  if (amount !== undefined && amount !== null && parseFloat(amount) === 0) return true;
  return false;
}

export interface OrdersQueryResult {
  orders: {
    nodes: ShopifyOrderNode[];
    pageInfo: {
      hasNextPage: boolean;
      endCursor: string | null;
    };
  };
}

// Fetch unfulfilled orders from Shopify (with pagination, capped at 200)
export async function fetchUnfulfilledOrders(): Promise<OrdersQueryResult> {
  const query = `
    query GetUnfulfilledOrders($cursor: String) {
      orders(
        first: 50
        after: $cursor
        query: "fulfillment_status:unfulfilled AND -status:cancelled AND -financial_status:refunded AND -financial_status:voided"
        sortKey: CREATED_AT
        reverse: true
      ) {
        nodes {
          id
          name
          createdAt
          cancelledAt
          sourceName
          displayFulfillmentStatus
          displayFinancialStatus
          currentTotalPriceSet {
            shopMoney {
              amount
            }
          }
          billingAddress {
            name
            city
            province
            provinceCode
            country
            countryCodeV2
          }
          shippingLine {
            title
          }
          lineItems(first: 50) {
            nodes {
              id
              title
              variantTitle
              quantity
              product {
                id
                title
                productType
              }
              customAttributes {
                key
                value
              }
            }
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  `;

  // Fetch all pages up to 200 orders
  const allOrders: ShopifyOrderNode[] = [];
  let cursor: string | undefined;
  let hasMore = true;

  while (hasMore) {
    const result = await shopifyGraphQL<OrdersQueryResult>(query, { cursor });
    // Belt-and-braces: also drop cancelled/refunded/$0 orders the search
    // filter didn't catch (e.g. $0 totals from a full-discount checkout)
    allOrders.push(...result.orders.nodes.filter((o) => !isIgnorableOrder(o)));
    hasMore = result.orders.pageInfo.hasNextPage;
    cursor = result.orders.pageInfo.endCursor || undefined;

    // Cap at 200 orders
    if (allOrders.length >= 200) {
      console.warn("Reached limit of 200 unfulfilled orders");
      break;
    }
  }

  return {
    orders: {
      nodes: allOrders.slice(0, 200),
      pageInfo: { hasNextPage: false, endCursor: null },
    },
  };
}

// Fetch recently fulfilled orders (to sync fulfillment status)
// Now supports pagination to fetch ALL matching orders
export async function fetchRecentlyFulfilledOrders(sinceDate?: Date): Promise<OrdersQueryResult> {
  const dateFilter = sinceDate
    ? `updated_at:>='${sinceDate.toISOString().split('T')[0]}'`
    : "";

  const query = `
    query GetFulfilledOrders($cursor: String) {
      orders(
        first: 100
        after: $cursor
        query: "fulfillment_status:fulfilled AND -status:cancelled AND -financial_status:refunded AND -financial_status:voided ${dateFilter}"
        sortKey: UPDATED_AT
        reverse: true
      ) {
        nodes {
          id
          name
          createdAt
          cancelledAt
          sourceName
          displayFulfillmentStatus
          displayFinancialStatus
          currentTotalPriceSet {
            shopMoney {
              amount
            }
          }
          billingAddress {
            name
            city
            province
            provinceCode
            country
            countryCodeV2
          }
          shippingLine {
            title
          }
          lineItems(first: 50) {
            nodes {
              id
              title
              variantTitle
              quantity
              product {
                id
                title
                productType
              }
              customAttributes {
                key
                value
              }
            }
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  `;

  // Fetch all pages
  const allOrders: ShopifyOrderNode[] = [];
  let cursor: string | undefined;
  let hasMore = true;

  while (hasMore) {
    const result = await shopifyGraphQL<OrdersQueryResult>(query, { cursor });
    allOrders.push(...result.orders.nodes.filter((o) => !isIgnorableOrder(o)));
    hasMore = result.orders.pageInfo.hasNextPage;
    cursor = result.orders.pageInfo.endCursor || undefined;

    // Safety limit to prevent infinite loops
    if (allOrders.length > 10000) {
      console.warn("Reached safety limit of 10000 orders");
      break;
    }
  }

  return {
    orders: {
      nodes: allOrders,
      pageInfo: { hasNextPage: false, endCursor: null },
    },
  };
}

// Fetch ALL fulfilled orders from entire Shopify history (no date filter)
export async function fetchAllFulfilledOrders(): Promise<OrdersQueryResult> {
  return fetchRecentlyFulfilledOrders(); // No date = all orders
}

// ---- Draft orders ----
// Orders created manually in the Shopify admin start life as DRAFT orders (a
// separate API) and never show up in the `orders` connection until completed.
// We surface open drafts so they can be fulfilled in the app, and expose the
// draft -> resulting-order link so sync can avoid double-deducting once a draft
// is completed into a real order.

interface DraftOrderLineItemNode {
  id: string;
  title: string;
  variantTitle: string | null;
  quantity: number;
  product: { id: string; title: string; productType: string } | null;
  customAttributes: { key: string; value: string | null }[];
}

interface DraftOrderNode {
  id: string;
  name: string;
  createdAt: string;
  status: string; // OPEN | INVOICE_SENT | COMPLETED
  order: { id: string } | null; // set once the draft is completed into an order
  totalPriceSet: { shopMoney: { amount: string } | null } | null;
  billingAddress: ShopifyOrderNode["billingAddress"];
  shippingLine: { title: string | null } | null;
  customer: { displayName: string | null } | null;
  lineItems: { nodes: DraftOrderLineItemNode[] };
}

interface DraftOrdersQueryResult {
  draftOrders: {
    nodes: DraftOrderNode[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

const DRAFT_ORDER_FIELDS = `
  id
  name
  createdAt
  status
  order { id }
  totalPriceSet { shopMoney { amount } }
  billingAddress {
    name
    city
    province
    provinceCode
    country
    countryCodeV2
  }
  shippingLine { title }
  customer { displayName }
  lineItems(first: 50) {
    nodes {
      id
      title
      variantTitle
      quantity
      product { id title productType }
      customAttributes { key value }
    }
  }
`;

// Map a DraftOrder into the common ShopifyOrderNode shape so the orders route
// can process it uniformly. Drafts have no source/fulfillment/financial status;
// they deduct from main (online) stock and are treated as unfulfilled.
function draftToOrderNode(d: DraftOrderNode): ShopifyOrderNode {
  return {
    id: d.id,
    name: d.name,
    createdAt: d.createdAt,
    cancelledAt: null,
    sourceName: null,
    displayFulfillmentStatus: "UNFULFILLED",
    displayFinancialStatus: null,
    currentTotalPriceSet: d.totalPriceSet,
    billingAddress:
      d.billingAddress ??
      (d.customer?.displayName
        ? { name: d.customer.displayName, city: null, province: null, provinceCode: null, country: null, countryCodeV2: null }
        : null),
    shippingLine: d.shippingLine,
    lineItems: {
      nodes: d.lineItems.nodes.map((li) => ({
        id: li.id,
        title: li.title,
        variantTitle: li.variantTitle,
        quantity: li.quantity,
        product: li.product,
        customAttributes: li.customAttributes,
      })),
    },
    isDraftOrder: true,
  };
}

// Open (not-yet-completed) draft orders, mapped as ShopifyOrderNodes.
export async function fetchOpenDraftOrders(): Promise<ShopifyOrderNode[]> {
  const query = `
    query GetOpenDraftOrders($cursor: String) {
      draftOrders(first: 50, after: $cursor, query: "status:open OR status:invoice_sent", sortKey: UPDATED_AT, reverse: true) {
        nodes { ${DRAFT_ORDER_FIELDS} }
        pageInfo { hasNextPage endCursor }
      }
    }
  `;

  const all: ShopifyOrderNode[] = [];
  let cursor: string | undefined;
  let hasMore = true;

  while (hasMore) {
    const result = await shopifyGraphQL<DraftOrdersQueryResult>(query, { cursor });
    for (const node of result.draftOrders.nodes) {
      if (node.status === "COMPLETED") continue; // completed drafts are real orders now
      all.push(draftToOrderNode(node));
    }
    hasMore = result.draftOrders.pageInfo.hasNextPage;
    cursor = result.draftOrders.pageInfo.endCursor || undefined;
    if (all.length >= 200) break;
  }

  return all.slice(0, 200);
}

export interface DraftOrderLink {
  draftId: string;
  orderId: string;
}

// Completed drafts (updated since `sinceDate`) with the real order they became.
// Used by sync to skip re-deducting an order whose draft was already fulfilled.
export async function fetchCompletedDraftLinks(sinceDate: Date): Promise<DraftOrderLink[]> {
  const dateFilter = `updated_at:>='${sinceDate.toISOString().split("T")[0]}'`;
  const query = `
    query GetCompletedDraftOrders($cursor: String) {
      draftOrders(first: 100, after: $cursor, query: "status:completed AND ${dateFilter}", sortKey: UPDATED_AT, reverse: true) {
        nodes { id order { id } }
        pageInfo { hasNextPage endCursor }
      }
    }
  `;

  const links: DraftOrderLink[] = [];
  let cursor: string | undefined;
  let hasMore = true;

  while (hasMore) {
    const result = await shopifyGraphQL<{
      draftOrders: {
        nodes: { id: string; order: { id: string } | null }[];
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      };
    }>(query, { cursor });
    for (const n of result.draftOrders.nodes) {
      if (n.order?.id) links.push({ draftId: n.id, orderId: n.order.id });
    }
    hasMore = result.draftOrders.pageInfo.hasNextPage;
    cursor = result.draftOrders.pageInfo.endCursor || undefined;
    if (links.length >= 2000) break;
  }

  return links;
}

// Whether an order originated from Shopify Point of Sale (in-person / craft
// market). Shopify sets the order's source_name to "pos" for POS sales.
// POS sales deduct from the market tote inventory, not online/main stock.
export function isPosSource(sourceName: string | null | undefined): boolean {
  return (sourceName || "").trim().toLowerCase() === "pos";
}

// Parse variant title to determine if kit is needed
// Variant titles like "8x8 / Yes" or "10x10 / No" or just "Yes" / "No"
export function parseNeedsKit(variantTitle: string | null): boolean {
  if (!variantTitle) return false;

  // Look for "Yes" in the variant title (case insensitive)
  // The kit option is "Add kit +$XX" with values "Yes" or "No"
  const parts = variantTitle.split("/").map(p => p.trim().toLowerCase());
  return parts.some(p => p === "yes");
}

// Match Shopify product title to design name
// Shopify product title should match design name
export function normalizeTitle(title: string): string {
  return title.toLowerCase().trim();
}

// Filter line-item custom attributes to the ones meant to be shown to staff.
// Shopify convention: keys starting with "_" are internal/hidden.
export function visibleCustomAttributes(
  attrs: { key: string; value: string | null }[] | null | undefined
): { key: string; value: string }[] {
  if (!attrs) return [];
  return attrs
    .filter((a) => a.key && !a.key.startsWith("_") && a.value)
    .map((a) => ({ key: a.key, value: a.value as string }));
}
