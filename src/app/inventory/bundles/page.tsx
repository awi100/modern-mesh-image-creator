"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import SectionNav from "@/components/SectionNav";
import { Breadcrumb } from "@/components/Breadcrumb";
import { useToast } from "@/components/Toast";

interface Supply { id: string; name: string; quantity: number; marketQuantity: number; }
interface Component { id?: string; supplyId: string | null; quantity: number; chooseFrom: string | null; supply?: { id: string; name: string } | null; }
interface Bundle { id: string; title: string; label: string | null; active: boolean; components: Component[]; }

interface DraftComponent { kind: "fixed" | "choice"; supplyId: string; chooseFrom: string; quantity: number; }
interface Draft { id: string | null; title: string; label: string; active: boolean; components: DraftComponent[]; }

const emptyDraft = (): Draft => ({ id: null, title: "", label: "", active: true, components: [{ kind: "fixed", supplyId: "", chooseFrom: "", quantity: 1 }] });

export default function BundlesPage() {
  const { showToast } = useToast();
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [supplies, setSupplies] = useState<Supply[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [b, s] = await Promise.all([fetch("/api/bundles"), fetch("/api/supplies")]);
      if (b.ok) setBundles(await b.json());
      if (s.ok) setSupplies(await s.json());
    } catch (e) {
      console.error("Failed to load bundles:", e);
    }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const startEdit = (bundle: Bundle) => setDraft({
    id: bundle.id,
    title: bundle.title,
    label: bundle.label || "",
    active: bundle.active,
    components: bundle.components.map((c) => c.chooseFrom
      ? { kind: "choice", supplyId: "", chooseFrom: c.chooseFrom, quantity: c.quantity }
      : { kind: "fixed", supplyId: c.supplyId || "", chooseFrom: "", quantity: c.quantity }),
  });

  const save = async () => {
    if (!draft) return;
    if (!draft.title.trim()) { showToast("Bundle title is required (match the Shopify product title).", "error"); return; }
    const components = draft.components
      .filter((c) => (c.kind === "fixed" ? c.supplyId : c.chooseFrom.trim()))
      .map((c) => c.kind === "fixed"
        ? { supplyId: c.supplyId, quantity: c.quantity, chooseFrom: null }
        : { supplyId: null, quantity: c.quantity, chooseFrom: c.chooseFrom.trim() });
    if (components.length === 0) { showToast("Add at least one component.", "error"); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/bundles", {
        method: draft.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: draft.id ?? undefined, title: draft.title.trim(), label: draft.label, active: draft.active, components }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || "Save failed"); }
      showToast(draft.id ? "Bundle updated" : "Bundle created", "success");
      setDraft(null);
      load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to save bundle", "error");
    }
    setSaving(false);
  };

  const remove = async (bundle: Bundle) => {
    if (!confirm(`Delete bundle "${bundle.title}"?`)) return;
    try {
      const res = await fetch(`/api/bundles?id=${bundle.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      showToast("Bundle deleted", "success");
      load();
    } catch {
      showToast("Failed to delete bundle", "error");
    }
  };

  const setComp = (i: number, patch: Partial<DraftComponent>) =>
    setDraft((d) => d ? { ...d, components: d.components.map((c, j) => j === i ? { ...c, ...patch } : c) } : d);

  const componentSummary = (c: Component) =>
    c.chooseFrom ? `${c.quantity}× customer-choice "${c.chooseFrom}"` : `${c.quantity}× ${c.supply?.name ?? "?"}`;

  return (
    <div className="min-h-screen bg-slate-900">
      <header className="bg-slate-800 border-b border-slate-700 sticky top-0 z-40 safe-area-top">
        <div className="max-w-4xl mx-auto px-3 md:px-4 pt-2"><SectionNav /></div>
        <div className="max-w-4xl mx-auto px-3 md:px-4 py-3 md:py-4 flex items-center justify-between gap-2">
          <h1 className="text-white font-semibold text-lg">Bundles</h1>
          <div className="flex items-center gap-2">
            {!draft && <button onClick={() => setDraft(emptyDraft())} className="px-3 py-1.5 text-sm font-medium bg-rose-900 hover:bg-rose-800 text-white rounded-lg">New bundle</button>}
            <Link href="/inventory" className="text-sm text-slate-400 hover:text-white">← Inventory</Link>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-3 md:px-4 py-6">
        <Breadcrumb items={[{ label: "Inventory", href: "/inventory" }, { label: "Bundles" }]} className="mb-4" />
        <p className="text-sm text-slate-400 mb-5">
          A bundle is one Shopify product that deducts several component supplies when ordered. Match the
          <span className="text-white"> title</span> to the Shopify product title exactly. Fixed components deduct a set
          supply; a <span className="text-white">customer-choice</span> component (e.g. the needle minder) is resolved
          from the order&apos;s variant.
        </p>

        {/* Editor */}
        {draft && (
          <div className="bg-slate-800 rounded-xl border border-slate-700 p-4 mb-6 space-y-4">
            <h2 className="text-white font-semibold">{draft.id ? "Edit bundle" : "New bundle"}</h2>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs uppercase tracking-wider text-slate-400 mb-1">Shopify product title</label>
                <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Essentials Bundle"
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white text-sm" />
              </div>
              <div>
                <label className="block text-xs uppercase tracking-wider text-slate-400 mb-1">Label (optional)</label>
                <input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} placeholder="Notes"
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white text-sm" />
              </div>
            </div>

            <div>
              <label className="block text-xs uppercase tracking-wider text-slate-400 mb-2">Components</label>
              <div className="space-y-2">
                {draft.components.map((c, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2 bg-slate-900/50 rounded-lg p-2">
                    <select value={c.kind} onChange={(e) => setComp(i, { kind: e.target.value as "fixed" | "choice" })}
                      className="px-2 py-1.5 bg-slate-900 border border-slate-600 rounded text-white text-sm">
                      <option value="fixed">Fixed supply</option>
                      <option value="choice">Customer choice</option>
                    </select>
                    {c.kind === "fixed" ? (
                      <select value={c.supplyId} onChange={(e) => setComp(i, { supplyId: e.target.value })}
                        className="flex-1 min-w-[160px] px-2 py-1.5 bg-slate-900 border border-slate-600 rounded text-white text-sm">
                        <option value="">Select supply…</option>
                        {supplies.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    ) : (
                      <input value={c.chooseFrom} onChange={(e) => setComp(i, { chooseFrom: e.target.value })} placeholder='matches supplies containing e.g. "Needle Minder"'
                        className="flex-1 min-w-[160px] px-2 py-1.5 bg-slate-900 border border-slate-600 rounded text-white text-sm" />
                    )}
                    <input type="number" min={1} value={c.quantity} onChange={(e) => setComp(i, { quantity: Math.max(1, Number(e.target.value) || 1) })}
                      className="w-16 px-2 py-1.5 bg-slate-900 border border-slate-600 rounded text-white text-sm text-center" title="Quantity" />
                    <button onClick={() => setDraft({ ...draft, components: draft.components.filter((_, j) => j !== i) })}
                      className="p-1.5 text-slate-500 hover:text-red-400" title="Remove">✕</button>
                  </div>
                ))}
              </div>
              <button onClick={() => setDraft({ ...draft, components: [...draft.components, { kind: "fixed", supplyId: "", chooseFrom: "", quantity: 1 }] })}
                className="mt-2 text-sm text-rose-400 hover:text-rose-300">+ Add component</button>
            </div>

            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} className="accent-rose-700" />
              Active (deduct components on orders)
            </label>

            <div className="flex items-center gap-2">
              <button onClick={save} disabled={saving} className="px-4 py-2 text-sm font-medium bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white rounded-lg">{saving ? "Saving…" : "Save bundle"}</button>
              <button onClick={() => setDraft(null)} className="px-4 py-2 text-sm text-slate-400 hover:text-white">Cancel</button>
            </div>
          </div>
        )}

        {/* List */}
        {loading ? (
          <div className="text-slate-400 py-12 text-center">Loading…</div>
        ) : bundles.length === 0 ? (
          <div className="bg-slate-800 rounded-xl border border-slate-700 p-8 text-center">
            <p className="text-slate-300 font-medium">No bundles yet</p>
            <p className="text-slate-400 text-sm mt-1">Create one so bundle orders deduct their component supplies.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {bundles.map((b) => (
              <div key={b.id} className="bg-slate-800 rounded-xl border border-slate-700 p-3 md:p-4 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-white font-medium">{b.title}</span>
                    {!b.active && <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-400 uppercase">inactive</span>}
                  </div>
                  <p className="text-xs text-slate-400 mt-1">{b.components.map(componentSummary).join(" · ") || "No components"}</p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => startEdit(b)} className="px-2 py-1 text-xs text-slate-300 hover:text-white bg-slate-700 rounded">Edit</button>
                  <button onClick={() => remove(b)} className="px-2 py-1 text-xs text-red-400 hover:text-red-300">Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
