"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import SectionNav from "@/components/SectionNav";
import { Breadcrumb } from "@/components/Breadcrumb";

// Inventory planning/report tools. These used to crowd the Inventory tab bar
// alongside the stock views — grouped here so the tab bar stays about "what
// stock do I have" and these stay about "what should I do / order".

const LOW_ON_HAND = 20; // matches the Restock page's low-canvas threshold

interface Tool {
  href: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  accent: string;
}

const icon = (d: string) => (
  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={d} />
  </svg>
);

const TOOLS: Tool[] = [
  {
    href: "/inventory/reorder",
    title: "Reorder",
    description: "What canvases to reorder from the supplier, based on how fast each design is selling vs. lead time.",
    icon: icon("M13 10V3L4 14h7v7l9-11h-7z"),
    accent: "text-amber-300",
  },
  {
    href: "/stock-alerts",
    title: "Stock Alerts",
    description: "Thread stock health and an order builder for the DMC colors you're low on.",
    icon: icon("M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"),
    accent: "text-red-300",
  },
  {
    href: "/inventory/restock",
    title: "Restock",
    description: "Designs low on canvases at home — pull more from your Andover bulk storage.",
    icon: icon("M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"),
    accent: "text-sky-300",
  },
  {
    href: "/market-prep",
    title: "Market Prep",
    description: "How many of each item to bring to the next market, from past POS sales.",
    icon: icon("M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"),
    accent: "text-emerald-300",
  },
  {
    href: "/inventory/deductions",
    title: "Sales Log",
    description: "History of every order deduction — which orders came off which inventory bucket.",
    icon: icon("M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"),
    accent: "text-slate-300",
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
          <h1 className="text-white font-semibold text-lg">Inventory Tools</h1>
          <Link href="/inventory" className="text-sm text-slate-400 hover:text-white">← Inventory</Link>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-3 md:px-4 py-6">
        <Breadcrumb items={[{ label: "Inventory", href: "/inventory" }, { label: "Tools" }]} className="mb-4" />

        <p className="text-sm text-slate-400 mb-5">
          Planning and reports. Your current stock levels live on the{" "}
          <Link href="/inventory" className="text-rose-400 hover:underline">Inventory</Link> page.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {TOOLS.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              className="group bg-slate-800 rounded-xl border border-slate-700 p-4 hover:border-slate-500 hover:bg-slate-800/60 transition-colors flex items-start gap-3"
            >
              <div className={`flex-shrink-0 ${t.accent}`}>{t.icon}</div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-white font-semibold">{t.title}</h2>
                  {t.href === "/inventory/restock" && lowCount > 0 && (
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
    </div>
  );
}
