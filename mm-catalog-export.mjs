#!/usr/bin/env node
/**
 * Modern Mesh Co. — full product catalog export (READ ONLY).
 *
 * Pulls ALL products (ACTIVE, DRAFT, ARCHIVED) from the Shopify Admin GraphQL
 * API, paginating until complete, and writes one row PER VARIANT to
 * ./mm-catalog.csv. Only runs queries — never mutates anything.
 *
 * Requires two env vars (a private app / custom app Admin API access token
 * with read_products, and ideally read_inventory for unit cost):
 *
 *   SHOPIFY_STORE_DOMAIN   e.g. modern-mesh.myshopify.com
 *   SHOPIFY_ADMIN_TOKEN    shpat_xxx...
 *
 * Optional:
 *   SHOPIFY_API_VERSION    defaults to a recent stable version below — set this
 *                          to the CURRENT stable version (Shopify ships one each
 *                          Jan/Apr/Jul/Oct, e.g. "2026-07").
 *
 * Run:  SHOPIFY_STORE_DOMAIN=... SHOPIFY_ADMIN_TOKEN=... node mm-catalog-export.mjs
 */

import { writeFileSync } from "node:fs";

const DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-01"; // bump to current stable

if (!DOMAIN || !TOKEN) {
  console.error("Missing SHOPIFY_STORE_DOMAIN and/or SHOPIFY_ADMIN_TOKEN env vars.");
  process.exit(1);
}

const ENDPOINT = `https://${DOMAIN}/admin/api/${API_VERSION}/graphql.json`;
const notes = [];
let unitCostAvailable = true; // flipped off if the read_inventory scope is missing

async function gql(query, variables) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN },
      body: JSON.stringify({ query, variables }),
    });
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}: ${await res.text()}`);
    const json = await res.json();
    // Throttled?
    if (json.errors && json.errors.some((e) => (e.extensions?.code || "") === "THROTTLED")) {
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      continue;
    }
    return json;
  }
  throw new Error("Exceeded retry attempts (throttled).");
}

const PRODUCT_FIELDS = (withCost) => `
  id
  title
  handle
  status
  productType
  vendor
  tags
  publishedAt
  collections(first: 30) { nodes { title } }
  variants(first: 100) {
    nodes {
      title
      selectedOptions { name value }
      sku
      price
      compareAtPrice
      inventoryQuantity
      ${withCost ? "inventoryItem { unitCost { amount } }" : ""}
    }
    pageInfo { hasNextPage }
  }
`;

const productsQuery = (withCost) => `
  query Products($cursor: String) {
    products(first: 50, after: $cursor, query: "status:active OR status:draft OR status:archived") {
      nodes { ${PRODUCT_FIELDS(withCost)} }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

function looksLikeAccessError(errors) {
  return (errors || []).some((e) => {
    const m = `${e.message || ""} ${e.extensions?.code || ""}`.toLowerCase();
    return m.includes("access") || m.includes("scope") || m.includes("unitcost") || m.includes("inventoryitem") || m.includes("read_inventory");
  });
}

async function fetchAllProducts() {
  const all = [];
  let cursor = null;
  let withCost = true;

  while (true) {
    let json = await gql(productsQuery(withCost), { cursor });

    // If unit cost is blocked by a missing scope, drop it and retry this page.
    if (json.errors && withCost && looksLikeAccessError(json.errors)) {
      unitCostAvailable = false;
      notes.push("unit_cost: unavailable (read_inventory scope missing or inventoryItem.unitCost not accessible) — left blank.");
      withCost = false;
      json = await gql(productsQuery(withCost), { cursor });
    }
    if (json.errors && json.errors.length) {
      throw new Error("GraphQL errors: " + JSON.stringify(json.errors, null, 2));
    }

    const conn = json.data.products;
    all.push(...conn.nodes);
    if (!conn.pageInfo.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;
    await new Promise((r) => setTimeout(r, 300)); // gentle on rate limit
  }
  return all;
}

// ---- CSV helpers ----
const COLUMNS = [
  "product_title", "handle", "status", "product_type", "collections", "tags",
  "variant_title", "option_name", "option_value", "sku", "price",
  "compare_at_price", "unit_cost", "inventory_qty",
];

function csvField(value) {
  const s = value == null ? "" : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toRow(product, variant) {
  const collections = (product.collections?.nodes || []).map((c) => c.title).join("|");
  const tags = (product.tags || []).join("|");
  const opts = variant.selectedOptions || [];
  let optionName = "";
  let optionValue = "";
  if (opts.length === 1) {
    optionName = opts[0].name;
    optionValue = opts[0].value;
  } else if (opts.length > 1) {
    optionName = "MULTI";
    optionValue = opts.map((o) => `${o.name}=${o.value}`).join("|");
  }
  const unitCost = unitCostAvailable ? (variant.inventoryItem?.unitCost?.amount ?? "") : "";
  return [
    product.title, product.handle, product.status, product.productType || "",
    collections, tags, variant.title, optionName, optionValue,
    variant.sku || "", variant.price ?? "", variant.compareAtPrice ?? "",
    unitCost, variant.inventoryQuantity ?? "",
  ];
}

async function main() {
  console.error(`Fetching catalog from ${DOMAIN} (Admin API ${API_VERSION})…`);
  const products = await fetchAllProducts();

  const rows = [];
  const statusCounts = {};
  const optionValues = new Map(); // name -> Set(values)
  let variantCount = 0;

  for (const p of products) {
    statusCounts[p.status] = (statusCounts[p.status] || 0) + 1;
    if (p.variants?.pageInfo?.hasNextPage) {
      notes.push(`product "${p.title}" has >100 variants — only the first 100 were exported.`);
    }
    for (const v of p.variants?.nodes || []) {
      variantCount++;
      for (const o of v.selectedOptions || []) {
        if (!optionValues.has(o.name)) optionValues.set(o.name, new Set());
        optionValues.get(o.name).add(o.value);
      }
      rows.push(toRow(p, v));
    }
  }

  const csv = [COLUMNS.join(","), ...rows.map((r) => r.map(csvField).join(","))].join("\n");
  writeFileSync("./mm-catalog.csv", csv + "\n", "utf8");

  // ---- Report to stdout ----
  console.log("\n===== SUMMARY =====");
  console.log(`Total products: ${products.length}`);
  console.log(`Total variants: ${variantCount}`);
  console.log("\nProducts by status:");
  for (const [s, n] of Object.entries(statusCounts).sort()) console.log(`  ${s}: ${n}`);

  console.log("\nDistinct option names and their values (how canvas-only vs kit are labeled):");
  for (const [name, vals] of [...optionValues.entries()].sort()) {
    console.log(`  ${name}: ${[...vals].sort().join(", ")}`);
  }

  if (notes.length) {
    console.log("\nUnavailable / caveats:");
    for (const n of [...new Set(notes)]) console.log(`  - ${n}`);
  } else {
    console.log("\nUnavailable / caveats: none — all requested fields returned.");
  }

  console.log("\n===== ./mm-catalog.csv =====");
  console.log(csv);
}

main().catch((e) => {
  console.error("\nExport failed:", e.message);
  process.exit(1);
});
