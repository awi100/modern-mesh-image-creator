"use client";

import React from "react";

export type MeshFilter = "all" | "14" | "18" | "order";

interface MeshFilterChipsProps {
  value: MeshFilter;
  onChange: (filter: MeshFilter) => void;
}

const OPTIONS: { value: MeshFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "18", label: "18ct" },
  { value: "14", label: "14ct" },
  { value: "order", label: "Order View" },
];

export default function MeshFilterChips({ value, onChange }: MeshFilterChipsProps) {
  return (
    <div className="flex gap-2">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            value === opt.value
              ? opt.value === "order"
                ? "bg-emerald-600 text-white"
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
