"use client";

import React from "react";

interface TooltipProps {
  label: string;
  children: React.ReactNode;
  position?: "top" | "bottom";
  shortcut?: string; // e.g. "⌘Z" or "Esc"
}

export default function Tooltip({ label, children, position = "top", shortcut }: TooltipProps) {
  return (
    <div className="relative group/tip">
      {children}
      <div
        className={`absolute left-1/2 -translate-x-1/2 px-2 py-1 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs rounded whitespace-nowrap opacity-0 group-hover/tip:opacity-100 group-active/tip:opacity-100 group-focus-within/tip:opacity-100 pointer-events-none transition-opacity z-50 flex items-center gap-1.5 ${
          position === "top" ? "bottom-full mb-1.5" : "top-full mt-1.5"
        }`}
      >
        <span>{label}</span>
        {shortcut && (
          <kbd className="px-1 py-0.5 bg-slate-700 dark:bg-slate-300 text-slate-300 dark:text-slate-700 text-[10px] font-mono rounded border border-slate-600 dark:border-slate-400">
            {shortcut}
          </kbd>
        )}
      </div>
    </div>
  );
}
