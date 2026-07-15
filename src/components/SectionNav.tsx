"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Top-level sections. Rendered as a horizontally-scrollable row inside each
// section page's sticky header so you can jump between areas (Orders ↔
// Inventory ↔ Kits ↔ …) without returning to the home page first.
const SECTIONS = [
  { href: "/", label: "Home" },
  { href: "/orders", label: "Orders" },
  { href: "/inventory", label: "Inventory" },
  { href: "/kits", label: "Kits" },
  { href: "/analytics", label: "Analytics" },
  { href: "/finishing", label: "Finishing" },
];

export default function SectionNav() {
  const pathname = usePathname();
  return (
    <nav className="flex items-center gap-1 overflow-x-auto">
      {SECTIONS.map((s) => {
        const active =
          s.href === "/" ? pathname === "/" : pathname === s.href || pathname.startsWith(s.href + "/");
        return (
          <Link
            key={s.href}
            href={s.href}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors flex-shrink-0 ${
              active
                ? "bg-rose-900 text-white"
                : "text-slate-300 hover:bg-slate-700 hover:text-white"
            }`}
          >
            {s.label}
          </Link>
        );
      })}
    </nav>
  );
}
