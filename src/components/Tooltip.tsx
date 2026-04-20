"use client";

import React from "react";

interface TooltipProps {
  label: string;
  children: React.ReactNode;
  position?: "top" | "bottom";
}

export default function Tooltip({ label, children, position = "top" }: TooltipProps) {
  return (
    <div className="relative group/tip">
      {children}
      <div
        className={`absolute left-1/2 -translate-x-1/2 px-2 py-1 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs rounded whitespace-nowrap opacity-0 group-hover/tip:opacity-100 pointer-events-none transition-opacity z-50 ${
          position === "top" ? "bottom-full mb-1.5" : "top-full mt-1.5"
        }`}
      >
        {label}
      </div>
    </div>
  );
}
