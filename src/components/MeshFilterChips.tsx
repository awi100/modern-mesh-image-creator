"use client";

import React from "react";

export type MeshFilter = "all" | "13" | "14" | "18" | "order14" | "order13" | "order";

interface MeshFilterChipsProps {
  value: MeshFilter;
  onChange: (filter: MeshFilter) => void;
}

// 14ct intro kits are retired. The active mesh counts are 18ct (canvases) and
// 13ct (intro kits); "Order View" = both. Archived 14ct designs are still
// reachable via "All" (and the Misprints tab, which fetches 14ct directly).
const OPTIONS: { value: MeshFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "18", label: "18ct" },
  { value: "13", label: "13ct" },
  { value: "order13", label: "Order View" },
];

// A selected mesh chip uses that mesh's own colour, matching the badges from
// mesh-badge.ts (13 = purple, 18 = amber, 14 = slate) so the chip and the rows
// it filters to agree. Chips that aren't one mesh ("All", "Order View") take the
// app's rose accent.
//
// "Order View" used to be emerald, which reads as the market tote — emerald and
// sky mean Market and Andover everywhere else, so a location colour must never
// stand for a filter. 18ct used to be rose, disagreeing with its own amber badge.
function selectedClass(v: MeshFilter): string {
  if (v === "13") return "bg-purple-700 text-white";
  if (v === "18") return "bg-amber-700 text-white";
  if (v === "14") return "bg-slate-600 text-white";
  return "bg-rose-900 text-white";
}

export default function MeshFilterChips({ value, onChange }: MeshFilterChipsProps) {
  // Map legacy order-view values ("order", "order14") to the current "order13".
  const displayValue = value === "order" || value === "order14" ? "order13" : value;
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Mesh count filter">
      {OPTIONS.map((opt) => {
        const selected = displayValue === opt.value;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            aria-pressed={selected}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              selected
                ? selectedClass(opt.value)
                : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
