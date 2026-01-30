"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import NewDesignDialog from "@/components/NewDesignDialog";
import { exportStitchGuidePdf } from "@/lib/pdf-export";
import { getDmcColorByNumber } from "@/lib/dmc-pearl-cotton";
import pako from "pako";

interface Tag {
  id: string;
  name: string;
  color: string;
}

interface Folder {
  id: string;
  name: string;
}

interface Design {
  id: string;
  name: string;
  widthInches: number;
  heightInches: number;
  meshCount: number;
  gridWidth: number;
  gridHeight: number;
  previewImageUrl: string | null;
  folder: Folder | null;
  tags: Tag[];
  kitsReady: number;
  canvasPrinted: number;
  kitColorCount: number;
  kitSkeinCount: number;
  colorsUsed: string | null;
  isDraft: boolean;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// Calculate days remaining before permanent deletion
function getDaysUntilPermanentDelete(deletedAt: string): number {
  const deletedDate = new Date(deletedAt);
  const expiryDate = new Date(deletedDate.getTime() + 14 * 24 * 60 * 60 * 1000);
  const now = new Date();
  const daysRemaining = Math.ceil((expiryDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
  return Math.max(0, daysRemaining);
}

interface InventoryItem {
  dmcNumber: string;
  skeins: number;
}

export default function HomePage() {
  const router = useRouter();
  const [designs, setDesigns] = useState<Design[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [showNewFolderInput, setShowNewFolderInput] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [movingDesignId, setMovingDesignId] = useState<string | null>(null);
  const [showNewDesignDialog, setShowNewDesignDialog] = useState(false);
  const [showTrash, setShowTrash] = useState(false);
  const [trashCount, setTrashCount] = useState(0);
  const [inventoryBySize, setInventoryBySize] = useState<{ size5: Set<string>; size8: Set<string> }>({
    size5: new Set(),
    size8: new Set(),
  });
  const [exportingDesignId, setExportingDesignId] = useState<string | null>(null);

  useEffect(() => {
    fetchDesigns();
    fetchFolders();
    fetchTags();
    fetchInventory();
    fetchTrashCount();
  }, [selectedFolder, selectedTag, searchQuery, showTrash]);

  const fetchInventory = async () => {
    try {
      // Fetch inventory for both thread sizes
      const [res5, res8] = await Promise.all([
        fetch("/api/inventory?size=5"),
        fetch("/api/inventory?size=8"),
      ]);

      if (res5.ok && res8.ok) {
        const data5: InventoryItem[] = await res5.json();
        const data8: InventoryItem[] = await res8.json();

        setInventoryBySize({
          size5: new Set(data5.filter(i => i.skeins > 0).map(i => i.dmcNumber)),
          size8: new Set(data8.filter(i => i.skeins > 0).map(i => i.dmcNumber)),
        });
      }
    } catch (error) {
      console.error("Error fetching inventory:", error);
    }
  };

  // Check if a design has colors not in inventory
  const getMissingColors = (design: Design): string[] => {
    if (!design.colorsUsed) return [];

    try {
      const colors: string[] = JSON.parse(design.colorsUsed);
      const inStock = design.meshCount === 14 ? inventoryBySize.size5 : inventoryBySize.size8;
      return colors.filter(c => !inStock.has(c));
    } catch {
      return [];
    }
  };

  const fetchDesigns = async () => {
    try {
      const params = new URLSearchParams();
      if (showTrash) {
        params.set("deleted", "true");
      } else {
        if (selectedFolder !== null) params.set("folderId", selectedFolder || "null");
        if (selectedTag) params.set("tagId", selectedTag);
      }
      if (searchQuery) params.set("search", searchQuery);

      const response = await fetch(`/api/designs?${params.toString()}`);
      if (response.ok) {
        const data = await response.json();
        setDesigns(data);
      }
    } catch (error) {
      console.error("Error fetching designs:", error);
    }
    setLoading(false);
  };

  const fetchTrashCount = async () => {
    try {
      const response = await fetch("/api/designs?deleted=true");
      if (response.ok) {
        const data = await response.json();
        setTrashCount(data.length);
      }
    } catch (error) {
      console.error("Error fetching trash count:", error);
    }
  };

  const fetchFolders = async () => {
    try {
      const response = await fetch("/api/folders");
      if (response.ok) {
        const data = await response.json();
        setFolders(data);
      }
    } catch (error) {
      console.error("Error fetching folders:", error);
    }
  };

  const fetchTags = async () => {
    try {
      const response = await fetch("/api/tags");
      if (response.ok) {
        const data = await response.json();
        setTags(data);
      }
    } catch (error) {
      console.error("Error fetching tags:", error);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Move this design to trash? It will be permanently deleted after 14 days.")) return;

    try {
      const response = await fetch(`/api/designs/${id}`, { method: "DELETE" });
      if (response.ok) {
        setDesigns(designs.filter((d) => d.id !== id));
        fetchTrashCount();
      }
    } catch (error) {
      console.error("Error deleting design:", error);
    }
  };

  const handleRestore = async (id: string) => {
    try {
      const response = await fetch(`/api/designs/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restore: true }),
      });
      if (response.ok) {
        setDesigns(designs.filter((d) => d.id !== id));
        fetchTrashCount();
      }
    } catch (error) {
      console.error("Error restoring design:", error);
    }
  };

  const handlePermanentDelete = async (id: string) => {
    if (!confirm("Permanently delete this design? This cannot be undone.")) return;

    try {
      const response = await fetch(`/api/designs/${id}?permanent=true`, { method: "DELETE" });
      if (response.ok) {
        setDesigns(designs.filter((d) => d.id !== id));
        fetchTrashCount();
      }
    } catch (error) {
      console.error("Error permanently deleting design:", error);
    }
  };

  const handleEmptyTrash = async () => {
    if (!confirm(`Permanently delete all ${trashCount} items in trash? This cannot be undone.`)) return;

    try {
      // Delete each item permanently
      for (const design of designs) {
        await fetch(`/api/designs/${design.id}?permanent=true`, { method: "DELETE" });
      }
      setDesigns([]);
      setTrashCount(0);
    } catch (error) {
      console.error("Error emptying trash:", error);
    }
  };

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;

    try {
      const response = await fetch("/api/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newFolderName.trim() }),
      });

      if (response.ok) {
        const newFolder = await response.json();
        setFolders([...folders, newFolder]);
        setNewFolderName("");
        setShowNewFolderInput(false);
      }
    } catch (error) {
      console.error("Error creating folder:", error);
    }
  };

  const handleMoveToFolder = async (designId: string, folderId: string | null) => {
    try {
      const response = await fetch(`/api/designs/${designId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderId }),
      });

      if (response.ok) {
        setDesigns(designs.map(d =>
          d.id === designId
            ? { ...d, folder: folderId ? folders.find(f => f.id === folderId) || null : null }
            : d
        ));
        setMovingDesignId(null);
        // Refresh to update counts
        fetchDesigns();
      }
    } catch (error) {
      console.error("Error moving design:", error);
    }
  };

  const handleDeleteFolder = async (folderId: string) => {
    if (!confirm("Delete this folder? Designs will be moved to Unfiled.")) return;

    try {
      const response = await fetch(`/api/folders/${folderId}`, { method: "DELETE" });
      if (response.ok) {
        setFolders(folders.filter(f => f.id !== folderId));
        if (selectedFolder === folderId) {
          setSelectedFolder(null);
        }
        fetchDesigns();
      }
    } catch (error) {
      console.error("Error deleting folder:", error);
    }
  };

  const handleUpdateCanvasPrinted = async (designId: string, delta: number) => {
    try {
      const response = await fetch(`/api/designs/${designId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ canvasPrintedDelta: delta }),
      });
      if (response.ok) {
        setDesigns(designs.map(d =>
          d.id === designId
            ? { ...d, canvasPrinted: Math.max(0, d.canvasPrinted + delta) }
            : d
        ));
      }
    } catch (error) {
      console.error("Error updating canvas count:", error);
    }
  };

  const handleDuplicate = async (designId: string) => {
    try {
      const response = await fetch(`/api/designs/${designId}/duplicate`, {
        method: "POST",
      });

      if (response.ok) {
        const newDesign = await response.json();
        // Refresh designs list
        fetchDesigns();
      }
    } catch (error) {
      console.error("Error duplicating design:", error);
    }
  };

  const handleExportStitchGuide = async (design: Design) => {
    setExportingDesignId(design.id);
    try {
      // Fetch full design data with pixelData
      const response = await fetch(`/api/designs/${design.id}`);
      if (!response.ok) {
        throw new Error("Failed to fetch design");
      }
      const fullDesign = await response.json();

      if (!fullDesign.pixelData) {
        alert("No pixel data available for this design.");
        return;
      }

      // Decompress pixel data
      const compressed = Uint8Array.from(atob(fullDesign.pixelData), c => c.charCodeAt(0));
      const decompressed = pako.inflate(compressed, { to: "string" });
      const grid: (string | null)[][] = JSON.parse(decompressed);

      // Get used colors from the grid
      const colorSet = new Set<string>();
      for (const row of grid) {
        for (const cell of row) {
          if (cell) colorSet.add(cell);
        }
      }
      const usedColors = Array.from(colorSet)
        .map(dmcNumber => getDmcColorByNumber(dmcNumber))
        .filter((c): c is NonNullable<typeof c> => c !== null);

      // Generate PDF
      const doc = exportStitchGuidePdf({
        grid,
        widthInches: design.widthInches,
        heightInches: design.heightInches,
        meshCount: design.meshCount,
        designName: design.name,
        usedColors,
        fitToOnePage: false,
      });

      doc.save(`${design.name.replace(/\s+/g, "_")}_stitch_guide.pdf`);
    } catch (error) {
      console.error("Error exporting stitch guide:", error);
      alert("Failed to export stitch guide. Please try again.");
    } finally {
      setExportingDesignId(null);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900">
      {/* Header */}
      <header className="bg-slate-800 border-b border-slate-700 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-3 md:px-4 py-3 md:py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 md:gap-3 min-w-0">
            <div className="w-9 h-9 md:w-10 md:h-10 bg-gradient-to-br from-rose-900 to-rose-800 rounded-xl flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 md:w-6 md:h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
              </svg>
            </div>
            <div className="min-w-0">
              <h1 className="text-lg md:text-xl font-bold text-white truncate">Modern Mesh</h1>
              <p className="text-xs md:text-sm text-slate-400 hidden sm:block">Image Creator</p>
            </div>
          </div>

          <div className="flex items-center gap-2 md:gap-4">
            <Link
              href="/inventory"
              className="px-3 md:px-4 py-2 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600 transition-all flex items-center gap-2 text-sm md:text-base"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
              <span className="hidden sm:inline">Inventory</span>
            </Link>
            <button
              onClick={() => setShowNewDesignDialog(true)}
              className="px-3 md:px-4 py-2 bg-gradient-to-r from-rose-900 to-rose-800 text-white rounded-lg hover:from-rose-950 hover:to-rose-900 transition-all flex items-center gap-2 text-sm md:text-base"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              <span className="hidden sm:inline">New Design</span>
            </button>
            <button
              onClick={handleLogout}
              className="p-2 text-slate-400 hover:text-white"
              title="Logout"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-3 md:px-4 py-4 md:py-6">
        {/* Mobile Search and Filter Toggle */}
        <div className="mb-4 md:hidden">
          <div className="flex gap-2">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search designs..."
              className="flex-1 px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-800"
            />
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`px-4 py-2.5 rounded-lg border transition-colors ${
                showFilters
                  ? "bg-rose-900 border-rose-900 text-white"
                  : "bg-slate-800 border-slate-700 text-slate-300"
              }`}
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
              </svg>
            </button>
          </div>

          {/* Mobile Filters Dropdown */}
          {showFilters && (
            <div className="mt-3 p-4 bg-slate-800 rounded-lg border border-slate-700 space-y-4">
              {/* Folders */}
              <div>
                <h3 className="text-sm font-medium text-slate-400 mb-2 uppercase tracking-wider">
                  Folders
                </h3>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setSelectedFolder(null)}
                    className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                      selectedFolder === null
                        ? "bg-rose-900 text-white"
                        : "bg-slate-700 text-slate-300"
                    }`}
                  >
                    All
                  </button>
                  <button
                    onClick={() => setSelectedFolder("")}
                    className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                      selectedFolder === ""
                        ? "bg-rose-900 text-white"
                        : "bg-slate-700 text-slate-300"
                    }`}
                  >
                    Unfiled
                  </button>
                  {folders.map((folder) => (
                    <button
                      key={folder.id}
                      onClick={() => setSelectedFolder(folder.id)}
                      className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                        selectedFolder === folder.id
                          ? "bg-rose-900 text-white"
                          : "bg-slate-700 text-slate-300"
                      }`}
                    >
                      {folder.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Tags */}
              {tags.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-slate-400 mb-2 uppercase tracking-wider">
                    Tags
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {tags.map((tag) => (
                      <button
                        key={tag.id}
                        onClick={() => setSelectedTag(selectedTag === tag.id ? null : tag.id)}
                        className={`px-3 py-1 rounded-full text-sm text-white transition-colors ${
                          selectedTag === tag.id ? "ring-2 ring-white" : "opacity-80"
                        }`}
                        style={{ backgroundColor: tag.color }}
                      >
                        {tag.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex gap-6">
          {/* Sidebar - hidden on mobile */}
          <aside className="hidden md:block w-64 flex-shrink-0">
            {/* Search */}
            <div className="mb-6">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search designs..."
                className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-800"
              />
            </div>

            {/* Folders */}
            <div className="mb-6">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wider">
                  Folders
                </h3>
                <button
                  onClick={() => setShowNewFolderInput(!showNewFolderInput)}
                  className="text-slate-400 hover:text-white p-1"
                  title="New Folder"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                </button>
              </div>

              {/* New folder input */}
              {showNewFolderInput && (
                <div className="mb-2 flex gap-2">
                  <input
                    type="text"
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleCreateFolder()}
                    placeholder="Folder name..."
                    className="flex-1 px-3 py-1.5 bg-slate-700 border border-slate-600 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-rose-800"
                    autoFocus
                  />
                  <button
                    onClick={handleCreateFolder}
                    className="px-3 py-1.5 bg-rose-900 text-white text-sm rounded hover:bg-rose-950"
                  >
                    Add
                  </button>
                </div>
              )}

              <div className="space-y-1">
                <button
                  onClick={() => { setSelectedFolder(null); setShowTrash(false); }}
                  className={`w-full text-left px-3 py-2 rounded-lg transition-colors ${
                    selectedFolder === null && !showTrash
                      ? "bg-rose-900/20 text-rose-400"
                      : "text-slate-300 hover:bg-slate-800"
                  }`}
                >
                  All Designs
                </button>
                <button
                  onClick={() => { setSelectedFolder(""); setShowTrash(false); }}
                  className={`w-full text-left px-3 py-2 rounded-lg transition-colors ${
                    selectedFolder === "" && !showTrash
                      ? "bg-rose-900/20 text-rose-400"
                      : "text-slate-300 hover:bg-slate-800"
                  }`}
                >
                  Unfiled
                </button>
                {folders.map((folder) => (
                  <div key={folder.id} className="group flex items-center">
                    <button
                      onClick={() => { setSelectedFolder(folder.id); setShowTrash(false); }}
                      className={`flex-1 text-left px-3 py-2 rounded-lg transition-colors ${
                        selectedFolder === folder.id && !showTrash
                          ? "bg-rose-900/20 text-rose-400"
                          : "text-slate-300 hover:bg-slate-800"
                      }`}
                    >
                      📁 {folder.name}
                    </button>
                    <button
                      onClick={() => handleDeleteFolder(folder.id)}
                      className="p-1 text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Delete folder"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                ))}

                {/* Trash */}
                <div className="pt-2 mt-2 border-t border-slate-700">
                  <button
                    onClick={() => { setShowTrash(true); setSelectedFolder(null); setSelectedTag(null); }}
                    className={`w-full text-left px-3 py-2 rounded-lg transition-colors flex items-center justify-between ${
                      showTrash
                        ? "bg-rose-900/20 text-rose-400"
                        : "text-slate-300 hover:bg-slate-800"
                    }`}
                  >
                    <span>🗑️ Trash</span>
                    {trashCount > 0 && (
                      <span className="text-xs bg-slate-600 text-slate-300 px-2 py-0.5 rounded-full">
                        {trashCount}
                      </span>
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* Tags */}
            <div>
              <h3 className="text-sm font-medium text-slate-400 mb-3 uppercase tracking-wider">
                Tags
              </h3>
              <div className="flex flex-wrap gap-2">
                {tags.map((tag) => (
                  <button
                    key={tag.id}
                    onClick={() => setSelectedTag(selectedTag === tag.id ? null : tag.id)}
                    className={`px-3 py-1 rounded-full text-sm text-white transition-colors ${
                      selectedTag === tag.id
                        ? "ring-2 ring-white"
                        : "opacity-80 hover:opacity-100"
                    }`}
                    style={{ backgroundColor: tag.color }}
                  >
                    {tag.name}
                  </button>
                ))}
                {tags.length === 0 && (
                  <p className="text-slate-500 text-sm">No tags yet</p>
                )}
              </div>
            </div>
          </aside>

          {/* Main content */}
          <main className="flex-1 min-w-0">
            {/* Trash header */}
            {showTrash && (
              <div className="flex items-center justify-between mb-4 pb-4 border-b border-slate-700">
                <div>
                  <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                    🗑️ Trash
                  </h2>
                  <p className="text-sm text-slate-400">
                    Items are permanently deleted after 14 days
                  </p>
                </div>
                {designs.length > 0 && (
                  <button
                    onClick={handleEmptyTrash}
                    className="px-3 py-1.5 bg-red-900/50 text-red-400 rounded-lg hover:bg-red-900 text-sm font-medium transition-colors"
                  >
                    Empty Trash
                  </button>
                )}
              </div>
            )}

            {loading ? (
              <div className="flex items-center justify-center h-64">
                <div className="text-white flex items-center gap-3">
                  <svg className="animate-spin h-6 w-6" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Loading designs...
                </div>
              </div>
            ) : designs.length === 0 ? (
              <div className="text-center py-12 md:py-16">
                <div className="w-14 h-14 md:w-16 md:h-16 bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-7 h-7 md:w-8 md:h-8 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    {showTrash ? (
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    ) : (
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                    )}
                  </svg>
                </div>
                <h2 className="text-lg md:text-xl font-semibold text-white mb-2">
                  {showTrash ? "Trash is empty" : "No designs yet"}
                </h2>
                <p className="text-slate-400 mb-6 text-sm md:text-base px-4">
                  {showTrash
                    ? "Deleted designs will appear here for 14 days before being permanently removed."
                    : "Create your first needlepoint design to get started."}
                </p>
                {!showTrash && (
                  <button
                    onClick={() => setShowNewDesignDialog(true)}
                    className="inline-flex items-center gap-2 px-5 md:px-6 py-2.5 md:py-3 bg-gradient-to-r from-rose-900 to-rose-800 text-white rounded-lg hover:from-rose-950 hover:to-rose-900 transition-all text-sm md:text-base"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Create New Design
                  </button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 md:gap-6">
                {designs.map((design) => (
                  <div
                    key={design.id}
                    className="bg-slate-800 rounded-xl overflow-hidden border border-slate-700 hover:border-rose-800/50 transition-colors group"
                  >
                    {/* Preview */}
                    <Link href={`/design/${design.id}`} className="block aspect-square relative bg-slate-900">
                      {design.previewImageUrl ? (
                        <img
                          src={design.previewImageUrl}
                          alt={design.name}
                          className="w-full h-full object-contain"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-slate-600">
                          <svg className="w-12 h-12 md:w-16 md:h-16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
                          </svg>
                        </div>
                      )}
                      {/* Draft badge */}
                      {design.isDraft && (
                        <div className="absolute top-2 left-2 pointer-events-none">
                          <span className="bg-slate-600/90 text-slate-200 text-xs font-semibold px-2 py-0.5 rounded">
                            DRAFT
                          </span>
                        </div>
                      )}
                      {/* Needs order badge - only show for non-draft designs with missing colors */}
                      {!design.isDraft && getMissingColors(design).length > 0 && (
                        <div className="absolute top-2 right-2 pointer-events-none">
                          <span
                            className="bg-red-600/90 text-white text-xs font-semibold px-2 py-0.5 rounded flex items-center gap-1"
                            title={`Missing: ${getMissingColors(design).join(", ")}`}
                          >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                            Order
                          </span>
                        </div>
                      )}
                    </Link>

                    {/* Info */}
                    <div className="p-3 md:p-4">
                      <Link href={`/design/${design.id}`}>
                        <h3 className="font-semibold text-white mb-1 group-hover:text-rose-400 transition-colors text-sm md:text-base truncate">
                          {design.name}
                        </h3>
                      </Link>
                      <p className="text-xs md:text-sm text-slate-400 mb-2 md:mb-3">
                        {design.widthInches}&quot; x {design.heightInches}&quot; @ {design.meshCount} mesh
                      </p>

                      {/* Tags */}
                      {design.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-2 md:mb-3">
                          {design.tags.map((tag) => (
                            <span
                              key={tag.id}
                              className="px-2 py-0.5 rounded-full text-xs text-white"
                              style={{ backgroundColor: tag.color }}
                            >
                              {tag.name}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Folder indicator */}
                      {design.folder && (
                        <p className="text-xs text-slate-500 mb-2">
                          📁 {design.folder.name}
                        </p>
                      )}

                      {/* Kit summary + tracking counters */}
                      <div className="flex flex-wrap items-center gap-2 mb-2 text-xs">
                        {design.kitColorCount > 0 && (
                          <span className="text-slate-400">
                            {design.kitColorCount} colors &middot; {design.kitSkeinCount} skeins
                          </span>
                        )}
                        <span className="px-1.5 py-0.5 bg-blue-900/40 text-blue-400 rounded flex items-center gap-1">
                          <button
                            onClick={() => handleUpdateCanvasPrinted(design.id, -1)}
                            disabled={design.canvasPrinted <= 0}
                            className="hover:text-blue-200 disabled:opacity-30"
                          >-</button>
                          {design.canvasPrinted} printed
                          <button
                            onClick={() => handleUpdateCanvasPrinted(design.id, 1)}
                            className="hover:text-blue-200"
                          >+</button>
                        </span>
                        <span className="px-1.5 py-0.5 bg-emerald-900/40 text-emerald-400 rounded">
                          {design.kitsReady} kits ready
                        </span>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center justify-between">
                        {showTrash && design.deletedAt ? (
                          <>
                            <span className="text-xs text-red-400">
                              {getDaysUntilPermanentDelete(design.deletedAt)} days left
                            </span>
                            <div className="flex items-center gap-1">
                              {/* Restore */}
                              <button
                                onClick={() => handleRestore(design.id)}
                                className="p-1.5 text-slate-500 hover:text-green-400 transition-colors"
                                title="Restore"
                              >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                                </svg>
                              </button>
                              {/* Permanent Delete */}
                              <button
                                onClick={() => handlePermanentDelete(design.id)}
                                className="p-1.5 text-slate-500 hover:text-red-400 transition-colors"
                                title="Delete permanently"
                              >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                              </button>
                            </div>
                          </>
                        ) : (
                          <>
                            <span className="text-xs text-slate-500">
                              {new Date(design.updatedAt).toLocaleDateString()}
                            </span>
                            <div className="flex items-center gap-1">
                              {/* Move to folder */}
                              <div className="relative">
                                <button
                                  onClick={() => setMovingDesignId(movingDesignId === design.id ? null : design.id)}
                                  className="p-1.5 text-slate-500 hover:text-white transition-colors"
                                  title="Move to folder"
                                >
                                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                                  </svg>
                                </button>
                                {movingDesignId === design.id && (
                                  <div className="absolute right-0 bottom-full mb-1 w-40 bg-slate-700 rounded-lg shadow-lg border border-slate-600 py-1 z-10">
                                    <button
                                      onClick={() => handleMoveToFolder(design.id, null)}
                                      className={`w-full text-left px-3 py-1.5 text-sm hover:bg-slate-600 ${!design.folder ? 'text-rose-400' : 'text-slate-300'}`}
                                    >
                                      Unfiled
                                    </button>
                                    {folders.map((folder) => (
                                      <button
                                        key={folder.id}
                                        onClick={() => handleMoveToFolder(design.id, folder.id)}
                                        className={`w-full text-left px-3 py-1.5 text-sm hover:bg-slate-600 ${design.folder?.id === folder.id ? 'text-rose-400' : 'text-slate-300'}`}
                                      >
                                        📁 {folder.name}
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                              {/* Kit */}
                              <Link
                                href={`/design/${design.id}/kit`}
                                className="p-1.5 text-slate-500 hover:text-emerald-400 transition-colors"
                                title="Kit"
                              >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                                </svg>
                              </Link>
                              {/* Export Stitch Guide */}
                              <button
                                onClick={() => handleExportStitchGuide(design)}
                                disabled={exportingDesignId === design.id}
                                className="p-1.5 text-slate-500 hover:text-rose-400 transition-colors disabled:opacity-50"
                                title="Export Stitch Guide"
                              >
                                {exportingDesignId === design.id ? (
                                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                  </svg>
                                ) : (
                                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                  </svg>
                                )}
                              </button>
                              {/* Duplicate */}
                              <button
                                onClick={() => handleDuplicate(design.id)}
                                className="p-1.5 text-slate-500 hover:text-blue-400 transition-colors"
                                title="Duplicate"
                              >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                </svg>
                              </button>
                              {/* Delete */}
                              <button
                                onClick={() => handleDelete(design.id)}
                                className="p-1.5 text-slate-500 hover:text-red-400 transition-colors"
                                title="Delete"
                              >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </main>
        </div>
      </div>

      {/* New Design Dialog */}
      {showNewDesignDialog && (
        <NewDesignDialog
          onClose={() => setShowNewDesignDialog(false)}
          folderId={selectedFolder}
        />
      )}
    </div>
  );
}
