/**
 * TEMPORARY — bulk kit reprice against Shopify.
 *
 * Bands on supplier COGS:  < $4.50 -> $16 ;  $4.50-$8.00 -> $20 ;  > $8.00 -> $25
 *
 * NO dead-zone lift. That adjustment existed only to clear a $75 free-shipping
 * threshold; the threshold is moving to $90, so a band price landing at $77 now
 * nets $77 and the lift would be a straight price rise on the customer rather
 * than free money. Bands only.
 *
 * Dry run by default. --write applies.
 * Refuses to lower any price; such designs are listed and skipped.
 */

const DOMAIN = process.env.SHOPIFY_STORE_DOMAIN!;
const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN!;
const API = "2026-01";
const SHEET =
  "/private/tmp/claude-501/-Users-andrewimrie-Documents-modern-mesh-image-creator/45d61426-393e-4c1a-b901-70876437806f/scratchpad/kitmix/sheet.json";

function band(cogs: number): number {
  if (cogs < 4.5) return 16;
  if (cogs <= 8) return 20;
  return 25;
}

async function gql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(`https://${DOMAIN}/admin/api/${API}/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN },
      body: JSON.stringify({ query, variables }),
    });
    if (r.status === 429 && attempt < 5) {
      await new Promise((res) => setTimeout(res, Number(r.headers.get("retry-after") ?? "2") * 1000));
      continue;
    }
    if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
    const j: any = await r.json();
    if (j.errors?.length) throw new Error(j.errors.map((e: any) => e.message).join(", "));
    const left = j.extensions?.cost?.throttleStatus?.currentlyAvailable ?? 1000;
    if (left < 300) await new Promise((res) => setTimeout(res, 1200));
    return j.data as T;
  }
}

const LIST = `query($cursor: String) {
  products(first: 50, after: $cursor, query: "status:active") {
    pageInfo { hasNextPage endCursor }
    nodes {
      id title status
      options { id name position optionValues { id name } }
      variants(first: 25) { nodes { id title price } }
    }
  }
}`;

const OPTION_UPDATE = `mutation($productId: ID!, $option: OptionUpdateInput!) {
  productOptionUpdate(productId: $productId, option: $option) {
    product { id } userErrors { field message }
  }
}`;

const VARIANTS_UPDATE = `mutation($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
  productVariantsBulkUpdate(productId: $productId, variants: $variants) {
    productVariants { id title price } userErrors { field message }
  }
}`;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

interface Plan {
  productId: string;
  title: string;
  optionId: string;
  oldOptionName: string;
  newOptionName: string;
  variantId: string;
  base: number;
  oldUp: number;
  newUp: number;
  newPrice: string;
  cogs: number;
  margin: number;
}

async function main() {
  const write = process.argv.includes("--write");
  const fs = await import("node:fs");
  const sheet = JSON.parse(fs.readFileSync(SHEET, "utf8")).prices as Record<
    string,
    { buy: number; kits: number }
  >;
  const cogsBy = new Map<string, number>();
  for (const [k, v] of Object.entries(sheet)) cogsBy.set(norm(k), v.buy);

  // --- fetch every active product ---
  const products: any[] = [];
  let cursor: string | null = null;
  do {
    const d: any = await gql<any>(LIST, { cursor });
    products.push(...d.products.nodes);
    cursor = d.products.pageInfo.hasNextPage ? d.products.pageInfo.endCursor : null;
  } while (cursor);
  console.log(`active products on Shopify: ${products.length}`);

  const plans: Plan[] = [];
  const noKitOption: string[] = [];
  const noCogs: string[] = [];
  const unchanged: string[] = [];
  const wouldLower: string[] = [];
  const odd: string[] = [];

  for (const p of products) {
    const hits = p.options
      .map((o: any) => ({ o, m: /\+\s*\$\s*([0-9]+(?:\.[0-9]{2})?)/.exec(o.name) }))
      .filter((x: any) => x.m);
    if (hits.length === 0) {
      noKitOption.push(p.title);
      continue;
    }
    if (hits.length > 1) {
      odd.push(`${p.title}: ${hits.length} options name a $ upcharge`);
      continue;
    }
    const kitOption = hits[0].o;
    const oldUp = Number(hits[0].m[1]);

    const cogs = cogsBy.get(norm(p.title));
    if (cogs === undefined) {
      noCogs.push(p.title);
      continue;
    }

    const prices = p.variants.nodes.map((v: any) => Number(v.price));
    const base = Math.min(...prices);
    const yes = p.variants.nodes.filter(
      (v: any) => Math.abs(Number(v.price) - (base + oldUp)) < 0.005,
    );
    if (yes.length !== 1) {
      odd.push(
        `${p.title}: expected 1 variant at base ${base} + ${oldUp}, found ${yes.length} (${p.variants.nodes.map((v: any) => v.title + "=" + v.price).join(", ")})`,
      );
      continue;
    }

    const newUp = band(cogs);
    if (newUp === oldUp) {
      unchanged.push(`${p.title} (stays +$${oldUp}, COGS $${cogs.toFixed(2)})`);
      continue;
    }
    if (newUp < oldUp) {
      wouldLower.push(`${p.title}: +$${oldUp} -> +$${newUp} (COGS $${cogs.toFixed(2)})`);
      continue;
    }

    plans.push({
      productId: p.id,
      title: p.title,
      optionId: kitOption.id,
      oldOptionName: kitOption.name,
      newOptionName: kitOption.name.replace(hits[0].m[0], `+$${newUp}`),
      variantId: yes[0].id,
      base,
      oldUp,
      newUp,
      newPrice: (base + newUp).toFixed(2),
      cogs,
      margin: (newUp - cogs) / newUp,
    });
  }

  plans.sort((a, b) => a.title.localeCompare(b.title));
  console.log(`\n=== PLAN: ${plans.length} products change ===`);
  console.log(
    "design".padEnd(34) + "COGS".padStart(7) + "kit now".padStart(9) + "kit new".padStart(9) + "total".padStart(9) + "margin".padStart(8),
  );
  for (const p of plans) {
    console.log(
      p.title.slice(0, 33).padEnd(34) +
        ("$" + p.cogs.toFixed(2)).padStart(7) +
        ("+$" + p.oldUp).padStart(9) +
        ("+$" + p.newUp).padStart(9) +
        ("$" + p.newPrice).padStart(9) +
        ((p.margin * 100).toFixed(0) + "%").padStart(8),
    );
  }

  const show = (label: string, arr: string[]) => {
    if (!arr.length) return;
    console.log(`\n--- ${label} (${arr.length}) ---`);
    for (const s of arr) console.log("  " + s);
  };
  show("NO CHANGE — already at band price", unchanged);
  show("SKIPPED — band is LOWER than today, needs a decision", wouldLower);
  show("SKIPPED — product shape unexpected", odd);
  show("no supplier quote (not in the PO)", noCogs);
  console.log(`\nactive products with no kit option at all: ${noKitOption.length}`);

  const worst = plans.reduce((a, b) => (a.margin < b.margin ? a : b), plans[0]);
  console.log(
    `\nworst margin: ${worst.title} ${(worst.margin * 100).toFixed(0)}% (+$${worst.newUp} vs $${worst.cogs.toFixed(2)} COGS)`,
  );

  if (!write) {
    console.log("\nDRY RUN — nothing changed. Re-run with --write to apply.");
    fs.writeFileSync(SHEET.replace("sheet.json", "reprice-plan.json"), JSON.stringify(plans, null, 2));
    return;
  }

  console.log("\napplying...");
  let done = 0;
  for (const p of plans) {
    const r1 = await gql<any>(OPTION_UPDATE, {
      productId: p.productId,
      option: { id: p.optionId, name: p.newOptionName },
    });
    if (r1.productOptionUpdate.userErrors.length) {
      console.error(`  FAIL option ${p.title}:`, JSON.stringify(r1.productOptionUpdate.userErrors));
      continue;
    }
    const r2 = await gql<any>(VARIANTS_UPDATE, {
      productId: p.productId,
      variants: [{ id: p.variantId, price: p.newPrice }],
    });
    if (r2.productVariantsBulkUpdate.userErrors.length) {
      console.error(`  FAIL price ${p.title}:`, JSON.stringify(r2.productVariantsBulkUpdate.userErrors));
      continue;
    }
    done++;
    console.log(`  ok  ${p.title}  +$${p.oldUp} -> +$${p.newUp}  ($${p.newPrice})`);
  }
  console.log(`\n${done} of ${plans.length} applied.`);
}

main().catch((e) => {
  console.error("ERR:", e.message);
  process.exit(1);
});
