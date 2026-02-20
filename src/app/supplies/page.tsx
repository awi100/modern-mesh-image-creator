"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Breadcrumb } from "@/components/Breadcrumb";

interface Supply {
  id: string;
  name: string;
  sku: string | null;
  description: string | null;
  imageUrl: string | null;
  quantity: number;
  createdAt: string;
  updatedAt: string;
}

export default function SuppliesPage() {
  const [supplies, setSupplies] = useState<Supply[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    sku: "",
    description: "",
    quantity: 0,
  });
  const [saving, setSaving] = useState(false);

  const fetchSupplies = useCallback(async () => {
    try {
      const res = await fetch("/api/supplies");
      if (!res.ok) throw new Error("Failed to fetch supplies");
      const data = await res.json();
      setSupplies(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSupplies();
  }, [fetchSupplies]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) return;

    setSaving(true);
    setError(null);

    try {
      const url = editingId ? `/api/supplies/${editingId}` : "/api/supplies";
      const method = editingId ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to save supply");
      }

      await fetchSupplies();
      setShowAddForm(false);
      setEditingId(null);
      setFormData({ name: "", sku: "", description: "", quantity: 0 });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (supply: Supply) => {
    setEditingId(supply.id);
    setFormData({
      name: supply.name,
      sku: supply.sku || "",
      description: supply.description || "",
      quantity: supply.quantity,
    });
    setShowAddForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this supply?")) return;

    try {
      const res = await fetch(`/api/supplies/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete supply");
      setSupplies(supplies.filter((s) => s.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  };

  const handleQuantityChange = async (id: string, delta: number) => {
    // Optimistic update
    setSupplies(
      supplies.map((s) =>
        s.id === id ? { ...s, quantity: Math.max(0, s.quantity + delta) } : s
      )
    );

    try {
      const res = await fetch(`/api/supplies/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantityDelta: delta }),
      });

      if (!res.ok) {
        throw new Error("Failed to update quantity");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
      // Revert on error
      fetchSupplies();
    }
  };

  const cancelForm = () => {
    setShowAddForm(false);
    setEditingId(null);
    setFormData({ name: "", sku: "", description: "", quantity: 0 });
  };

  return (
    <div className="min-h-screen bg-slate-900">
      {/* Header */}
      <header className="bg-slate-800 border-b border-slate-700 sticky top-0 z-40">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-slate-400 hover:text-white">
              <svg
                className="w-6 h-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
                />
              </svg>
            </Link>
            <h1 className="text-xl font-bold text-white">Supplies</h1>
          </div>

          <button
            onClick={() => setShowAddForm(true)}
            className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium flex items-center gap-2"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4v16m8-8H4"
              />
            </svg>
            Add Supply
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        <Breadcrumb items={[{ label: "Supplies" }]} className="mb-2" />

        {/* Error */}
        {error && (
          <div className="p-4 bg-red-900/30 border border-red-700 rounded-lg">
            <p className="text-red-400">{error}</p>
          </div>
        )}

        {/* Info */}
        <div className="p-4 bg-slate-800 border border-slate-700 rounded-lg">
          <p className="text-sm text-slate-400">
            Add supplies here to track their inventory. Supply names must match
            Shopify product titles exactly to link orders automatically.
          </p>
        </div>

        {/* Add/Edit Form */}
        {showAddForm && (
          <div className="bg-slate-800 rounded-xl border border-slate-700 p-6">
            <h2 className="text-lg font-semibold text-white mb-4">
              {editingId ? "Edit Supply" : "Add New Supply"}
            </h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm text-slate-400 mb-1">
                  Name *
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  placeholder="Exact Shopify product title"
                  className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
                  required
                />
                <p className="text-xs text-slate-500 mt-1">
                  Must match the Shopify product title exactly for automatic
                  linking
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-slate-400 mb-1">
                    SKU
                  </label>
                  <input
                    type="text"
                    value={formData.sku}
                    onChange={(e) =>
                      setFormData({ ...formData, sku: e.target.value })
                    }
                    placeholder="Optional SKU"
                    className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>
                <div>
                  <label className="block text-sm text-slate-400 mb-1">
                    Initial Quantity
                  </label>
                  <input
                    type="number"
                    value={formData.quantity}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        quantity: parseInt(e.target.value) || 0,
                      })
                    }
                    min="0"
                    className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm text-slate-400 mb-1">
                  Description
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) =>
                    setFormData({ ...formData, description: e.target.value })
                  }
                  placeholder="Optional description"
                  rows={2}
                  className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>

              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={cancelForm}
                  className="px-4 py-2 text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving || !formData.name.trim()}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium disabled:opacity-50"
                >
                  {saving ? "Saving..." : editingId ? "Update" : "Add Supply"}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="text-slate-400 flex items-center gap-3">
              <svg className="animate-spin h-6 w-6" fill="none" viewBox="0 0 24 24">
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              Loading supplies...
            </div>
          </div>
        )}

        {/* Supplies List */}
        {!loading && supplies.length === 0 && (
          <div className="bg-slate-800 rounded-xl border border-slate-700 p-8 text-center">
            <svg
              className="w-12 h-12 mx-auto text-slate-600 mb-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
              />
            </svg>
            <p className="text-slate-400">No supplies added yet</p>
            <p className="text-sm text-slate-500 mt-2">
              Click &quot;Add Supply&quot; to start tracking supply inventory
            </p>
          </div>
        )}

        {!loading && supplies.length > 0 && (
          <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
            <div className="divide-y divide-slate-700/50">
              {supplies.map((supply) => (
                <div key={supply.id} className="p-4 flex items-center gap-4">
                  <div className="w-12 h-12 rounded-lg bg-purple-900/30 border border-purple-700/50 flex items-center justify-center flex-shrink-0">
                    <svg
                      className="w-6 h-6 text-purple-400"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
                      />
                    </svg>
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-white font-medium truncate">
                      {supply.name}
                    </p>
                    {supply.sku && (
                      <p className="text-xs text-slate-500">SKU: {supply.sku}</p>
                    )}
                    {supply.description && (
                      <p className="text-xs text-slate-400 truncate">
                        {supply.description}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleQuantityChange(supply.id, -1)}
                      disabled={supply.quantity <= 0}
                      className="w-8 h-8 rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center text-white font-bold"
                    >
                      −
                    </button>
                    <div className="text-center w-16">
                      <p className="text-2xl font-bold text-purple-400">
                        {supply.quantity}
                      </p>
                      <p className="text-xs text-slate-400">in stock</p>
                    </div>
                    <button
                      onClick={() => handleQuantityChange(supply.id, 1)}
                      className="w-8 h-8 rounded bg-purple-700 hover:bg-purple-600 flex items-center justify-center text-white font-bold"
                    >
                      +
                    </button>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleEdit(supply)}
                      className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg"
                      title="Edit"
                    >
                      <svg
                        className="w-5 h-5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                        />
                      </svg>
                    </button>
                    <button
                      onClick={() => handleDelete(supply.id)}
                      className="p-2 text-slate-400 hover:text-red-400 hover:bg-slate-700 rounded-lg"
                      title="Delete"
                    >
                      <svg
                        className="w-5 h-5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                        />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
