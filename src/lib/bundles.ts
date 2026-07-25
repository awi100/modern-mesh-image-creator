// Bundle expansion: a bundle product (one Shopify line item, e.g. "Essentials
// Bundle") maps to several component supplies. Fixed components deduct a
// specific supply; a customer-choice component is resolved per order from the
// bundle line item's VARIANT (same place the kit yes/no lives).

export interface BundleComponentData {
  quantity: number;
  supplyId: string | null; // set for fixed components
  supplyName: string | null;
  chooseFrom: string | null; // set for customer-choice components (a Supply-name filter, e.g. "Needle Minder")
}

export interface BundleData {
  id: string;
  title: string;
  components: BundleComponentData[];
}

export interface SupplyLite {
  id: string;
  name: string;
}

export interface ExpandedComponent {
  supplyId: string;
  supplyName: string;
  quantity: number;
}

export interface BundleExpansion {
  components: ExpandedComponent[];
  // Choice slots we couldn't resolve from the variant (surface so nothing is
  // silently missed).
  unresolved: { chooseFrom: string; variantTitle: string | null }[];
}

const norm = (s: string) => s.toLowerCase().trim();

// Map active bundles by normalized title for line-item matching.
export function buildBundleMap(bundles: BundleData[]): Map<string, BundleData> {
  const map = new Map<string, BundleData>();
  for (const b of bundles) map.set(norm(b.title), b);
  return map;
}

// Resolve a customer-choice component (e.g. "Needle Minder") to a specific
// supply using the bundle line item's variant. Handles variant forms like
// "Pearl Shell", "Pearl Shell Needle Minder", or "8x8 / Pearl Shell".
function resolveChoice(
  chooseFrom: string,
  variantTitle: string | null,
  supplies: SupplyLite[]
): SupplyLite | null {
  const variantNorm = norm(variantTitle || "");
  if (!variantNorm) return null;
  const filter = norm(chooseFrom);
  const tokens = variantNorm.split("/").map((t) => t.trim()).filter(Boolean);
  const candidates = supplies.filter((s) => norm(s.name).includes(filter));

  for (const s of candidates) {
    const nameNorm = norm(s.name);
    const core = nameNorm.replace(filter, "").trim(); // e.g. "pearl shell needle minder" -> "pearl shell"
    if (
      variantNorm.includes(nameNorm) ||
      (core && variantNorm.includes(core)) ||
      tokens.some((t) => t === nameNorm || t === core || (core.length > 2 && (t.includes(core) || core.includes(t))))
    ) {
      return s;
    }
  }
  return null;
}

// Expand one bundle line item into its component supply deductions (per single
// bundle unit — multiply by the line quantity at the call site).
export function expandBundle(
  bundle: BundleData,
  variantTitle: string | null,
  supplies: SupplyLite[]
): BundleExpansion {
  const components: ExpandedComponent[] = [];
  const unresolved: { chooseFrom: string; variantTitle: string | null }[] = [];

  for (const c of bundle.components) {
    if (c.chooseFrom) {
      const match = resolveChoice(c.chooseFrom, variantTitle, supplies);
      if (match) components.push({ supplyId: match.id, supplyName: match.name, quantity: c.quantity });
      else unresolved.push({ chooseFrom: c.chooseFrom, variantTitle });
      continue;
    }
    if (c.supplyId) {
      const s = supplies.find((x) => x.id === c.supplyId);
      components.push({ supplyId: c.supplyId, supplyName: s?.name ?? c.supplyName ?? "Unknown", quantity: c.quantity });
    }
  }

  return { components, unresolved };
}
