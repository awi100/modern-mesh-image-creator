"use client";

import { useEffect, useRef, useState } from "react";

interface DesignOption { id: string; name: string; meshCount: number }

/**
 * Pick a design by typing.
 *
 * Deliberately NOT restricted to 18ct: sip-and-stitch picks span 13ct intro
 * kits and 18ct canvases alike, and roughly one in six is an intro kit. It does
 * exclude archived and deleted designs, so a pick can never be mapped onto a
 * retired design — which is exactly the mistake a name-similarity match makes
 * with "Comm Ave Street Sign".
 */
export default function DesignPicker({
  onPick, disabled, label = "Map to design",
}: {
  onPick: (designId: string) => void;
  disabled?: boolean;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [all, setAll] = useState<DesignOption[] | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || all) return;
    (async () => {
      const res = await fetch("/api/designs?includeArchived=false");
      if (!res.ok) return;
      const data = await res.json();
      setAll(
        (Array.isArray(data) ? data : [])
          .filter((d: Record<string, unknown>) => !d.archivedAt && !d.deletedAt && !d.printVersionOf)
          .map((d: Record<string, unknown>) => ({ id: d.id as string, name: d.name as string, meshCount: d.meshCount as number }))
          .sort((a: DesignOption, b: DesignOption) => a.name.localeCompare(b.name)),
      );
    })();
  }, [open, all]);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  const matches = (all ?? []).filter((d) => d.name.toLowerCase().includes(q.toLowerCase())).slice(0, 40);

  return (
    <div className="relative" ref={box}>
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        className="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg text-xs disabled:opacity-50 whitespace-nowrap"
      >
        {label}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-1 w-72 bg-slate-900 border border-slate-600 rounded-lg shadow-xl">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search designs…"
            className="w-full px-3 py-2 bg-slate-800 border-b border-slate-700 rounded-t-lg text-sm text-white placeholder-slate-500"
          />
          <div className="max-h-64 overflow-y-auto">
            {all === null ? (
              <p className="px-3 py-2 text-xs text-slate-500">Loading…</p>
            ) : matches.length === 0 ? (
              <p className="px-3 py-2 text-xs text-slate-500">Nothing matches.</p>
            ) : (
              matches.map((d) => (
                <button
                  key={d.id}
                  onClick={() => { onPick(d.id); setOpen(false); setQ(""); }}
                  className="w-full text-left px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
                >
                  {d.name} <span className="text-slate-500 text-xs">{d.meshCount}ct</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
