"use client";

import React, { useEffect, useMemo, useState } from "react";

interface DesignOption {
  id: string;
  name: string;
  meshCount: number;
  misprintCount: number;
  kitsReady: number;
  previewImageUrl?: string | null;
}

interface MysteryBagPickerDialogProps {
  open: boolean;
  shopifyOrderId: string;
  orderNumber: string;
  customerName?: string | null;
  // Shopify line items the order contains — used to create the local order
  // row on the server when none exists yet (picks are saved before fulfillment).
  orderItems: { productTitle: string; quantity: number }[];
  required: number;          // total picks needed (e.g. 2 for one bag, 4 for two bags)
  initialPicks: { designId: string }[];
  onClose: () => void;
  onSaved: () => void;
}

// Picks 2N designs (where N = number of Mystery Bags in the order) from the
// pool of 14ct designs with at least one misprint in inventory. The same
// design may be picked more than once up to its misprintCount.
export default function MysteryBagPickerDialog({
  open,
  shopifyOrderId,
  orderNumber,
  customerName,
  orderItems,
  required,
  initialPicks,
  onClose,
  onSaved,
}: MysteryBagPickerDialogProps) {
  const [designs, setDesigns] = useState<DesignOption[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picks, setPicks] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setPicks(initialPicks.map((p) => p.designId));
    setError(null);
    setLoading(true);
    fetch("/api/designs?meshCount=14")
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then((rows: DesignOption[]) => {
        // Only show 14ct designs that currently have at least one misprint
        // available OR that are already in our pick list (so users can see
        // existing picks even if inventory has since changed).
        const initialIds = new Set(initialPicks.map((p) => p.designId));
        setDesigns(
          rows
            .filter((d) => d.misprintCount > 0 || initialIds.has(d.id))
            .sort((a, b) => a.name.localeCompare(b.name))
        );
      })
      .catch(() => setError("Failed to load designs"))
      .finally(() => setLoading(false));
  }, [open, initialPicks]);

  const designById = useMemo(() => {
    const m = new Map<string, DesignOption>();
    for (const d of designs ?? []) m.set(d.id, d);
    return m;
  }, [designs]);

  // How many times each designId is in the current pick list
  const pickCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const id of picks) m.set(id, (m.get(id) ?? 0) + 1);
    return m;
  }, [picks]);

  if (!open) return null;

  const remaining = required - picks.length;
  const canSave = picks.length === required;

  function addPick(designId: string) {
    if (picks.length >= required) return;
    const d = designById.get(designId);
    if (!d) return;
    const current = pickCounts.get(designId) ?? 0;
    if (current >= d.misprintCount) return; // can't pick more than available
    setPicks((p) => [...p, designId]);
  }

  function removePickAt(index: number) {
    setPicks((p) => p.filter((_, i) => i !== index));
  }

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/shopify/orders/mystery-bag", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shopifyOrderId,
          orderNumber,
          customerName: customerName ?? null,
          items: orderItems,
          designIds: picks,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error || "Failed to save picks");
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save picks");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-slate-800 rounded-xl shadow-xl border border-slate-700 max-w-3xl w-full max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-slate-700 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">
              Pick Mystery Bag Misprints
            </h2>
            <p className="text-sm text-slate-400 mt-0.5">
              Order {orderNumber} — choose {required} {required === 1 ? "design" : "designs"} from the 14ct misprint pool.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white px-2 py-1 rounded"
          >
            Close
          </button>
        </div>

        <div className="px-6 py-3 border-b border-slate-700 bg-slate-900/40">
          <div className="flex items-center gap-2 flex-wrap min-h-[2.5rem]">
            {picks.length === 0 ? (
              <span className="text-sm text-slate-500">
                No picks yet — click a design below.
              </span>
            ) : (
              picks.map((id, idx) => {
                const d = designById.get(id);
                return (
                  <button
                    key={`${id}-${idx}`}
                    onClick={() => removePickAt(idx)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-purple-700/40 hover:bg-purple-700/60 text-purple-100 text-sm border border-purple-700/50"
                    title="Remove this pick"
                  >
                    <span>{d?.name ?? "Unknown design"}</span>
                    <span className="text-purple-300">×</span>
                  </button>
                );
              })
            )}
          </div>
          <div className="text-xs text-slate-400 mt-2">
            {canSave
              ? "Ready to save."
              : `${remaining} more ${remaining === 1 ? "pick" : "picks"} needed.`}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading && (
            <div className="text-slate-400 text-sm">Loading designs…</div>
          )}
          {error && (
            <div className="mb-3 px-3 py-2 rounded bg-red-900/40 border border-red-800 text-red-200 text-sm">
              {error}
            </div>
          )}
          {!loading && designs && designs.length === 0 && (
            <div className="text-slate-400 text-sm">
              No 14ct designs currently have misprints tracked.
            </div>
          )}
          {!loading && designs && designs.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {designs.map((d) => {
                const picked = pickCounts.get(d.id) ?? 0;
                const remainingAvail = d.misprintCount - picked;
                const disabled = picks.length >= required || remainingAvail <= 0;
                return (
                  <button
                    key={d.id}
                    onClick={() => addPick(d.id)}
                    disabled={disabled}
                    className={`flex items-center gap-3 p-3 rounded-lg border transition text-left ${
                      disabled
                        ? "border-slate-700 bg-slate-900/40 opacity-50 cursor-not-allowed"
                        : "border-slate-700 bg-slate-900/40 hover:border-purple-600 hover:bg-slate-900"
                    }`}
                  >
                    {d.previewImageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={d.previewImageUrl}
                        alt={d.name}
                        className="w-12 h-12 object-cover rounded border border-slate-700"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded bg-slate-700 border border-slate-600" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-white truncate">
                        {d.name}
                      </div>
                      <div className="text-xs text-slate-400 mt-0.5">
                        misprints: <span className="text-white">{remainingAvail}</span>
                        {picked > 0 ? ` (picked ${picked})` : ""}
                        {" · kits ready: "}
                        <span className={d.kitsReady > 0 ? "text-white" : "text-amber-400"}>
                          {d.kitsReady}
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="px-6 py-3 border-t border-slate-700 flex items-center justify-between">
          <div className="text-xs text-slate-500">
            Picking deducts 1 kit + 1 misprint canvas per design when the order is fulfilled.
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded text-slate-300 hover:bg-slate-700 text-sm"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!canSave || saving}
              className={`px-4 py-1.5 rounded text-sm font-medium ${
                canSave && !saving
                  ? "bg-purple-700 hover:bg-purple-600 text-white"
                  : "bg-slate-700 text-slate-500 cursor-not-allowed"
              }`}
            >
              {saving ? "Saving…" : "Save picks"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
