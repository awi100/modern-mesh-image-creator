"use client";

import { useEffect, useState, useCallback } from "react";
import { LOW_ON_HAND } from "@/lib/stock-targets";
import Link from "next/link";
import SectionNav from "@/components/SectionNav";
import { Breadcrumb } from "@/components/Breadcrumb";

// Everything used occasionally rather than weekly.
//
// This was /inventory/tools, reachable only from inside the Inventory page, and
// it held seven real workflows while Finishing — two records, both from April —
// sat in the top nav. So it moved up a level and Finishing moved in.
//
// /velocity landed here too: nothing in the app linked to it, so the only way
// in was typing the URL. (/supplies and /inventory/restock looked orphaned as
// well, but they are deliberate redirect stubs forwarding to Inventory tabs —
// listing them would be a second route to the same view.)


interface Tool {
  href: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  accent: string;
  /** Which heading it sits under. */
  group: "Ordering & planning" | "Checking & fixing" | "Stock & setup" | "Other";
}

const icon = (d: string) => (
  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={d} />
  </svg>
);

const GROUP_ORDER = ["Ordering & planning", "Checking & fixing", "Stock & setup", "Other"] as const;

const TOOLS: Tool[] = [
  {
    href: "/inventory/reorder",
    group: "Ordering & planning",
    title: "Reorder",
    description: "What canvases to reorder from the supplier, based on how fast each design is selling vs. lead time.",
    icon: icon("M13 10V3L4 14h7v7l9-11h-7z"),
    accent: "text-amber-300",
  },
  {
    href: "/stock-alerts",
    group: "Ordering & planning",
    title: "Stock Alerts",
    description: "Thread stock health and an order builder for the DMC colors you're low on.",
    icon: icon("M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"),
    accent: "text-red-300",
  },
  {
    href: "/inventory/andover-pickup",
    group: "Stock & setup",
    title: "Andover Pickup",
    description: "What canvases and kits to grab from your Andover bulk storage to restock on-hand — with one-tap “picked up”.",
    icon: icon("M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"),
    accent: "text-sky-300",
  },
  {
    href: "/inventory/deductions",
    group: "Checking & fixing",
    title: "Sales Log",
    description: "History of every order deduction — which orders came off which inventory bucket.",
    icon: icon("M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"),
    accent: "text-slate-300",
  },
  {
    href: "/inventory/unmatched",
    group: "Checking & fixing",
    title: "Unmatched Sales",
    description: "Sales that deducted nothing because the Shopify title matched no design or supply — and which of them would still miss today.",
    icon: icon("M12 9v2m0 4h.01M5.07 19H18.93a2 2 0 001.732-3L13.732 4a2 2 0 00-3.464 0L3.34 16a2 2 0 001.731 3z"),
    accent: "text-amber-300",
  },
  {
    href: "/inventory/bundles",
    group: "Stock & setup",
    title: "Bundles",
    description: "Define bundle products (like the Essentials Bundle) so one order deducts all its component supplies.",
    icon: icon("M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"),
    accent: "text-rose-300",
  },
  {
    href: "/inventory/pricing",
    group: "Ordering & planning",
    title: "Pricing",
    description: "Cost-up price recommendations by size tier from each design's real thread cost + your margin target.",
    icon: icon("M9 7h6m0 10v-3m-3 3h.01M9 17h.01M12 17h.01M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3"),
    accent: "text-emerald-300",
  },
  {
    href: "/velocity",
    group: "Ordering & planning",
    title: "Velocity",
    description: "How fast each design is actually selling, which is what the reorder and alert numbers are built on.",
    icon: icon("M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"),
    accent: "text-sky-400",
  },
  {
    href: "/events/mappings",
    group: "Stock & setup",
    title: "Canvas mappings",
    description: "What each sip-and-stitch checkout answer means. New options keep appearing, since Ticket Tailor will not tell us the list.",
    icon: icon("M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"),
    accent: "text-indigo-400",
  },
  {
    href: "/shopify",
    group: "Checking & fixing",
    title: "Shopify sync",
    description: "Reconcile orders Shopify's webhook may have missed, and refresh the product catalog.",
    icon: icon("M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"),
    accent: "text-lime-400",
  },
  {
    href: "/finishing",
    group: "Other",
    title: "Finishing",
    description: "Canvases we are stitching ourselves, and what they became.",
    icon: icon("M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01"),
    accent: "text-slate-400",
  },
  {
    href: "/help",
    group: "Other",
    title: "Help",
    description: "How the editor and the rest of the app work.",
    icon: icon("M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"),
    accent: "text-slate-400",
  },
];

export default function InventoryToolsPage() {
  const [lowCount, setLowCount] = useState(0);

  const fetchLow = useCallback(async () => {
    try {
      const res = await fetch("/api/designs");
      if (res.ok) {
        const data: { isDraft: boolean; canvasPrinted: number; marketCanvasPrinted: number }[] = await res.json();
        setLowCount(
          data.filter((d) => !d.isDraft && d.canvasPrinted + (d.marketCanvasPrinted || 0) < LOW_ON_HAND).length
        );
      }
    } catch {
      // non-critical — the badge just won't show
    }
  }, []);

  useEffect(() => { fetchLow(); }, [fetchLow]);

  return (
    <div className="min-h-screen bg-slate-900">
      <header className="bg-slate-800 border-b border-slate-700 sticky top-0 z-40 safe-area-top">
        <div className="max-w-4xl mx-auto px-3 md:px-4 pt-2"><SectionNav /></div>
        <div className="max-w-4xl mx-auto px-3 md:px-4 py-3 md:py-4 flex items-center justify-between gap-2">
          <h1 className="text-white font-semibold text-lg">Tools</h1>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-3 md:px-4 py-6">
        <Breadcrumb items={[{ label: "Tools" }]} className="mb-4" />

        <p className="text-sm text-slate-400 mb-5">
          Everything you reach for occasionally. Day-to-day stock levels are on the{" "}
          <Link href="/inventory" className="text-rose-400 hover:underline">Inventory</Link> page.
        </p>

        {GROUP_ORDER.map((group) => (
          <div key={group} className="mb-6">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">{group}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {TOOLS.filter((t) => t.group === group).map((t) => (
            <Link
              key={t.href}
              href={t.href}
              className="group bg-slate-800 rounded-xl border border-slate-700 p-4 hover:border-slate-500 hover:bg-slate-800/60 transition-colors flex items-start gap-3"
            >
              <div className={`flex-shrink-0 ${t.accent}`}>{t.icon}</div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-white font-semibold">{t.title}</h2>
                  {t.href === "/inventory/andover-pickup" && lowCount > 0 && (
                    <span
                      className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 text-[10px] font-bold rounded-full bg-red-600 text-white"
                      title={`${lowCount} designs low on hand`}
                    >
                      {lowCount}
                    </span>
                  )}
                  <span className="ml-auto text-slate-500 group-hover:text-white transition-colors">→</span>
                </div>
                <p className="text-sm text-slate-400 mt-1">{t.description}</p>
              </div>
            </Link>
          ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
