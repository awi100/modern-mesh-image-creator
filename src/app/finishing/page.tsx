"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import useSWR, { mutate } from "swr";

const PRODUCT_TYPES = [
  "Pillow",
  "Ornament",
  "Frame",
  "Belt",
  "Tote Bag",
  "Standup",
  "Coaster",
  "Clutch",
  "Eyeglass Case",
];

interface FinisherOrder {
  id: string;
  designId: string | null;
  design: { id: string; name: string; previewImageUrl: string | null } | null;
  finisher?: { id: string; name: string };
  sentAt: string;
  receivedAt: string | null;
  cost: number | null;
  status: string;
  productType: string | null;
  notes: string | null;
}

interface Finisher {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  website: string | null;
  turnaroundDays: number | null;
  rating: number | null;
  notes: string | null;
  avgTurnaround: number | null;
  totalSpent: number;
  activeOrders: number;
  orderCount: number;
}

interface Design {
  id: string;
  name: string;
}

type Tab = "orders" | "finishers";
type StatusFilter = "all" | "sent" | "in_progress" | "finished";

function Stars({ rating }: { rating: number | null }) {
  if (!rating) return <span className="text-xs text-slate-500">No rating</span>;
  return (
    <span className="text-amber-400">
      {"★".repeat(rating)}
      {"☆".repeat(5 - rating)}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    sent: "bg-amber-500/20 text-amber-400",
    in_progress: "bg-blue-500/20 text-blue-400",
    finished: "bg-emerald-500/20 text-emerald-400",
  };
  const labels: Record<string, string> = {
    sent: "Sent",
    in_progress: "In Progress",
    finished: "Finished",
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded font-medium ${styles[status] || "bg-slate-500/20 text-slate-400"}`}>
      {labels[status] || status}
    </span>
  );
}

function elapsedMonths(sentAt: string, receivedAt: string | null): string {
  const start = new Date(sentAt);
  const end = receivedAt ? new Date(receivedAt) : new Date();
  const months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
  if (months < 1) {
    const days = Math.round((end.getTime() - start.getTime()) / 86400000);
    return `${days}d`;
  }
  return `${months}mo`;
}

export default function FinishingPage() {
  const [tab, setTab] = useState<Tab>("orders");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  // Data
  const { data: finishers = [], isLoading: loadingFinishers } = useSWR<Finisher[]>("/api/finishing");
  const { data: allOrders = [], isLoading: loadingOrders } = useSWR<FinisherOrder[]>("/api/finishing/orders");
  const [designs, setDesigns] = useState<Design[]>([]);

  // Finisher form
  const [showFinisherForm, setShowFinisherForm] = useState(false);
  const [editingFinisher, setEditingFinisher] = useState<Finisher | null>(null);
  const [finisherForm, setFinisherForm] = useState({
    name: "", email: "", phone: "", website: "", turnaroundDays: "", rating: "", notes: "",
  });

  // Order form
  const [showOrderForm, setShowOrderForm] = useState(false);
  const [orderForm, setOrderForm] = useState({
    finisherId: "", designId: "", sentAt: new Date().toISOString().split("T")[0],
    cost: "", productType: "", customProductType: "", notes: "",
  });

  // Finisher detail expansion
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedOrders, setExpandedOrders] = useState<FinisherOrder[]>([]);

  useEffect(() => {
    fetch("/api/designs").then((r) => r.json()).then(setDesigns).catch(() => {});
  }, []);

  // Finisher CRUD
  const handleFinisherSubmit = async () => {
    if (!finisherForm.name) return;
    if (editingFinisher) {
      await fetch("/api/finishing", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editingFinisher.id, ...finisherForm }),
      });
    } else {
      await fetch("/api/finishing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(finisherForm),
      });
    }
    setShowFinisherForm(false);
    setEditingFinisher(null);
    setFinisherForm({ name: "", email: "", phone: "", website: "", turnaroundDays: "", rating: "", notes: "" });
    mutate("/api/finishing");
  };

  const editFinisher = (f: Finisher) => {
    setEditingFinisher(f);
    setFinisherForm({
      name: f.name,
      email: f.email || "",
      phone: f.phone || "",
      website: f.website || "",
      turnaroundDays: f.turnaroundDays?.toString() || "",
      rating: f.rating?.toString() || "",
      notes: f.notes || "",
    });
    setShowFinisherForm(true);
  };

  const deleteFinisher = async (id: string) => {
    if (!confirm("Delete this finisher and all their orders?")) return;
    await fetch("/api/finishing", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    mutate("/api/finishing");
    mutate("/api/finishing/orders");
  };

  // Load orders for expanded finisher
  const toggleFinisher = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    const res = await fetch(`/api/finishing/${id}/orders`);
    setExpandedOrders(await res.json());
  };

  // Order CRUD
  const handleOrderSubmit = async () => {
    if (!orderForm.finisherId) return;
    const productType = orderForm.productType === "__custom__"
      ? orderForm.customProductType
      : orderForm.productType;
    await fetch(`/api/finishing/${orderForm.finisherId}/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        designId: orderForm.designId || null,
        sentAt: orderForm.sentAt,
        cost: orderForm.cost || null,
        productType: productType || null,
        notes: orderForm.notes || null,
      }),
    });
    setShowOrderForm(false);
    setOrderForm({
      finisherId: "", designId: "", sentAt: new Date().toISOString().split("T")[0],
      cost: "", productType: "", customProductType: "", notes: "",
    });
    mutate("/api/finishing");
    mutate("/api/finishing/orders");
    // Refresh expanded finisher orders if open
    if (expandedId === orderForm.finisherId) {
      const res = await fetch(`/api/finishing/${orderForm.finisherId}/orders`);
      setExpandedOrders(await res.json());
    }
  };

  const updateOrderStatus = async (order: FinisherOrder, newStatus: string) => {
    const finisherId = order.finisher?.id || expandedId;
    if (!finisherId) return;
    const updates: Record<string, unknown> = { id: order.id, status: newStatus };
    if (newStatus === "finished") {
      updates.receivedAt = new Date().toISOString();
    }
    await fetch(`/api/finishing/${finisherId}/orders`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    mutate("/api/finishing");
    mutate("/api/finishing/orders");
    if (expandedId) {
      const res = await fetch(`/api/finishing/${expandedId}/orders`);
      setExpandedOrders(await res.json());
    }
  };

  const deleteOrder = async (order: FinisherOrder) => {
    const finisherId = order.finisher?.id || expandedId;
    if (!finisherId) return;
    await fetch(`/api/finishing/${finisherId}/orders`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: order.id }),
    });
    mutate("/api/finishing");
    mutate("/api/finishing/orders");
    if (expandedId) {
      const res = await fetch(`/api/finishing/${expandedId}/orders`);
      setExpandedOrders(await res.json());
    }
  };

  // Stats
  const totalSpent = finishers.reduce((sum, f) => sum + f.totalSpent, 0);
  const totalActive = finishers.reduce((sum, f) => sum + f.activeOrders, 0);
  const totalFinished = allOrders.filter((o) => o.status === "finished").length;

  // Filtered orders
  const filteredOrders = statusFilter === "all"
    ? allOrders
    : allOrders.filter((o) => o.status === statusFilter);

  const isLoading = loadingFinishers || loadingOrders;

  return (
    <div className="min-h-screen bg-slate-900">
      {/* Header */}
      <header className="bg-slate-800 border-b border-slate-700 px-4 py-3 sticky top-0 z-40">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-slate-400 hover:text-white">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <h1 className="text-xl font-bold text-white">Finishing</h1>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => { setShowOrderForm(true); setShowFinisherForm(false); }}
              className="px-4 py-2 bg-rose-900 text-white rounded-lg hover:bg-rose-950 text-sm"
            >
              New Order
            </button>
            <button
              onClick={() => {
                setShowFinisherForm(true);
                setShowOrderForm(false);
                setEditingFinisher(null);
                setFinisherForm({ name: "", email: "", phone: "", website: "", turnaroundDays: "", rating: "", notes: "" });
              }}
              className="px-4 py-2 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600 text-sm"
            >
              Add Finisher
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto p-4 md:p-6">
        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="bg-slate-800 rounded-lg p-3 text-center">
            <p className="text-2xl font-bold text-white">{totalActive}</p>
            <p className="text-xs text-slate-400">In Progress</p>
          </div>
          <div className="bg-slate-800 rounded-lg p-3 text-center">
            <p className="text-2xl font-bold text-emerald-400">{totalFinished}</p>
            <p className="text-xs text-slate-400">Finished</p>
          </div>
          <div className="bg-slate-800 rounded-lg p-3 text-center">
            <p className="text-2xl font-bold text-white">{totalSpent > 0 ? `$${totalSpent.toFixed(0)}` : "$0"}</p>
            <p className="text-xs text-slate-400">Total Spent</p>
          </div>
        </div>

        {/* New Order Form */}
        {showOrderForm && (
          <div className="mb-6 p-4 bg-slate-800 rounded-xl border border-slate-700 space-y-3">
            <h3 className="font-medium text-white">New Finishing Order</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <select
                value={orderForm.finisherId}
                onChange={(e) => setOrderForm({ ...orderForm, finisherId: e.target.value })}
                className="px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm"
              >
                <option value="">Select finisher *</option>
                {finishers.map((f) => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
              <select
                value={orderForm.designId}
                onChange={(e) => setOrderForm({ ...orderForm, designId: e.target.value })}
                className="px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm"
              >
                <option value="">Select design (optional)</option>
                {designs.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
              <select
                value={orderForm.productType}
                onChange={(e) => setOrderForm({ ...orderForm, productType: e.target.value })}
                className="px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm"
              >
                <option value="">Product type (optional)</option>
                {PRODUCT_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
                <option value="__custom__">Other...</option>
              </select>
              {orderForm.productType === "__custom__" && (
                <input
                  type="text"
                  placeholder="Custom product type"
                  value={orderForm.customProductType}
                  onChange={(e) => setOrderForm({ ...orderForm, customProductType: e.target.value })}
                  className="px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm"
                />
              )}
              <input
                type="date"
                value={orderForm.sentAt}
                onChange={(e) => setOrderForm({ ...orderForm, sentAt: e.target.value })}
                className="px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm"
              />
              <input
                type="number"
                step="0.01"
                placeholder="Cost ($)"
                value={orderForm.cost}
                onChange={(e) => setOrderForm({ ...orderForm, cost: e.target.value })}
                className="px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm"
              />
            </div>
            <input
              type="text"
              placeholder="Notes (optional)"
              value={orderForm.notes}
              onChange={(e) => setOrderForm({ ...orderForm, notes: e.target.value })}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm"
            />
            <div className="flex gap-2">
              <button
                onClick={handleOrderSubmit}
                disabled={!orderForm.finisherId}
                className="px-4 py-2 bg-rose-900 text-white rounded-lg text-sm hover:bg-rose-950 disabled:opacity-50"
              >
                Create Order
              </button>
              <button
                onClick={() => setShowOrderForm(false)}
                className="px-4 py-2 bg-slate-700 text-slate-300 rounded-lg text-sm hover:bg-slate-600"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Add Finisher Form */}
        {showFinisherForm && (
          <div className="mb-6 p-4 bg-slate-800 rounded-xl border border-slate-700 space-y-3">
            <h3 className="font-medium text-white">{editingFinisher ? "Edit Finisher" : "Add Finisher"}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <input
                type="text"
                placeholder="Name *"
                value={finisherForm.name}
                onChange={(e) => setFinisherForm({ ...finisherForm, name: e.target.value })}
                className="px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm"
              />
              <input
                type="email"
                placeholder="Email"
                value={finisherForm.email}
                onChange={(e) => setFinisherForm({ ...finisherForm, email: e.target.value })}
                className="px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm"
              />
              <input
                type="tel"
                placeholder="Phone"
                value={finisherForm.phone}
                onChange={(e) => setFinisherForm({ ...finisherForm, phone: e.target.value })}
                className="px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm"
              />
              <input
                type="url"
                placeholder="Website"
                value={finisherForm.website}
                onChange={(e) => setFinisherForm({ ...finisherForm, website: e.target.value })}
                className="px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm"
              />
              <input
                type="number"
                placeholder="Expected turnaround (days)"
                value={finisherForm.turnaroundDays}
                onChange={(e) => setFinisherForm({ ...finisherForm, turnaroundDays: e.target.value })}
                className="px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm"
              />
              <select
                value={finisherForm.rating}
                onChange={(e) => setFinisherForm({ ...finisherForm, rating: e.target.value })}
                className="px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm"
              >
                <option value="">Rating</option>
                {[1, 2, 3, 4, 5].map((r) => (
                  <option key={r} value={r}>{"★".repeat(r)} ({r}/5)</option>
                ))}
              </select>
            </div>
            <textarea
              placeholder="Notes"
              value={finisherForm.notes}
              onChange={(e) => setFinisherForm({ ...finisherForm, notes: e.target.value })}
              rows={2}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm"
            />
            <div className="flex gap-2">
              <button
                onClick={handleFinisherSubmit}
                disabled={!finisherForm.name}
                className="px-4 py-2 bg-rose-900 text-white rounded-lg text-sm hover:bg-rose-950 disabled:opacity-50"
              >
                {editingFinisher ? "Save" : "Add Finisher"}
              </button>
              <button
                onClick={() => { setShowFinisherForm(false); setEditingFinisher(null); }}
                className="px-4 py-2 bg-slate-700 text-slate-300 rounded-lg text-sm hover:bg-slate-600"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-slate-800 p-1 rounded-lg">
          <button
            onClick={() => setTab("orders")}
            className={`flex-1 py-2 text-sm rounded-md transition-colors ${
              tab === "orders" ? "bg-slate-700 text-white" : "text-slate-400 hover:text-white"
            }`}
          >
            All Orders ({allOrders.length})
          </button>
          <button
            onClick={() => setTab("finishers")}
            className={`flex-1 py-2 text-sm rounded-md transition-colors ${
              tab === "finishers" ? "bg-slate-700 text-white" : "text-slate-400 hover:text-white"
            }`}
          >
            Finishers ({finishers.length})
          </button>
        </div>

        {isLoading ? (
          <div className="text-center py-12 text-slate-500">Loading...</div>
        ) : tab === "orders" ? (
          <>
            {/* Status filters */}
            <div className="flex gap-2 mb-4">
              {(["all", "sent", "in_progress", "finished"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                    statusFilter === s
                      ? "bg-rose-900 text-white"
                      : "bg-slate-800 text-slate-400 hover:text-white"
                  }`}
                >
                  {s === "all" ? "All" : s === "sent" ? "Sent" : s === "in_progress" ? "In Progress" : "Finished"}
                </button>
              ))}
            </div>

            {filteredOrders.length === 0 ? (
              <div className="text-center py-12 text-slate-500">
                {allOrders.length === 0 ? "No finishing orders yet. Create one above!" : "No orders match this filter."}
              </div>
            ) : (
              <div className="space-y-2">
                {filteredOrders.map((order) => (
                  <div key={order.id} className="bg-slate-800 rounded-lg border border-slate-700 p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3 min-w-0">
                        {/* Design thumbnail */}
                        {order.design?.previewImageUrl ? (
                          <img
                            src={order.design.previewImageUrl}
                            alt=""
                            className="w-10 h-10 rounded object-cover flex-shrink-0"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded bg-slate-700 flex-shrink-0" />
                        )}
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            {order.design ? (
                              <Link href={`/design/${order.design.id}/kit`} className="text-sm font-medium text-white hover:text-rose-400">
                                {order.design.name}
                              </Link>
                            ) : (
                              <span className="text-sm text-slate-400">No design</span>
                            )}
                            <StatusBadge status={order.status} />
                            {order.productType && (
                              <span className="text-xs px-2 py-0.5 rounded bg-purple-500/20 text-purple-400">
                                {order.productType}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-500 mt-0.5">
                            {order.finisher?.name || "Unknown"} &middot;
                            Sent {new Date(order.sentAt).toLocaleDateString()} &middot;
                            {order.status === "finished" && order.receivedAt
                              ? ` Done ${new Date(order.receivedAt).toLocaleDateString()} · `
                              : " "}
                            {elapsedMonths(order.sentAt, order.receivedAt)}
                            {order.cost != null && ` · $${order.cost.toFixed(2)}`}
                          </p>
                          {order.notes && (
                            <p className="text-xs text-slate-500 mt-0.5 italic">{order.notes}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                        {order.status === "sent" && (
                          <button
                            onClick={() => updateOrderStatus(order, "in_progress")}
                            className="text-xs px-2 py-1 bg-blue-900/30 text-blue-400 rounded hover:bg-blue-900/50"
                          >
                            Start
                          </button>
                        )}
                        {order.status === "in_progress" && (
                          <button
                            onClick={() => updateOrderStatus(order, "finished")}
                            className="text-xs px-2 py-1 bg-emerald-900/30 text-emerald-400 rounded hover:bg-emerald-900/50"
                          >
                            Complete
                          </button>
                        )}
                        <button
                          onClick={() => deleteOrder(order)}
                          className="text-xs text-red-500 hover:text-red-400"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          /* Finishers tab */
          <>
            {finishers.length === 0 ? (
              <div className="text-center py-12 text-slate-500">
                No finishers added yet. Add one above!
              </div>
            ) : (
              <div className="space-y-3">
                {finishers.map((f) => (
                  <div key={f.id} className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
                    <div
                      className="p-4 cursor-pointer hover:bg-slate-750"
                      onClick={() => toggleFinisher(f.id)}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="font-medium text-white">{f.name}</h3>
                          <div className="flex items-center gap-3 mt-1 flex-wrap">
                            <Stars rating={f.rating} />
                            {f.avgTurnaround != null && (
                              <span className="text-xs text-slate-500">~{f.avgTurnaround} day avg</span>
                            )}
                            <span className="text-xs text-slate-500">
                              {f.orderCount} order{f.orderCount !== 1 ? "s" : ""}
                              {f.activeOrders > 0 && ` (${f.activeOrders} active)`}
                            </span>
                            {f.totalSpent > 0 && (
                              <span className="text-xs text-slate-500">${f.totalSpent.toFixed(2)} spent</span>
                            )}
                          </div>
                          {(f.email || f.phone) && (
                            <p className="text-xs text-slate-500 mt-1">
                              {[f.email, f.phone].filter(Boolean).join(" · ")}
                            </p>
                          )}
                          {f.notes && (
                            <p className="text-xs text-slate-500 mt-1 italic">{f.notes}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={(e) => { e.stopPropagation(); editFinisher(f); }}
                            className="text-xs text-slate-400 hover:text-white"
                          >
                            Edit
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); deleteFinisher(f.id); }}
                            className="text-xs text-red-500 hover:text-red-400"
                          >
                            Delete
                          </button>
                          <svg
                            className={`w-4 h-4 text-slate-400 transition-transform ${expandedId === f.id ? "rotate-180" : ""}`}
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>
                      </div>
                    </div>

                    {/* Expanded orders */}
                    {expandedId === f.id && (
                      <div className="border-t border-slate-700 p-4 space-y-2">
                        {expandedOrders.length === 0 ? (
                          <p className="text-sm text-slate-500">No orders for this finisher yet.</p>
                        ) : (
                          expandedOrders.map((o) => (
                            <div key={o.id} className="flex items-center justify-between p-3 bg-slate-700/50 rounded-lg">
                              <div>
                                <div className="flex items-center gap-2">
                                  <p className="text-sm text-white">
                                    {o.design?.name || "No design"}
                                  </p>
                                  <StatusBadge status={o.status} />
                                  {o.productType && (
                                    <span className="text-xs px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400">
                                      {o.productType}
                                    </span>
                                  )}
                                </div>
                                <p className="text-xs text-slate-500 mt-0.5">
                                  Sent {new Date(o.sentAt).toLocaleDateString()}
                                  {o.receivedAt && ` · Received ${new Date(o.receivedAt).toLocaleDateString()}`}
                                  {" · "}{elapsedMonths(o.sentAt, o.receivedAt)}
                                  {o.cost != null && ` · $${o.cost.toFixed(2)}`}
                                </p>
                              </div>
                              <div className="flex items-center gap-2">
                                {o.status === "sent" && (
                                  <button
                                    onClick={() => updateOrderStatus(o, "in_progress")}
                                    className="text-xs text-blue-400 hover:text-blue-300"
                                  >
                                    Start
                                  </button>
                                )}
                                {o.status === "in_progress" && (
                                  <button
                                    onClick={() => updateOrderStatus(o, "finished")}
                                    className="text-xs text-emerald-400 hover:text-emerald-300"
                                  >
                                    Complete
                                  </button>
                                )}
                                <button
                                  onClick={() => deleteOrder(o)}
                                  className="text-xs text-red-500 hover:text-red-400"
                                >
                                  Delete
                                </button>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
