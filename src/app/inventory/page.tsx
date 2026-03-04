"use client";

import React, { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DmcColor, searchDmcColors, getDmcColorByNumber } from "@/lib/dmc-pearl-cotton";
import { Breadcrumb } from "@/components/Breadcrumb";

interface InventoryItem {
  id: string;
  dmcNumber: string;
  size: number;
  skeins: number;
  createdAt: string;
  updatedAt: string;
}

interface Folder {
  id: string;
  name: string;
  parentId: string | null;
}

interface Design {
  id: string;
  name: string;
  previewImageUrl: string | null;
  kitsReady: number;
  canvasPrinted: number;
  canvasPrintedMaddie: number;
  isDraft: boolean;
  kitColorCount: number;
  kitSkeinCount: number;
  widthInches: number;
  heightInches: number;
  meshCount: number;
  folderId: string | null;
  folder: Folder | null;
}

interface ColorUsageDesign {
  id: string;
  name: string;
  previewImageUrl: string | null;
  meshCount: number;
  stitchCount: number;
  skeinsNeeded: number;
  yardsWithBuffer: number;
  fullSkeins: number;
  bobbinYards: number;
}

interface ColorUsage {
  dmcNumber: string;
  designs: ColorUsageDesign[];
}

type TabType = "threads" | "kits" | "canvases" | "supplies";

interface Supply {
  id: string;
  name: string;
  sku: string | null;
  description: string | null;
  imageUrl: string | null;
  quantity: number;
}

interface BackupColorInfo {
  dmcNumber: string;
  colorName: string;
  hex: string;
  inventorySkeins: number;
  inStock: boolean;
}

interface KitItem {
  dmcNumber: string;
  colorName: string;
  hex: string;
  stitchCount: number;
  skeinsNeeded: number;
  yardsWithoutBuffer: number;
  yardsWithBuffer: number;
  fullSkeins: number;
  bobbinYards: number;
  inventorySkeins: number;
  inStock: boolean;
  primaryInStock?: boolean;
  backup: BackupColorInfo | null;
}

interface KitContents {
  kitContents: KitItem[];
  totals: {
    colors: number;
    skeins: number;
    bobbins: number;
    allInStock: boolean;
  };
}

function getContrastTextColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? "#000000" : "#FFFFFF";
}

