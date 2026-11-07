"use client";

import Link from "next/link";
import { Suspense } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * The app's one and only list of top-level sections.
 *
 * It used to be three lists: this component, plus a hardcoded row in the home
 * page header, plus a second hardcoded list in the home page's mobile menu.
 * Adding Events to this one left the other two behind, which is how a section
 * can exist and still be invisible from the page you start on.
 *
 * Kept to the things used weekly. Occasional workflows live on /tools, which is
 * why Finishing is not here — two records, both from April — while Tools and
 * Market, which are used constantly, are.
 *
 * Styled for light and dark: the home page supports both, and everything else
 * is dark-only, so the `dark:` variants have to be present either way.
 */
export const SECTION_LINKS = [
  { href: "/", label: "Home" },
  { href: "/orders", label: "Orders" },
  { href: "/events", label: "Events" },
  { href: "/inventory", label: "Inventory" },
  { href: "/kits", label: "Kits" },
  { href: "/inventory?tab=market&view=pack", label: "Market" },
  { href: "/tools", label: "Tools" },
  { href: "/analytics", label: "Analytics" },
];

/** Sections whose sub-pages live elsewhere in the tree, so the right tab still
 *  lights up. Without this, /stock-alerts and /velocity highlight nothing and
 *  you cannot tell where you are. */
const ALSO_UNDER: Record<string, string[]> = {
  "/tools": ["/stock-alerts", "/velocity", "/finishing", "/inventory/reorder",
             "/inventory/andover-pickup", "/inventory/deductions", "/inventory/unmatched",
             "/inventory/bundles", "/inventory/pricing", "/shopify", "/help"],
};

function SectionNavInner() {
  const pathname = usePathname();
  const search = useSearchParams();
  // Market and Inventory are the same route with a different tab, so the query
  // string is what tells them apart. Without this, pressing Market lights up
  // Inventory and you cannot tell which view you are in.
  const onMarketTab = pathname === "/inventory" && search.get("tab") === "market";

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    if (href.startsWith("/inventory?")) return onMarketTab;
    if (href === "/inventory") return pathname.startsWith("/inventory") && !onMarketTab
      && !(ALSO_UNDER["/tools"] ?? []).some((p) => pathname === p || pathname.startsWith(p + "/"));
    if (pathname === href || pathname.startsWith(href + "/")) return true;
    return (ALSO_UNDER[href] ?? []).some((p) => pathname === p || pathname.startsWith(p + "/"));
  };

  return (
    <nav className="flex items-center gap-1 overflow-x-auto" aria-label="Sections">
      {SECTION_LINKS.map((s) => {
        const active = isActive(s.href);
        return (
          <Link
            key={s.href}
            href={s.href}
            aria-current={active ? "page" : undefined}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors flex-shrink-0 ${
              active
                ? "bg-rose-900 text-white"
                : "text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white"
            }`}
          >
            {s.label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Wrapped in Suspense because reading the query string (to tell the Market tab
 * from the rest of Inventory) otherwise forces every page that renders this —
 * which is now all of them — out of static rendering and fails the build.
 *
 * The fallback draws the same row with nothing highlighted, so there is no
 * layout shift and no flash of a missing nav.
 */
export default function SectionNav() {
  return (
    <Suspense fallback={<SectionNavSkeleton />}>
      <SectionNavInner />
    </Suspense>
  );
}

function SectionNavSkeleton() {
  return (
    <nav className="flex items-center gap-1 overflow-x-auto" aria-label="Sections">
      {SECTION_LINKS.map((s) => (
        <Link
          key={s.href}
          href={s.href}
          className="px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap flex-shrink-0 text-slate-600 dark:text-slate-300"
        >
          {s.label}
        </Link>
      ))}
    </nav>
  );
}
