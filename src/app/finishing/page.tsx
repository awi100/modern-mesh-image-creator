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

interface FinishingProject {
  id: string;
  designId: string;
  design: { id: string; name: string; previewImageUrl: string | null; meshCount: number };
  person: string;
  status: string;
  productType: string | null;
  startedAt: string;
  finishedAt: string | null;
  notes: string | null;
}

interface Design {
  id: string;
  name: string;
}

type StatusFilter = "all" | "wip" | "finished";

function StatusBadge({ status }: { status: string }) {
  return status === "finished" ? (
    <span className="text-xs px-2 py-0.5 rounded font-medium bg-emerald-500/20 text-emerald-400">Finished</span>
  ) : (
    <span className="text-xs px-2 py-0.5 rounded font-medium bg-amber-500/20 text-amber-400">WIP</span>
  );
}

function elapsedTime(startedAt: string, finishedAt: string | null): string {
  const start = new Date(startedAt);
  const end = finishedAt ? new Date(finishedAt) : new Date();
  const months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
  if (months < 1) {
    const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000));
    return `${days} day${days !== 1 ? "s" : ""}`;
  }
  return `${months} month${months !== 1 ? "s" : ""}`;
}

export default function FinishingPage() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const { data: projects = [], isLoading } = useSWR<FinishingProject[]>("/api/finishing");
  const [designs, setDesigns] = useState<Design[]>([]);

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    designId: "",
    person: "",
    status: "wip",
    productType: "",
    customProductType: "",
    startedAt: new Date().toISOString().split("T")[0],
    finishedAt: "",
    notes: "",
  });

  useEffect(() => {
    fetch("/api/designs")
      .then((r) => r.json())
      .then(setDesigns)
      .catch(() => {});
  }, []);

  const resetForm = () => {
    setForm({
      designId: "",
      person: "",
      status: "wip",
      productType: "",
      customProductType: "",
      startedAt: new Date().toISOString().split("T")[0],
      finishedAt: "",
      notes: "",
    });
    setEditingId(null);
    setShowForm(false);
  };

  const handleSubmit = async () => {
    if (!form.designId || !form.person) return;
    const productType =
      form.productType === "__custom__" ? form.customProductType : form.productType;

    const payload = {
      ...(editingId ? { id: editingId } : {}),
      designId: form.designId,
      person: form.person,
      status: form.status,
      productType: productType || null,
      startedAt: form.startedAt,
      finishedAt: form.status === "finished" && form.finishedAt ? form.finishedAt : null,
      notes: form.notes || null,
    };

    await fetch("/api/finishing", {
      method: editingId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    resetForm();
    mutate("/api/finishing");
  };

  const editProject = (p: FinishingProject) => {
    const isPreset = PRODUCT_TYPES.includes(p.productType || "");
    setEditingId(p.id);
    setForm({
      designId: p.designId,
      person: p.person,
      status: p.status,
      productType: isPreset ? (p.productType || "") : (p.productType ? "__custom__" : ""),
      customProductType: isPreset ? "" : (p.productType || ""),
      startedAt: p.startedAt.split("T")[0],
      finishedAt: p.finishedAt ? p.finishedAt.split("T")[0] : "",
      notes: p.notes || "",
    });
    setShowForm(true);
  };

  const markFinished = async (p: FinishingProject) => {
    await fetch("/api/finishing", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: p.id,
        status: "finished",
        finishedAt: new Date().toISOString(),
      }),
    });
    mutate("/api/finishing");
  };

  const deleteProject = async (id: string) => {
    if (!confirm("Delete this finishing project?")) return;
    await fetch("/api/finishing", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    mutate("/api/finishing");
  };

  // Get unique people for quick filter
  const people = [...new Set(projects.map((p) => p.person))].sort();

  // Filter
  const filtered =
    statusFilter === "all" ? projects : projects.filter((p) => p.status === statusFilter);

  const wipCount = projects.filter((p) => p.status === "wip").length;
  const finishedCount = projects.filter((p) => p.status === "finished").length;

  return (
    <div className="min-h-screen bg-slate-900">
      {/* Header */}
      <header className="bg-slate-800 border-b border-slate-700 px-4 py-3 sticky top-0 z-40 safe-area-top">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-slate-400 hover:text-white">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <h1 className="text-xl font-bold text-white">Finishing</h1>
          </div>
          <button
            onClick={() => {
              resetForm();
              setShowForm(true);
            }}
            className="px-4 py-2 bg-rose-900 text-white rounded-lg hover:bg-rose-950 text-sm"
          >
            New Project
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto p-4 md:p-6">
        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 mb-6">
          <div className="bg-slate-800 rounded-lg p-3 text-center">
            <p className="text-2xl font-bold text-amber-400">{wipCount}</p>
            <p className="text-xs text-slate-400">In Progress</p>
          </div>
          <div className="bg-slate-800 rounded-lg p-3 text-center">
            <p className="text-2xl font-bold text-emerald-400">{finishedCount}</p>
            <p className="text-xs text-slate-400">Finished</p>
          </div>
        </div>

        {/* Form */}
        {showForm && (
          <div className="mb-6 p-4 bg-slate-800 rounded-xl border border-slate-700 space-y-3">
            <h3 className="font-medium text-white">
              {editingId ? "Edit Project" : "New Finishing Project"}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <select
                value={form.designId}
                onChange={(e) => setForm({ ...form, designId: e.target.value })}
                className="px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm"
              >
                <option value="">Select design *</option>
                {designs.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              <input
                type="text"
                placeholder="Who is stitching this? *"
                value={form.person}
                onChange={(e) => setForm({ ...form, person: e.target.value })}
                list="people-list"
                className="px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm"
              />
              <datalist id="people-list">
                {people.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                className="px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm"
              >
                <option value="wip">WIP</option>
                <option value="finished">Finished</option>
              </select>
              <select
                value={form.productType}
                onChange={(e) => setForm({ ...form, productType: e.target.value })}
                className="px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm"
              >
                <option value="">Made into... (optional)</option>
                {PRODUCT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
                <option value="__custom__">Other...</option>
              </select>
              {form.productType === "__custom__" && (
                <input
                  type="text"
                  placeholder="Custom product type"
                  value={form.customProductType}
                  onChange={(e) => setForm({ ...form, customProductType: e.target.value })}
                  className="px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm"
                />
              )}
              <div>
                <label className="block text-xs text-slate-400 mb-1">Started</label>
                <input
                  type="date"
                  value={form.startedAt}
                  onChange={(e) => setForm({ ...form, startedAt: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm"
                />
              </div>
              {form.status === "finished" && (
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Finished</label>
                  <input
                    type="date"
                    value={form.finishedAt}
                    onChange={(e) => setForm({ ...form, finishedAt: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm"
                  />
                </div>
              )}
            </div>
            <input
              type="text"
              placeholder="Notes (optional)"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm"
            />
            <div className="flex gap-2">
              <button
                onClick={handleSubmit}
                disabled={!form.designId || !form.person}
                className="px-4 py-2 bg-rose-900 text-white rounded-lg text-sm hover:bg-rose-950 disabled:opacity-50"
              >
                {editingId ? "Save" : "Add Project"}
              </button>
              <button
                onClick={resetForm}
                className="px-4 py-2 bg-slate-700 text-slate-300 rounded-lg text-sm hover:bg-slate-600"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Status filters */}
        <div className="flex gap-2 mb-4">
          {(["all", "wip", "finished"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                statusFilter === s
                  ? "bg-rose-900 text-white"
                  : "bg-slate-800 text-slate-400 hover:text-white"
              }`}
            >
              {s === "all" ? `All (${projects.length})` : s === "wip" ? `WIP (${wipCount})` : `Finished (${finishedCount})`}
            </button>
          ))}
        </div>

        {/* Projects list */}
        {isLoading ? (
          <div className="text-center py-12 text-slate-500">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-slate-500">
            {projects.length === 0
              ? "No finishing projects yet. Start one above!"
              : "No projects match this filter."}
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((project) => (
              <div
                key={project.id}
                className="bg-slate-800 rounded-lg border border-slate-700 p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    {/* Design thumbnail */}
                    {project.design.previewImageUrl ? (
                      <img
                        src={project.design.previewImageUrl}
                        alt=""
                        className="w-12 h-12 rounded object-cover flex-shrink-0"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded bg-slate-700 flex-shrink-0" />
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link
                          href={`/design/${project.design.id}/kit`}
                          className="text-sm font-medium text-white hover:text-rose-400"
                        >
                          {project.design.name}
                        </Link>
                        <StatusBadge status={project.status} />
                        {project.productType && (
                          <span className="text-xs px-2 py-0.5 rounded bg-purple-500/20 text-purple-400">
                            {project.productType}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {project.person} &middot;{" "}
                        {project.status === "finished"
                          ? `${elapsedTime(project.startedAt, project.finishedAt)} to complete`
                          : `${elapsedTime(project.startedAt, null)} so far`}
                        {" "}&middot; Started{" "}
                        {new Date(project.startedAt).toLocaleDateString()}
                        {project.finishedAt &&
                          ` · Finished ${new Date(project.finishedAt).toLocaleDateString()}`}
                      </p>
                      {project.notes && (
                        <p className="text-xs text-slate-500 mt-0.5 italic">{project.notes}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {project.status === "wip" && (
                      <button
                        onClick={() => markFinished(project)}
                        className="text-xs px-2 py-1 bg-emerald-900/30 text-emerald-400 rounded hover:bg-emerald-900/50"
                      >
                        Mark Finished
                      </button>
                    )}
                    <button
                      onClick={() => editProject(project)}
                      className="text-xs text-slate-400 hover:text-white"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => deleteProject(project.id)}
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
      </main>
    </div>
  );
}