export default function InventoryPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabType>("threads");
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [designs, setDesigns] = useState<Design[]>([]);
  const [transferringCanvas, setTransferringCanvas] = useState<string | null>(null);
  const [colorUsage, setColorUsage] = useState<Map<string, ColorUsageDesign[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [supplies, setSupplies] = useState<Supply[]>([]);
  const [suppliesLoading, setSuppliesLoading] = useState(false);
  const [showAddSupply, setShowAddSupply] = useState(false);
  const [supplyForm, setSupplyForm] = useState({ name: "", sku: "", description: "", quantity: 0 });
  const [editingSupplyId, setEditingSupplyId] = useState<string | null>(null);
  const [savingSupply, setSavingSupply] = useState(false);
  const sizeFilter = null; // Size 5 only in internal app
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedColor, setExpandedColor] = useState<string | null>(null);

  // Add form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [addSearch, setAddSearch] = useState("");
  const [selectedColor, setSelectedColor] = useState<DmcColor | null>(null);
  const addSize = 5; // Size 5 only in internal app
  const [addSkeins, setAddSkeins] = useState("1");
  const [adding, setAdding] = useState(false);

  // Track pending values being typed
  const [pendingSkeins, setPendingSkeins] = useState<Record<string, string>>({});
  const [pendingKits, setPendingKits] = useState<Record<string, string>>({});
  const [pendingCanvases, setPendingCanvases] = useState<Record<string, string>>({});
  const [pendingCanvasesMaddie, setPendingCanvasesMaddie] = useState<Record<string, string>>({});
  const [pendingSupplyQuantity, setPendingSupplyQuantity] = useState<Record<string, string>>({});

  // Kit contents expansion state
  const [expandedKits, setExpandedKits] = useState<Set<string>>(new Set());
  const [kitContentsCache, setKitContentsCache] = useState<Map<string, KitContents>>(new Map());
  const [loadingKitContents, setLoadingKitContents] = useState<Set<string>>(new Set());

  // Color usage expansion state (for showing which designs use each color)
  const [expandedColors, setExpandedColors] = useState<Set<string>>(new Set());

  // Inventory update state
  const [pendingInventoryValues, setPendingInventoryValues] = useState<Record<string, string>>({});
  const [updatingInventory, setUpdatingInventory] = useState<string | null>(null);

  useEffect(() => {
    fetchInventory();
    fetchDesigns();
    fetchColorUsage();
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([fetchInventory(), fetchDesigns(), fetchColorUsage()]);
    setRefreshing(false);
  };

  const fetchColorUsage = async () => {
    try {
      const response = await fetch("/api/colors/usage");
      if (response.ok) {
        const data: ColorUsage[] = await response.json();
        const usageMap = new Map<string, ColorUsageDesign[]>();
        for (const item of data) {
          usageMap.set(item.dmcNumber, item.designs);
        }
        setColorUsage(usageMap);
      }
    } catch (error) {
      console.error("Error fetching color usage:", error);
    }
  };

  const fetchInventory = async () => {
    try {
      const response = await fetch("/api/inventory");
      if (response.ok) {
        const data = await response.json();
        setItems(data);
      }
    } catch (error) {
      console.error("Error fetching inventory:", error);
    }
    setLoading(false);
  };

  const fetchDesigns = async () => {
    try {
      const response = await fetch("/api/designs");
      if (response.ok) {
        const data = await response.json();
        // Filter out drafts
        setDesigns(data.filter((d: Design) => !d.isDraft));
      }
    } catch (error) {
      console.error("Error fetching designs:", error);
    }
  };

  const fetchKitContents = async (designId: string) => {
    // Check if already loading or cached
    if (loadingKitContents.has(designId) || kitContentsCache.has(designId)) {
      return;
    }

    setLoadingKitContents((prev) => new Set([...prev, designId]));
    try {
      const response = await fetch(`/api/designs/${designId}/kit`);
      if (response.ok) {
        const data = await response.json();
        setKitContentsCache((prev) => {
          const next = new Map(prev);
          next.set(designId, {
            kitContents: data.kitContents,
            totals: data.totals,
          });
          return next;
        });
      }
    } catch (error) {
      console.error("Error fetching kit contents:", error);
    }
    setLoadingKitContents((prev) => {
      const next = new Set(prev);
      next.delete(designId);
      return next;
    });
  };

  const toggleKitExpansion = (designId: string) => {
    setExpandedKits((prev) => {
      const next = new Set(prev);
      if (next.has(designId)) {
        next.delete(designId);
      } else {
        next.add(designId);
        // Fetch kit contents if not already loaded
        if (!kitContentsCache.has(designId)) {
          fetchKitContents(designId);
        }
      }
      return next;
    });
  };

  // Update inventory for a color within kit contents
  const handleKitInventoryUpdate = async (dmcNumber: string, delta: number) => {
    const key = dmcNumber;
    setUpdatingInventory(key);

    // Optimistic update for kit contents cache
    setKitContentsCache((prev) => {
      const next = new Map(prev);
      for (const [designId, kit] of next) {
        const updatedContents = kit.kitContents.map((item) => {
          if (item.dmcNumber !== dmcNumber) return item;
          const newSkeins = Math.max(0, item.inventorySkeins + delta);
          return {
            ...item,
            inventorySkeins: newSkeins,
            inStock: newSkeins >= item.skeinsNeeded || (item.backup?.inStock ?? false),
            primaryInStock: newSkeins >= item.skeinsNeeded,
          };
        });
        next.set(designId, { ...kit, kitContents: updatedContents });
      }
      return next;
    });

    try {
      const response = await fetch("/api/inventory", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dmcNumber, size: 5, delta }),
      });

      if (!response.ok) {
        throw new Error("Failed to update inventory");
      }

      // Also refresh the main inventory items
      fetchInventory();
    } catch (error) {
      console.error("Error updating inventory:", error);
      // Revert by refetching kit contents for all expanded kits
      for (const designId of expandedKits) {
        setKitContentsCache((prev) => {
          const next = new Map(prev);
          next.delete(designId);
          return next;
        });
        fetchKitContents(designId);
      }
    } finally {
      setUpdatingInventory(null);
    }
  };

  // Set absolute inventory value for a color
  const handleSetKitInventory = async (dmcNumber: string, value: number) => {
    // Find current value from kit contents
    let currentValue = 0;
    for (const [, kit] of kitContentsCache) {
      const item = kit.kitContents.find((i) => i.dmcNumber === dmcNumber);
      if (item) {
        currentValue = item.inventorySkeins;
        break;
      }
    }

    const newVal = Math.max(0, value);
    const delta = newVal - currentValue;

    if (delta !== 0) {
      await handleKitInventoryUpdate(dmcNumber, delta);
    }

    // Clear pending value
    setPendingInventoryValues((prev) => {
      const next = { ...prev };
      delete next[dmcNumber];
      return next;
    });
  };

  const fetchSupplies = async () => {
    setSuppliesLoading(true);
    try {
      const response = await fetch("/api/supplies");
      if (response.ok) {
        const data = await response.json();
        setSupplies(data);
      }
    } catch (error) {
      console.error("Error fetching supplies:", error);
    }
    setSuppliesLoading(false);
  };

  // Fetch supplies when tab changes to supplies
  useEffect(() => {
    if (activeTab === "supplies" && supplies.length === 0) {
      fetchSupplies();
    }
  }, [activeTab, supplies.length]);

  const handleSaveSupply = async () => {
    if (!supplyForm.name.trim()) return;
    setSavingSupply(true);
    try {
      const url = editingSupplyId ? `/api/supplies/${editingSupplyId}` : "/api/supplies";
      const method = editingSupplyId ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(supplyForm),
      });
      if (res.ok) {
        await fetchSupplies();
        setShowAddSupply(false);
        setEditingSupplyId(null);
        setSupplyForm({ name: "", sku: "", description: "", quantity: 0 });
      }
    } catch (error) {
      console.error("Error saving supply:", error);
    }
    setSavingSupply(false);
  };

  const handleDeleteSupply = async (id: string) => {
    if (!confirm("Delete this supply?")) return;
    try {
      const res = await fetch(`/api/supplies/${id}`, { method: "DELETE" });
      if (res.ok) {
        setSupplies(supplies.filter((s) => s.id !== id));
      }
    } catch (error) {
      console.error("Error deleting supply:", error);
    }
  };

  const handleSupplyQuantityChange = async (id: string, delta: number) => {
    // Optimistic update
    setSupplies(supplies.map((s) => s.id === id ? { ...s, quantity: Math.max(0, s.quantity + delta) } : s));
    try {
      await fetch(`/api/supplies/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantityDelta: delta }),
      });
    } catch (error) {
      console.error("Error updating supply quantity:", error);
      fetchSupplies(); // Revert on error
    }
  };

  const handleSetSupplyQuantity = async (id: string, value: number) => {
    const supply = supplies.find((s) => s.id === id);
    if (!supply) return;

    const newVal = Math.max(0, value);
    const delta = newVal - supply.quantity;

    if (delta !== 0) {
      await handleSupplyQuantityChange(id, delta);
    }
    // Clear pending value
    setPendingSupplyQuantity((prev) => { const next = { ...prev }; delete next[id]; return next; });
  };

  const filteredItems = useMemo(() => {
    let result = items;
    if (sizeFilter !== null) {
      result = result.filter((item) => item.size === sizeFilter);
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter((item) => {
        const color = getDmcColorByNumber(item.dmcNumber);
        return (
          item.dmcNumber.toLowerCase().includes(q) ||
          (color && color.name.toLowerCase().includes(q))
        );
      });
    }
    // Sort by DMC number numerically
    result = [...result].sort((a, b) => {
      const numA = parseInt(a.dmcNumber, 10);
      const numB = parseInt(b.dmcNumber, 10);
      if (!isNaN(numA) && !isNaN(numB)) {
        return numA - numB;
      }
      if (!isNaN(numA)) return -1;
      if (!isNaN(numB)) return 1;
      return a.dmcNumber.localeCompare(b.dmcNumber);
    });
    return result;
  }, [items, sizeFilter, searchQuery]);

  const filteredDesigns = useMemo(() => {
    if (!searchQuery) return designs;
    const q = searchQuery.toLowerCase();
    return designs.filter((d) => d.name.toLowerCase().includes(q));
  }, [designs, searchQuery]);

  // Search results for main search - colors not in inventory
  const mainSearchSuggestions = useMemo(() => {
    if (!searchQuery || filteredItems.length > 0 || activeTab !== "threads") return [];
    const matches = searchDmcColors(searchQuery).slice(0, 10);
    const inventoryDmcNumbers = new Set(
      items
        .filter((item) => sizeFilter === null || item.size === sizeFilter)
        .map((item) => item.dmcNumber)
    );
    return matches.filter((color) => !inventoryDmcNumbers.has(color.dmcNumber));
  }, [searchQuery, filteredItems.length, items, sizeFilter, activeTab]);

  const addColorResults = useMemo(() => {
    if (!addSearch) return [];
    return searchDmcColors(addSearch).slice(0, 20);
  }, [addSearch]);

  const handleAdd = async () => {
    const skeinsNum = Math.max(1, Number(addSkeins) || 1);
    if (!selectedColor) return;
    setAdding(true);
    try {
      const response = await fetch("/api/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dmcNumber: selectedColor.dmcNumber,
          size: addSize,
          skeins: skeinsNum,
        }),
      });
      if (response.ok) {
        await fetchInventory();
        setSelectedColor(null);
        setAddSearch("");
        setAddSkeins("1");
        setShowAddForm(false);
      }
    } catch (error) {
      console.error("Error adding inventory item:", error);
    }
    setAdding(false);
  };

  const handleUpdateSkeins = async (id: string, skeins: number) => {
    const clamped = Math.max(0, skeins);
    setItems(items.map((item) => (item.id === id ? { ...item, skeins: clamped } : item)));
    setPendingSkeins((prev) => { const next = { ...prev }; delete next[id]; return next; });
    try {
      const response = await fetch(`/api/inventory/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skeins: clamped }),
      });
      if (!response.ok) {
        await fetchInventory();
      }
    } catch (error) {
      console.error("Error updating inventory item:", error);
      await fetchInventory();
    }
  };

  const handleUpdateDesign = async (id: string, field: "kitsReady" | "canvasPrinted" | "canvasPrintedMaddie", delta: number) => {
    const design = designs.find((d) => d.id === id);
    if (!design) return;

    const currentVal = field === "kitsReady"
      ? design.kitsReady
      : field === "canvasPrinted"
      ? design.canvasPrinted
      : (design.canvasPrintedMaddie || 0);
    const newVal = Math.max(0, currentVal + delta);

    // Optimistic update
    setDesigns(designs.map((d) => (d.id === id ? { ...d, [field]: newVal } : d)));

    // Clear pending
    if (field === "kitsReady") {
      setPendingKits((prev) => { const next = { ...prev }; delete next[id]; return next; });
    } else if (field === "canvasPrinted") {
      setPendingCanvases((prev) => { const next = { ...prev }; delete next[id]; return next; });
    } else {
      setPendingCanvasesMaddie((prev) => { const next = { ...prev }; delete next[id]; return next; });
    }

    try {
      const body = field === "kitsReady"
        ? { kitsReadyDelta: delta }
        : field === "canvasPrinted"
        ? { canvasPrintedDelta: delta }
        : { canvasPrintedMaddieDelta: delta };

      const response = await fetch(`/api/designs/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        await fetchDesigns();
      }
    } catch (error) {
      console.error("Error updating design:", error);
      await fetchDesigns();
    }
  };

  const handleSetDesignValue = async (id: string, field: "kitsReady" | "canvasPrinted" | "canvasPrintedMaddie", value: number) => {
    const design = designs.find((d) => d.id === id);
    if (!design) return;

    const currentVal = field === "kitsReady"
      ? design.kitsReady
      : field === "canvasPrinted"
      ? design.canvasPrinted
      : (design.canvasPrintedMaddie || 0);
    const newVal = Math.max(0, value);
    const delta = newVal - currentVal;

    if (delta !== 0) {
      await handleUpdateDesign(id, field, delta);
    } else {
      // Just clear pending
      if (field === "kitsReady") {
        setPendingKits((prev) => { const next = { ...prev }; delete next[id]; return next; });
      } else if (field === "canvasPrinted") {
        setPendingCanvases((prev) => { const next = { ...prev }; delete next[id]; return next; });
      } else {
        setPendingCanvasesMaddie((prev) => { const next = { ...prev }; delete next[id]; return next; });
      }
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Remove this thread from inventory?")) return;
    try {
      const response = await fetch(`/api/inventory/${id}`, { method: "DELETE" });
      if (response.ok) {
        setItems(items.filter((item) => item.id !== id));
      }
    } catch (error) {
      console.error("Error deleting inventory item:", error);
    }
  };

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  };

  const totalSkeins = filteredItems.reduce((sum, item) => sum + item.skeins, 0);
  const totalYards = totalSkeins * 27;
  const size5Count = items.filter((i) => i.size === 5).length;
  const totalKitsReady = designs.reduce((sum, d) => sum + d.kitsReady, 0);
  const totalCanvasesPrinted = designs.reduce((sum, d) => sum + d.canvasPrinted, 0);

  // Canvas location-specific stats
  const mainCanvases = designs.reduce((sum, d) => sum + d.canvasPrinted, 0);
  const maddieCanvases = designs.reduce((sum, d) => sum + (d.canvasPrintedMaddie || 0), 0);
  const allCanvases = mainCanvases + maddieCanvases;

  // Handle canvas transfer from Maddie to main
  const handleCanvasTransfer = async (designId: string) => {
    setTransferringCanvas(designId);
    try {
      const res = await fetch("/api/inventory/transfer", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ designId }),
      });
      if (res.ok) {
        const data = await res.json();
        // Update local state
        setDesigns(designs.map(d =>
          d.id === designId
            ? { ...d, canvasPrinted: data.design.canvasPrinted, canvasPrintedMaddie: data.design.canvasPrintedMaddie }
            : d
        ));
      }
    } catch (error) {
      console.error("Error transferring canvases:", error);
    }
    setTransferringCanvas(null);
  };

  // Group designs by collection (folder)
  const designsByCollection = useMemo(() => {
    const groups: { folderId: string | null; folderName: string; designs: Design[] }[] = [];
    const folderMap = new Map<string | null, Design[]>();

    filteredDesigns.forEach(design => {
      const key = design.folderId;
      if (!folderMap.has(key)) {
        folderMap.set(key, []);
      }
      folderMap.get(key)!.push(design);
    });

    // Sort folders: named folders first (alphabetically), then "Uncategorized" last
    const sortedKeys = Array.from(folderMap.keys()).sort((a, b) => {
      if (a === null) return 1;
      if (b === null) return -1;
      const aName = filteredDesigns.find(d => d.folderId === a)?.folder?.name || "";
      const bName = filteredDesigns.find(d => d.folderId === b)?.folder?.name || "";
      return aName.localeCompare(bName);
    });

    sortedKeys.forEach(key => {
      const designsInFolder = folderMap.get(key)!;
      const folderName = key === null ? "Uncategorized" : designsInFolder[0]?.folder?.name || "Unknown";
      groups.push({
        folderId: key,
        folderName,
        designs: designsInFolder,
      });
    });

    return groups;
  }, [filteredDesigns]);

  return (
    <div className="min-h-screen bg-slate-900 overflow-x-hidden">
      {/* Header */}
      <header className="bg-slate-800 border-b border-slate-700 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-3 md:px-4 py-3 md:py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 md:gap-3 min-w-0">
            <Link
              href="/"
              className="w-9 h-9 md:w-10 md:h-10 bg-gradient-to-br from-rose-900 to-rose-800 rounded-xl flex items-center justify-center flex-shrink-0"
            >
              <svg className="w-5 h-5 md:w-6 md:h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
              </svg>
            </Link>
            <div className="min-w-0">
              <h1 className="text-lg md:text-xl font-bold text-white truncate">Inventory</h1>
              <p className="text-xs md:text-sm text-slate-400 hidden sm:block">
                Threads, Kits & Canvases
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 md:gap-4">
            {activeTab === "threads" && (
              <button
                onClick={() => setShowAddForm(true)}
                className="px-3 md:px-4 py-2 bg-gradient-to-r from-rose-900 to-rose-800 text-white rounded-lg hover:from-rose-950 hover:to-rose-900 transition-all flex items-center gap-2 text-sm md:text-base"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                <span className="hidden sm:inline">Add Thread</span>
              </button>
            )}
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="p-2 text-slate-400 hover:text-white disabled:opacity-50"
              title="Refresh"
            >
              <svg className={`w-5 h-5 ${refreshing ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
            <Link
              href="/"
              className="p-2 text-slate-400 hover:text-white"
              title="Home"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
            </Link>
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
        <Breadcrumb items={[{ label: "Inventory" }]} className="mb-4" />

        {/* Tabs */}
        <div className="overflow-x-auto -mx-3 px-3 md:mx-0 md:px-0 mb-6">
          <div className="flex gap-1 bg-slate-800 p-1 rounded-lg border border-slate-700 w-fit min-w-fit">
            <button
              onClick={() => setActiveTab("threads")}
              className={`px-2 md:px-4 py-2 rounded-md text-xs md:text-sm font-medium transition-colors whitespace-nowrap ${
                activeTab === "threads"
                  ? "bg-rose-900 text-white"
                  : "text-slate-400 hover:text-white hover:bg-slate-700"
              }`}
            >
              Threads
              <span className="ml-1 text-xs opacity-75">({items.length})</span>
            </button>
            <button
              onClick={() => setActiveTab("kits")}
              className={`px-2 md:px-4 py-2 rounded-md text-xs md:text-sm font-medium transition-colors whitespace-nowrap ${
                activeTab === "kits"
                  ? "bg-rose-900 text-white"
                  : "text-slate-400 hover:text-white hover:bg-slate-700"
              }`}
            >
              Kits
              <span className="ml-1 text-xs opacity-75">({totalKitsReady})</span>
            </button>
            <button
              onClick={() => setActiveTab("canvases")}
              className={`px-2 md:px-4 py-2 rounded-md text-xs md:text-sm font-medium transition-colors whitespace-nowrap ${
                activeTab === "canvases"
                  ? "bg-rose-900 text-white"
                  : "text-slate-400 hover:text-white hover:bg-slate-700"
              }`}
            >
              Canvases
              <span className="ml-1 text-xs opacity-75">({totalCanvasesPrinted})</span>
            </button>
            <button
              onClick={() => setActiveTab("supplies")}
              className={`px-2 md:px-4 py-2 rounded-md text-xs md:text-sm font-medium transition-colors flex items-center gap-1 whitespace-nowrap ${
                activeTab === "supplies"
                  ? "bg-rose-900 text-white"
                  : "text-slate-400 hover:text-white hover:bg-slate-700"
              }`}
            >
              <svg className="w-4 h-4 flex-shrink-0 hidden md:block" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
              Supplies
              {supplies.length > 0 && (
                <span className="ml-1 text-xs opacity-75">({supplies.length})</span>
              )}
            </button>
            <div className="border-l border-slate-600 h-6 mx-2" />
            <Link
              href="/stock-alerts"
              className="px-2 md:px-4 py-2 rounded-md text-xs md:text-sm font-medium transition-colors flex items-center gap-1 whitespace-nowrap text-slate-400 hover:text-white hover:bg-slate-700"
            >
              <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              Stock Alerts →
            </Link>
          </div>
        </div>

        {/* Threads Tab */}
        {activeTab === "threads" && (
          <>
            {/* Stats bar */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
              <div className="bg-slate-800 rounded-lg p-3 border border-slate-700">
                <p className="text-xs text-slate-400 uppercase tracking-wider">Total Colors</p>
                <p className="text-xl font-bold text-white">{filteredItems.length}</p>
              </div>
              <div className="bg-slate-800 rounded-lg p-3 border border-slate-700">
                <p className="text-xs text-slate-400 uppercase tracking-wider">Total Skeins</p>
                <p className="text-xl font-bold text-white">{totalSkeins}</p>
              </div>
              <div className="bg-slate-800 rounded-lg p-3 border border-slate-700">
                <p className="text-xs text-slate-400 uppercase tracking-wider">Total Yards</p>
                <p className="text-xl font-bold text-white">{totalYards}</p>
              </div>
            </div>

            {/* Search and filter */}
            <div className="flex flex-col sm:flex-row gap-3 mb-6">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by DMC number or name..."
                className="flex-1 px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-800"
              />
              {/* Size 5 only in internal app (14 mesh) */}
              <div className="px-4 py-2.5 bg-slate-800 border border-slate-700 text-slate-300 rounded-lg text-sm">
                Size 5 (14 mesh)
              </div>
            </div>

            {/* Thread list */}
            {loading ? (
              <div className="flex items-center justify-center h-64">
                <div className="text-white flex items-center gap-3">
                  <svg className="animate-spin h-6 w-6" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Loading inventory...
                </div>
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="text-center py-12 md:py-16">
                <div className="w-14 h-14 md:w-16 md:h-16 bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-7 h-7 md:w-8 md:h-8 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                  </svg>
                </div>
                <h2 className="text-lg md:text-xl font-semibold text-white mb-2">
                  {items.length === 0 ? "No threads in inventory" : "No matching threads"}
                </h2>
                <p className="text-slate-400 mb-6 text-sm md:text-base px-4">
                  {items.length === 0
                    ? "Add your DMC Pearl Cotton threads to track your collection."
                    : "Try a different search or filter."}
                </p>
                {items.length === 0 && (
                  <button
                    onClick={() => setShowAddForm(true)}
                    className="inline-flex items-center gap-2 px-5 md:px-6 py-2.5 md:py-3 bg-gradient-to-r from-rose-900 to-rose-800 text-white rounded-lg hover:from-rose-950 hover:to-rose-900 transition-all text-sm md:text-base"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Add Your First Thread
                  </button>
                )}

                {/* Quick-add suggestions when searching */}
                {searchQuery && mainSearchSuggestions.length > 0 && (
                  <div className="mt-8 max-w-2xl mx-auto">
                    <p className="text-slate-400 text-sm mb-3">Add to inventory:</p>
                    <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
                      {mainSearchSuggestions.map((color) => {
                        const usedInDesigns = colorUsage.get(color.dmcNumber) || [];
                        return (
                          <div
                            key={color.dmcNumber}
                            className="p-3 border-b border-slate-700 last:border-b-0 hover:bg-slate-750"
                          >
                            <div className="flex items-center gap-3">
                              <Link
                                href={`/inventory/color/${color.dmcNumber}`}
                                className="w-10 h-10 rounded-lg border border-white/20 flex-shrink-0 flex items-center justify-center hover:ring-2 hover:ring-rose-500 transition-all"
                                style={{ backgroundColor: color.hex }}
                                title={`View DMC ${color.dmcNumber} details`}
                              >
                                <span
                                  className="text-[7px] font-bold"
                                  style={{ color: getContrastTextColor(color.hex) }}
                                >
                                  {color.dmcNumber}
                                </span>
                              </Link>
                              <div className="flex-1 text-left min-w-0">
                                <Link href={`/inventory/color/${color.dmcNumber}`} className="text-white text-sm font-medium hover:text-rose-400 transition-colors">DMC {color.dmcNumber}</Link>
                                <p className="text-slate-400 text-xs">{color.name}</p>
                              </div>
                              {usedInDesigns.length > 0 && (
                                <span className="text-xs text-rose-400 hidden sm:block">
                                  Used in {usedInDesigns.length} design{usedInDesigns.length !== 1 ? "s" : ""}
                                </span>
                              )}
                              <button
                                onClick={() => {
                                  setSelectedColor(color);
                                  setAddSearch("");
                                  setShowAddForm(true);
                                }}
                                className="px-3 py-1.5 bg-rose-900 text-white text-xs font-medium rounded-lg hover:bg-rose-950 transition-colors flex-shrink-0"
                              >
                                Add
                              </button>
                            </div>
                            {/* Show designs using this color */}
                            {usedInDesigns.length > 0 && (
                              <div className="mt-2 pl-13 flex flex-wrap gap-1.5">
                                {usedInDesigns.slice(0, 5).map((design) => (
                                  <div
                                    key={design.id}
                                    className="flex items-center gap-1 bg-slate-700/50 rounded px-2 py-0.5"
                                  >
                                    {design.previewImageUrl ? (
                                      <img
                                        src={design.previewImageUrl}
                                        alt={design.name}
                                        className="w-4 h-4 object-cover rounded"
                                      />
                                    ) : (
                                      <div className="w-4 h-4 bg-slate-600 rounded" />
                                    )}
                                    <span className="text-xs text-slate-300 truncate max-w-[60px]">{design.name}</span>
                                    <span className="text-xs text-emerald-400">
                                      {design.bobbinYards > 0
                                        ? `${Math.round(design.bobbinYards)}yd`
                                        : `${design.fullSkeins}sk`}
                                    </span>
                                    <Link
                                      href={`/design/${design.id}`}
                                      className="p-0.5 text-slate-400 hover:text-white transition-colors"
                                      title="Edit design"
                                    >
                                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                      </svg>
                                    </Link>
                                    <Link
                                      href={`/design/${design.id}/kit`}
                                      className="p-0.5 text-slate-400 hover:text-emerald-400 transition-colors"
                                      title="View kit"
                                    >
                                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                                      </svg>
                                    </Link>
                                  </div>
                                ))}
                                {usedInDesigns.length > 5 && (
                                  <span className="text-xs text-slate-500 px-2 py-0.5">
                                    +{usedInDesigns.length - 5} more
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-700 text-left">
                      <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Color</th>
                      <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">DMC #</th>
                      <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider hidden sm:table-cell">Name</th>
                      <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Size</th>
                      <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Skeins</th>
                      <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider hidden md:table-cell">Yards</th>
                      <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider hidden lg:table-cell">Used In</th>
                      <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700">
                    {filteredItems.map((item) => {
                      const color = getDmcColorByNumber(item.dmcNumber);
                      const usedInDesigns = colorUsage.get(item.dmcNumber) || [];
                      const isExpanded = expandedColor === item.dmcNumber;
                      return (
                        <React.Fragment key={item.id}>
                          <tr className="hover:bg-slate-750 transition-colors">
                            <td className="px-4 py-3">
                              <Link
                                href={`/inventory/color/${item.dmcNumber}`}
                                className="w-10 h-10 rounded-lg border border-white/20 flex items-center justify-center hover:ring-2 hover:ring-rose-500 transition-all"
                                style={{ backgroundColor: color?.hex || "#666" }}
                                title={`View DMC ${item.dmcNumber} details`}
                              >
                                <span
                                  className="text-[7px] font-bold select-none"
                                  style={{ color: color ? getContrastTextColor(color.hex) : "#fff" }}
                                >
                                  {item.dmcNumber}
                                </span>
                              </Link>
                            </td>
                            <td className="px-4 py-3">
                              <Link href={`/inventory/color/${item.dmcNumber}`} className="text-white font-medium hover:text-rose-400 transition-colors">{item.dmcNumber}</Link>
                            </td>
                            <td className="px-4 py-3 hidden sm:table-cell">
                              <span className="text-slate-300">{color?.name || "Unknown"}</span>
                            </td>
                            <td className="px-4 py-3">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                                item.size === 5
                                  ? "bg-blue-900/50 text-blue-300"
                                  : "bg-purple-900/50 text-purple-300"
                              }`}>
                                Size {item.size}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => handleUpdateSkeins(item.id, item.skeins - 1)}
                                  className="p-1.5 text-slate-400 hover:text-white transition-colors rounded hover:bg-slate-700"
                                  title="Remove 1 skein"
                                >
                                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                                  </svg>
                                </button>
                                <input
                                  type="number"
                                  min="0"
                                  value={pendingSkeins[item.id] ?? item.skeins}
                                  onChange={(e) => setPendingSkeins((prev) => ({ ...prev, [item.id]: e.target.value }))}
                                  onBlur={() => {
                                    const val = pendingSkeins[item.id];
                                    if (val !== undefined) {
                                      handleUpdateSkeins(item.id, Number(val));
                                    }
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      const val = pendingSkeins[item.id];
                                      if (val !== undefined) {
                                        handleUpdateSkeins(item.id, Number(val));
                                      }
                                      (e.target as HTMLInputElement).blur();
                                    }
                                  }}
                                  className="w-16 px-2 py-1 bg-slate-700 border border-slate-600 rounded text-white text-sm text-center focus:outline-none focus:ring-2 focus:ring-rose-800"
                                />
                                <button
                                  onClick={() => handleUpdateSkeins(item.id, item.skeins + 1)}
                                  className="p-1.5 text-slate-400 hover:text-white transition-colors rounded hover:bg-slate-700"
                                  title="Add 1 skein"
                                >
                                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                  </svg>
                                </button>
                              </div>
                            </td>
                            <td className="px-4 py-3 hidden md:table-cell">
                              <span className="text-slate-400">{item.skeins * 27} yds</span>
                            </td>
                            <td className="px-4 py-3 hidden lg:table-cell">
                              {usedInDesigns.length > 0 ? (
                                <button
                                  onClick={() => setExpandedColor(isExpanded ? null : item.dmcNumber)}
                                  className="flex items-center gap-1 text-sm text-rose-400 hover:text-rose-300"
                                >
                                  <span>{usedInDesigns.length} design{usedInDesigns.length !== 1 ? "s" : ""}</span>
                                  <svg
                                    className={`w-4 h-4 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    stroke="currentColor"
                                  >
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                  </svg>
                                </button>
                              ) : (
                                <span className="text-slate-500 text-sm">Not used</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <div className="flex items-center justify-end gap-1">
                                {/* Show expand button on smaller screens */}
                                <button
                                  onClick={() => setExpandedColor(isExpanded ? null : item.dmcNumber)}
                                  className="p-1.5 text-slate-400 hover:text-rose-400 transition-colors lg:hidden"
                                  title={`Used in ${usedInDesigns.length} designs`}
                                >
                                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                  </svg>
                                </button>
                                <button
                                  onClick={() => handleDelete(item.id)}
                                  className="p-1.5 text-slate-400 hover:text-red-400 transition-colors"
                                  title="Remove from inventory"
                                >
                                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                  </svg>
                                </button>
                              </div>
                            </td>
                          </tr>
                          {/* Expanded row showing designs */}
                          {isExpanded && usedInDesigns.length > 0 && (
                            <tr>
                              <td colSpan={8} className="px-4 py-3 bg-slate-750">
                                <div className="pl-4 border-l-2 border-rose-800">
                                  <p className="text-xs text-slate-400 mb-2">Used in {usedInDesigns.length} design{usedInDesigns.length !== 1 ? "s" : ""}:</p>
                                  <div className="flex flex-wrap gap-2">
                                    {usedInDesigns.map((design) => (
                                      <div
                                        key={design.id}
                                        className="flex items-center gap-2 bg-slate-700 rounded-lg px-3 py-1.5"
                                      >
                                        {design.previewImageUrl ? (
                                          <img
                                            src={design.previewImageUrl}
                                            alt={design.name}
                                            className="w-6 h-6 object-cover rounded"
                                          />
                                        ) : (
                                          <div className="w-6 h-6 bg-slate-600 rounded flex items-center justify-center">
                                            <svg className="w-3 h-3 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                            </svg>
                                          </div>
                                        )}
                                        <span className="text-sm text-white">{design.name}</span>
                                        <span className={`text-xs px-1.5 py-0.5 rounded ${
                                          design.meshCount === 14 ? "bg-blue-900/50 text-blue-300" : "bg-purple-900/50 text-purple-300"
                                        }`}>
                                          {design.meshCount}
                                        </span>
                                        {/* Yarn usage */}
                                        <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-900/50 text-emerald-300">
                                          {design.bobbinYards > 0
                                            ? `${Math.round(design.bobbinYards * 10) / 10} yd`
                                            : `${design.fullSkeins} skein${design.fullSkeins !== 1 ? "s" : ""}`}
                                        </span>
                                        {/* Action buttons */}
                                        <div className="flex items-center gap-1 ml-1">
                                          <Link
                                            href={`/design/${design.id}`}
                                            className="p-1 text-slate-400 hover:text-white hover:bg-slate-600 rounded transition-colors"
                                            title="Edit design"
                                          >
                                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                            </svg>
                                          </Link>
                                          <Link
                                            href={`/design/${design.id}/kit`}
                                            className="p-1 text-slate-400 hover:text-emerald-400 hover:bg-slate-600 rounded transition-colors"
                                            title="View kit"
                                          >
                                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                                            </svg>
                                          </Link>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {/* Kits Ready Tab */}
        {activeTab === "kits" && (
          <>
            {/* Stats bar */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
              <div className="bg-slate-800 rounded-lg p-3 border border-slate-700">
                <p className="text-xs text-slate-400 uppercase tracking-wider">Total Kits Ready</p>
                <p className="text-xl font-bold text-white">{totalKitsReady}</p>
              </div>
              <div className="bg-slate-800 rounded-lg p-3 border border-slate-700">
                <p className="text-xs text-slate-400 uppercase tracking-wider">Designs</p>
                <p className="text-xl font-bold text-white">{designs.length}</p>
              </div>
              <div className="bg-slate-800 rounded-lg p-3 border border-slate-700">
                <p className="text-xs text-slate-400 uppercase tracking-wider">With Stock</p>
                <p className="text-xl font-bold text-white">{designs.filter(d => d.kitsReady > 0).length}</p>
              </div>
            </div>

            {/* Search */}
            <div className="mb-6">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search designs..."
                className="w-full max-w-md px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-800"
              />
            </div>

            {/* Designs list grouped by collection */}
            {filteredDesigns.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-slate-400">No designs found</p>
              </div>
            ) : (
              <div className="space-y-6">
                {designsByCollection.map((group) => (
                  <div key={group.folderId || "uncategorized"}>
                    {/* Collection header */}
                    <div className="flex items-center gap-2 mb-3">
                      <svg className="w-5 h-5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                      </svg>
                      <h3 className="text-white font-semibold">{group.folderName}</h3>
                      <span className="text-slate-500 text-sm">
                        ({group.designs.length} design{group.designs.length !== 1 ? "s" : ""} · {group.designs.reduce((sum, d) => sum + d.kitsReady, 0)} kits)
                      </span>
                    </div>

                    {/* Designs in collection */}
                    <div className="grid gap-3 pl-2 md:pl-4 border-l-2 border-slate-700">
                      {group.designs.map((design) => {
                        const isExpanded = expandedKits.has(design.id);
                        const kitContents = kitContentsCache.get(design.id);
                        const isLoading = loadingKitContents.has(design.id);

                        return (
                          <div
                            key={design.id}
                            className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden"
                          >
                            {/* Main row */}
                            <div className="p-3 md:p-4 flex items-center gap-3 md:gap-4">
                              {/* Preview */}
                              <Link href={`/design/${design.id}/info`} className="flex-shrink-0">
                                {design.previewImageUrl ? (
                                  <img
                                    src={design.previewImageUrl}
                                    alt={design.name}
                                    className="w-12 h-12 md:w-16 md:h-16 object-cover rounded-lg border border-slate-600"
                                  />
                                ) : (
                                  <div className="w-12 h-12 md:w-16 md:h-16 bg-slate-700 rounded-lg border border-slate-600 flex items-center justify-center">
                                    <svg className="w-5 h-5 md:w-6 md:h-6 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                    </svg>
                                  </div>
                                )}
                              </Link>

                              {/* Info */}
                              <div className="flex-1 min-w-0">
                                <Link href={`/design/${design.id}/info`} className="text-white font-medium hover:text-rose-400 truncate block text-sm md:text-base">
                                  {design.name}
                                </Link>
                                <button
                                  onClick={() => toggleKitExpansion(design.id)}
                                  className="text-slate-400 text-xs md:text-sm hover:text-rose-400 flex items-center gap-1"
                                >
                                  {design.kitColorCount} colors · {design.kitSkeinCount} skeins/kit
                                  <svg
                                    className={`w-3 h-3 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    stroke="currentColor"
                                  >
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                  </svg>
                                </button>
                              </div>

                              {/* Kits Ready control */}
                              <div className="flex items-center gap-1 md:gap-2">
                                <button
                                  onClick={() => handleUpdateDesign(design.id, "kitsReady", -1)}
                                  className="p-1.5 text-slate-400 hover:text-white transition-colors rounded hover:bg-slate-700"
                                  disabled={design.kitsReady <= 0}
                                >
                                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                                  </svg>
                                </button>
                                <input
                                  type="number"
                                  min="0"
                                  value={pendingKits[design.id] ?? design.kitsReady}
                                  onChange={(e) => setPendingKits((prev) => ({ ...prev, [design.id]: e.target.value }))}
                                  onBlur={() => {
                                    const val = pendingKits[design.id];
                                    if (val !== undefined) {
                                      handleSetDesignValue(design.id, "kitsReady", Number(val));
                                    }
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      const val = pendingKits[design.id];
                                      if (val !== undefined) {
                                        handleSetDesignValue(design.id, "kitsReady", Number(val));
                                      }
                                      (e.target as HTMLInputElement).blur();
                                    }
                                  }}
                                  className="w-14 md:w-16 px-2 py-1 bg-slate-700 border border-slate-600 rounded text-white text-sm text-center focus:outline-none focus:ring-2 focus:ring-rose-800"
                                />
                                <button
                                  onClick={() => handleUpdateDesign(design.id, "kitsReady", 1)}
                                  className="p-1.5 text-slate-400 hover:text-white transition-colors rounded hover:bg-slate-700"
                                >
                                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                  </svg>
                                </button>
                              </div>
                            </div>

                            {/* Expanded kit contents */}
                            {isExpanded && (
                              <div className="border-t border-slate-700 bg-slate-900/50 p-3 md:p-4">
                                {isLoading ? (
                                  <div className="flex items-center justify-center py-4">
                                    <div className="w-5 h-5 border-2 border-rose-400 border-t-transparent rounded-full animate-spin"></div>
                                    <span className="ml-2 text-slate-400 text-sm">Loading kit contents...</span>
                                  </div>
                                ) : kitContents ? (
                                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                                    {kitContents.kitContents.map((item) => {
                                      const colorUsageKey = `${design.id}-${item.dmcNumber}`;
                                      const isColorExpanded = expandedColors.has(colorUsageKey);
                                      const isUpdating = updatingInventory === item.dmcNumber;
                                      const otherDesigns = (colorUsage.get(item.dmcNumber) || []).filter(
                                        (d) => d.id !== design.id
                                      );
                                      return (
                                        <div
                                          key={item.dmcNumber}
                                          className={`rounded-lg bg-slate-800/50 ${
                                            !item.inStock ? "ring-1 ring-red-500" : ""
                                          }`}
                                        >
                                          <div className="flex items-center gap-2 p-2">
                                            <Link
                                              href={`/inventory/color/${item.dmcNumber}`}
                                              className="w-8 h-8 rounded flex-shrink-0 flex items-center justify-center hover:ring-2 hover:ring-rose-500 transition-all"
                                              style={{ backgroundColor: item.hex }}
                                              title={`View DMC ${item.dmcNumber} inventory`}
                                            >
                                              <span
                                                className="text-[7px] font-bold"
                                                style={{ color: getContrastTextColor(item.hex) }}
                                              >
                                                {item.dmcNumber}
                                              </span>
                                            </Link>
                                            <div className="min-w-0 flex-1">
                                              <Link
                                                href={`/inventory/color/${item.dmcNumber}`}
                                                className="text-white text-xs font-medium truncate hover:text-rose-400 transition-colors block"
                                              >
                                                {item.dmcNumber}
                                              </Link>
                                              <p className={`text-xs ${item.bobbinYards > 0 ? "text-amber-400" : "text-slate-400"}`}>
                                                {item.fullSkeins > 0
                                                  ? `Need ${item.fullSkeins} skein${item.fullSkeins > 1 ? "s" : ""}`
                                                  : `${item.bobbinYards} yd bobbin`
                                                }
                                              </p>
                                            </div>
                                            {/* Inventory with +/- buttons and editable input */}
                                            <div className="flex flex-col items-end gap-1 flex-shrink-0">
                                              <div className="flex items-center gap-1">
                                                <button
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleKitInventoryUpdate(item.dmcNumber, -1);
                                                  }}
                                                  disabled={isUpdating || item.inventorySkeins <= 0}
                                                  className="p-0.5 text-slate-400 hover:text-white transition-colors rounded hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed"
                                                  title="Remove 1"
                                                >
                                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                                                  </svg>
                                                </button>
                                                <input
                                                  type="number"
                                                  min="0"
                                                  value={pendingInventoryValues[item.dmcNumber] ?? item.inventorySkeins}
                                                  onClick={(e) => e.stopPropagation()}
                                                  onChange={(e) => {
                                                    setPendingInventoryValues((prev) => ({ ...prev, [item.dmcNumber]: e.target.value }));
                                                  }}
                                                  onBlur={() => {
                                                    const val = pendingInventoryValues[item.dmcNumber];
                                                    if (val !== undefined) {
                                                      handleSetKitInventory(item.dmcNumber, Number(val));
                                                    }
                                                  }}
                                                  onKeyDown={(e) => {
                                                    if (e.key === "Enter") {
                                                      const val = pendingInventoryValues[item.dmcNumber];
                                                      if (val !== undefined) {
                                                        handleSetKitInventory(item.dmcNumber, Number(val));
                                                      }
                                                      (e.target as HTMLInputElement).blur();
                                                    }
                                                  }}
                                                  className={`w-12 px-1 py-0.5 bg-slate-700 border border-slate-600 rounded text-xs text-center font-medium focus:outline-none focus:ring-2 focus:ring-emerald-600 ${item.primaryInStock !== false ? "text-emerald-400" : "text-red-400"}`}
                                                />
                                                <button
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleKitInventoryUpdate(item.dmcNumber, 1);
                                                  }}
                                                  disabled={isUpdating}
                                                  className="p-0.5 text-slate-400 hover:text-white transition-colors rounded hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed"
                                                  title="Add 1"
                                                >
                                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                                  </svg>
                                                </button>
                                              </div>
                                              {/* Backup color indicator */}
                                              {item.backup && (
                                                <Link
                                                  href={`/inventory/color/${item.backup.dmcNumber}`}
                                                  className="flex items-center gap-1.5 px-1.5 py-0.5 rounded bg-amber-900/30 border border-amber-800/50 hover:bg-amber-900/50 transition-colors"
                                                  title={`Backup: ${item.backup.colorName}`}
                                                  onClick={(e) => e.stopPropagation()}
                                                >
                                                  <span
                                                    className="w-6 h-6 rounded flex items-center justify-center border border-white/20"
                                                    style={{ backgroundColor: item.backup.hex }}
                                                  >
                                                    <span
                                                      className="text-[7px] font-bold"
                                                      style={{ color: getContrastTextColor(item.backup.hex) }}
                                                    >
                                                      {item.backup.dmcNumber}
                                                    </span>
                                                  </span>
                                                  <span className={`text-[10px] font-medium ${item.backup.inStock ? "text-emerald-400" : "text-red-400"}`}>
                                                    {item.backup.inventorySkeins} sk
                                                  </span>
                                                </Link>
                                              )}
                                            </div>
                                          </div>
                                          {/* Color usage indicator */}
                                          {otherDesigns.length > 0 ? (
                                            <>
                                              <button
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  setExpandedColors((prev) => {
                                                    const next = new Set(prev);
                                                    if (next.has(colorUsageKey)) {
                                                      next.delete(colorUsageKey);
                                                    } else {
                                                      next.add(colorUsageKey);
                                                    }
                                                    return next;
                                                  });
                                                }}
                                                className="w-full px-2 py-1 text-[10px] text-slate-400 hover:text-slate-300 hover:bg-slate-700/50 flex items-center justify-center gap-1 border-t border-slate-700/50"
                                              >
                                                <span>Used in {otherDesigns.length} other design{otherDesigns.length !== 1 ? "s" : ""}</span>
                                                <svg
                                                  className={`w-3 h-3 transition-transform ${isColorExpanded ? "rotate-180" : ""}`}
                                                  fill="none"
                                                  viewBox="0 0 24 24"
                                                  stroke="currentColor"
                                                >
                                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                                </svg>
                                              </button>
                                              {isColorExpanded && (
                                                <div className="px-2 pb-2 border-t border-slate-700/50 space-y-1 max-h-32 overflow-y-auto">
                                                  {otherDesigns.map((otherDesign) => (
                                                    <Link
                                                      key={otherDesign.id}
                                                      href={`/design/${otherDesign.id}/kit`}
                                                      onClick={(e) => e.stopPropagation()}
                                                      className="flex items-center gap-2 p-1.5 rounded bg-slate-700/30 hover:bg-slate-700/60 transition-colors"
                                                    >
                                                      {otherDesign.previewImageUrl ? (
                                                        <img
                                                          src={otherDesign.previewImageUrl}
                                                          alt={otherDesign.name}
                                                          className="w-6 h-6 object-cover rounded"
                                                        />
                                                      ) : (
                                                        <div className="w-6 h-6 bg-slate-600 rounded flex items-center justify-center">
                                                          <svg className="w-3 h-3 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                                          </svg>
                                                        </div>
                                                      )}
                                                      <div className="min-w-0 flex-1">
                                                        <p className="text-[10px] text-white truncate">{otherDesign.name}</p>
                                                        <p className="text-[9px] text-slate-400">
                                                          {otherDesign.bobbinYards > 0 && otherDesign.fullSkeins === 0
                                                          ? `${otherDesign.bobbinYards} yd`
                                                          : `${otherDesign.fullSkeins} sk`}
                                                        </p>
                                                      </div>
                                                    </Link>
                                                  ))}
                                                </div>
                                              )}
                                            </>
                                          ) : (
                                            <div className="w-full px-2 py-1 text-[10px] text-slate-500 flex items-center justify-center border-t border-slate-700/50">
                                              <span>Only in this design</span>
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                ) : (
                                  <p className="text-slate-400 text-sm">Failed to load kit contents</p>
                                )}
                                {kitContents && (
                                  <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
                                    <span>
                                      {kitContents.totals.colors} colors · {kitContents.totals.skeins} skeins total
                                      {kitContents.totals.bobbins > 0 && ` · ${kitContents.totals.bobbins} bobbins`}
                                    </span>
                                    <Link
                                      href={`/design/${design.id}/kit`}
                                      className="text-rose-400 hover:text-rose-300"
                                    >
                                      View full kit details →
                                    </Link>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* Canvases Printed Tab */}
        {activeTab === "canvases" && (
          <>
            {/* Stats bar */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              <div className="bg-slate-800 rounded-lg p-3 border border-slate-700">
                <p className="text-xs text-slate-400 uppercase tracking-wider">Here (Main)</p>
                <p className="text-xl font-bold text-emerald-400">{mainCanvases}</p>
              </div>
              <div className="bg-slate-800 rounded-lg p-3 border border-slate-700">
                <p className="text-xs text-slate-400 uppercase tracking-wider">Maddie&apos;s</p>
                <p className="text-xl font-bold text-amber-400">{maddieCanvases}</p>
              </div>
              <div className="bg-slate-800 rounded-lg p-3 border border-slate-700">
                <p className="text-xs text-slate-400 uppercase tracking-wider">Combined Total</p>
                <p className="text-xl font-bold text-white">{allCanvases}</p>
              </div>
              <div className="bg-slate-800 rounded-lg p-3 border border-slate-700">
                <p className="text-xs text-slate-400 uppercase tracking-wider">Designs</p>
                <p className="text-xl font-bold text-white">{designs.length}</p>
              </div>
            </div>

            {/* Search */}
            <div className="mb-6">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search designs..."
                className="w-full max-w-md px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-800"
              />
            </div>

            {/* Designs list grouped by collection */}
            {filteredDesigns.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-slate-400">No designs found</p>
              </div>
            ) : (
              <div className="space-y-6">
                {designsByCollection.map((group) => (
                  <div key={group.folderId || "uncategorized"}>
                    {/* Collection header */}
                    <div className="flex items-center gap-2 mb-3">
                      <svg className="w-5 h-5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                      </svg>
                      <h3 className="text-white font-semibold">{group.folderName}</h3>
                      <span className="text-slate-500 text-sm">
                        ({group.designs.length} design{group.designs.length !== 1 ? "s" : ""} · {group.designs.reduce((sum, d) => sum + d.canvasPrinted, 0)} canvases)
                      </span>
                    </div>

                    {/* Designs in collection */}
                    <div className="grid gap-3 pl-2 md:pl-4 border-l-2 border-slate-700">
                      {group.designs.map((design) => (
                        <div
                          key={design.id}
                          className="bg-slate-800 rounded-xl border border-slate-700 p-3 md:p-4 flex items-center gap-3 md:gap-4"
                        >
                          {/* Preview */}
                          <Link href={`/design/${design.id}/info`} className="flex-shrink-0">
                            {design.previewImageUrl ? (
                              <img
                                src={design.previewImageUrl}
                                alt={design.name}
                                className="w-12 h-12 md:w-16 md:h-16 object-cover rounded-lg border border-slate-600"
                              />
                            ) : (
                              <div className="w-12 h-12 md:w-16 md:h-16 bg-slate-700 rounded-lg border border-slate-600 flex items-center justify-center">
                                <svg className="w-5 h-5 md:w-6 md:h-6 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                </svg>
                              </div>
                            )}
                          </Link>

                          {/* Info */}
                          <div className="flex-1 min-w-0">
                            <Link href={`/design/${design.id}/info`} className="text-white font-medium hover:text-rose-400 truncate block text-sm md:text-base">
                              {design.name}
                            </Link>
                            <p className="text-slate-400 text-xs md:text-sm">
                              {design.widthInches}&quot; × {design.heightInches}&quot; @ {design.meshCount} mesh
                            </p>
                          </div>

                          {/* Canvases controls - Main (Here) */}
                          <div className="flex flex-col md:flex-row items-end md:items-center gap-2 md:gap-4">
                            {/* Main location */}
                            <div className="flex items-center gap-1">
                              <span className="text-xs text-emerald-400 mr-1 hidden md:inline">Here:</span>
                              <button
                                onClick={() => handleUpdateDesign(design.id, "canvasPrinted", -1)}
                                className="p-1 text-slate-400 hover:text-white transition-colors rounded hover:bg-slate-700"
                                disabled={design.canvasPrinted <= 0}
                              >
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                                </svg>
                              </button>
                              <input
                                type="number"
                                min="0"
                                value={pendingCanvases[design.id] ?? design.canvasPrinted}
                                onChange={(e) => setPendingCanvases((prev) => ({ ...prev, [design.id]: e.target.value }))}
                                onBlur={() => {
                                  const val = pendingCanvases[design.id];
                                  if (val !== undefined) {
                                    handleSetDesignValue(design.id, "canvasPrinted", Number(val));
                                  }
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    const val = pendingCanvases[design.id];
                                    if (val !== undefined) {
                                      handleSetDesignValue(design.id, "canvasPrinted", Number(val));
                                    }
                                    (e.target as HTMLInputElement).blur();
                                  }
                                }}
                                className="w-12 px-1 py-1 bg-emerald-900/30 border border-emerald-700/50 rounded text-emerald-300 text-sm text-center focus:outline-none focus:ring-2 focus:ring-emerald-600"
                              />
                              <button
                                onClick={() => handleUpdateDesign(design.id, "canvasPrinted", 1)}
                                className="p-1 text-slate-400 hover:text-white transition-colors rounded hover:bg-slate-700"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                </svg>
                              </button>
                            </div>

                            {/* Maddie's location with transfer */}
                            <div className="flex items-center gap-1">
                              <span className="text-xs text-amber-400 mr-1 hidden md:inline">Maddie:</span>
                              <button
                                onClick={() => handleUpdateDesign(design.id, "canvasPrintedMaddie", -1)}
                                className="p-1 text-slate-400 hover:text-white transition-colors rounded hover:bg-slate-700"
                                disabled={(design.canvasPrintedMaddie || 0) <= 0}
                              >
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                                </svg>
                              </button>
                              <input
                                type="number"
                                min="0"
                                value={pendingCanvasesMaddie[design.id] ?? (design.canvasPrintedMaddie || 0)}
                                onChange={(e) => setPendingCanvasesMaddie((prev) => ({ ...prev, [design.id]: e.target.value }))}
                                onBlur={() => {
                                  const val = pendingCanvasesMaddie[design.id];
                                  if (val !== undefined) {
                                    handleSetDesignValue(design.id, "canvasPrintedMaddie", Number(val));
                                  }
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    const val = pendingCanvasesMaddie[design.id];
                                    if (val !== undefined) {
                                      handleSetDesignValue(design.id, "canvasPrintedMaddie", Number(val));
                                    }
                                    (e.target as HTMLInputElement).blur();
                                  }
                                }}
                                className="w-12 px-1 py-1 bg-amber-900/30 border border-amber-700/50 rounded text-amber-300 text-sm text-center focus:outline-none focus:ring-2 focus:ring-amber-600"
                              />
                              <button
                                onClick={() => handleUpdateDesign(design.id, "canvasPrintedMaddie", 1)}
                                className="p-1 text-slate-400 hover:text-white transition-colors rounded hover:bg-slate-700"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                </svg>
                              </button>
                              {/* Transfer button */}
                              {(design.canvasPrintedMaddie || 0) > 0 && (
                                <button
                                  onClick={() => handleCanvasTransfer(design.id)}
                                  disabled={transferringCanvas === design.id}
                                  className="ml-1 p-1 text-amber-400 hover:text-emerald-400 transition-colors rounded hover:bg-slate-700 disabled:opacity-50"
                                  title="Transfer all to main"
                                >
                                  {transferringCanvas === design.id ? (
                                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                    </svg>
                                  ) : (
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                                    </svg>
                                  )}
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}


        {/* Supplies Tab */}
        {activeTab === "supplies" && (
          <>
            {/* Header with Add button */}
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold text-white">Supplies Inventory</h2>
                <p className="text-sm text-slate-400">Track needles, finishers, needle minders, and other supplies</p>
              </div>
              <button
                onClick={() => {
                  setShowAddSupply(true);
                  setEditingSupplyId(null);
                  setSupplyForm({ name: "", sku: "", description: "", quantity: 0 });
                }}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add Supply
              </button>
            </div>

            {/* Info box */}
            <div className="p-4 bg-slate-800 border border-slate-700 rounded-lg mb-4">
              <p className="text-sm text-slate-400">
                Supply names must match Shopify product titles exactly for automatic order matching.
              </p>
            </div>

            {suppliesLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="text-slate-400 flex items-center gap-3">
                  <svg className="animate-spin h-6 w-6" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Loading supplies...
                </div>
              </div>
            ) : supplies.length === 0 ? (
              <div className="bg-slate-800 rounded-xl border border-slate-700 p-8 text-center">
                <svg className="w-12 h-12 mx-auto text-slate-600 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
                <p className="text-slate-400">No supplies added yet</p>
                <p className="text-sm text-slate-500 mt-2">Click &quot;Add Supply&quot; to start tracking supply inventory</p>
              </div>
            ) : (
              <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
                <div className="divide-y divide-slate-700/50">
                  {supplies.map((supply) => (
                    <div key={supply.id} className="p-4 flex items-center gap-4">
                      <div className="w-12 h-12 rounded-lg bg-purple-900/30 border border-purple-700/50 flex items-center justify-center flex-shrink-0">
                        <svg className="w-6 h-6 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                        </svg>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-white font-medium truncate">{supply.name}</p>
                        {supply.sku && <p className="text-xs text-slate-500">SKU: {supply.sku}</p>}
                        {supply.description && <p className="text-xs text-slate-400 truncate">{supply.description}</p>}
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleSupplyQuantityChange(supply.id, -1)}
                          disabled={supply.quantity <= 0}
                          className="p-1.5 text-slate-400 hover:text-white transition-colors rounded hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed"
                          title="Remove 1"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                          </svg>
                        </button>
                        <input
                          type="number"
                          min="0"
                          value={pendingSupplyQuantity[supply.id] ?? supply.quantity}
                          onChange={(e) => setPendingSupplyQuantity((prev) => ({ ...prev, [supply.id]: e.target.value }))}
                          onBlur={() => {
                            const val = pendingSupplyQuantity[supply.id];
                            if (val !== undefined) {
                              handleSetSupplyQuantity(supply.id, Number(val));
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              const val = pendingSupplyQuantity[supply.id];
                              if (val !== undefined) {
                                handleSetSupplyQuantity(supply.id, Number(val));
                              }
                              (e.target as HTMLInputElement).blur();
                            }
                          }}
                          className="w-16 px-2 py-1 bg-slate-700 border border-slate-600 rounded text-white text-sm text-center focus:outline-none focus:ring-2 focus:ring-purple-800"
                        />
                        <button
                          onClick={() => handleSupplyQuantityChange(supply.id, 1)}
                          className="p-1.5 text-slate-400 hover:text-white transition-colors rounded hover:bg-slate-700"
                          title="Add 1"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                          </svg>
                        </button>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => {
                            setEditingSupplyId(supply.id);
                            setSupplyForm({
                              name: supply.name,
                              sku: supply.sku || "",
                              description: supply.description || "",
                              quantity: supply.quantity,
                            });
                            setShowAddSupply(true);
                          }}
                          className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg"
                          title="Edit"
                        >
                          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => handleDeleteSupply(supply.id)}
                          className="p-2 text-slate-400 hover:text-red-400 hover:bg-slate-700 rounded-lg"
                          title="Delete"
                        >
                          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Add/Edit Supply Modal */}
      {showAddSupply && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-xl border border-slate-700 w-full max-w-lg">
            <div className="p-4 border-b border-slate-700 flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">
                {editingSupplyId ? "Edit Supply" : "Add New Supply"}
              </h2>
              <button
                onClick={() => {
                  setShowAddSupply(false);
                  setEditingSupplyId(null);
                  setSupplyForm({ name: "", sku: "", description: "", quantity: 0 });
                }}
                className="p-1 text-slate-400 hover:text-white"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <label className="block text-sm text-slate-400 mb-1">Name *</label>
                <input
                  type="text"
                  value={supplyForm.name}
                  onChange={(e) => setSupplyForm({ ...supplyForm, name: e.target.value })}
                  placeholder="Exact Shopify product title"
                  className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
                <p className="text-xs text-slate-500 mt-1">Must match Shopify product title exactly</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-slate-400 mb-1">SKU</label>
                  <input
                    type="text"
                    value={supplyForm.sku}
                    onChange={(e) => setSupplyForm({ ...supplyForm, sku: e.target.value })}
                    placeholder="Optional"
                    className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>
                <div>
                  <label className="block text-sm text-slate-400 mb-1">Quantity</label>
                  <input
                    type="number"
                    value={supplyForm.quantity}
                    onChange={(e) => setSupplyForm({ ...supplyForm, quantity: parseInt(e.target.value) || 0 })}
                    min="0"
                    className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">Description</label>
                <textarea
                  value={supplyForm.description}
                  onChange={(e) => setSupplyForm({ ...supplyForm, description: e.target.value })}
                  placeholder="Optional"
                  rows={2}
                  className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>
            </div>
            <div className="p-4 border-t border-slate-700 flex gap-3">
              <button
                onClick={() => {
                  setShowAddSupply(false);
                  setEditingSupplyId(null);
                  setSupplyForm({ name: "", sku: "", description: "", quantity: 0 });
                }}
                className="flex-1 py-2.5 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600 text-sm font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveSupply}
                disabled={!supplyForm.name.trim() || savingSupply}
                className="flex-1 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
              >
                {savingSupply ? "Saving..." : editingSupplyId ? "Update" : "Add Supply"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Thread Modal */}
      {showAddForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-xl border border-slate-700 w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
            <div className="p-4 border-b border-slate-700 flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">Add Thread to Inventory</h2>
              <button
                onClick={() => {
                  setShowAddForm(false);
                  setSelectedColor(null);
                  setAddSearch("");
                  setAddSkeins("1");
                }}
                className="p-1 text-slate-400 hover:text-white"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-4 space-y-4 overflow-y-auto flex-1">
              {/* Selected color preview */}
              {selectedColor && (
                <div className="flex items-center gap-3 p-3 bg-slate-700 rounded-lg">
                  <div
                    className="w-12 h-12 rounded-lg border-2 border-white/20 flex items-center justify-center"
                    style={{ backgroundColor: selectedColor.hex }}
                  >
                    <span
                      className="text-[8px] font-bold"
                      style={{ color: getContrastTextColor(selectedColor.hex) }}
                    >
                      {selectedColor.dmcNumber}
                    </span>
                  </div>
                  <div className="flex-1">
                    <p className="text-white font-medium">DMC {selectedColor.dmcNumber}</p>
                    <p className="text-slate-400 text-sm">{selectedColor.name}</p>
                  </div>
                  <button
                    onClick={() => setSelectedColor(null)}
                    className="p-1 text-slate-400 hover:text-white"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              )}

              {/* Color search */}
              {!selectedColor && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1">Search DMC Color</label>
                    <input
                      type="text"
                      value={addSearch}
                      onChange={(e) => setAddSearch(e.target.value)}
                      placeholder="Type DMC number or color name..."
                      className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-800"
                      autoFocus
                    />
                  </div>

                  {addSearch && (
                    <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-600">
                      {addColorResults.length === 0 ? (
                        <p className="text-slate-400 text-sm p-3">No colors found</p>
                      ) : (
                        addColorResults.map((color) => (
                          <button
                            key={color.dmcNumber}
                            onClick={() => {
                              setSelectedColor(color);
                              setAddSearch("");
                            }}
                            className="w-full flex items-center gap-3 p-2 hover:bg-slate-700 transition-colors text-left"
                          >
                            <div
                              className="w-8 h-8 rounded border border-white/20 flex-shrink-0"
                              style={{ backgroundColor: color.hex }}
                            />
                            <div>
                              <span className="text-white text-sm font-medium">DMC {color.dmcNumber}</span>
                              <span className="text-slate-400 text-sm ml-2">{color.name}</span>
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </>
              )}

              {/* Thread size - Size 5 only in internal app */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Thread Size</label>
                <div className="py-2 px-4 rounded-lg border border-slate-600 bg-slate-700/50 text-slate-300 text-center">
                  <span className="text-sm font-medium">Size 5</span>
                  <span className="text-xs text-slate-400 ml-2">(14 mesh)</span>
                </div>
              </div>

              {/* Skeins input */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">
                  Number of Skeins
                  <span className="text-slate-500 font-normal ml-1">(1 skein = 27 yards)</span>
                </label>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setAddSkeins(String(Math.max(1, (Number(addSkeins) || 1) - 1)))}
                    className="p-2 bg-slate-700 rounded-lg text-slate-300 hover:bg-slate-600"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                    </svg>
                  </button>
                  <input
                    type="number"
                    min="1"
                    value={addSkeins}
                    onChange={(e) => setAddSkeins(e.target.value)}
                    onBlur={() => setAddSkeins(String(Math.max(1, Number(addSkeins) || 1)))}
                    className="w-20 px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-center focus:outline-none focus:ring-2 focus:ring-rose-800"
                  />
                  <button
                    onClick={() => setAddSkeins(String((Number(addSkeins) || 0) + 1))}
                    className="p-2 bg-slate-700 rounded-lg text-slate-300 hover:bg-slate-600"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                  </button>
                  <span className="text-slate-400 text-sm">{(Number(addSkeins) || 0) * 27} yards</span>
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-slate-700 flex gap-3">
              <button
                onClick={() => {
                  setShowAddForm(false);
                  setSelectedColor(null);
                  setAddSearch("");
                  setAddSkeins("1");
                }}
                className="flex-1 py-2.5 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600 text-sm font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleAdd}
                disabled={!selectedColor || adding}
                className="flex-1 py-2.5 bg-gradient-to-r from-rose-900 to-rose-800 text-white rounded-lg hover:from-rose-950 hover:to-rose-900 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
              >
                {adding ? "Adding..." : "Add to Inventory"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
