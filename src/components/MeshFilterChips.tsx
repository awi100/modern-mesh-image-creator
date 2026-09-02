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

export default function MeshFilterChips({ value, onChange }: MeshFilterChipsProps) {
  // Map legacy order-view values ("order", "order14") to the current "order13".
  const displayValue = value === "order" || value === "order14" ? "order13" : value;
  return (
    <div className="flex flex-wrap gap-2">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            displayValue === opt.value
              ? opt.value === "order13"
                ? "bg-emerald-600 text-white"
                : opt.value === "13"
                  ? "bg-purple-700 text-white"
                  : "bg-rose-900 text-white"
              : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
