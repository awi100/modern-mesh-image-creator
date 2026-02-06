"use client";

import React, { useState, useMemo, useCallback, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR, { mutate } from "swr";
import NewDesignDialog from "@/components/NewDesignDialog";
import BatchActionBar from "@/components/BatchActionBar";
import ColorSwapDialog from "@/components/ColorSwapDialog";
import { exportStitchGuideImage } from "@/lib/pdf-export";
import { getDmcColorByNumber } from "@/lib/dmc-pearl-cotton";

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
  skillLevel: string | null;
  sizeCategory: string | null;
  totalStitches: number;
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

// Build the designs API URL based on filters
function buildDesignsUrl(
  showTrash: boolean,
  selectedFolder: string | null,
  selectedTag: string | null,
  searchQuery: string,
  skillLevel: string | null,
  sizeCategory: string | null
): string {
  const params = new URLSearchParams();
  if (showTrash) {
    params.set("deleted", "true");
  } else {
    if (selectedFolder !== null) params.set("folderId", selectedFolder || "null");
    if (selectedTag) params.set("tagId", selectedTag);
    if (skillLevel) params.set("skillLevel", skillLevel);
    if (sizeCategory) params.set("sizeCategory", sizeCategory);
  }
  if (searchQuery) params.set("search", searchQuery);
  return `/api/designs?${params.toString()}`;
}

export default function HomePage() {
  const router = useRouter();

  // Filter state
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showTrash, setShowTrash] = useState(false);
  const [selectedSkillLevel, setSelectedSkillLevel] = useState<string | null>(null);
  const [selectedSizeCategory, setSelectedSizeCategory] = useState<string | null>(null);

  // UI state
  const [showFilters, setShowFilters] = useState(false);
  const [showNewFolderInput, setShowNewFolderInput] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [movingDesignId, setMovingDesignId] = useState<string | null>(null);
  const [showNewDesignDialog, setShowNewDesignDialog] = useState(false);
  const [exportingDesignId, setExportingDesignId] = useState<string | null>(null);
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editingFolderName, setEditingFolderName] = useState("");
  const [colorSwapDesign, setColorSwapDesign] = useState<{ id: string; name: string } | null>(null);

  // Selection mode state
  const [selectedDesigns, setSelectedDesigns] = useState<Set<string>>(new Set());
  const [isSelectionMode, setIsSelectionMode] = useState(false);

  // SWR for static data (cached, doesn't refetch on filter changes)
  const { data: folders = [] } = useSWR<Folder[]>("/api/folders", {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  });

  const { data: tags = [] } = useSWR<Tag[]>("/api/tags", {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  });

  const { data: inventory5 = [] } = useSWR<InventoryItem[]>("/api/inventory?size=5", {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  });

  const { data: inventory8 = [] } = useSWR<InventoryItem[]>("/api/inventory?size=8", {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  });

  const { data: trashData = [] } = useSWR<Design[]>("/api/designs?deleted=true", {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  });
  const trashCount = trashData.length;

  // Memoize inventory sets to avoid recreating on every render
  const inventoryBySize = useMemo(() => ({
    size5: new Set(inventory5.filter(i => i.skeins > 0).map(i => i.dmcNumber)),
    size8: new Set(inventory8.filter(i => i.skeins > 0).map(i => i.dmcNumber)),
  }), [inventory5, inventory8]);

  // SWR for designs (refetches when filters change via key)
  const designsUrl = buildDesignsUrl(showTrash, selectedFolder, selectedTag, searchQuery, selectedSkillLevel, selectedSizeCategory);
  const { data: designs = [], isLoading: loading, mutate: mutateDesigns } = useSWR<Design[]>(
    designsUrl,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      keepPreviousData: true,
    }
  );

  // Check if a design has colors not in inventory
  const getMissingColors = useCallback((design: Design): string[] => {
    if (!design.colorsUsed) return [];

    try {
      const colors: string[] = JSON.parse(design.colorsUsed);
      const inStock = design.meshCount === 14 ? inventoryBySize.size5 : inventoryBySize.size8;
      return colors.filter(c => !inStock.has(c));
    } catch {
      return [];
    }
  }, [inventoryBySize]);

  const handleDelete = async (id: string) => {
    if (!confirm("Move this design to trash? It will be permanently deleted after 14 days.")) return;

    try {
      const response = await fetch(`/api/designs/${id}`, { method: "DELETE" });
      if (response.ok) {
        // Optimistically update current view
        mutateDesigns(designs.filter((d) => d.id !== id), false);
        // Revalidate trash count
        mutate("/api/designs?deleted=true");
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
        // Optimistically update current view
        mutateDesigns(designs.filter((d) => d.id !== id), false);
        // Revalidate trash count
        mutate("/api/designs?deleted=true");
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
        // Optimistically update current view
        mutateDesigns(designs.filter((d) => d.id !== id), false);
        // Revalidate trash count
        mutate("/api/designs?deleted=true");
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
      // Clear current view and revalidate trash
      mutateDesigns([], false);
      mutate("/api/designs?deleted=true");
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
        // Revalidate folders cache
        mutate("/api/folders");
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
        // Optimistically update the design in current view
        mutateDesigns(
          designs.map(d =>
            d.id === designId
              ? { ...d, folder: folderId ? folders.find(f => f.id === folderId) || null : null }
              : d
          ),
          false
        );
        setMovingDesignId(null);
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
        // Revalidate folders cache
        mutate("/api/folders");
        if (selectedFolder === folderId) {
          setSelectedFolder(null);
        }
        // Revalidate designs since they may have moved to unfiled
        mutateDesigns();
      }
    } catch (error) {
      console.error("Error deleting folder:", error);
    }
  };

  const handleRenameFolder = async (folderId: string) => {
    if (!editingFolderName.trim()) {
      setEditingFolderId(null);
      return;
    }

    try {
      const response = await fetch(`/api/folders/${folderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editingFolderName.trim() }),
      });

      if (response.ok) {
        // Revalidate folders cache
        mutate("/api/folders");
      }
    } catch (error) {
      console.error("Error renaming folder:", error);
    }
    setEditingFolderId(null);
    setEditingFolderName("");
  };

  const startEditingFolder = (folder: Folder) => {
    setEditingFolderId(folder.id);
    setEditingFolderName(folder.name);
  };

  const handleUpdateCanvasPrinted = async (designId: string, delta: number) => {
    try {
      const response = await fetch(`/api/designs/${designId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ canvasPrintedDelta: delta }),
      });
      if (response.ok) {
        // Optimistically update
        mutateDesigns(
          designs.map(d =>
            d.id === designId
              ? { ...d, canvasPrinted: Math.max(0, d.canvasPrinted + delta) }
              : d
          ),
          false
        );
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
        // Revalidate designs list
        mutateDesigns();
      }
    } catch (error) {
      console.error("Error duplicating design:", error);
    }
  };

  const handleUpdateDesignField = async (designId: string, field: "skillLevel" | "sizeCategory", value: string | null) => {
    try {
      const response = await fetch(`/api/designs/${designId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
      if (response.ok) {
        // Optimistically update
        mutateDesigns(
          designs.map(d =>
            d.id === designId ? { ...d, [field]: value } : d
          ),
          false
        );
      }
    } catch (error) {
      console.error("Error updating design:", error);
    }
  };

  const handleExportStitchGuide = async (design: Design) => {
    setExportingDesignId(design.id);
    try {
      // Fetch full design data with grid
      const response = await fetch(`/api/designs/${design.id}`);
      if (!response.ok) {
        throw new Error("Failed to fetch design");
      }
      const fullDesign = await response.json();

      if (!fullDesign.grid || fullDesign.grid.length === 0) {
        alert("No pixel data available for this design.");
        return;
      }

      const grid: (string | null)[][] = fullDesign.grid;

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

      // Generate image
      const dataUrl = exportStitchGuideImage({
        grid,
        widthInches: design.widthInches,
        heightInches: design.heightInches,
        meshCount: design.meshCount,
        designName: design.name,
        usedColors,
      });

      if (dataUrl) {
        const link = document.createElement("a");
        link.download = `${design.name.replace(/\s+/g, "_")}_stitch_guide.png`;
        link.href = dataUrl;
        link.click();
      }
    } catch (error) {
      console.error("Error exporting stitch guide:", error);
      alert("Failed to export stitch guide. Please try again.");
    } finally {
      setExportingDesignId(null);
    }
  };

  // Selection mode helpers
  const toggleDesignSelection = useCallback((id: string) => {
    setSelectedDesigns(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      // Exit selection mode if no items selected
      if (next.size === 0) {
        setIsSelectionMode(false);
      }
      return next;
    });
  }, []);

  const selectAllDesigns = useCallback(() => {
    setSelectedDesigns(new Set(designs.map(d => d.id)));
  }, [designs]);

  const clearSelection = useCallback(() => {
    setSelectedDesigns(new Set());
    setIsSelectionMode(false);
  }, []);

  const enterSelectionMode = useCallback(() => {
    setIsSelectionMode(true);
  }, []);

  // Escape key to exit selection mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isSelectionMode) {
        clearSelection();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isSelectionMode, clearSelection]);

  // Batch action handlers
  const handleBatchMoveToFolder = async (folderId: string | null) => {
    try {
      const response = await fetch("/api/designs/batch", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          designIds: Array.from(selectedDesigns),
          action: "move",
          payload: { folderId },
        }),
      });

      if (response.ok) {
        // Optimistically update
        const targetFolder = folderId ? folders.find(f => f.id === folderId) || null : null;
        mutateDesigns(
          designs.map(d =>
            selectedDesigns.has(d.id) ? { ...d, folder: targetFolder } : d
          ),
          false
        );
        clearSelection();
      }
    } catch (error) {
      console.error("Batch move error:", error);
      alert("Failed to move designs. Please try again.");
    }
  };

  const handleBatchAddTags = async (tagIds: string[]) => {
    try {
      const response = await fetch("/api/designs/batch", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          designIds: Array.from(selectedDesigns),
          action: "addTags",
          payload: { tagIds },
        }),
      });

      if (response.ok) {
        // Optimistically update - add the tag(s) to selected designs
        const newTags = tags.filter(t => tagIds.includes(t.id));
        mutateDesigns(
          designs.map(d =>
            selectedDesigns.has(d.id)
              ? { ...d, tags: [...d.tags.filter(t => !tagIds.includes(t.id)), ...newTags] }
              : d
          ),
          false
        );
        clearSelection();
      }
    } catch (error) {
      console.error("Batch add tags error:", error);
      alert("Failed to add tags. Please try again.");
    }
  };

  const handleBatchRemoveTags = async (tagIds: string[]) => {
    try {
      const response = await fetch("/api/designs/batch", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          designIds: Array.from(selectedDesigns),
          action: "removeTags",
          payload: { tagIds },
        }),
      });

      if (response.ok) {
        // Optimistically update - remove the tag(s) from selected designs
        mutateDesigns(
          designs.map(d =>
            selectedDesigns.has(d.id)
              ? { ...d, tags: d.tags.filter(t => !tagIds.includes(t.id)) }
              : d
          ),
          false
        );
        clearSelection();
      }
    } catch (error) {
      console.error("Batch remove tags error:", error);
      alert("Failed to remove tags. Please try again.");
    }
  };

  const handleBatchDelete = async () => {
    try {
      const response = await fetch("/api/designs/batch", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          designIds: Array.from(selectedDesigns),
          action: "delete",
        }),
      });

      if (response.ok) {
        // Optimistically remove from view
        mutateDesigns(
          designs.filter(d => !selectedDesigns.has(d.id)),
          false
        );
        // Revalidate trash count
        mutate("/api/designs?deleted=true");
        clearSelection();
      }
    } catch (error) {
      console.error("Batch delete error:", error);
      alert("Failed to delete designs. Please try again.");
    }
  };

  const handleBatchExportKits = async () => {
    try {
      const response = await fetch("/api/designs/batch/kits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          designIds: Array.from(selectedDesigns),
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to fetch kit data");
      }

      const data = await response.json();

      // Create a text file with the kit list
      let content = `Combined Kit List - ${data.totals.designCount} Designs\n`;
      content += `${"=".repeat(50)}\n\n`;

      content += `DESIGNS INCLUDED:\n`;
      for (const design of data.designs) {
        content += `  - ${design.name} (${design.meshCount} mesh, ${design.colorCount} colors)\n`;
      }
      content += `\n`;

      content += `TOTALS:\n`;
      content += `  Colors: ${data.totals.colors}\n`;
      content += `  Skeins needed: ${data.totals.skeins}\n`;
      content += `  Bobbin-only colors: ${data.totals.bobbins}\n`;
      content += `  Out of stock: ${data.totals.outOfStockCount}\n`;
      content += `\n`;

      content += `COLOR LIST:\n`;
      content += `${"─".repeat(50)}\n`;
      for (const item of data.kitContents) {
        const stockStatus = item.inStock ? "✓" : "✗";
        const skeinsInfo = item.bobbinYards > 0
          ? `${item.bobbinYards} yd bobbin`
          : `${item.fullSkeins} skein${item.fullSkeins !== 1 ? "s" : ""}`;
        content += `${stockStatus} DMC ${item.dmcNumber.padEnd(6)} ${item.colorName.padEnd(20)} ${skeinsInfo.padEnd(12)} (${item.stitchCount} stitches)\n`;
        content += `   Used in: ${item.usedInDesigns.join(", ")}\n`;
      }

      // Download as text file
      const blob = new Blob([content], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.download = `kit_list_${data.totals.designCount}_designs.txt`;
      link.href = url;
      link.click();
      URL.revokeObjectURL(url);

      clearSelection();
    } catch (error) {
      console.error("Batch export kits error:", error);
      alert("Failed to export kit list. Please try again.");
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
              href="/kits"
              className="px-3 md:px-4 py-2 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600 transition-all flex items-center gap-2 text-sm md:text-base"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
              <span className="hidden sm:inline">Kits</span>
            </Link>
            <Link
              href="/inventory"
              className="px-3 md:px-4 py-2 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600 transition-all flex items-center gap-2 text-sm md:text-base"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
              <span className="hidden sm:inline">Inventory</span>
            </Link>
            {/* Select button - toggle selection mode */}
            {!showTrash && designs.length > 0 && (
              <button
                onClick={() => isSelectionMode ? clearSelection() : enterSelectionMode()}
                className={`px-3 md:px-4 py-2 rounded-lg transition-all flex items-center gap-2 text-sm md:text-base ${
                  isSelectionMode
                    ? "bg-rose-900 text-white"
                    : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                }`}
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                </svg>
                <span className="hidden sm:inline">{isSelectionMode ? "Cancel" : "Select"}</span>
              </button>
            )}
            <Link
              href="/custom-design"
              className="px-3 md:px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition-all flex items-center gap-2 text-sm md:text-base"
              title="Create design from customer photo"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span className="hidden sm:inline">From Photo</span>
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
                <div className="flex items-center justify-between mb-2">
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
                {/* New folder input - mobile */}
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

              {/* Skill Level */}
              <div>
                <h3 className="text-sm font-medium text-slate-400 mb-2 uppercase tracking-wider">
                  Skill Level
                </h3>
                <div className="flex flex-wrap gap-2">
                  {["easy", "intermediate", "advanced"].map((level) => (
                    <button
                      key={level}
                      onClick={() => setSelectedSkillLevel(selectedSkillLevel === level ? null : level)}
                      className={`px-3 py-1.5 rounded-lg text-sm transition-colors capitalize ${
                        selectedSkillLevel === level
                          ? "bg-rose-900 text-white"
                          : "bg-slate-700 text-slate-300"
                      }`}
                    >
                      {level}
                    </button>
                  ))}
                </div>
              </div>

              {/* Size Category */}
              <div>
                <h3 className="text-sm font-medium text-slate-400 mb-2 uppercase tracking-wider">
                  Size
                </h3>
                <div className="flex flex-wrap gap-2">
                  {["small", "medium", "large"].map((size) => (
                    <button
                      key={size}
                      onClick={() => setSelectedSizeCategory(selectedSizeCategory === size ? null : size)}
                      className={`px-3 py-1.5 rounded-lg text-sm transition-colors capitalize ${
                        selectedSizeCategory === size
                          ? "bg-rose-900 text-white"
                          : "bg-slate-700 text-slate-300"
                      }`}
                    >
                      {size}
                    </button>
                  ))}
                </div>
              </div>
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
                    {editingFolderId === folder.id ? (
                      <div className="flex-1 flex gap-1">
                        <input
                          type="text"
                          value={editingFolderName}
                          onChange={(e) => setEditingFolderName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleRenameFolder(folder.id);
                            if (e.key === "Escape") { setEditingFolderId(null); setEditingFolderName(""); }
                          }}
                          onBlur={() => handleRenameFolder(folder.id)}
                          className="flex-1 px-2 py-1 bg-slate-700 border border-slate-600 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-rose-800"
                          autoFocus
                        />
                      </div>
                    ) : (
                      <>
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
                          onClick={() => startEditingFolder(folder)}
                          className="p-1 text-slate-500 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Rename folder"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                          </svg>
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
                      </>
                    )}
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

            {/* Skill Level */}
            <div>
              <h3 className="text-sm font-medium text-slate-400 mb-3 uppercase tracking-wider">
                Skill Level
              </h3>
              <div className="flex flex-wrap gap-2">
                {["easy", "intermediate", "advanced"].map((level) => (
                  <button
                    key={level}
                    onClick={() => setSelectedSkillLevel(selectedSkillLevel === level ? null : level)}
                    className={`px-3 py-1 rounded-lg text-sm transition-colors capitalize ${
                      selectedSkillLevel === level
                        ? "bg-rose-900 text-white"
                        : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                    }`}
                  >
                    {level}
                  </button>
                ))}
              </div>
            </div>

            {/* Size Category */}
            <div>
              <h3 className="text-sm font-medium text-slate-400 mb-3 uppercase tracking-wider">
                Size
              </h3>
              <div className="flex flex-wrap gap-2">
                {["small", "medium", "large"].map((size) => (
                  <button
                    key={size}
                    onClick={() => setSelectedSizeCategory(selectedSizeCategory === size ? null : size)}
                    className={`px-3 py-1 rounded-lg text-sm transition-colors capitalize ${
                      selectedSizeCategory === size
                        ? "bg-rose-900 text-white"
                        : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                    }`}
                  >
                    {size}
                  </button>
                ))}
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
              <>
                {/* Selection mode header */}
                {isSelectionMode && (
                  <div className="flex items-center justify-between mb-4 p-3 bg-slate-800 rounded-lg border border-slate-700">
                    <span className="text-slate-300 text-sm">
                      {selectedDesigns.size} of {designs.length} selected
                    </span>
                    <button
                      onClick={selectedDesigns.size === designs.length ? clearSelection : selectAllDesigns}
                      className="text-rose-400 hover:text-rose-300 text-sm font-medium"
                    >
                      {selectedDesigns.size === designs.length ? "Deselect All" : "Select All"}
                    </button>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 md:gap-6">
                  {designs.map((design) => {
                    const isSelected = selectedDesigns.has(design.id);

                    return (
                      <div
                        key={design.id}
                        className={`bg-slate-800 rounded-xl overflow-hidden border transition-colors group ${
                          isSelected
                            ? "border-rose-500 ring-2 ring-rose-500/50"
                            : "border-slate-700 hover:border-rose-800/50"
                        }`}
                        onClick={(e) => {
                          if (isSelectionMode) {
                            e.preventDefault();
                            toggleDesignSelection(design.id);
                          }
                        }}
                      >
                        {/* Preview */}
                        <div className="block aspect-square relative bg-slate-900">
                          {/* Selection checkbox */}
                          {isSelectionMode && (
                            <div className="absolute top-2 left-2 z-10">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleDesignSelection(design.id);
                                }}
                                className={`w-6 h-6 rounded border-2 flex items-center justify-center transition-colors ${
                                  isSelected
                                    ? "bg-rose-500 border-rose-500 text-white"
                                    : "bg-slate-900/80 border-slate-400 hover:border-rose-400"
                                }`}
                              >
                                {isSelected && (
                                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                  </svg>
                                )}
                              </button>
                            </div>
                          )}

                          {/* Wrap content in Link only when not in selection mode */}
                          {isSelectionMode ? (
                            <>
                              {design.previewImageUrl ? (
                                <img
                                  src={design.previewImageUrl}
                                  alt={design.name}
                                  className="w-full h-full object-contain cursor-pointer"
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-slate-600 cursor-pointer">
                                  <svg className="w-12 h-12 md:w-16 md:h-16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
                                  </svg>
                                </div>
                              )}
                            </>
                          ) : (
                            <Link href={`/design/${design.id}`} className="block w-full h-full">
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
                            </Link>
                          )}

                          {/* Draft badge - adjust position when in selection mode */}
                          {design.isDraft && (
                            <div className={`absolute ${isSelectionMode ? "top-2 left-10" : "top-2 left-2"} pointer-events-none`}>
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
                        </div>

                        {/* Info */}
                        <div className="p-3 md:p-4">
                          {isSelectionMode ? (
                            <h3 className="font-semibold text-white mb-1 text-sm md:text-base truncate cursor-pointer">
                              {design.name}
                            </h3>
                          ) : (
                            <Link href={`/design/${design.id}`}>
                              <h3 className="font-semibold text-white mb-1 group-hover:text-rose-400 transition-colors text-sm md:text-base truncate">
                                {design.name}
                              </h3>
                            </Link>
                          )}
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

                          {/* Skill Level & Size Category */}
                          <div className="flex flex-wrap items-center gap-2 mb-2">
                            <select
                              value={design.skillLevel || ""}
                              onChange={(e) => handleUpdateDesignField(design.id, "skillLevel", e.target.value || null)}
                              className={`text-xs px-2 py-0.5 rounded border-0 cursor-pointer ${
                                design.skillLevel === "easy" ? "bg-green-900/50 text-green-400" :
                                design.skillLevel === "intermediate" ? "bg-yellow-900/50 text-yellow-400" :
                                design.skillLevel === "advanced" ? "bg-red-900/50 text-red-400" :
                                "bg-slate-700 text-slate-400"
                              }`}
                            >
                              <option value="">Skill...</option>
                              <option value="easy">Easy</option>
                              <option value="intermediate">Intermediate</option>
                              <option value="advanced">Advanced</option>
                            </select>
                            <select
                              value={design.sizeCategory || ""}
                              onChange={(e) => handleUpdateDesignField(design.id, "sizeCategory", e.target.value || null)}
                              className={`text-xs px-2 py-0.5 rounded border-0 cursor-pointer ${
                                design.sizeCategory ? "bg-slate-600 text-white" : "bg-slate-700 text-slate-400"
                              }`}
                            >
                              <option value="">Size...</option>
                              <option value="small">Small</option>
                              <option value="medium">Medium</option>
                              <option value="large">Large</option>
                            </select>
                          </div>

                          {/* Folder indicator */}
                          {design.folder && (
                            <p className="text-xs text-slate-500 mb-2">
                              📁 {design.folder.name}
                            </p>
                          )}

                          {/* Kit summary + tracking counters */}
                          <div className="flex flex-wrap items-center gap-2 mb-2 text-xs">
                            {design.totalStitches > 0 && (
                              <span className="text-slate-400">
                                {design.totalStitches.toLocaleString()} stitches
                              </span>
                            )}
                            {design.kitColorCount > 0 && (
                              <span className="text-slate-400">
                                {design.kitColorCount} colors &middot; {design.kitSkeinCount} skeins
                              </span>
                            )}
                            <span className="px-1.5 py-0.5 bg-blue-900/40 text-blue-400 rounded flex items-center gap-1">
                              <button
                                onClick={(e) => { e.stopPropagation(); handleUpdateCanvasPrinted(design.id, -1); }}
                                disabled={design.canvasPrinted <= 0}
                                className="hover:text-blue-200 disabled:opacity-30"
                              >-</button>
                              {design.canvasPrinted} printed
                              <button
                                onClick={(e) => { e.stopPropagation(); handleUpdateCanvasPrinted(design.id, 1); }}
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
                                <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
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
                                <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
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
                              {/* Color Variant */}
                              <button
                                onClick={() => setColorSwapDesign({ id: design.id, name: design.name })}
                                className="p-1.5 text-slate-500 hover:text-purple-400 transition-colors"
                                title="Create color variant"
                              >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
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
                    );
                  })}
                </div>
              </>
            )}
          </main>
        </div>
      </div>

      {/* Batch Action Bar */}
      {selectedDesigns.size > 0 && (
        <BatchActionBar
          selectedCount={selectedDesigns.size}
          onMoveToFolder={handleBatchMoveToFolder}
          onAddTags={handleBatchAddTags}
          onRemoveTags={handleBatchRemoveTags}
          onDelete={handleBatchDelete}
          onExportKits={handleBatchExportKits}
          onCancel={clearSelection}
          folders={folders}
          tags={tags}
        />
      )}

      {/* New Design Dialog */}
      {showNewDesignDialog && (
        <NewDesignDialog
          onClose={() => setShowNewDesignDialog(false)}
          folderId={selectedFolder}
        />
      )}

      {/* Color Swap Dialog */}
      {colorSwapDesign && (
        <ColorSwapDialog
          designId={colorSwapDesign.id}
          designName={colorSwapDesign.name}
          onClose={() => setColorSwapDesign(null)}
          onSuccess={() => mutateDesigns()}
        />
      )}
    </div>
  );
}
