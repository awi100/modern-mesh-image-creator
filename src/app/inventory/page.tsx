"use client";

import React, { useEffect, useState, useMemo, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import SectionNav from "@/components/SectionNav";
import { DmcColor, searchDmcColors, getDmcColorByNumber } from "@/lib/dmc-pearl-cotton";
import { Breadcrumb } from "@/components/Breadcrumb";
import MeshFilterChips, { MeshFilter } from "@/components/MeshFilterChips";
import { meshBadgeClassLight } from "@/lib/mesh-badge";
import { threadSizeForMesh, skeinYardsForThread, MeshCount, ThreadSize } from "@/lib/yarn-calculator";
import { invalidateInventory } from "@/lib/invalidate-inventory";
import CountStepper from "@/components/inventory/CountStepper";
import { rowInStock } from "@/lib/kit-stock";
import { LOW_ON_HAND, RESTOCK_TARGET } from "@/lib/stock-targets";



// Wrap any inventory-changing fetch so that on success we invalidate every
// page's SWR cache — this is what makes an edit here show up immediately on the
// Kits/Home/Color/Orders pages instead of only after a manual refresh.
async function mutApi(url: string, init: RequestInit): Promise<Response> {
  const res = await fetch(url, init);
  if (res.ok) invalidateInventory();
  return res;
}

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
  marketKitsReady: number;
  marketCanvasPrinted: number;
  canvasAndover: number;
  kitsAndover: number;
  misprintCount: number;
  isDraft: boolean;
  notLiveAt: string | null;
  archivedAt: string | null;
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

const TAB_TYPES = ["threads", "kits", "canvases", "market", "supplies", "bobbins", "misprints"] as const;
type TabType = (typeof TAB_TYPES)[number];

interface Supply {
  id: string;
  name: string;
  sku: string | null;
  description: string | null;
  imageUrl: string | null;
  quantity: number;
  marketQuantity: number;
  andoverQuantity: number;
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

interface BobbinDesign {
  id: string;
  name: string;
  previewImageUrl: string | null;
  exactYards: number;
}

interface BobbinSuggestion {
  dmcNumber: string;
  colorName: string;
  hex: string;
  // Size 3 (13ct) or Size 5 (14/18ct). The old `5 | 8` was wrong on both
  // counts — 8 is public-app legacy and 3 was missing entirely.
  threadSize: ThreadSize;
  length: number;
  quantity: number;
  onHand: number;
  make: number;
  designs: BobbinDesign[];
}

interface BobbinAnalysisSummary {
  totalColors: number;
  totalBobbins: number;
  mostCommonLengths: { length: number; count: number }[];
}

interface BobbinAnalysisData {
  suggestions: BobbinSuggestion[];
  summary: BobbinAnalysisSummary;
}

function getContrastTextColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? "#000000" : "#FFFFFF";
}

// Returns items in a sorted order that stays STABLE while you edit counts —
// the order is only recomputed when `sig` changes (sort mode / tab / filter /
// search) or when the set of item ids changes (add/remove). Editing a count
// updates the numbers in place without re-sorting, so rows don't jump under
// the cursor mid-click. Counts shown are always live (mapped from current items).
function useFrozenSort<T extends { id: string }>(
  items: T[],
  sig: string,
  comparator: (a: T, b: T) => number
): T[] {
  const ref = useRef<{ sig: string; ids: string[] }>({ sig: "\u0000", ids: [] });
  return useMemo(() => {
    const membership = items.map((i) => i.id).slice().sort().join(",");
    const fullSig = `${sig}|${membership}`;
    if (ref.current.sig !== fullSig) {
      ref.current = { sig: fullSig, ids: items.slice().sort(comparator).map((i) => i.id) };
    }
    const byId = new Map(items.map((i) => [i.id, i]));
    return ref.current.ids
      .map((id) => byId.get(id))
      .filter((x): x is T => x != null);
    // comparator intentionally omitted — sort intent is captured by `sig`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, sig]);
}

// Sort-by-total-inventory control shared by the kits, canvases, and supplies tabs.
function SortControls({
  value,
  onChange,
}: {
  value: "default" | "high" | "low";
  onChange: (v: "default" | "high" | "low") => void;
}) {
  const options: { key: "default" | "high" | "low"; label: string }[] = [
    { key: "default", label: "Default" },
    { key: "high", label: "Most stock" },
    { key: "low", label: "Least stock" },
  ];
  return (
    <div className="inline-flex items-center gap-1 rounded-lg bg-slate-800 border border-slate-700 p-1">
      <span className="px-2 text-xs uppercase tracking-wider text-slate-500 hidden sm:inline">Sort</span>
      {options.map((o) => (
        <button
          key={o.key}
          onClick={() => onChange(o.key)}
          className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
            value === o.key
              ? "bg-rose-900 text-white"
              : "text-slate-300 hover:bg-slate-700"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function InventoryPage() {
  const router = useRouter();
  // Deep-linkable: /inventory?tab=supplies.
  //
  // This route is statically prerendered, so the server HTML always renders the
  // "threads" tab. Reading the URL in the useState INITIALIZER made the client's
  // first render disagree with that HTML — a hydration mismatch that React
  // resolves by throwing away the server tree. Start from the same value the
  // server used and adopt the URL after mount instead.
  const [activeTab, setActiveTab] = useState<TabType>("threads");
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t && TAB_TYPES.includes(t as TabType)) setActiveTab(t as TabType);
  }, []);
  // Market view sub-tab: "current" shows designs that have market canvases in
  // stock; "zero" shows designs with 0 market canvases (sold out / to restock).
  const [marketSubTab, setMarketSubTab] = useState<"current" | "zero">("current");
  // Sort by total inventory count on the kits/canvases/supplies tabs.
  // "default" keeps the collection grouping / original order.
  const [sortMode, setSortMode] = useState<"default" | "high" | "low">("default");
  const [meshFilter, setMeshFilter] = useState<MeshFilter>(() => {
    if (typeof window !== "undefined") {
      return (sessionStorage.getItem("inventoryMeshFilter") as MeshFilter) || "order";
    }
    return "all";
  });
  const handleMeshFilterChange = (f: MeshFilter) => {
    setMeshFilter(f);
    if (typeof window !== "undefined") sessionStorage.setItem("inventoryMeshFilter", f);
  };
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [designs, setDesigns] = useState<Design[]>([]);
  // Misprints are 14ct-only and must NOT be constrained by the mesh filter
  // (which defaults to "order" and would hide most 14ct designs). Fetched
  // separately, always as all 14ct designs.
  const [misprintDesigns, setMisprintDesigns] = useState<Design[]>([]);
  const [colorUsage, setColorUsage] = useState<Map<string, ColorUsageDesign[]>>(new Map());
  const [loading, setLoading] = useState(true);
  // Separate from `loading` (which only gated the Threads tab): the Kits,
  // Canvases, Market and Misprints tabs render off `designs`, which starts as
  // [], so during the first fetch they asserted "No designs found" as fact.
  const [designsLoading, setDesignsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [supplies, setSupplies] = useState<Supply[]>([]);
  const [suppliesLoading, setSuppliesLoading] = useState(false);
  const [showAddSupply, setShowAddSupply] = useState(false);
  const [supplyForm, setSupplyForm] = useState({ name: "", sku: "", description: "", quantity: 0 });
  const [editingSupplyId, setEditingSupplyId] = useState<string | null>(null);
  const [savingSupply, setSavingSupply] = useState(false);
  const [bobbinData, setBobbinData] = useState<BobbinAnalysisData | null>(null);
  const [bobbinsLoading, setBobbinsLoading] = useState(false);
  // Predicted "bring to next market" quantity per design (from Market Prep),
  // shown on the Market tab. Keyed by designId.
  const [marketPrediction, setMarketPrediction] = useState<Map<string, number>>(new Map());
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
  // Guards against a set-market value being committed twice in the same tick
  // (e.g. Enter fires the handler, then .blur() fires onBlur before re-render),
  // which would double the market transfer. Keyed by `${type}-${id}`.
  const marketSetBusyRef = useRef<Set<string>>(new Set());
  // "Move" modal — move a quantity of canvases OR kits between home/market/andover.
  type CanvasLoc = "home" | "market" | "andover";
  type MoveKind = "canvas" | "kit";
  const [moveModal, setMoveModal] = useState<{ kind: MoveKind; designId: string; from: CanvasLoc; to: CanvasLoc; qty: string } | null>(null);
  const [movingCanvas, setMovingCanvas] = useState(false);
  const [matchingAllMarket, setMatchingAllMarket] = useState(false);

  // Kit contents expansion state
  const [expandedKits, setExpandedKits] = useState<Set<string>>(new Set());
  const [kitContentsCache, setKitContentsCache] = useState<Map<string, KitContents>>(new Map());
  const [loadingKitContents, setLoadingKitContents] = useState<Set<string>>(new Set());

  // Color usage expansion state (for showing which designs use each color)
  const [expandedColors, setExpandedColors] = useState<Set<string>>(new Set());

  // Inventory update state
  const [updatingInventory, setUpdatingInventory] = useState<string | null>(null);

  useEffect(() => {
    fetchInventory();
    fetchDesigns();
    fetchColorUsage();
  }, [meshFilter]);

  // Misprint designs (all 14ct) load once, independent of the mesh filter.
  useEffect(() => {
    fetchMisprintDesigns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-fetch counts when the tab regains focus, so POS sales (and any other
  // changes) that happened while this page sat open in the background show up.
  // Without this, market/online numbers can look stale after a market day.
  useEffect(() => {
    const refetch = () => {
      if (document.visibilityState === "visible") {
        fetchInventory();
        fetchDesigns();
        fetchMisprintDesigns();
        // Supplies and bobbins were omitted, so those tabs never self-healed —
        // e.g. picking supplies up from Andover elsewhere left this page showing
        // the old number indefinitely (and a later edit computed its delta from
        // that stale base). This page holds local state, so invalidateInventory()
        // from other pages can't reach it; it has to refetch itself.
        if (supplies.length > 0) fetchSupplies();
        if (bobbinData) fetchBobbins();
      }
    };
    window.addEventListener("focus", refetch);
    document.addEventListener("visibilitychange", refetch);
    return () => {
      window.removeEventListener("focus", refetch);
      document.removeEventListener("visibilitychange", refetch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meshFilter]);

  const handleRefresh = async () => {
    setRefreshing(true);
    // Cached kit panels were never invalidated, so an expanded panel could hold
    // a stale skein count indefinitely. Drop them and refetch what's open.
    setKitContentsCache(new Map());
    await Promise.all([
      fetchInventory(),
      fetchDesigns(),
      fetchColorUsage(),
      fetchMisprintDesigns(),
      supplies.length > 0 ? fetchSupplies() : Promise.resolve(),
      bobbinData ? fetchBobbins() : Promise.resolve(),
    ]);
    setRefreshing(false);
  };

  const fetchColorUsage = async () => {
    try {
      const response = await fetch(`/api/colors/usage${meshFilter !== "all" ? `?meshCount=${meshFilter}` : ""}`);
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
      const response = await fetch(`/api/designs${meshFilter !== "all" ? `?meshCount=${meshFilter}` : ""}`);
      if (response.ok) {
        const data = await response.json();
        // Filter out drafts
        setDesigns(data.filter((d: Design) => !d.isDraft));
      }
    } catch (error) {
      console.error("Error fetching designs:", error);
    } finally {
      setDesignsLoading(false);
    }
  };

  // All 14ct designs for the Misprints tab, independent of the mesh filter.
  // Archived 14ct designs are included here ONLY (they may still have physical
  // misprint stock to track/ship even though they're retired everywhere else).
  const fetchMisprintDesigns = async () => {
    try {
      const [activeRes, archivedRes] = await Promise.all([
        fetch(`/api/designs?meshCount=14`),
        fetch(`/api/designs?meshCount=14&archived=true`),
      ]);
      const active: Design[] = activeRes.ok ? await activeRes.json() : [];
      const archived: Design[] = archivedRes.ok ? await archivedRes.json() : [];
      const byId = new Map<string, Design>();
      for (const d of [...active, ...archived]) {
        if (!d.isDraft) byId.set(d.id, d);
      }
      setMisprintDesigns([...byId.values()]);
    } catch (error) {
      console.error("Error fetching misprint designs:", error);
    }
  };

  // `force` bypasses the cache guard. The error-revert path deletes the cache
  // entry and immediately refetches, but setState hasn't flushed yet, so the
  // closure's `kitContentsCache` still held the entry and this early-returned —
  // leaving the panel empty and permanently stuck on "Failed to load".
  const fetchKitContents = async (designId: string, force = false) => {
    if (loadingKitContents.has(designId)) return;
    if (!force && kitContentsCache.has(designId)) return;

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

  // Update inventory for a color within kit contents.
  // `size` is the thread size for the edited kit's mesh (13ct = Size 3, else Size 5).
  // A 3yd Size 3 skein is a different SKU from a Size 5 skein, so we must write the
  // correct size and only touch cached kits that share that same size/SKU.
  const handleKitInventoryUpdate = async (dmcNumber: string, delta: number, size: number) => {
    const key = `${dmcNumber}-${size}`;
    setUpdatingInventory(key);

    // designId -> thread size, so the optimistic update only touches same-SKU kits.
    const sizeByDesign = new Map(designs.map((d) => [d.id, threadSizeForMesh(d.meshCount as MeshCount)]));

    // Optimistic update for kit contents cache (same-size kits share the SKU)
    setKitContentsCache((prev) => {
      const next = new Map(prev);
      for (const [designId, kit] of next) {
        if (sizeByDesign.get(designId) !== size) continue;
        // A DMC is often BOTH a primary row and another row's backup (the
        // backup map is bidirectional), so update every occurrence — the chip
        // used to keep showing a stale "N sk" until a full refetch. In-stock
        // uses the shared skeinsToStock rule, not the legacy skeinsNeeded.
        const updatedContents = kit.kitContents.map((item) => {
          const isPrimary = item.dmcNumber === dmcNumber;
          const isBackup = item.backup?.dmcNumber === dmcNumber;
          if (!isPrimary && !isBackup) return item;
          const nextSkeins = isPrimary ? Math.max(0, item.inventorySkeins + delta) : item.inventorySkeins;
          const nextBackupSkeins = isBackup && item.backup
            ? Math.max(0, item.backup.inventorySkeins + delta)
            : item.backup?.inventorySkeins ?? null;
          const { primaryInStock, backupInStock, inStock } = rowInStock(item, nextSkeins, nextBackupSkeins);
          return {
            ...item,
            inventorySkeins: nextSkeins,
            backup: item.backup
              ? { ...item.backup, inventorySkeins: nextBackupSkeins ?? item.backup.inventorySkeins, inStock: backupInStock }
              : item.backup,
            primaryInStock,
            inStock,
          };
        });
        next.set(designId, { ...kit, kitContents: updatedContents });
      }
      return next;
    });

    try {
      const response = await mutApi("/api/inventory", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dmcNumber, size, delta }),
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
        fetchKitContents(designId, true);
      }
    } finally {
      setUpdatingInventory(null);
    }
  };

  // Set an absolute inventory value for a colour inside a kit panel.
  //
  // `currentValue` MUST come from the row the user typed into. This used to
  // scan kitContentsCache for the first kit of the same thread size holding
  // that DMC — but cached kit panels are fetched lazily and never invalidated,
  // so two expanded kits can disagree about the same SKU. Typing the correct
  // number into the fresher panel then computed the delta against the stale
  // panel's value and silently destroyed skeins (e.g. confirming "7" against a
  // stale 10 sent -3, taking the real count from 7 to 4).
  const handleSetKitInventory = async (
    dmcNumber: string,
    value: number,
    size: number,
    currentValue: number,
  ) => {
    const delta = Math.max(0, Math.floor(value)) - currentValue;
    if (delta !== 0) {
      await handleKitInventoryUpdate(dmcNumber, delta, size);
    }
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

  // Refetch on every entry into the tab. The old `supplies.length === 0` guard
  // meant supplies were fetched once per session and then went stale after any
  // POS sale or Andover pickup — and it re-fired on every tab switch whenever
  // there were genuinely 0 supplies.
  useEffect(() => {
    if (activeTab === "supplies") fetchSupplies();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const fetchBobbins = async () => {
    setBobbinsLoading(true);
    try {
      const response = await fetch(`/api/inventory/bobbin-analysis${meshFilter !== "all" ? `?meshCount=${meshFilter}` : ""}`);
      if (response.ok) {
        const data = await response.json();
        setBobbinData(data);
      }
    } catch (error) {
      console.error("Error fetching bobbin analysis:", error);
    }
    setBobbinsLoading(false);
  };

  // Fetch bobbins when tab changes to bobbins or mesh filter changes
  useEffect(() => {
    if (activeTab === "bobbins") {
      fetchBobbins();
    }
  }, [activeTab, meshFilter]);

  // Predicted market bring-quantities (balanced buffer) for the Market tab.
  const fetchMarketPrediction = async () => {
    try {
      const res = await fetch("/api/market/prep?buffer=balanced");
      if (res.ok) {
        const data = await res.json();
        const map = new Map<string, number>();
        for (const r of data.rows || []) {
          if (r.designId) map.set(r.designId, r.recommended);
        }
        setMarketPrediction(map);
      }
    } catch (e) {
      console.error("Error fetching market prediction:", e);
    }
  };

  useEffect(() => {
    if (activeTab === "market") fetchMarketPrediction();
  }, [activeTab]);

  // Adjust bobbin inventory count for a (DMC color, length).
  // Updates onHand optimistically; refetches afterwards so trickle-down
  // make values stay accurate (a larger bobbin covers smaller needs).
  // threadSize is REQUIRED: bobbins are keyed by (dmcNumber, length, threadSize)
  // and a 3-yard Size 3 bobbin is a different SKU from a 3-yard Size 5 one.
  // These used to omit it, so the API's `threadSize = 5` default meant every
  // 13ct bobbin edit silently wrote to (and corrupted) the Size 5 row.
  const handleBobbinDelta = async (dmcNumber: string, length: number, threadSize: ThreadSize, delta: number) => {
    setBobbinData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        suggestions: prev.suggestions.map((s) =>
          s.dmcNumber === dmcNumber && s.length === length && s.threadSize === threadSize
            ? { ...s, onHand: Math.max(0, s.onHand + delta) }
            : s
        ),
      };
    });
    try {
      const res = await mutApi("/api/inventory/bobbins", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dmcNumber, length, threadSize, delta }),
      });
      if (!res.ok) console.error("Failed to update bobbin count");
      fetchBobbins();
    } catch (error) {
      console.error("Error updating bobbin count:", error);
      fetchBobbins();
    }
  };

  const handleBobbinSet = async (dmcNumber: string, length: number, threadSize: ThreadSize, count: number) => {
    setBobbinData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        suggestions: prev.suggestions.map((s) =>
          s.dmcNumber === dmcNumber && s.length === length && s.threadSize === threadSize
            ? { ...s, onHand: count }
            : s
        ),
      };
    });
    try {
      const res = await mutApi("/api/inventory/bobbins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dmcNumber, length, threadSize, count }),
      });
      if (!res.ok) console.error("Failed to save bobbin count");
      fetchBobbins();
    } catch (error) {
      console.error("Error saving bobbin count:", error);
      fetchBobbins();
    }
  };

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
      const res = await mutApi(`/api/supplies/${id}`, { method: "DELETE" });
      if (res.ok) {
        setSupplies(supplies.filter((s) => s.id !== id));
      }
    } catch (error) {
      console.error("Error deleting supply:", error);
    }
  };

  const handleSupplyQuantityChange = async (id: string, delta: number) => {
    // Functional update: reading `supplies` from the closure meant two rapid
    // clicks both computed from the same stale base, so the UI advanced by 1
    // while the server (atomic increment) advanced by 2.
    setSupplies((prev) => prev.map((s) => s.id === id ? { ...s, quantity: Math.max(0, s.quantity + delta) } : s));
    try {
      const res = await mutApi(`/api/supplies/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantityDelta: delta }),
      });
      // mutApi resolves normally on 4xx/5xx, so without this a rejected write
      // left the optimistic number on screen permanently.
      if (!res.ok) fetchSupplies();
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
  };

  // Adjust the market supply tote.
  //  - Positive = bring stock from home -> market (conserves total).
  //  - Negative = stock LEAVES the market (sold / removed); it is NOT returned
  //    to home, the market count just decreases.
  const handleSupplyMarketTransfer = async (id: string, delta: number) => {
    const supply = supplies.find((s) => s.id === id);
    if (!supply || delta === 0) return;

    if (delta > 0) {
      const moved = Math.min(delta, supply.quantity);
      if (moved === 0) return;
      setSupplies((prev) => prev.map((s) => s.id === id
        ? { ...s, quantity: s.quantity - moved, marketQuantity: s.marketQuantity + moved }
        : s));
      try {
        const res = await mutApi(`/api/supplies/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ marketTransferDelta: moved }),
        });
        if (!res.ok) fetchSupplies();
      } catch (error) {
        console.error("Error transferring supply to market:", error);
        fetchSupplies();
      }
      return;
    }

    // delta < 0: remove from the market tote outright (does not touch home).
    const removed = Math.min(-delta, supply.marketQuantity);
    if (removed === 0) return;
    const newMarket = supply.marketQuantity - removed;
    setSupplies((prev) => prev.map((s) => s.id === id ? { ...s, marketQuantity: newMarket } : s));
    try {
      const res = await mutApi(`/api/supplies/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ marketQuantity: newMarket }),
      });
      if (!res.ok) fetchSupplies();
    } catch (error) {
      console.error("Error removing supply from market:", error);
      fetchSupplies();
    }
  };

  // Set the market supply count to an absolute value. Raising it pulls from
  // home; lowering it removes the difference from the tote (not back to home).
  const handleSetSupplyMarket = async (id: string, value: number) => {
    const supply = supplies.find((s) => s.id === id);
    if (!supply) return;
    if (!Number.isFinite(value)) return;
    const delta = Math.max(0, Math.floor(value)) - supply.marketQuantity;
    if (delta !== 0) await handleSupplyMarketTransfer(id, delta);
  };

  // Adjust the Andover bulk count directly (e.g. logging a bulk shipment that
  // arrived at Andover). This is a count edit, not a transfer — use the Andover
  // Pickup tool to move stock from Andover into home.
  const handleSupplyAndoverDelta = async (id: string, delta: number) => {
    setSupplies((prev) => prev.map((s) => s.id === id ? { ...s, andoverQuantity: Math.max(0, (s.andoverQuantity || 0) + delta) } : s));
    try {
      const res = await mutApi(`/api/supplies/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ andoverQuantityDelta: delta }),
      });
      if (!res.ok) fetchSupplies();
    } catch (error) {
      console.error("Error updating supply Andover count:", error);
      fetchSupplies();
    }
  };

  const handleSetSupplyAndover = async (id: string, value: number) => {
    const supply = supplies.find((s) => s.id === id);
    if (!supply) return;
    if (Number.isFinite(value)) {
      const delta = Math.max(0, Math.floor(value)) - (supply.andoverQuantity || 0);
      if (delta !== 0) await handleSupplyAndoverDelta(id, delta);
    }
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
      // PATCH (delta), not POST (absolute): POST upserts `skeins: n`, i.e. it
      // REPLACES. The dialog says "Add Thread", so picking a colour you already
      // stock and typing 2 used to overwrite 47 skeins with 2. PATCH is an
      // atomic create-or-increment, which is what "add" should mean.
      const response = await mutApi("/api/inventory", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dmcNumber: selectedColor.dmcNumber,
          size: addSize,
          delta: skeinsNum,
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
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, skeins: clamped } : item)));
    try {
      const response = await mutApi(`/api/inventory/${id}`, {
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

  const handleUpdateDesign = async (id: string, field: "kitsReady" | "canvasPrinted", delta: number) => {
    const design = designs.find((d) => d.id === id);
    if (!design) return;

    const currentVal = field === "kitsReady" ? design.kitsReady : design.canvasPrinted;
    const newVal = Math.max(0, currentVal + delta);

    // Optimistic update
    setDesigns((prev) => prev.map((d) => (d.id === id ? { ...d, [field]: newVal } : d)));

    try {
      const body = field === "kitsReady"
        ? { kitsReadyDelta: delta }
        : { canvasPrintedDelta: delta };

      const response = await mutApi(`/api/designs/${id}`, {
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

  const handleSetDesignValue = async (id: string, field: "kitsReady" | "canvasPrinted", value: number) => {
    const design = designs.find((d) => d.id === id);
    if (!design) return;

    // Guard against `Number("")` = 0 / NaN silently zeroing a count.
    if (!Number.isFinite(value)) {
      return;
    }

    const currentVal = field === "kitsReady" ? design.kitsReady : design.canvasPrinted;
    const newVal = Math.max(0, Math.floor(value));
    const delta = newVal - currentVal;

    if (delta !== 0) {
      await handleUpdateDesign(id, field, delta);
    } else {
    }
  };

  // Adjust the market tote.
  //  - Positive delta = bring stock from home to the market tote (conserves
  //    total; home goes down, market goes up).
  //  - Negative delta = stock LEAVES the market entirely (sold / removed). It
  //    is NOT returned to home — market just decreases.
  const handleMarketTransfer = async (id: string, type: "kits" | "canvas", delta: number) => {
    const design = designs.find((d) => d.id === id);
    if (!design || delta === 0) return;

    const main = type === "kits" ? design.kitsReady : design.canvasPrinted;
    const market = type === "kits" ? design.marketKitsReady : design.marketCanvasPrinted;

    if (delta > 0) {
      // Bring stock from home -> market (clamped to available home stock).
      const moved = Math.min(delta, main);
      if (moved === 0) return;
      setDesigns((prev) => prev.map((d) => {
        if (d.id !== id) return d;
        return type === "kits"
          ? { ...d, kitsReady: d.kitsReady - moved, marketKitsReady: d.marketKitsReady + moved }
          : { ...d, canvasPrinted: d.canvasPrinted - moved, marketCanvasPrinted: d.marketCanvasPrinted + moved };
      }));
      try {
        const body = type === "kits"
          ? { marketTransferKitsDelta: moved }
          : { marketTransferCanvasDelta: moved };
        const response = await mutApi(`/api/designs/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!response.ok) await fetchDesigns();
      } catch (error) {
        console.error("Error transferring to market:", error);
        await fetchDesigns();
      }
      return;
    }

    // delta < 0: remove from the market tote outright (does not touch home).
    const removed = Math.min(-delta, market);
    if (removed === 0) return;
    const newMarket = market - removed;
    setDesigns((prev) => prev.map((d) => {
      if (d.id !== id) return d;
      return type === "kits"
        ? { ...d, marketKitsReady: newMarket }
        : { ...d, marketCanvasPrinted: newMarket };
    }));
    try {
      const body = type === "kits"
        ? { marketKitsReady: newMarket }
        : { marketCanvasPrinted: newMarket };
      const response = await mutApi(`/api/designs/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) await fetchDesigns();
    } catch (error) {
      console.error("Error removing from market:", error);
      await fetchDesigns();
    }
  };

  // Set the market count to an absolute value. Raising it pulls the extra from
  // home stock; lowering it removes the difference from the tote outright (it
  // does not go back to home).
  const handleSetMarketValue = async (id: string, type: "kits" | "canvas", value: number) => {
    // Re-entrancy guard: ignore a duplicate commit for the same field before the
    // first one has finished (prevents the Enter+blur double-transfer).
    const busyKey = `${type}-${id}`;
    if (marketSetBusyRef.current.has(busyKey)) return;
    marketSetBusyRef.current.add(busyKey);
    try {
      const design = designs.find((d) => d.id === id);
      if (!design) return;
      if (!Number.isFinite(value)) return;
      const current = type === "kits" ? design.marketKitsReady : design.marketCanvasPrinted;
      const newVal = Math.max(0, Math.floor(value));
      const delta = newVal - current;
      if (delta !== 0) await handleMarketTransfer(id, type, delta);
    } finally {
      marketSetBusyRef.current.delete(busyKey);
    }
  };

  // Receive/adjust Andover bulk-storage canvases by a signed delta. Does NOT
  // touch home stock (bulk orders arrive at Andover independently).
  const handleAndoverDelta = async (id: string, delta: number) => {
    const design = designs.find((d) => d.id === id);
    if (!design || delta === 0) return;
    const newVal = Math.max(0, design.canvasAndover + delta);
    if (newVal === design.canvasAndover) return;
    setDesigns((prev) => prev.map((d) => (d.id === id ? { ...d, canvasAndover: newVal } : d)));
    try {
      const res = await mutApi(`/api/designs/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ canvasAndoverDelta: delta }),
      });
      if (!res.ok) await fetchDesigns();
    } catch (e) {
      console.error("Error updating Andover stock:", e);
      await fetchDesigns();
    }
  };

  const handleSetAndover = async (id: string, value: number) => {
    const design = designs.find((d) => d.id === id);
    if (!design) return;
    if (!Number.isFinite(value)) return;
    const newVal = Math.max(0, Math.floor(value));
    setDesigns((prev) => prev.map((d) => (d.id === id ? { ...d, canvasAndover: newVal } : d)));
    try {
      const res = await mutApi(`/api/designs/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ canvasAndover: newVal }),
      });
      if (!res.ok) await fetchDesigns();
    } catch (e) {
      console.error("Error setting Andover stock:", e);
      await fetchDesigns();
    }
  };

  // Move canvases between Andover and home (conserves total, clamped).
  // Positive = Andover -> home (restock); negative = home -> Andover.
  const handleAndoverTransfer = async (id: string, delta: number) => {
    const design = designs.find((d) => d.id === id);
    if (!design || delta === 0) return;
    const moved = delta >= 0
      ? Math.min(delta, design.canvasAndover)
      : -Math.min(-delta, design.canvasPrinted);
    if (moved === 0) return;
    setDesigns((prev) => prev.map((d) => (d.id === id
      ? { ...d, canvasAndover: d.canvasAndover - moved, canvasPrinted: d.canvasPrinted + moved }
      : d)));
    try {
      const res = await mutApi(`/api/designs/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ andoverTransferDelta: delta }),
      });
      if (!res.ok) await fetchDesigns();
    } catch (e) {
      console.error("Error restocking from Andover:", e);
      await fetchDesigns();
    }
  };

  // --- Kit Andover (bulk kit storage) — mirrors the canvas Andover handlers. ---
  const handleKitAndoverDelta = async (id: string, delta: number) => {
    const design = designs.find((d) => d.id === id);
    if (!design || delta === 0) return;
    const newVal = Math.max(0, (design.kitsAndover || 0) + delta);
    if (newVal === (design.kitsAndover || 0)) return;
    setDesigns((prev) => prev.map((d) => (d.id === id ? { ...d, kitsAndover: newVal } : d)));
    try {
      const res = await mutApi(`/api/designs/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kitsAndoverDelta: delta }),
      });
      if (!res.ok) await fetchDesigns();
    } catch (e) {
      console.error("Error updating kit Andover stock:", e);
      await fetchDesigns();
    }
  };

  const handleSetKitAndover = async (id: string, value: number) => {
    const design = designs.find((d) => d.id === id);
    if (!design) return;
    if (!Number.isFinite(value)) return;
    const newVal = Math.max(0, Math.floor(value));
    setDesigns((prev) => prev.map((d) => (d.id === id ? { ...d, kitsAndover: newVal } : d)));
    try {
      const res = await mutApi(`/api/designs/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kitsAndover: newVal }),
      });
      if (!res.ok) await fetchDesigns();
    } catch (e) {
      console.error("Error setting kit Andover stock:", e);
      await fetchDesigns();
    }
  };

  // Count at a location for a given kind (canvas or kit).
  const unitAt = (d: Design, kind: MoveKind, loc: CanvasLoc) =>
    kind === "kit"
      ? (loc === "home" ? d.kitsReady : loc === "market" ? (d.marketKitsReady || 0) : (d.kitsAndover || 0))
      : (loc === "home" ? d.canvasPrinted : loc === "market" ? (d.marketCanvasPrinted || 0) : (d.canvasAndover || 0));
  const LOC_LABEL: Record<CanvasLoc, string> = { home: "Home", market: "Market tote", andover: "Andover" };
  // Which Design field a (kind, loc) pair maps to — used for the optimistic update.
  const MOVE_FIELD: Record<MoveKind, Record<CanvasLoc, keyof Design>> = {
    canvas: { home: "canvasPrinted", market: "marketCanvasPrinted", andover: "canvasAndover" },
    kit: { home: "kitsReady", market: "marketKitsReady", andover: "kitsAndover" },
  };

  // Move a quantity of canvases OR kits between two locations (home/market/andover).
  const handleCanvasMove = async () => {
    if (!moveModal) return;
    const { kind, designId, from, to } = moveModal;
    const design = designs.find((d) => d.id === designId);
    const qty = Math.floor(Number(moveModal.qty));
    if (!design || from === to || !Number.isFinite(qty) || qty <= 0) return;
    const moved = Math.min(qty, unitAt(design, kind, from));
    if (moved <= 0) return;
    setMovingCanvas(true);
    const fromField = MOVE_FIELD[kind][from];
    const toField = MOVE_FIELD[kind][to];
    // Optimistic
    setDesigns((prev) => prev.map((d) => {
      if (d.id !== designId) return d;
      const n = { ...d } as unknown as Record<string, number>;
      n[fromField] = (n[fromField] || 0) - moved;
      n[toField] = (n[toField] || 0) + moved;
      return n as unknown as Design;
    }));
    try {
      const res = await mutApi(`/api/designs/${designId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ canvasMove: { kind, from, to, qty: moved } }),
      });
      if (!res.ok) await fetchDesigns();
    } catch (e) {
      console.error("Error moving stock:", e);
      await fetchDesigns();
    }
    setMovingCanvas(false);
    setMoveModal(null);
  };

  // Immediate move (no modal) — used by the "-> Home" quick restock buttons.
  const quickMove = async (id: string, kind: MoveKind, from: CanvasLoc, to: CanvasLoc, qty: number) => {
    const design = designs.find((d) => d.id === id);
    if (!design || qty <= 0) return;
    const moved = Math.min(qty, unitAt(design, kind, from));
    if (moved <= 0) return;
    const fromField = MOVE_FIELD[kind][from];
    const toField = MOVE_FIELD[kind][to];
    setDesigns((prev) => prev.map((d) => {
      if (d.id !== id) return d;
      const n = { ...d } as unknown as Record<string, number>;
      n[fromField] = (n[fromField] || 0) - moved;
      n[toField] = (n[toField] || 0) + moved;
      return n as unknown as Design;
    }));
    try {
      const res = await mutApi(`/api/designs/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ canvasMove: { kind, from, to, qty: moved } }),
      });
      if (!res.ok) await fetchDesigns();
    } catch (e) {
      console.error("Error moving stock:", e);
      await fetchDesigns();
    }
  };

  // "Match kits to canvases" for one design: bring the MARKET kit count up (or
  // down) to the MARKET canvas count. This goes through the same transfer as the
  // +/- buttons and canvases, so raising it pulls kits FROM HOME (clamped to
  // what's actually at home) and lowering it removes them from the tote. It no
  // longer invents kits or leaves the at-home count untouched.
  const handleMatchKitsToCanvas = async (id: string) => {
    const design = designs.find((d) => d.id === id);
    if (!design) return;
    const delta = design.marketCanvasPrinted - design.marketKitsReady;
    if (delta !== 0) await handleMarketTransfer(id, "kits", delta);
  };

  // Same, across every market-eligible design at once. Raising a design's market
  // kits transfers from home (API clamps to available home stock); lowering
  // REMOVES them from the tote (they do not return home). Resyncs once at the end.
  //
  // Scope is exactly the rows on screen (marketVisibleDesigns): the current
  // search, the current sub-tab, and excluding Not-Live designs the tab hides.
  // Badge, disabled state and action all read the same set, so "Match all"
  // can never touch a design the user can't see.
  const handleMatchAllKitsToCanvas = async () => {
    const work = marketVisibleDesigns
      .filter((d) => d.marketCanvasPrinted !== d.marketKitsReady)
      .map((d) => ({
        id: d.id,
        name: d.name,
        target: d.marketCanvasPrinted,
        delta: d.marketCanvasPrinted - d.marketKitsReady,
      }));
    if (work.length === 0) return;

    // Lowering is destructive and irreversible — say so before doing it.
    const removals = work.filter((x) => x.delta < 0);
    if (removals.length > 0) {
      const units = removals.reduce((s, x) => s - x.delta, 0);
      const ok = confirm(
        `This will REMOVE ${units} kit${units === 1 ? "" : "s"} from the market tote across ` +
        `${removals.length} design${removals.length === 1 ? "" : "s"} ` +
        `(${removals.slice(0, 3).map((r) => r.name).join(", ")}${removals.length > 3 ? "…" : ""}).\n\n` +
        `Removed kits do NOT return to Home. Continue?`
      );
      if (!ok) return;
    }

    setMatchingAllMarket(true);
    try {
      // mutApi resolves on 4xx/5xx, so collect the results rather than relying
      // on Promise.all to reject — otherwise partial failures are invisible.
      const results = await Promise.all(
        work.map(async (x) => {
          const res = await mutApi(`/api/designs/${x.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            // Raise = transfer from home (conserves total, decrements Here);
            // lower = remove from the tote outright (does not return to home).
            body: JSON.stringify(
              x.delta > 0 ? { marketTransferKitsDelta: x.delta } : { marketKitsReady: x.target }
            ),
          });
          return { name: x.name, ok: res.ok };
        })
      );
      const failed = results.filter((r) => !r.ok);
      if (failed.length > 0) {
        alert(`${failed.length} design${failed.length === 1 ? "" : "s"} failed to update: ${failed.map((f) => f.name).join(", ")}`);
      }
    } catch (e) {
      console.error("Error matching all kits to canvases:", e);
    }
    await fetchDesigns();
    setMatchingAllMarket(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Remove this thread from inventory?")) return;
    try {
      const response = await mutApi(`/api/inventory/${id}`, { method: "DELETE" });
      if (response.ok) {
        setItems((prev) => prev.filter((item) => item.id !== id));
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
  // Size 3 skeins are 16yd, Size 5 are 27yd — sum per item, don't assume Size 5.
  const totalYards = filteredItems.reduce(
    (sum, item) => sum + item.skeins * skeinYardsForThread(item.size as ThreadSize),
    0,
  );
  const totalKitsReady = designs.reduce((sum, d) => sum + d.kitsReady, 0);

  // Market tote stats (in-person/craft-market stock, not available online)
  const marketKitsReady = designs.reduce((sum, d) => sum + (d.marketKitsReady || 0), 0);
  const kitsAndoverTotal = designs.reduce((sum, d) => sum + (d.kitsAndover || 0), 0);
  const marketCanvases = designs.reduce((sum, d) => sum + (d.marketCanvasPrinted || 0), 0);
  const totalKitsOverall = totalKitsReady + marketKitsReady + kitsAndoverTotal;

  // Canvas location-specific stats
  const mainCanvases = designs.reduce((sum, d) => sum + d.canvasPrinted, 0);
  const andoverCanvases = designs.reduce((sum, d) => sum + (d.canvasAndover || 0), 0);
  const allCanvases = mainCanvases + marketCanvases + andoverCanvases;

  // On-hand canvas per design = Here (home) + Market tote. Below LOW_ON_HAND,
  // it needs restocking from Andover. `designs` is already mesh-filtered and
  // excludes drafts, so this reflects the current mesh view.
  const canvasOnHand = (d: Design) => d.canvasPrinted + (d.marketCanvasPrinted || 0);
  const lowCanvasDesigns = designs
    .filter((d) => canvasOnHand(d) < LOW_ON_HAND)
    .sort((a, b) => canvasOnHand(a) - canvasOnHand(b));

  // Adjust a design's misprint count by signed delta (additive); clamp at 0.
  const handleMisprintDelta = async (designId: string, delta: number) => {
    const design = misprintDesigns.find((d) => d.id === designId);
    if (!design) return;
    if (delta < 0 && design.misprintCount + delta < 0) return;
    try {
      const res = await mutApi(`/api/designs/${designId}/misprint`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ delta }),
      });
      if (!res.ok) return;
      const data: { id: string; misprintCount: number } = await res.json();
      const apply = (prev: Design[]) => prev.map((d) => (d.id === data.id ? { ...d, misprintCount: data.misprintCount } : d));
      setMisprintDesigns(apply);
      setDesigns(apply); // keep in sync if the design also appears in the filtered set
    } catch (err) {
      console.error("Failed to adjust misprint count:", err);
    }
  };

  // Set a design's misprint count to an absolute value (used by text input).
  const handleSetMisprintValue = async (designId: string, value: number) => {
    const design = misprintDesigns.find((d) => d.id === designId);
    if (!design) return;
    const newVal = Math.max(0, Math.floor(value));
    const delta = newVal - design.misprintCount;
    if (delta !== 0) {
      await handleMisprintDelta(designId, delta);
    }
  };

  // Group designs by collection (folder)
  // Count-sorted designs for the Kits/Canvases tabs. The order is frozen while
  // you edit counts (useFrozenSort), so rows don't jump under the cursor when
  // clicking +/-. It re-sorts only on a sort/tab/filter/search or membership
  // change. The active tab decides which total to sort by.
  const sortedDesigns = useFrozenSort(
    filteredDesigns,
    sortMode === "default" ? "default" : `${sortMode}-${activeTab}`,
    (a, b) => {
      const totalFor = (d: Design) =>
        activeTab === "canvases"
          ? d.canvasPrinted + (d.marketCanvasPrinted || 0) + (d.canvasAndover || 0)
          : d.kitsReady + (d.marketKitsReady || 0) + (d.kitsAndover || 0);
      return sortMode === "high" ? totalFor(b) - totalFor(a) : totalFor(a) - totalFor(b);
    }
  );

  const designsByCollection = useMemo(() => {
    // When sorting by inventory count, collapse the folder grouping into one
    // (frozen-order) list ordered by TOTAL inventory.
    if (sortMode !== "default") {
      return [
        {
          folderId: "__sorted__",
          folderName: sortMode === "high" ? "Sorted: most stock first" : "Sorted: least stock first",
          designs: sortedDesigns,
        },
      ];
    }

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
  }, [filteredDesigns, sortMode, sortedDesigns]);

  // Designs for the Market view, market-allocated items first. Order frozen
  // while editing so +/- on a row doesn't bump it up the list mid-click.
  // Not Live designs (printed but not for sale yet) are excluded from the
  // market view — they're not sold at market. They still appear in the
  // Canvases/Kits stock tabs (which use filteredDesigns directly).
  const marketEligibleDesigns = useMemo(
    () => filteredDesigns.filter((d) => !d.notLiveAt),
    [filteredDesigns]
  );

  const marketDesigns = useFrozenSort(
    marketEligibleDesigns,
    "market",
    (a, b) => {
      const am = a.marketCanvasPrinted + a.marketKitsReady;
      const bm = b.marketCanvasPrinted + b.marketKitsReady;
      if (bm !== am) return bm - am;
      return a.name.localeCompare(b.name);
    }
  );

  // The exact rows the Market tab is currently SHOWING. "Match all" must act on
  // this and nothing else: it previously ran over every eligible design, so
  // sitting on "Current Inventory" it also hit the "Out of Stock" sub-tab —
  // rows with 0 market canvases, where matching means marketKitsReady -> 0,
  // i.e. it permanently removed kits from the tote for designs off screen.
  const marketVisibleDesigns = useMemo(
    () => marketSubTab === "zero"
      ? marketDesigns.filter((d) => d.marketCanvasPrinted === 0)
      : marketDesigns.filter((d) => d.marketCanvasPrinted > 0),
    [marketDesigns, marketSubTab]
  );

  // Designs whose market kit count doesn't yet match their market canvas count,
  // within what's on screen — so badge, button state, and action agree.
  const marketUnmatchedCount = useMemo(
    () => marketVisibleDesigns.filter((d) => d.marketCanvasPrinted !== d.marketKitsReady).length,
    [marketVisibleDesigns]
  );

  // Supplies sorted by total inventory (online + market) when a count sort is
  // on. Frozen order while editing (same reason as designs/market).
  const frozenSupplies = useFrozenSort(
    supplies,
    sortMode === "default" ? "default" : `supplies-${sortMode}`,
    (a, b) => {
      const totalFor = (s: Supply) => s.quantity + s.marketQuantity;
      return sortMode === "high" ? totalFor(b) - totalFor(a) : totalFor(a) - totalFor(b);
    }
  );
  const sortedSupplies = sortMode === "default" ? supplies : frozenSupplies;

  return (
    <div className="min-h-screen bg-slate-900 overflow-x-hidden">
      {/* Header */}
      <header className="bg-slate-800 border-b border-slate-700 sticky top-0 z-40 safe-area-top">
        <div className="max-w-7xl mx-auto px-3 md:px-4 pt-2"><SectionNav /></div>
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

        {/* Mesh filter */}
        <div className="mb-4">
          <MeshFilterChips value={meshFilter} onChange={handleMeshFilterChange} />
        </div>

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
              <span className="ml-1 text-xs opacity-75">({totalKitsOverall})</span>
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
              <span className="ml-1 text-xs opacity-75">({allCanvases})</span>
            </button>
            <button
              onClick={() => setActiveTab("market")}
              className={`px-2 md:px-4 py-2 rounded-md text-xs md:text-sm font-medium transition-colors flex items-center gap-1 whitespace-nowrap ${
                activeTab === "market"
                  ? "bg-emerald-800 text-white"
                  : "text-emerald-400 hover:text-white hover:bg-slate-700"
              }`}
            >
              <svg className="w-4 h-4 flex-shrink-0 hidden md:block" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
              Market
              <span className="ml-1 text-xs opacity-75">({marketKitsReady + marketCanvases})</span>
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
            <button
              onClick={() => setActiveTab("bobbins")}
              className={`px-2 md:px-4 py-2 rounded-md text-xs md:text-sm font-medium transition-colors flex items-center gap-1 whitespace-nowrap ${
                activeTab === "bobbins"
                  ? "bg-rose-900 text-white"
                  : "text-slate-400 hover:text-white hover:bg-slate-700"
              }`}
            >
              <svg className="w-4 h-4 flex-shrink-0 hidden md:block" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
              </svg>
              Bobbins
              {bobbinData && (
                <span className="ml-1 text-xs opacity-75">({bobbinData.summary.totalBobbins})</span>
              )}
            </button>
            <button
              onClick={() => setActiveTab("misprints")}
              className={`px-2 md:px-4 py-2 rounded-md text-xs md:text-sm font-medium transition-colors flex items-center gap-1 whitespace-nowrap ${
                activeTab === "misprints"
                  ? "bg-purple-800 text-white"
                  : "text-slate-400 hover:text-white hover:bg-slate-700"
              }`}
            >
              <svg className="w-4 h-4 flex-shrink-0 hidden md:block" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              Misprints
              <span className="ml-1 text-xs opacity-75">
                ({misprintDesigns.reduce((sum, d) => sum + d.misprintCount, 0)})
              </span>
            </button>
            <div className="border-l border-slate-600 h-6 mx-2" />
            <Link
              href="/inventory/tools"
              className="px-2 md:px-4 py-2 rounded-md text-xs md:text-sm font-medium transition-colors flex items-center gap-1 whitespace-nowrap text-slate-300 hover:text-white hover:bg-slate-700"
              title="Reorder, Stock Alerts, Restock, Market Prep, Sales Log"
            >
              <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Tools
              {lowCanvasDesigns.length > 0 && (
                <span className="ml-1 inline-flex items-center justify-center min-w-[1.1rem] h-[1.1rem] px-1 text-[10px] font-bold rounded-full bg-red-600 text-white" title={`${lowCanvasDesigns.length} designs low on hand`}>
                  {lowCanvasDesigns.length}
                </span>
              )}
              <span className="ml-0.5">→</span>
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
              {/* Size 5 only in internal app */}
              <div className="px-4 py-2.5 bg-slate-800 border border-slate-700 text-slate-300 rounded-lg text-sm">
                Size 5
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
                                <CountStepper
                                  value={item.skeins}
                                  onCommit={(next) => handleUpdateSkeins(item.id, next)}
                                  ariaLabel={`Skeins of DMC ${item.dmcNumber} (Size ${item.size})`}
                                  decrementTitle="Remove 1 skein"
                                  incrementTitle="Add 1 skein"
                                />
                              </div>
                            </td>
                            <td className="px-4 py-3 hidden md:table-cell">
                              <span className="text-slate-400">{item.skeins * skeinYardsForThread(item.size as ThreadSize)} yds</span>
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
                                        <span className={`text-xs px-1.5 py-0.5 rounded ${meshBadgeClassLight(design.meshCount)}`}>
                                          {design.meshCount}ct
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
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
              <div className="bg-slate-800 rounded-lg p-3 border border-slate-700">
                <p className="text-xs text-slate-400 uppercase tracking-wider">Kits at Home</p>
                <p className="text-xl font-bold text-white">{totalKitsReady}</p>
              </div>
              <div className="bg-slate-800 rounded-lg p-3 border border-emerald-800/60">
                <p className="text-xs text-emerald-400 uppercase tracking-wider">Market Tote</p>
                <p className="text-xl font-bold text-emerald-300">{marketKitsReady}</p>
              </div>
              <div className="bg-slate-800 rounded-lg p-3 border border-sky-800/60" title="Bulk kit storage at Andover — pull from here when home + market runs low">
                <p className="text-xs text-sky-400 uppercase tracking-wider">Andover</p>
                <p className="text-xl font-bold text-sky-300">{kitsAndoverTotal}</p>
              </div>
              <div className="bg-slate-800 rounded-lg p-3 border border-slate-700" title="Home + Market + Andover">
                <p className="text-xs text-slate-400 uppercase tracking-wider">Total Kits</p>
                <p className="text-xl font-bold text-white">{totalKitsOverall}</p>
              </div>
              <div className="bg-slate-800 rounded-lg p-3 border border-slate-700">
                <p className="text-xs text-slate-400 uppercase tracking-wider">With Stock</p>
                <p className="text-xl font-bold text-white">{designs.filter(d => d.kitsReady + (d.marketKitsReady || 0) + (d.kitsAndover || 0) > 0).length}</p>
              </div>
            </div>

            {/* Search */}
            <div className="mb-6 flex flex-wrap items-center gap-3">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search designs..."
                className="flex-1 min-w-[200px] max-w-md px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-800"
              />
              <SortControls value={sortMode} onChange={setSortMode} />
            </div>

            {/* Designs list grouped by collection */}
            {filteredDesigns.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-slate-400">{designsLoading ? "Loading designs…" : "No designs found"}</p>
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
                        ({group.designs.length} design{group.designs.length !== 1 ? "s" : ""} · {group.designs.reduce((sum, d) => sum + d.kitsReady + (d.marketKitsReady || 0) + (d.kitsAndover || 0), 0)} kits)
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
                                {design.notLiveAt && (
                                  <span className="inline-block mt-0.5 text-[10px] px-1.5 py-0.5 rounded bg-amber-900/50 text-amber-300 font-medium uppercase tracking-wide" title="Printed but not for sale yet">Not Live</span>
                                )}
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
                                <p className="text-xs mt-0.5">
                                  <span className="text-slate-300 font-semibold">{design.kitsReady + design.marketKitsReady} total</span>
                                  <span className="text-slate-500"> ({design.kitsReady} online · <span className="text-emerald-400">{design.marketKitsReady} market</span>)</span>
                                  {(design.kitsAndover || 0) > 0 && <span className="text-sky-400"> · {design.kitsAndover} @ Andover</span>}
                                </p>
                              </div>

                              {/* Kits at Home (the online-sellable bucket) */}
                              <CountStepper
                                value={design.kitsReady}
                                onCommit={(next) => handleSetDesignValue(design.id, "kitsReady", next)}
                                onDelta={(d) => handleUpdateDesign(design.id, "kitsReady", d)}
                                label="Home"
                                tone="home"
                                ariaLabel={`Kits at Home for ${design.name}`}
                              />

                              {/* Market tote. + pulls from Home; − removes from the tote entirely. */}
                              <CountStepper
                                value={design.marketKitsReady}
                                onCommit={(next) => handleSetMarketValue(design.id, "kits", next)}
                                onDelta={(d) => handleMarketTransfer(design.id, "kits", d)}
                                label="Market"
                                tone="market"
                                labelTitle="Kits in the craft-market tote. POS sales deduct from here. + moves a kit from Home into the tote; − removes it from the tote entirely (it does not go back Home)."
                                ariaLabel={`Kits in the market tote for ${design.name}`}
                                decrementTitle="Remove one kit from the market tote (does not return Home)"
                                incrementTitle="Move one kit from Home into the market tote"
                                disableIncrement={design.kitsReady <= 0}
                              />

                              {/* Andover bulk kit storage */}
                              <CountStepper
                                value={design.kitsAndover || 0}
                                onCommit={(next) => handleSetKitAndover(design.id, next)}
                                onDelta={(d) => handleKitAndoverDelta(design.id, d)}
                                label="Andover"
                                tone="andover"
                                labelTitle="Bulk kit storage at Andover — pull to Home when it runs low"
                                ariaLabel={`Kits at Andover for ${design.name}`}
                              />

                              {/* Move kits between locations (+ quick Andover -> Home restock) */}
                              <div className="flex flex-col items-center gap-1">
                                <span className="text-[10px] uppercase tracking-wider text-slate-500">Move</span>
                                <div className="flex items-center gap-1">
                                  {(design.kitsAndover || 0) > 0 && (design.kitsReady + design.marketKitsReady) < RESTOCK_TARGET && (
                                    <button
                                      onClick={() => quickMove(design.id, "kit", "andover", "home", Math.min(design.kitsAndover, RESTOCK_TARGET - (design.kitsReady + design.marketKitsReady)))}
                                      className="px-2 py-1.5 text-[10px] font-medium bg-sky-700 hover:bg-sky-600 text-white rounded whitespace-nowrap"
                                      title={`Move ${Math.min(design.kitsAndover, RESTOCK_TARGET - (design.kitsReady + design.marketKitsReady))} kits from Andover to Home`}
                                    >
                                      → Home
                                    </button>
                                  )}
                                  <button
                                    onClick={() => setMoveModal({ kind: "kit", designId: design.id, from: "andover", to: "home", qty: "" })}
                                    className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg transition-colors"
                                    title="Move kits between Home, Market, and Andover"
                                  >
                                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m4 6H4m0 0l4 4m-4-4l4-4" /></svg>
                                    Move
                                  </button>
                                </div>
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
                                      const size = threadSizeForMesh(design.meshCount as MeshCount);
                                      const invKey = `${item.dmcNumber}-${size}`;
                                      const isUpdating = updatingInventory === invKey;
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
                                              <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                                                <CountStepper
                                                  value={item.inventorySkeins}
                                                  onCommit={(next) => handleSetKitInventory(item.dmcNumber, next, size, item.inventorySkeins)}
                                                  onDelta={(d) => handleKitInventoryUpdate(item.dmcNumber, d, size)}
                                                  busy={isUpdating}
                                                  ariaLabel={`Skeins of DMC ${item.dmcNumber} (Size ${size})`}
                                                  valueClassName={item.primaryInStock !== false ? "text-emerald-400" : "text-red-400"}
                                                />
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
                <p className="text-xs text-slate-400 uppercase tracking-wider">Home</p>
                <p className="text-xl font-bold text-emerald-400">{mainCanvases}</p>
              </div>
              <div className="bg-slate-800 rounded-lg p-3 border border-emerald-800/60">
                <p className="text-xs text-emerald-400 uppercase tracking-wider">Market Tote</p>
                <p className="text-xl font-bold text-emerald-300">{marketCanvases}</p>
              </div>
              <div className="bg-slate-800 rounded-lg p-3 border border-sky-800/60" title="Bulk canvas storage at Andover — pull from here when home + market runs low">
                <p className="text-xs text-sky-400 uppercase tracking-wider">Andover</p>
                <p className="text-xl font-bold text-sky-300">{andoverCanvases}</p>
              </div>
              <div className="bg-slate-800 rounded-lg p-3 border border-slate-700" title="Here + Market + Andover">
                <p className="text-xs text-slate-400 uppercase tracking-wider">Total (all)</p>
                <p className="text-xl font-bold text-white">{allCanvases}</p>
              </div>
            </div>

            {/* Low-on-hand designs are surfaced on the dedicated Restock page
                (linked from the tab bar). A per-row "Low" badge still flags them here. */}

            {/* Search */}
            <div className="mb-6 flex flex-wrap items-center gap-3">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search designs..."
                className="flex-1 min-w-[200px] max-w-md px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-800"
              />
              <SortControls value={sortMode} onChange={setSortMode} />
            </div>

            {/* Designs list grouped by collection */}
            {filteredDesigns.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-slate-400">{designsLoading ? "Loading designs…" : "No designs found"}</p>
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
                        ({group.designs.length} design{group.designs.length !== 1 ? "s" : ""} · {group.designs.reduce((sum, d) => sum + d.canvasPrinted + (d.marketCanvasPrinted || 0) + (d.canvasAndover || 0), 0)} canvases)
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
                            <div className="flex items-center gap-2">
                              <Link href={`/design/${design.id}/info`} className="text-white font-medium hover:text-rose-400 truncate text-sm md:text-base">
                                {design.name}
                              </Link>
                              <span className={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 ${meshBadgeClassLight(design.meshCount)}`}>
                                {design.meshCount}ct
                              </span>
                              {design.notLiveAt && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 bg-amber-900/50 text-amber-300 font-medium uppercase tracking-wide" title="Printed but not for sale yet">Not Live</span>
                              )}
                            </div>
                            <p className="text-slate-400 text-xs md:text-sm">
                              {design.widthInches}&quot; × {design.heightInches}&quot;
                            </p>
                            <p className="text-xs mt-0.5">
                              <span className="text-slate-300 font-semibold">{design.canvasPrinted + design.marketCanvasPrinted} on hand</span>
                              <span className="text-slate-500"> ({design.canvasPrinted} home · <span className="text-emerald-400">{design.marketCanvasPrinted} market</span>)</span>
                              {(design.canvasAndover || 0) > 0 && <span className="text-sky-400"> · {design.canvasAndover} @ Andover</span>}
                              {(design.canvasPrinted + design.marketCanvasPrinted) < LOW_ON_HAND && (
                                <span className="ml-1.5 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-red-600 text-white">Low</span>
                              )}
                            </p>
                          </div>

                          {/* Canvases controls - Main (Here) */}
                          <div className="flex flex-col md:flex-row items-end md:items-center gap-2 md:gap-4">
                            {/* Home. Deliberately neutral, not emerald: it used
                                to be styled identically to the Market control
                                beside it, so you couldn't tell them apart. */}
                            <CountStepper
                              value={design.canvasPrinted}
                              onCommit={(next) => handleSetDesignValue(design.id, "canvasPrinted", next)}
                              onDelta={(d) => handleUpdateDesign(design.id, "canvasPrinted", d)}
                              label="Home"
                              tone="home"
                              ariaLabel={`Canvases at Home for ${design.name}`}
                            />

                            {/* Market tote (POS / craft-market). + pulls from Home; − removes from the tote entirely. */}
                            <CountStepper
                              value={design.marketCanvasPrinted}
                              onCommit={(next) => handleSetMarketValue(design.id, "canvas", next)}
                              onDelta={(d) => handleMarketTransfer(design.id, "canvas", d)}
                              label="Market"
                              tone="market"
                              labelTitle="Canvases in the craft-market tote. POS sales deduct from here. + moves a canvas from Home into the tote; − removes it from the tote entirely (it does not go back Home)."
                              ariaLabel={`Canvases in the market tote for ${design.name}`}
                              decrementTitle="Remove one canvas from the market tote (does not return Home)"
                              incrementTitle="Move one canvas from Home into the market tote"
                              disableIncrement={design.canvasPrinted <= 0}
                            />

                            {/* Andover bulk storage — edit to receive shipments; → Home restocks */}
                            <div className="flex items-center gap-1">
                              <CountStepper
                                value={design.canvasAndover || 0}
                                onCommit={(next) => handleSetAndover(design.id, next)}
                                onDelta={(d) => handleAndoverDelta(design.id, d)}
                                label="Andover"
                                tone="andover"
                                labelTitle="Bulk canvas storage at Andover"
                                ariaLabel={`Canvases at Andover for ${design.name}`}
                              />
                              {/* Restock to Home (top up on-hand toward target) */}
                              {(design.canvasAndover || 0) > 0 && (design.canvasPrinted + design.marketCanvasPrinted) < RESTOCK_TARGET && (
                                <button
                                  onClick={() => handleAndoverTransfer(design.id, Math.min(design.canvasAndover, RESTOCK_TARGET - (design.canvasPrinted + design.marketCanvasPrinted)))}
                                  className="ml-1 mt-[18px] px-2 py-1 text-[10px] font-medium bg-sky-700 hover:bg-sky-600 text-white rounded whitespace-nowrap"
                                  title={`Move ${Math.min(design.canvasAndover, RESTOCK_TARGET - (design.canvasPrinted + design.marketCanvasPrinted))} from Andover to home`}
                                >
                                  → Home
                                </button>
                              )}
                            </div>

                            {/* Move canvases between locations. Wrapped with a
                                spacer caption so it lines up with the labelled
                                steppers beside it (same shape as the Kits tab). */}
                            <div className="flex flex-col items-center gap-1">
                              <span aria-hidden="true" className="text-[10px] uppercase tracking-wider text-transparent select-none">.</span>
                            <button
                              onClick={() => setMoveModal({ kind: "canvas", designId: design.id, from: "andover", to: "home", qty: "" })}
                              className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg transition-colors"
                              title="Move canvases between Home, Market, and Andover"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m4 6H4m0 0l4 4m-4-4l4-4" /></svg>
                              Move
                            </button>
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


        {/* Market Tab — kits & canvases allocated to the craft-market tote */}
        {activeTab === "market" && (
          <>
            {/* Stats + match all */}
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div className="grid grid-cols-3 gap-3 flex-1 min-w-[280px]">
                <div className="bg-slate-800 rounded-lg p-3 border border-emerald-800/60">
                  <p className="text-xs text-emerald-400 uppercase tracking-wider">Market Canvases</p>
                  <p className="text-xl font-bold text-emerald-300">{marketCanvases}</p>
                </div>
                <div className="bg-slate-800 rounded-lg p-3 border border-emerald-800/60">
                  <p className="text-xs text-emerald-400 uppercase tracking-wider">Market Kits</p>
                  <p className="text-xl font-bold text-emerald-300">{marketKitsReady}</p>
                </div>
                <div className={`rounded-lg p-3 border ${marketUnmatchedCount > 0 ? "bg-amber-900/30 border-amber-700" : "bg-slate-800 border-slate-700"}`}>
                  <p className={`text-xs uppercase tracking-wider ${marketUnmatchedCount > 0 ? "text-amber-400" : "text-slate-400"}`}>Unmatched</p>
                  <p className={`text-xl font-bold ${marketUnmatchedCount > 0 ? "text-amber-300" : "text-white"}`}>{marketUnmatchedCount}</p>
                </div>
              </div>
              <button
                onClick={handleMatchAllKitsToCanvas}
                disabled={matchingAllMarket || marketUnmatchedCount === 0}
                className="px-4 py-2.5 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium flex items-center gap-2"
                title="Bring a matching kit to the tote for every market canvas, across all designs"
              >
                {matchingAllMarket ? (
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                )}
                Match all kits to canvases
              </button>
            </div>

            <div className="p-3 bg-slate-800 border border-slate-700 rounded-lg mb-4">
              <p className="text-sm text-slate-400">
                Stock allocated to the craft-market tote. POS sales deduct from here. Adjust counts to load the tote (moves from your online stock), then <span className="text-emerald-400">Match kits to canvases</span> so every canvas in the tote has a kit to go with it.
              </p>
            </div>

            {/* Sub-tabs: designs currently in the tote vs. sold out of it */}
            <div className="inline-flex gap-1 bg-slate-800 p-1 rounded-lg border border-slate-700 mb-4">
              <button
                onClick={() => setMarketSubTab("current")}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${marketSubTab === "current" ? "bg-emerald-700 text-white" : "text-slate-300 hover:bg-slate-700"}`}
              >
                Current Inventory
                <span className="ml-1 text-xs opacity-75">({marketDesigns.filter((d) => d.marketCanvasPrinted > 0).length})</span>
              </button>
              <button
                onClick={() => setMarketSubTab("zero")}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${marketSubTab === "zero" ? "bg-emerald-700 text-white" : "text-slate-300 hover:bg-slate-700"}`}
              >
                Out of Stock
                <span className="ml-1 text-xs opacity-75">({marketDesigns.filter((d) => d.marketCanvasPrinted === 0).length})</span>
              </button>
            </div>

            {/* Search */}
            <div className="mb-6">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search designs..."
                className="w-full max-w-md px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-700"
              />
            </div>

            {(() => {
              const marketList = marketVisibleDesigns;
              return marketList.length === 0 ? (
              <div className="text-center py-12"><p className="text-slate-400">{designsLoading ? "Loading designs…" : marketSubTab === "zero" ? "Every design has canvases in the market tote." : "No designs currently in the market tote."}</p></div>
            ) : (
              <div className="space-y-2">
                {marketList.map((design) => {
                  const matched = design.marketCanvasPrinted === design.marketKitsReady;
                  return (
                    <div key={design.id} className="bg-slate-800 rounded-xl border border-slate-700 p-3 md:p-4 flex flex-wrap items-center gap-3 md:gap-4">
                      <Link href={`/design/${design.id}/info`} className="flex-shrink-0">
                        {design.previewImageUrl ? (
                          <img src={design.previewImageUrl} alt={design.name} className="w-12 h-12 md:w-14 md:h-14 object-cover rounded-lg border border-slate-600" />
                        ) : (
                          <div className="w-12 h-12 md:w-14 md:h-14 bg-slate-700 rounded-lg border border-slate-600" />
                        )}
                      </Link>
                      <div className="flex-1 min-w-[140px]">
                        <Link href={`/design/${design.id}/info`} className="text-white font-medium hover:text-emerald-400 truncate block text-sm md:text-base">
                          {design.name}
                        </Link>
                        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                          <span className={`text-xs px-1.5 py-0.5 rounded ${meshBadgeClassLight(design.meshCount)}`}>{design.meshCount}ct</span>
                          {marketPrediction.get(design.id) !== undefined && (
                            <span
                              className="text-xs px-1.5 py-0.5 rounded bg-emerald-900/40 text-emerald-300 font-medium"
                              title="Predicted quantity to bring to the next market, from past POS sales (Market Prep, balanced buffer)"
                            >
                              bring ~{marketPrediction.get(design.id)}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Market canvas. On this tab every count is market-scoped;
                          + pulls from Home, − removes from the tote entirely. */}
                      <CountStepper
                        value={design.marketCanvasPrinted}
                        onCommit={(next) => handleSetMarketValue(design.id, "canvas", next)}
                        onDelta={(d) => handleMarketTransfer(design.id, "canvas", d)}
                        label="Canvas"
                        tone="market"
                        labelTitle="Canvases in the market tote. + moves one from Home into the tote; − removes it from the tote entirely (it does not go back Home)."
                        ariaLabel={`Canvases in the market tote for ${design.name}`}
                        decrementTitle="Remove one canvas from the tote (does not return Home)"
                        incrementTitle={`Move one canvas from Home into the tote (${design.canvasPrinted} at Home)`}
                        disableIncrement={design.canvasPrinted <= 0}
                      />

                      {/* Market kit */}
                      <CountStepper
                        value={design.marketKitsReady}
                        onCommit={(next) => handleSetMarketValue(design.id, "kits", next)}
                        onDelta={(d) => handleMarketTransfer(design.id, "kits", d)}
                        label="Kit"
                        tone="market"
                        labelTitle="Kits in the market tote. + moves one from Home into the tote; − removes it from the tote entirely (it does not go back Home)."
                        ariaLabel={`Kits in the market tote for ${design.name}`}
                        decrementTitle="Remove one kit from the tote (does not return Home)"
                        incrementTitle={`Move one kit from Home into the tote (${design.kitsReady} at Home)`}
                        disableIncrement={design.kitsReady <= 0}
                      />

                      {/* Match button */}
                      <div className="flex flex-col items-center gap-1">
                        <span aria-hidden="true" className="text-[10px] uppercase tracking-wider text-transparent select-none">.</span>
                        {matched ? (
                          <span className="px-2.5 py-1.5 text-xs text-emerald-400 flex items-center gap-1" title="Kit count matches canvas count">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                            Matched
                          </span>
                        ) : (
                          <button
                            onClick={() => handleMatchKitsToCanvas(design.id)}
                            className="px-2.5 py-1.5 text-xs font-medium bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg whitespace-nowrap"
                            title={`Set market kits to ${design.marketCanvasPrinted} to match canvases`}
                          >
                            Match kits → {design.marketCanvasPrinted}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
            })()}
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

            {/* Info box + sort */}
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div className="flex-1 min-w-[200px] p-4 bg-slate-800 border border-slate-700 rounded-lg">
                <p className="text-sm text-slate-400">
                  Supply names must match Shopify product titles exactly for automatic order matching.
                </p>
              </div>
              <SortControls value={sortMode} onChange={setSortMode} />
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
                  {sortedSupplies.map((supply) => (
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
                        <p className="text-xs mt-0.5">
                          <span className="text-slate-300 font-semibold">{supply.quantity + supply.marketQuantity + (supply.andoverQuantity || 0)} total</span>
                          <span className="text-slate-500"> ({supply.quantity} online · <span className="text-emerald-400">{supply.marketQuantity} market</span>{(supply.andoverQuantity || 0) > 0 && <> · <span className="text-sky-400">{supply.andoverQuantity} Andover</span></>})</span>
                        </p>
                      </div>
                      {/* Home (online-sellable) quantity */}
                      <CountStepper
                        value={supply.quantity}
                        onCommit={(next) => handleSetSupplyQuantity(supply.id, next)}
                        onDelta={(d) => handleSupplyQuantityChange(supply.id, d)}
                        label="Home"
                        tone="home"
                        ariaLabel={`${supply.name} at Home`}
                      />

                      <CountStepper
                        value={supply.marketQuantity}
                        onCommit={(next) => handleSetSupplyMarket(supply.id, next)}
                        onDelta={(d) => handleSupplyMarketTransfer(supply.id, d)}
                        label="Market"
                        tone="market"
                        labelTitle="Supply stock in the craft-market tote. POS sales deduct from here. + moves stock from Home into the tote; − removes it from the tote entirely (it does not go back Home)."
                        ariaLabel={`${supply.name} in the market tote`}
                        decrementTitle="Remove one from the market tote (does not return Home)"
                        incrementTitle="Move one from Home into the market tote"
                        disableIncrement={supply.quantity <= 0}
                      />

                      {/* Andover bulk storage. Adjust the count stored at
                          Andover; pick it up (move to Home) via Andover Pickup. */}
                      <CountStepper
                        value={supply.andoverQuantity || 0}
                        onCommit={(next) => handleSetSupplyAndover(supply.id, next)}
                        onDelta={(d) => handleSupplyAndoverDelta(supply.id, d)}
                        label="Andover"
                        tone="andover"
                        labelTitle="Bulk supply stock kept at Andover storage. Pick it up (move to Home) from Inventory → Tools → Andover Pickup."
                        ariaLabel={`${supply.name} at Andover`}
                        decrementTitle="Remove 1 from Andover"
                        incrementTitle="Add 1 at Andover"
                      />
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

        {/* Pre-make Bobbins Tab */}
        {activeTab === "bobbins" && (
          <div className="space-y-4">
            {/* Summary stats */}
            {bobbinData && (() => {
              const totalOnHand = bobbinData.suggestions.reduce((sum, s) => sum + s.onHand, 0);
              const totalToMake = bobbinData.suggestions.reduce((sum, s) => sum + s.make, 0);
              return (
                <div className="grid grid-cols-3 gap-4 mb-4">
                  <div className="bg-slate-800 rounded-lg border border-slate-700 p-4">
                    <p className="text-xs text-slate-400 uppercase tracking-wider">Colors</p>
                    <p className="text-xl font-bold text-white">{bobbinData.summary.totalColors}</p>
                  </div>
                  <div className="bg-slate-800 rounded-lg border border-slate-700 p-4">
                    <p className="text-xs text-slate-400 uppercase tracking-wider">On Hand</p>
                    <p className="text-xl font-bold text-emerald-400">{totalOnHand}</p>
                  </div>
                  <div className={`rounded-lg border p-4 ${totalToMake > 0 ? "bg-amber-900/30 border-amber-700" : "bg-emerald-900/30 border-emerald-700"}`}>
                    <p className={`text-xs uppercase tracking-wider ${totalToMake > 0 ? "text-amber-400" : "text-emerald-400"}`}>To Make</p>
                    <p className={`text-xl font-bold ${totalToMake > 0 ? "text-amber-300" : "text-emerald-300"}`}>{totalToMake}</p>
                  </div>
                </div>
              );
            })()}

            {/* Info box */}
            <div className="p-4 bg-amber-900/20 border border-amber-800/50 rounded-lg mb-4">
              <p className="text-sm text-slate-300">
                <strong className="text-white">Bobbin Inventory.</strong> Bobbins are sized per kit in whole yards and tracked
                per thread size (Size 3 for 13ct, Size 5 for 18ct — different SKUs).
                A bobbin covers needs within ±0.2 yards of its size — a 3-yard bobbin works for 2.8–3.2 yards.
                Larger bobbins can cover smaller needs in a pinch (a 4-yard bobbin works for a 3-yard design).
                Small amounts are finger-wrapped at assembly; large amounts use a full skein.
              </p>
            </div>

            {bobbinsLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="text-slate-400 flex items-center gap-3">
                  <svg className="animate-spin h-6 w-6" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Analyzing bobbin requirements...
                </div>
              </div>
            ) : !bobbinData || bobbinData.suggestions.length === 0 ? (
              <div className="bg-slate-800 rounded-xl border border-slate-700 p-8 text-center">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-slate-700 flex items-center justify-center">
                  <svg className="w-8 h-8 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h2 className="text-lg font-semibold text-white mb-2">No bobbins needed</h2>
                <p className="text-slate-400 text-sm">
                  No thread colors fall in the bobbin range (2.4 – 5 yards). Anything below 2.4 yards is finger-wrapped at kit assembly.
                </p>
              </div>
            ) : (
              <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-700 text-left">
                      <th className="p-3 text-xs text-slate-400 font-medium">Color</th>
                      <th className="p-3 text-xs text-slate-400 font-medium text-center">Length</th>
                      <th className="p-3 text-xs text-slate-400 font-medium text-center">On Hand</th>
                      <th className="p-3 text-xs text-slate-400 font-medium text-center">Make</th>
                      <th className="p-3 text-xs text-slate-400 font-medium">Used In</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700/50">
                    {bobbinData.suggestions.map((s) => {
                      const make = s.make;
                      return (
                      <tr key={`${s.dmcNumber}-${s.length}-${s.threadSize}`} className="hover:bg-slate-700/30">
                        <td className="p-3">
                          <Link
                            href={`/inventory/color/${s.dmcNumber}`}
                            className="flex items-center gap-2 hover:text-rose-400"
                          >
                            <div
                              className="w-8 h-8 rounded flex items-center justify-center flex-shrink-0"
                              style={{ backgroundColor: s.hex }}
                            >
                              <span
                                className="text-[8px] font-bold"
                                style={{ color: getContrastTextColor(s.hex) }}
                              >
                                {s.dmcNumber}
                              </span>
                            </div>
                            <div>
                              <p className="text-white text-sm font-medium">{s.dmcNumber}</p>
                              <p className="text-slate-400 text-xs truncate max-w-[100px]">{s.colorName}</p>
                            </div>
                          </Link>
                        </td>
                        <td className="p-3 text-center">
                          <span className="px-2 py-1 bg-amber-900/50 text-amber-400 rounded text-sm font-medium">
                            {s.length} yd
                          </span>
                          {/* The same DMC+length exists as both a Size 3 and a
                              Size 5 bobbin — without this the two rows are
                              indistinguishable. */}
                          <span className="block mt-1 text-[10px] text-slate-400">Size {s.threadSize}</span>
                        </td>
                        <td className="p-3">
                          <div className="flex items-center justify-center">
                            <CountStepper
                              value={s.onHand}
                              onCommit={(next) => handleBobbinSet(s.dmcNumber, s.length, s.threadSize, next)}
                              onDelta={(d) => handleBobbinDelta(s.dmcNumber, s.length, s.threadSize, d)}
                              ariaLabel={`Size ${s.threadSize} ${s.length} yard bobbins on hand for DMC ${s.dmcNumber}`}
                            />
                          </div>
                        </td>
                        <td className="p-3 text-center">
                          {make > 0 ? (
                            <span className="px-2 py-1 bg-amber-900/50 text-amber-300 rounded text-sm font-bold">
                              +{make}
                            </span>
                          ) : (
                            <span className="px-2 py-1 bg-emerald-900/50 text-emerald-300 rounded text-sm font-medium">
                              ✓ covered
                            </span>
                          )}
                        </td>
                        <td className="p-3">
                          <div className="flex flex-wrap gap-1">
                            {s.designs.slice(0, 3).map((design) => (
                              <Link
                                key={design.id}
                                href={`/design/${design.id}/kit`}
                                className="flex items-center gap-1 px-2 py-1 bg-slate-700 rounded text-xs hover:bg-slate-600 transition-colors"
                              >
                                {design.previewImageUrl ? (
                                  <img src={design.previewImageUrl} alt="" className="w-4 h-4 rounded object-cover" />
                                ) : (
                                  <div className="w-4 h-4 bg-slate-600 rounded" />
                                )}
                                <span className="text-slate-300 truncate max-w-[80px]">{design.name}</span>
                                <span className="text-slate-500">({design.exactYards}yd)</span>
                              </Link>
                            ))}
                            {s.designs.length > 3 && (
                              <span className="px-2 py-1 bg-slate-700 rounded text-xs text-slate-400">
                                +{s.designs.length - 3} more
                              </span>
                            )}
                            {s.designs.length === 0 && (
                              <span className="text-xs text-slate-500 italic">in stock, not currently needed</span>
                            )}
                          </div>
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Misprints Tab */}
        {activeTab === "misprints" && (() => {
          const misprint14ct = misprintDesigns;
          const totalMisprints = misprint14ct.reduce((sum, d) => sum + d.misprintCount, 0);
          const designsWithStock = misprint14ct.filter((d) => d.misprintCount > 0).length;
          const filtered = searchQuery
            ? misprint14ct.filter((d) => d.name.toLowerCase().includes(searchQuery.toLowerCase()))
            : misprint14ct;
          const sorted = [...filtered].sort((a, b) => {
            // Designs with misprints first, then alphabetical
            if ((a.misprintCount > 0) !== (b.misprintCount > 0)) {
              return a.misprintCount > 0 ? -1 : 1;
            }
            return a.name.localeCompare(b.name);
          });
          return (
            <>
              {/* Stats */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
                <div className="bg-slate-800 rounded-lg p-3 border border-slate-700">
                  <p className="text-xs text-slate-400 uppercase tracking-wider">Misprints in Stock</p>
                  <p className="text-xl font-bold text-purple-400">{totalMisprints}</p>
                </div>
                <div className="bg-slate-800 rounded-lg p-3 border border-slate-700">
                  <p className="text-xs text-slate-400 uppercase tracking-wider">Distinct Designs</p>
                  <p className="text-xl font-bold text-white">{designsWithStock}</p>
                </div>
                <div className="bg-slate-800 rounded-lg p-3 border border-slate-700">
                  <p className="text-xs text-slate-400 uppercase tracking-wider">14ct Designs</p>
                  <p className="text-xl font-bold text-slate-300">{misprint14ct.length}</p>
                </div>
              </div>

              <div className="mb-4 px-4 py-3 rounded-lg bg-purple-900/20 border border-purple-800/40 text-sm text-purple-200">
                Misprints are 14ct only. Use the controls below to add or remove from inventory as physical misprints accumulate or ship.
              </div>

              {/* Search */}
              <div className="mb-4">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search 14ct designs…"
                  className="w-full max-w-md px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-700"
                />
              </div>

              {sorted.length === 0 ? (
                <div className="text-center py-12 text-slate-400">No 14ct designs found.</div>
              ) : (
                <div className="grid gap-2">
                  {sorted.map((design) => (
                    <div
                      key={design.id}
                      className={`bg-slate-800 rounded-lg border p-3 flex items-center gap-3 ${
                        design.misprintCount > 0 ? "border-purple-800/60" : "border-slate-700"
                      }`}
                    >
                      <Link href={`/design/${design.id}/info`} className="flex-shrink-0">
                        {design.previewImageUrl ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img
                            src={design.previewImageUrl}
                            alt={design.name}
                            className="w-12 h-12 object-cover rounded border border-slate-600"
                          />
                        ) : (
                          <div className="w-12 h-12 rounded bg-slate-700 border border-slate-600" />
                        )}
                      </Link>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/design/${design.id}/info`}
                            className="text-white font-medium hover:text-purple-300 truncate text-sm md:text-base"
                          >
                            {design.name}
                          </Link>
                          {design.archivedAt && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 bg-sky-900/50 text-sky-300 uppercase tracking-wide" title="Archived design — shown here for misprint stock only">Archived</span>
                          )}
                        </div>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {design.canvasPrinted} canvases printed · {design.kitsReady} kits ready
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <CountStepper
                          value={design.misprintCount}
                          onCommit={(next) => handleSetMisprintValue(design.id, next)}
                          onDelta={(d) => handleMisprintDelta(design.id, d)}
                          ariaLabel={`Misprints for ${design.name}`}
                          valueClassName={design.misprintCount > 0 ? "text-purple-300" : "text-slate-400"}
                          decrementTitle="Remove one misprint"
                          incrementTitle="Add one misprint"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          );
        })()}
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
                  <span className="text-xs text-slate-400 ml-2">(all mesh counts)</span>
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

      {/* Move modal (canvases or kits) */}
      {moveModal && (() => {
        const design = designs.find((d) => d.id === moveModal.designId);
        if (!design) return null;
        const kind = moveModal.kind;
        const noun = kind === "kit" ? "kits" : "canvases";
        const locs: CanvasLoc[] = ["home", "market", "andover"];
        const fromAvail = unitAt(design, kind, moveModal.from);
        const qtyNum = Math.floor(Number(moveModal.qty));
        const sameLoc = moveModal.from === moveModal.to;
        const valid = !sameLoc && Number.isFinite(qtyNum) && qtyNum > 0 && fromAvail > 0;
        const selectCls = "mt-1 w-full px-2 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-rose-700";
        return (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => !movingCanvas && setMoveModal(null)}>
            <div className="bg-slate-800 rounded-xl border border-slate-700 p-5 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-white font-semibold">Move {noun}</h3>
              <p className="text-slate-400 text-sm mb-4 truncate">{design.name}</p>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <label className="block">
                  <span className="text-xs text-slate-400 uppercase tracking-wider">From</span>
                  <select value={moveModal.from} onChange={(e) => setMoveModal({ ...moveModal, from: e.target.value as CanvasLoc })} className={selectCls}>
                    {locs.map((l) => <option key={l} value={l}>{LOC_LABEL[l]} ({unitAt(design, kind, l)})</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs text-slate-400 uppercase tracking-wider">To</span>
                  <select value={moveModal.to} onChange={(e) => setMoveModal({ ...moveModal, to: e.target.value as CanvasLoc })} className={selectCls}>
                    {locs.map((l) => <option key={l} value={l}>{LOC_LABEL[l]} ({unitAt(design, kind, l)})</option>)}
                  </select>
                </label>
              </div>
              <label className="block">
                <span className="text-xs text-slate-400 uppercase tracking-wider">Quantity</span>
                <input type="number" min="1" max={fromAvail} value={moveModal.qty} autoFocus
                  onChange={(e) => setMoveModal({ ...moveModal, qty: e.target.value })}
                  onKeyDown={(e) => { if (e.key === "Enter" && valid) handleCanvasMove(); }}
                  className="mt-1 w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-rose-700" />
              </label>
              <p className="text-xs text-slate-500 mt-2 mb-4 min-h-[1rem]">
                {sameLoc ? <span className="text-amber-400">Pick two different locations.</span>
                  : <>{fromAvail} available in {LOC_LABEL[moveModal.from]}{qtyNum > fromAvail ? <span className="text-amber-400"> — will move all {fromAvail}</span> : null}</>}
              </p>
              <div className="flex gap-2">
                <button onClick={() => setMoveModal(null)} disabled={movingCanvas} className="flex-1 py-2.5 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600 disabled:opacity-50 text-sm font-medium">Cancel</button>
                <button onClick={handleCanvasMove} disabled={!valid || movingCanvas} className="flex-1 py-2.5 bg-rose-900 text-white rounded-lg hover:bg-rose-800 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium">{movingCanvas ? "Moving…" : "Move"}</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
