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
  } | null;
}

export interface ShopifyOrderNode {
  id: string;
  name: string; // Order number like "#1001"
  createdAt: string;
  displayFulfillmentStatus: string;
  // Note: customer field requires read_customers scope
  billingAddress: {
    name: string | null;
  } | null;
  lineItems: {
    nodes: ShopifyLineItem[];
  };
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

// Fetch unfulfilled orders from Shopify
export async function fetchUnfulfilledOrders(cursor?: string): Promise<OrdersQueryResult> {
  const query = `
    query GetUnfulfilledOrders($cursor: String) {
      orders(
        first: 50
        after: $cursor
        query: "fulfillment_status:unfulfilled"
        sortKey: CREATED_AT
        reverse: true
      ) {
        nodes {
          id
          name
          createdAt
          displayFulfillmentStatus
          billingAddress {
            name
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

  return shopifyGraphQL<OrdersQueryResult>(query, { cursor });
}

// Fetch recently fulfilled orders (to sync fulfillment status)
export async function fetchRecentlyFulfilledOrders(sinceDate?: Date): Promise<OrdersQueryResult> {
  const dateFilter = sinceDate
    ? `updated_at:>='${sinceDate.toISOString().split('T')[0]}'`
    : "";

  const query = `
    query GetFulfilledOrders($cursor: String) {
      orders(
        first: 50
        after: $cursor
        query: "fulfillment_status:fulfilled ${dateFilter}"
        sortKey: UPDATED_AT
        reverse: true
      ) {
        nodes {
          id
          name
          createdAt
          displayFulfillmentStatus
          billingAddress {
            name
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

  return shopifyGraphQL<OrdersQueryResult>(query, { cursor: undefined });
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
