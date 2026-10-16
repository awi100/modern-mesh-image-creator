"use client";

/**
 * How much headroom to size the tote with. Shared by the "to pack" and "plan"
 * views so switching between them can't silently change the numbers.
 */

export type Buffer = "conservative" | "balanced" | "aggressive";

export const BUFFERS: { value: Buffer; label: string; hint: string }[] = [
  { value: "conservative", label: "Conservative", hint: "peak +25%" },
  { value: "balanced", label: "Balanced", hint: "peak +50%" },
  { value: "aggressive", label: "Aggressive", hint: "peak ×2" },
];

export default function BufferPicker({
  value,
  onChange,
  showHints = false,
}: {
  value: Buffer;
  onChange: (b: Buffer) => void;
  showHints?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 mb-5">
      <span className="text-xs uppercase tracking-wider text-slate-400">Buffer</span>
      <div className="inline-flex gap-1 bg-slate-800 p-1 rounded-lg border border-slate-700">
        {BUFFERS.map((b) => (
          <button
            key={b.value}
            onClick={() => onChange(b.value)}
            title={b.hint}
            aria-pressed={value === b.value}
            className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              value === b.value ? "bg-rose-900 text-white" : "text-slate-300 hover:bg-slate-700"
            }`}
          >
            {b.label}
            {showHints && <span className="ml-1 text-xs opacity-70">{b.hint}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
