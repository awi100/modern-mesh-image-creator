"use client";

import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { mutApi } from "@/lib/mut-api";
import Link from "next/link";
import SectionNav from "@/components/SectionNav";
import type { OrdersResponse, Order, OrderItem } from "@/app/api/shopify/orders/route";
import { Breadcrumb } from "@/components/Breadcrumb";
import MeshFilterChips, { MeshFilter } from "@/components/MeshFilterChips";
import { useMeshFilter } from "@/lib/use-mesh-filter";
import CountStepper from "@/components/inventory/CountStepper";
import { getDmcColorByNumber, searchDmcColors, DMC_PEARL_COTTON } from "@/lib/dmc-pearl-cotton";
import { ORDER_KINDS, ORDER_KIND_LABEL, ORDER_KIND_HELP, type OrderKind } from "@/lib/order-kind";
import { onPickList, isSkipped } from "@/lib/order-pick-list";
// Allocation lives in a tested lib because it has to respect shared kit pools:
// `item.kitsReady` is the WHOLE pool for a pooled design, so budgeting or
// totalling it per design spends the same bags once per member.
import { calculateFulfillableOrders, calculateDemandByDesign, kitBudgetKey } from "@/lib/order-allocation";

// Kit content types
interface BackupColorInfo {
  dmcNumber: string;
  colorName: string;
  hex: string;
  inventorySkeins: number;
  inStock: boolean;
  threadSize: number;
}

interface KitItem {
  dmcNumber: string;
  colorName: string;
  hex: string;
  skeinsNeeded: number;
  fullSkeins: number;
  bobbinYards: number;
  inventorySkeins: number;
  threadSize: number;
  inStock: boolean;
  primaryInStock?: boolean;
  backup: BackupColorInfo | null;
}

/**
 * Skeins of a colour that must be on hand to make one kit of it.
 *
 * Mirrors `skeinsToStock` in /api/kits: the displayed "N sk needed", except a
 * bobbin-only colour shows 0 full skeins and still needs one skein opened to
 * wind the bobbin from. Used for the optimistic in-stock flags so a +/- here
 * cannot flip a colour green on a threshold the server would not agree with —
 * `skeinsNeeded` is the raw fractional figure and was being compared instead.
 */
function skeinsToStockFor(item: Pick<KitItem, "fullSkeins" | "bobbinYards">): number {
  return item.fullSkeins > 0 ? item.fullSkeins : item.bobbinYards > 0 ? 1 : 0;
}

interface KitData {
  designId: string;
  totalColors: number;
  totalSkeins: number;
  allInStock: boolean;
  kitContents: KitItem[];
}

interface ColorDesignUsage {
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
  designs: ColorDesignUsage[];
}

function getContrastTextColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? "#000000" : "#FFFFFF";
}

type FilterType = "all" | "canvases" | "kits" | "supplies" | "mystery";




export default function OrdersPage() {
  const [data, setData] = useState<OrdersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterType>("all");
  const { meshFilter, setMeshFilter: setStoredMeshFilter } = useMeshFilter("ordersMeshFilter");
  const handleMeshFilterChange = (f: MeshFilter) => {
    setStoredMeshFilter(f);
    // Reset cached data so it refetches with the new filter
    setKitData(new Map());
    setColorUsage(new Map());
  };
  const [updating, setUpdating] = useState<string | null>(null); // Track which design is being updated
  const [fulfilling, setFulfilling] = useState<string | null>(null); // Track which order is being fulfilled

  // Track pending values being typed
  const [updatingInventory, setUpdatingInventory] = useState<string | null>(null);

  // Kit data for showing what's needed to make each kit
  const [kitData, setKitData] = useState<Map<string, KitData>>(new Map());
  const [loadingKits, setLoadingKits] = useState(false);
  const [expandedKits, setExpandedKits] = useState<Set<string>>(new Set());
  const [expandedColors, setExpandedColors] = useState<Set<string>>(new Set());
  const [colorUsage, setColorUsage] = useState<Map<string, ColorDesignUsage[]>>(new Map());

  // Backup color picker state
  const [editingBackup, setEditingBackup] = useState<{ designId: string; dmcNumber: string } | null>(null);
  const [backupSearch, setBackupSearch] = useState("");
  const [savingBackup, setSavingBackup] = useState(false);
  const [inventoryStock, setInventoryStock] = useState<Map<string, number>>(new Map());

  // Sync state
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ synced: number; message: string } | null>(null);
  const [undoing, setUndoing] = useState<string | null>(null);
  const [settingKind, setSettingKind] = useState<string | null>(null);
  const [skipping, setSkipping] = useState<string | null>(null);

  // Calculate how many orders can be fully filled with current inventory
  const fulfillableOrderCount = useMemo(() => {
    if (!data) return 0;
    const fulfillable = calculateFulfillableOrders(data.orders);
    return fulfillable.size;
  }, [data]);

  const totalUnfulfilledOrders = useMemo(() => {
    if (!data) return 0;
    return onPickList(data.orders).length;
  }, [data]);

  // Search results for backup color picker
  const backupColorSuggestions = useMemo(() => {
    if (!backupSearch.trim()) return [];
    return searchDmcColors(backupSearch.trim()).slice(0, 50);
  }, [backupSearch]);

  // Fetch inventory for the backup color picker at the design's thread size
  // (Size 3 for 13ct, Size 5 for 14/18ct) so the in-stock hint is accurate.
  const fetchInventoryStock = useCallback(async (size: number = 5) => {
    try {
      const res = await fetch(`/api/inventory?size=${size}`);
      if (res.ok) {
        const items: { dmcNumber: string; skeins: number }[] = await res.json();
        const stockMap = new Map<string, number>();
        for (const item of items) {
          stockMap.set(item.dmcNumber, item.skeins);
        }
        setInventoryStock(stockMap);
      }
    } catch (err) {
      console.error("Failed to fetch inventory:", err);
    }
  }, []);

  // Use refs for debounced updates to handle rapid clicks
  const pendingUpdates = useRef<Map<string, { field: "kitsReady" | "canvasPrinted"; delta: number; timeout: NodeJS.Timeout }>>(new Map());
  const inFlightRequests = useRef<Set<string>>(new Set());

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/shopify/orders");
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to fetch orders");
      }
      const json: OrdersResponse = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
    setLoading(false);
  }, []);

  // Sync fulfilled orders from Shopify
  const syncOrders = useCallback(async (showResult = true) => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await mutApi("/api/shopify/orders/sync", { method: "POST" });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to sync orders");
      }
      const result = await res.json();
      if (showResult && result.synced > 0) {
        // Name the ones that weren't sales. They deduct stock exactly like a
        // sale, so a donation or a wholesale box quietly moving inventory is
        // the one outcome of this sync worth reading before you trust the
        // counts — and the type is a guess that can be corrected on the order.
        const nonRetail: { orderNumber: string; label: string }[] = result.nonRetail ?? [];
        const aside =
          nonRetail.length > 0
            ? ` — including ${nonRetail.map((o) => `${o.orderNumber} as ${o.label.toLowerCase()}`).join(", ")}. Stock was deducted; these are kept out of the sales rate. Change the type on an order if that's wrong.`
            : "";
        setSyncResult({
          synced: result.synced,
          message: `Synced ${result.synced} fulfilled order${result.synced > 1 ? "s" : ""} from Shopify${aside}`,
        });
        // Refetch orders to update the list
        await fetchOrders();
      }
      return result;
    } catch (err) {
      console.error("Sync error:", err);
      if (showResult) {
        setError(err instanceof Error ? err.message : "Sync failed");
      }
      return null;
    } finally {
      setSyncing(false);
    }
  }, [fetchOrders]);

  // Undo a local fulfillment
  const handleUndoFulfillment = useCallback(async (shopifyOrderId: string) => {
    setUndoing(shopifyOrderId);
    setError(null);
    try {
      const res = await mutApi(`/api/shopify/orders/fulfill?shopifyOrderId=${encodeURIComponent(shopifyOrderId)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to undo fulfillment");
      }

      // Update local state to mark as not fulfilled
      setData(prevData => {
        if (!prevData) return prevData;
        return {
          ...prevData,
          orders: prevData.orders.map(o => {
            if (o.shopifyOrderId !== shopifyOrderId) return o;
            return {
              ...o,
              locallyFulfilled: false,
              locallyFulfilledAt: null,
            };
          }),
        };
      });

      // Refetch to get updated inventory counts
      await fetchOrders();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Undo failed");
    } finally {
      setUndoing(null);
    }
  }, [fetchOrders]);

  // Fetch kit data for showing kit contents
  const fetchKits = useCallback(async (force = false) => {
    if (!force && kitData.size > 0) return; // Already loaded
    setLoadingKits(true);
    try {
      const meshParam = meshFilter !== "all" ? `?meshCount=${meshFilter}` : "";
      const res = await fetch(`/api/kits${meshParam}`);
      if (res.ok) {
        const kits = await res.json();
        const kitMap = new Map<string, KitData>();
        for (const kit of kits) {
          kitMap.set(kit.designId, {
            designId: kit.designId,
            totalColors: kit.totalColors,
            totalSkeins: kit.totalSkeins,
            allInStock: kit.allInStock,
            kitContents: kit.kitContents,
          });
        }
        setKitData(kitMap);
      }
    } catch (err) {
      console.error("Failed to fetch kit data:", err);
    }
    setLoadingKits(false);
  }, [kitData.size, meshFilter]);

  // Fetch color usage data for showing which designs use each color
  const fetchColorUsage = useCallback(async () => {
    if (colorUsage.size > 0) return; // Already loaded
    try {
      const meshParam = meshFilter !== "all" ? `?meshCount=${meshFilter}` : "";
      const res = await fetch(`/api/colors/usage${meshParam}`);
      if (res.ok) {
        const data: ColorUsage[] = await res.json();
        const usageMap = new Map<string, ColorDesignUsage[]>();
        for (const usage of data) {
          usageMap.set(usage.dmcNumber, usage.designs);
        }
        setColorUsage(usageMap);
      }
    } catch (err) {
      console.error("Failed to fetch color usage:", err);
    }
  }, [colorUsage.size, meshFilter]);

  // Toggle expanded kit view
  const toggleKitExpanded = useCallback((designId: string) => {
    setExpandedKits(prev => {
      const next = new Set(prev);
      if (next.has(designId)) {
        next.delete(designId);
      } else {
        next.add(designId);
        // Fetch kit data and color usage if not already loaded
        if (kitData.size === 0) {
          fetchKits();
        }
        if (colorUsage.size === 0) {
          fetchColorUsage();
        }
      }
      return next;
    });
  }, [kitData.size, fetchKits, colorUsage.size, fetchColorUsage]);

  // Fulfill an order - deduct kits, canvases, and supplies
  const handleFulfillOrder = useCallback(async (order: Order) => {
    setFulfilling(order.shopifyOrderId);
    setError(null);

    try {
      // Prepare items for fulfillment. Mystery Bag lines are still sent so the
      // order history records them; they match no design and deduct nothing.
      const items = order.items
        .filter(item => item.designId || item.supplyId || item.itemType === "mystery_bag" || item.itemType === "bundle")
        .map(item => ({
          designId: item.designId || undefined,
          supplyId: item.supplyId || undefined,
          productTitle: item.productTitle,
          variantTitle: item.variantTitle,
          quantity: item.quantity,
          needsKit: item.needsKit,
          customAttributes: item.customAttributes ?? [],
        }));

      if (items.length === 0) {
        setError("No items with matching designs or supplies to fulfill");
        setFulfilling(null);
        return;
      }

      const res = await mutApi("/api/shopify/orders/fulfill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shopifyOrderId: order.shopifyOrderId,
          orderNumber: order.orderNumber,
          customerName: order.customerName,
          sourceName: order.sourceName,
          // Why the order exists, so a donation or wholesale box deducts stock
          // without being counted as retail demand.
          kind: order.kind,
          items,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to fulfill order");
      }

      // Mark the order as locally fulfilled (instead of removing it)
      setData(prevData => {
        if (!prevData) return prevData;
        return {
          ...prevData,
          orders: prevData.orders.map(o => {
            if (o.shopifyOrderId !== order.shopifyOrderId) return o;
            return {
              ...o,
              locallyFulfilled: true,
              locallyFulfilledAt: new Date().toISOString(),
            };
          }),
        };
      });
      // Fulfillment deducted kits/canvas/supplies server-side — refresh this
      // page's own order/design counts so they update immediately too (mutApi
      // already fanned the change out to the other pages' SWR caches).
      await fetchOrders();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fulfill failed");
    }
    setFulfilling(null);
  }, [fetchOrders]);

  /**
   * Record why an order exists. This moves no stock — the units left the
   * building whatever the reason — it only decides whether the order counts as
   * retail demand in the sales rate that sizes reorders and the kit order.
   *
   * Applied locally first, because an order that hasn't been deducted yet has
   * no row to label: the server answers 404 and the choice rides along on the
   * fulfil request instead. Any other failure puts the old value back.
   */
  const handleSetOrderKind = useCallback(async (order: Order, kind: OrderKind) => {
    const previous = order.kind;
    if (previous === kind) return;
    setSettingKind(order.shopifyOrderId);
    setError(null);

    const applyLocally = (value: OrderKind) =>
      setData((prev) =>
        prev
          ? {
              ...prev,
              orders: prev.orders.map((o) =>
                o.shopifyOrderId === order.shopifyOrderId ? { ...o, kind: value } : o
              ),
            }
          : prev
      );

    applyLocally(kind);

    try {
      // mutApi, not fetch: the kind changes the sales rate, so every page
      // showing velocity, reorder sizing or stock alerts is now stale.
      const res = await mutApi("/api/shopify/orders/kind", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shopifyOrderId: order.shopifyOrderId, kind }),
      });
      // 404 = not deducted yet, which is expected and not an error.
      if (!res.ok && res.status !== 404) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to update order type");
      }
    } catch (err) {
      applyLocally(previous);
      setError(err instanceof Error ? err.message : "Failed to update order type");
    }
    setSettingKind(null);
  }, []);

  /**
   * Leave an order off the pick list, or put it back.
   *
   * Moves no stock and touches nothing in Shopify. It only stops the order
   * counting toward what gets pulled from the shelf, and stops it being
   * allocated inventory ahead of the orders actually being packed today.
   *
   * Applied locally first so the totals on screen move the moment the box is
   * unticked; a failure puts the tick back and says why.
   */
  const handleToggleSkip = useCallback(async (order: Order) => {
    const next = !isSkipped(order);
    setSkipping(order.shopifyOrderId);
    setError(null);

    const applyLocally = (at: string | null) =>
      setData((prev) =>
        prev
          ? {
              ...prev,
              orders: prev.orders.map((o) =>
                o.shopifyOrderId === order.shopifyOrderId
                  ? { ...o, excludedAt: at, excludedReason: at ? o.excludedReason : null }
                  : o
              ),
            }
          : prev
      );

    const previous = order.excludedAt;
    applyLocally(next ? new Date().toISOString() : null);

    try {
      // Plain fetch, not mutApi: this moves no stock, kits, canvases, market,
      // Andover, supplies or bobbins, so there is no inventory cache anywhere
      // else to invalidate. The refetch below is for this page's own totals.
      const res = await fetch("/api/shopify/orders/exclude", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shopifyOrderId: order.shopifyOrderId,
          excluded: next,
          // Needed only when no local row exists yet, which is the usual case:
          // skipping happens before packing. The kind rides along so a bare row
          // cannot pin a wholesale order to the "retail" default.
          orderNumber: order.orderNumber,
          kind: order.kind,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to update order");
      }
      // The headline "Canvases x/y" and "Kits x/y" cards are computed on the
      // server, so the local tick above moves the per-row figures but not the
      // totals she is actually pulling against. Refetch so both agree.
      await fetchOrders();
    } catch (err) {
      applyLocally(previous);
      setError(err instanceof Error ? err.message : "Failed to update order");
    }
    setSkipping(null);
  }, [fetchOrders]);

  // Fetch inventory when backup picker opens, using the editing design's
  // thread size so a 13ct design shows Size 3 stock (not Size 5).
  useEffect(() => {
    if (editingBackup) {
      const editingItem = kitData.get(editingBackup.designId)?.kitContents.find(i => i.dmcNumber === editingBackup.dmcNumber);
      fetchInventoryStock(editingItem?.threadSize ?? 5);
    }
  }, [editingBackup, fetchInventoryStock, kitData]);

  useEffect(() => {
    const loadAndSync = async () => {
      await fetchOrders();
      // Auto-sync fulfilled orders from Shopify (silent, no toast on 0 synced)
      await syncOrders(true);
    };
    loadAndSync();
  }, [fetchOrders, syncOrders]);

  // Send the actual API request for a design update
  const sendUpdate = useCallback(async (designId: string, field: "kitsReady" | "canvasPrinted", totalDelta: number) => {
    // Mark as in-flight
    inFlightRequests.current.add(`${designId}-${field}`);
    setUpdating(designId);

    try {
      const body = field === "kitsReady"
        ? { kitsReadyDelta: totalDelta }
        : { canvasPrintedDelta: totalDelta };

      const res = await mutApi(`/api/designs/${designId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        throw new Error("Failed to update");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
      // Revert by refetching
      await fetchOrders();
    } finally {
      inFlightRequests.current.delete(`${designId}-${field}`);
      setUpdating(null);
    }
  }, [fetchOrders]);

  // Update design kitsReady or canvasPrinted count with optimistic updates and debouncing
  const handleUpdateCount = useCallback((designId: string, field: "kitsReady" | "canvasPrinted", delta: number) => {
    const key = `${designId}-${field}`;

    // Immediately apply optimistic update to UI
    setData(prevData => {
      if (!prevData) return prevData;

      // A kit edit on a pooled design changes the POOL, so it has to show on
      // every member's rows — the server write already goes to the group, so
      // updating only this design's rows would leave the siblings reporting a
      // stale pool until the next refetch and invite a second correction.
      // Canvases are per design and unaffected.
      const groupId = field === "kitsReady"
        ? prevData.orders
            .flatMap(o => o.items)
            .find(i => i.designId === designId)?.kitGroupId ?? null
        : null;
      const affects = (item: OrderItem) =>
        groupId ? item.kitGroupId === groupId : item.designId === designId;

      return {
        ...prevData,
        orders: prevData.orders.map(order => ({
          ...order,
          items: order.items.map(item => {
            if (!affects(item)) return item;
            if (field === "kitsReady") {
              return { ...item, kitsReady: Math.max(0, item.kitsReady + delta) };
            } else {
              return { ...item, canvasPrinted: Math.max(0, item.canvasPrinted + delta) };
            }
          }),
        })),
      };
    });

    // Check if there's already a pending update for this design+field
    const existing = pendingUpdates.current.get(key);
    if (existing) {
      // Accumulate the delta and reset the timer
      clearTimeout(existing.timeout);
      existing.delta += delta;
      existing.timeout = setTimeout(() => {
        const update = pendingUpdates.current.get(key);
        if (update && update.delta !== 0) {
          pendingUpdates.current.delete(key);
          sendUpdate(designId, field, update.delta);
        }
      }, 300); // 300ms debounce
    } else {
      // Create new pending update
      const timeout = setTimeout(() => {
        const update = pendingUpdates.current.get(key);
        if (update && update.delta !== 0) {
          pendingUpdates.current.delete(key);
          sendUpdate(designId, field, update.delta);
        }
      }, 300); // 300ms debounce

      pendingUpdates.current.set(key, { field, delta, timeout });
    }
  }, [sendUpdate]);

  // Set an absolute value for kitsReady or canvasPrinted.
  //
  // `currentValue` is the number shown in the row the user typed into. It used
  // to be found by scanning every order for the first item with this designId —
  // and the inner `break` only left the inner loop, so a later order could
  // overwrite it — which computes the delta against a row other than the one
  // being edited.
  //
  // Bails (no PATCH) on non-finite input, guarding against `Number("")` = 0
  // silently zeroing a count when the user blurs an empty input.
  const handleSetValue = useCallback((
    designId: string,
    field: "kitsReady" | "canvasPrinted",
    value: number,
    currentValue: number,
  ) => {
    if (!Number.isFinite(value)) return;

    const newVal = Math.max(0, Math.floor(value));
    const delta = newVal - currentValue;

    if (delta !== 0) {
      handleUpdateCount(designId, field, delta);
    }
  }, [handleUpdateCount]);

  // Update thread inventory for a kit color. Inventory is keyed by
  // (dmcNumber, threadSize) — 13ct designs use Size 3, 14/18ct use Size 5 —
  // so the write and the optimistic update must both respect the size.
  const handleUpdateInventory = useCallback(async (dmcNumber: string, delta: number, threadSize: number) => {
    const size = threadSize;
    const key = `${dmcNumber}-${size}`;
    if (updatingInventory === key) return;

    setUpdatingInventory(key);

    // Optimistic update in kitData — only items of the SAME thread size share
    // this inventory record; a same-DMC item at a different size is a different
    // SKU and must not move.
    //
    // One colour can appear in three places at once: as a kit's own colour, as
    // the BACKUP for a different colour in the same kit, and as either of those
    // in another design's kit. They all read the single (dmc, size) inventory
    // row, so one +/- has to move every one of them — otherwise adjusting a
    // backup's stock leaves the figure the button is attached to unchanged and
    // it reads as if the click did nothing.
    setKitData(prevKitData => {
      const newMap = new Map(prevKitData);
      for (const [designId, kit] of newMap) {
        const updatedContents = kit.kitContents.map(item => {
          if (item.threadSize !== size) return item;
          const hitsPrimary = item.dmcNumber === dmcNumber;
          const hitsBackup = item.backup?.dmcNumber === dmcNumber;
          if (!hitsPrimary && !hitsBackup) return item;

          const need = skeinsToStockFor(item);
          const primarySkeins = hitsPrimary ? Math.max(0, item.inventorySkeins + delta) : item.inventorySkeins;
          const backupSkeins = item.backup
            ? hitsBackup ? Math.max(0, item.backup.inventorySkeins + delta) : item.backup.inventorySkeins
            : 0;
          const primaryInStock = primarySkeins >= need;
          const backupInStock = item.backup ? backupSkeins >= need : false;

          return {
            ...item,
            inventorySkeins: primarySkeins,
            backup: item.backup ? { ...item.backup, inventorySkeins: backupSkeins, inStock: backupInStock } : null,
            primaryInStock,
            // A colour counts as covered if EITHER the colour itself or its
            // backup is stocked — the same rule /api/kits applies.
            inStock: primaryInStock || backupInStock,
          };
        });
        newMap.set(designId, {
          ...kit,
          kitContents: updatedContents,
          allInStock: updatedContents.every(i => i.inStock),
        });
      }
      return newMap;
    });

    try {
      const res = await mutApi("/api/inventory", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dmcNumber, size, delta }),
      });

      if (!res.ok) {
        throw new Error("Failed to update inventory");
      }
    } catch (error) {
      console.error("Error updating inventory:", error);
      // Revert by force-refetching kits (the plain fetch would no-op since
      // kitData is already loaded).
      fetchKits(true);
    }
    setUpdatingInventory(null);
  }, [updatingInventory, fetchKits]);

  // Set absolute inventory value for a kit color at a specific thread size.
  // `currentValue` MUST be the number shown in the row the user typed into.
  // This used to scan kitData for the first kit holding that (dmc, size), which
  // is a different row that can hold a different, staler number — so confirming
  // the value you could see moved stock by the difference between the two.
  const handleSetInventory = useCallback(async (
    dmcNumber: string,
    value: number,
    threadSize: number,
    currentValue: number,
  ) => {
    if (!Number.isFinite(value)) return;
    const delta = Math.max(0, Math.floor(value)) - currentValue;
    if (delta !== 0) {
      await handleUpdateInventory(dmcNumber, delta, threadSize);
    }
  }, [handleUpdateInventory]);

  // Save backup color for a design
  const handleSaveBackup = useCallback(async (backupDmcNumber: string) => {
    if (!editingBackup || savingBackup) return;

    const { designId, dmcNumber } = editingBackup;
    setSavingBackup(true);

    try {
      // Get current backup colors for this design from kitData
      const kit = kitData.get(designId);
      const existingBackups: Record<string, string> = {};

      // Build existing backups from kit contents
      if (kit) {
        for (const item of kit.kitContents) {
          if (item.backup) {
            existingBackups[item.dmcNumber] = item.backup.dmcNumber;
          }
        }
      }

      // Update with new backup
      const newBackups = { ...existingBackups, [dmcNumber]: backupDmcNumber.trim() };

      // If empty, remove the backup
      if (!backupDmcNumber.trim()) {
        delete newBackups[dmcNumber];
      }

      const res = await mutApi(`/api/designs/${designId}/backup-colors`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ backupColors: newBackups }),
      });

      if (!res.ok) throw new Error("Failed to save backup color");

      // Optimistic update: update kitData with new backup
      setKitData(prevKitData => {
        const newMap = new Map(prevKitData);
        const kit = newMap.get(designId);
        if (kit) {
          const backupColor = backupDmcNumber ? getDmcColorByNumber(backupDmcNumber) : null;
          const updatedContents = kit.kitContents.map(item => {
            if (item.dmcNumber !== dmcNumber) return item;
            if (!backupDmcNumber.trim()) {
              return { ...item, backup: null };
            }
            // Real stock for the backup colour at the SAME thread size.
            //
            // `inventoryStock` is loaded for this design's thread size when the
            // picker opens, so it covers every colour. The scan of loaded kits
            // below is the fallback, and it only ever finds a colour that is
            // some design's OWN colour — a backup nobody stitches came out as
            // 0, which the +/- control beside it would then be counting up
            // from, writing a delta against a number that was never true.
            let backupInventorySkeins = inventoryStock.get(backupDmcNumber);
            if (backupInventorySkeins === undefined) {
              backupInventorySkeins = 0;
              for (const k of prevKitData.values()) {
                const backupItem = k.kitContents.find(i => i.dmcNumber === backupDmcNumber && i.threadSize === item.threadSize);
                if (backupItem) {
                  backupInventorySkeins = backupItem.inventorySkeins;
                  break;
                }
              }
            }
            return {
              ...item,
              backup: {
                dmcNumber: backupDmcNumber,
                colorName: backupColor?.name ?? "Unknown",
                hex: backupColor?.hex ?? "#888888",
                inventorySkeins: backupInventorySkeins,
                inStock: backupInventorySkeins >= skeinsToStockFor(item),
                threadSize: item.threadSize,
              },
            };
          });
          newMap.set(designId, { ...kit, kitContents: updatedContents });
        }
        return newMap;
      });

      // Close modal
      setEditingBackup(null);
      setBackupSearch("");
    } catch (error) {
      console.error("Error saving backup color:", error);
      setError("Failed to save backup color");
    } finally {
      setSavingBackup(false);
    }
  }, [editingBackup, savingBackup, kitData, inventoryStock]);

  return (
    <div className="min-h-screen bg-slate-900">
      {/* Header */}
      <header className="bg-slate-800 border-b border-slate-700 sticky top-0 z-40 safe-area-top">
        <div className="max-w-6xl mx-auto px-4 pt-2"><SectionNav /></div>
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-slate-400 hover:text-white">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
            </Link>
            <h1 className="text-lg md:text-xl font-bold text-white">Orders</h1>
            <Link
              href="/analytics"
              className="px-2 py-1 text-xs text-slate-400 hover:text-white bg-slate-700 hover:bg-slate-600 rounded transition-colors"
            >
              Analytics →
            </Link>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => syncOrders(true)}
              disabled={syncing || loading}
              className="px-2 md:px-3 py-2 bg-emerald-700 text-emerald-100 rounded-lg hover:bg-emerald-600 disabled:opacity-50 text-xs md:text-sm flex items-center gap-1.5"
              title="Sync fulfilled orders from Shopify"
            >
              {syncing ? (
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              )}
              <span className="hidden md:inline">Sync</span>
            </button>
            <Link
              href="/shopify"
              className="px-2 md:px-3 py-2 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600 text-xs md:text-sm"
            >
              Products
            </Link>
            <button
              onClick={fetchOrders}
              disabled={loading}
              className="p-2 text-slate-400 hover:text-white disabled:opacity-50"
              title="Refresh"
            >
              <svg className={`w-5 h-5 ${loading ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        <Breadcrumb items={[{ label: "Orders" }]} className="mb-2" />

        <div className="mb-4">
          <MeshFilterChips value={meshFilter} onChange={handleMeshFilterChange} />
        </div>

        {/* Error */}
        {error && (
          <div className="p-4 bg-red-900/30 border border-red-700 rounded-lg">
            <p className="text-red-400">{error}</p>
          </div>
        )}

        {/* Sync Result */}
        {syncResult && (
          <div className="p-4 bg-emerald-900/30 border border-emerald-700 rounded-lg flex items-center justify-between">
            <div className="flex items-center gap-3">
              <svg className="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <p className="text-emerald-400">{syncResult.message}</p>
            </div>
            <button
              onClick={() => setSyncResult(null)}
              className="text-emerald-400 hover:text-emerald-300"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {/* Loading */}
        {loading && !data && (
          <div className="flex items-center justify-center py-12">
            <div className="text-slate-400 flex items-center gap-3">
              <svg className="animate-spin h-6 w-6" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Loading orders from Shopify...
            </div>
          </div>
        )}

        {/* Summary */}
        {data && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div className={`rounded-xl p-4 border ${fulfillableOrderCount >= totalUnfulfilledOrders ? "bg-slate-800 border-slate-700" : "bg-emerald-900/20 border-emerald-700"}`}>
                <p className="text-3xl font-bold text-emerald-400">
                  <span className={fulfillableOrderCount >= totalUnfulfilledOrders ? "text-emerald-400" : ""}>{fulfillableOrderCount}</span>
                  <span className="text-slate-500 text-xl">/{totalUnfulfilledOrders}</span>
                </p>
                <p className="text-sm text-slate-400">Orders Fillable</p>
              </div>
              <div className={`rounded-xl p-4 border ${(data.summary.totalCanvasesReady ?? 0) >= data.summary.totalCanvasesNeeded ? "bg-slate-800 border-slate-700" : "bg-blue-900/20 border-blue-700"}`}>
                <p className="text-3xl font-bold text-blue-400">
                  <span className={(data.summary.totalCanvasesReady ?? 0) >= data.summary.totalCanvasesNeeded ? "text-emerald-400" : ""}>{data.summary.totalCanvasesReady ?? 0}</span>
                  <span className="text-slate-500 text-xl">/{data.summary.totalCanvasesNeeded}</span>
                </p>
                <p className="text-sm text-slate-400">Canvases Ready</p>
              </div>
              <div className={`rounded-xl p-4 border ${(data.summary.totalKitsReady ?? 0) >= data.summary.totalKitsNeeded ? "bg-slate-800 border-slate-700" : "bg-amber-900/20 border-amber-700"}`}>
                <p className="text-3xl font-bold text-amber-400">
                  <span className={(data.summary.totalKitsReady ?? 0) >= data.summary.totalKitsNeeded ? "text-emerald-400" : ""}>{data.summary.totalKitsReady ?? 0}</span>
                  <span className="text-slate-500 text-xl">/{data.summary.totalKitsNeeded}</span>
                </p>
                <p className="text-sm text-slate-400">Kits Ready</p>
              </div>
              <div className={`rounded-xl p-4 border ${(data.summary.totalSuppliesReady ?? 0) >= data.summary.totalSupplies ? "bg-slate-800 border-slate-700" : "bg-purple-900/20 border-purple-700"}`}>
                <p className="text-3xl font-bold text-purple-400">
                  <span className={(data.summary.totalSuppliesReady ?? 0) >= data.summary.totalSupplies ? "text-emerald-400" : ""}>{data.summary.totalSuppliesReady ?? 0}</span>
                  <span className="text-slate-500 text-xl">/{data.summary.totalSupplies}</span>
                </p>
                <p className="text-sm text-slate-400">Supplies Ready</p>
              </div>
              <div className={`rounded-xl p-4 border ${data.summary.unmatchedProducts.length > 0 ? "bg-yellow-900/20 border-yellow-700" : "bg-emerald-900/20 border-emerald-700"}`}>
                <p className={`text-3xl font-bold ${data.summary.unmatchedProducts.length > 0 ? "text-yellow-400" : "text-emerald-400"}`}>
                  {data.summary.unmatchedProducts.length}
                </p>
                <p className="text-sm text-slate-400">Unmatched</p>
              </div>
            </div>

            {/* Draft orders unavailable (missing Shopify scope) */}
            {data.draftWarning && (
              <div className="p-4 bg-amber-900/20 border border-amber-700 rounded-lg">
                <p className="text-amber-400 font-medium mb-1">Draft orders not loaded</p>
                <p className="text-sm text-slate-300">{data.draftWarning}</p>
              </div>
            )}

            {/* Unmatched Products Warning */}
            {data.summary.unmatchedProducts.length > 0 && (
              <div className="p-4 bg-yellow-900/20 border border-yellow-700 rounded-lg">
                <p className="text-yellow-400 font-medium mb-2">Products Not Matched to Designs</p>
                <p className="text-sm text-slate-300 mb-2">
                  These Shopify product titles don&apos;t match any design names in your system:
                </p>
                <ul className="list-disc list-inside text-sm text-slate-400">
                  {data.summary.unmatchedProducts.map((name) => (
                    <li key={name}>{name}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Filter Buttons */}
            <div className="flex flex-wrap items-center gap-1.5 md:gap-2">
              <span className="text-xs md:text-sm text-slate-400 mr-1 md:mr-2">Show:</span>
              <button
                onClick={() => setFilter("all")}
                className={`px-2 md:px-3 py-1.5 rounded-lg text-xs md:text-sm font-medium transition-colors ${
                  filter === "all"
                    ? "bg-slate-600 text-white"
                    : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white"
                }`}
              >
                All
              </button>
              <button
                onClick={() => setFilter("canvases")}
                className={`px-2 md:px-3 py-1.5 rounded-lg text-xs md:text-sm font-medium transition-colors ${
                  filter === "canvases"
                    ? "bg-blue-600 text-white"
                    : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-blue-400"
                }`}
              >
                Canvases <span className="opacity-75">({data.summary.totalCanvasesReady ?? 0}/{data.summary.totalCanvasesNeeded})</span>
              </button>
              <button
                onClick={() => setFilter("kits")}
                className={`px-2 md:px-3 py-1.5 rounded-lg text-xs md:text-sm font-medium transition-colors ${
                  filter === "kits"
                    ? "bg-amber-600 text-white"
                    : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-amber-400"
                }`}
              >
                Kits <span className="opacity-75">({data.summary.totalKitsReady ?? 0}/{data.summary.totalKitsNeeded})</span>
              </button>
              <button
                onClick={() => setFilter("supplies")}
                className={`px-2 md:px-3 py-1.5 rounded-lg text-xs md:text-sm font-medium transition-colors ${
                  filter === "supplies"
                    ? "bg-purple-600 text-white"
                    : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-purple-400"
                }`}
              >
                Supplies <span className="opacity-75">({data.summary.totalSuppliesReady ?? 0}/{data.summary.totalSupplies})</span>
              </button>
              {(data.summary.totalMysteryBags ?? 0) > 0 && (
                <button
                  onClick={() => setFilter("mystery")}
                  className={`px-2 md:px-3 py-1.5 rounded-lg text-xs md:text-sm font-medium transition-colors ${
                    filter === "mystery"
                      ? "bg-fuchsia-700 text-white"
                      : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-fuchsia-300"
                  }`}
                  title="Orders containing a Mystery Misprint Bag, with any special instructions"
                >
                  Misprints <span className="opacity-75">({data.summary.totalMysteryBags} {data.summary.totalMysteryBags === 1 ? "order" : "orders"})</span>
                </button>
              )}
            </div>

            {/* Kits Needed View - Grouped by collection */}
            {filter === "kits" && (
              <div className="space-y-4">
                <h2 className="text-lg font-semibold text-white">Kits Needed</h2>
                {(() => {
                  // One row PER DESIGN. Pooled designs are not merged: the kit
                  // bags are interchangeable but the canvases are not, so a
                  // Boylston order and a Newbury order are two different things
                  // to pull and must stay two rows — merged, the list read
                  // "2 x Boylston St" for one of each.
                  //
                  // What IS shared is the bag count, so `kitsReady` on every
                  // member is the whole pool. Comparing it with one design's
                  // demand would be the invitation to pull the pool twice, so
                  // the pool's TOTAL demand is accumulated alongside and the
                  // enough/short maths below uses that instead.
                  const kitsByDesign = new Map<string, {
                    designId: string | null;
                    designName: string | null;
                    productTitle: string;
                    previewImageUrl: string | null;
                    quantity: number;
                    kitsReady: number;
                    folderId: string | null;
                    folderName: string | null;
                    totalSold: number;
                    poolKey: string | null;
                    poolName: string | null;
                  }>();
                  // poolKey -> total bags owed across every member, and which
                  // designs are sharing them.
                  const poolNeed = new Map<string, number>();
                  const poolFor = new Map<string, string[]>();

                  for (const order of data.orders) {
                    for (const item of order.items) {
                      if (!item.needsKit || item.itemType !== "canvas") continue;

                      const poolKey = item.kitPool ? kitBudgetKey(item) : null;
                      if (poolKey) {
                        poolNeed.set(poolKey, (poolNeed.get(poolKey) ?? 0) + item.quantity);
                        const names = poolFor.get(poolKey) ?? [];
                        const label = item.designName ?? item.productTitle;
                        if (!names.includes(label)) names.push(label);
                        poolFor.set(poolKey, names);
                      }

                      const key = item.designId || item.productTitle;
                      const existing = kitsByDesign.get(key);
                      if (existing) {
                        existing.quantity += item.quantity;
                      } else {
                        kitsByDesign.set(key, {
                          designId: item.designId,
                          designName: item.designName,
                          productTitle: item.productTitle,
                          previewImageUrl: item.previewImageUrl,
                          quantity: item.quantity,
                          kitsReady: item.kitsReady,
                          folderId: item.folderId,
                          folderName: item.folderName,
                          totalSold: item.totalSold,
                          poolKey,
                          poolName: item.kitPool?.name ?? null,
                        });
                      }
                    }
                  }

                  const kits = Array.from(kitsByDesign.values());

                  if (kits.length === 0) {
                    return (
                      <div className="bg-slate-800 rounded-xl border border-slate-700 p-8 text-center">
                        <p className="text-slate-400">No kits needed</p>
                      </div>
                    );
                  }

                  // Group by folder
                  const kitsByFolder = new Map<string, typeof kits>();
                  for (const kit of kits) {
                    const folderKey = kit.folderId || "__uncategorized__";
                    const existing = kitsByFolder.get(folderKey) || [];
                    existing.push(kit);
                    kitsByFolder.set(folderKey, existing);
                  }

                  // Sort folders alphabetically, with uncategorized at the end
                  const sortedFolders = Array.from(kitsByFolder.entries()).sort((a, b) => {
                    if (a[0] === "__uncategorized__") return 1;
                    if (b[0] === "__uncategorized__") return -1;
                    const nameA = a[1][0]?.folderName || "";
                    const nameB = b[1][0]?.folderName || "";
                    return nameA.localeCompare(nameB);
                  });

                  return (
                    <div className="space-y-4">
                      {sortedFolders.map(([folderId, folderKits]) => {
                        const folderName = folderKits[0]?.folderName || "Uncategorized";
                        // Sort kits within folder by quantity needed (descending)
                        const sortedKits = [...folderKits].sort((a, b) => b.quantity - a.quantity);

                        return (
                          <div key={folderId} className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
                            {/* Folder header */}
                            <div className="px-4 py-3 bg-slate-700/50 border-b border-slate-700">
                              <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
                                {folderName}
                              </h3>
                            </div>
                            <div className="divide-y divide-slate-700/50">
                              {sortedKits.map((kit, idx) => {
                                // `kit.kitsReady` is the whole pool for a pooled
                                // design, so it is compared with what the whole
                                // pool owes. Against this design alone, Boylston
                                // needing 2 and Newbury needing 2 would both read
                                // "enough" off the same 3 bags.
                                const bagsNeeded = kit.poolKey ? (poolNeed.get(kit.poolKey) ?? kit.quantity) : kit.quantity;
                                const hasEnough = kit.kitsReady >= bagsNeeded;
                                const shortage = bagsNeeded - kit.kitsReady;
                                const sharedWith = kit.poolKey ? (poolFor.get(kit.poolKey) ?? []) : [];
                                const isExpanded = kit.designId ? expandedKits.has(kit.designId) : false;
                                const kitInfo = kit.designId ? kitData.get(kit.designId) : null;
                                const isIntroKit = kit.productTitle.toLowerCase().includes("intro") || kit.productTitle.toLowerCase().includes("beginner");
                                const kitDelta = isIntroKit ? 2 : 1;

                                return (
                                  <div key={kit.designId ?? `row-${idx}`}>
                                    <div className="p-4 flex items-center gap-4">
                                      {kit.designId ? (
                                        <Link
                                          href={`/design/${kit.designId}/info`}
                                          className="flex-shrink-0"
                                        >
                                          {kit.previewImageUrl ? (
                                            <img
                                              src={kit.previewImageUrl}
                                              alt={kit.productTitle}
                                              className="w-14 h-14 rounded-lg object-cover hover:ring-2 hover:ring-rose-500 transition-all"
                                            />
                                          ) : (
                                            <div className="w-14 h-14 rounded-lg bg-slate-700 flex items-center justify-center hover:ring-2 hover:ring-rose-500 transition-all">
                                              <span className="text-slate-500 text-xs">?</span>
                                            </div>
                                          )}
                                        </Link>
                                      ) : kit.previewImageUrl ? (
                                        <img
                                          src={kit.previewImageUrl}
                                          alt={kit.productTitle}
                                          className="w-14 h-14 rounded-lg object-cover flex-shrink-0"
                                        />
                                      ) : (
                                        <div className="w-14 h-14 rounded-lg bg-slate-700 flex items-center justify-center flex-shrink-0">
                                          <span className="text-slate-500 text-xs">?</span>
                                        </div>
                                      )}
                                      <div className="flex-1 min-w-0">
                                        {kit.designId ? (
                                          <Link
                                            href={`/design/${kit.designId}/info`}
                                            className="text-white font-medium truncate hover:text-rose-400 transition-colors block"
                                          >
                                            {kit.designName || kit.productTitle}
                                          </Link>
                                        ) : (
                                          <p className="text-white font-medium truncate">
                                            {kit.designName || kit.productTitle}
                                          </p>
                                        )}
                                        {!kit.designId ? (
                                          <p className="text-xs text-yellow-500">No matching design</p>
                                        ) : (
                                          <p className="text-xs text-purple-400">{kit.totalSold} sold</p>
                                        )}
                                        {/* The bag count on this row is the whole
                                            pool, so say whose it is — otherwise
                                            the same 3 reads as 3 for this design
                                            alone and gets pulled twice. */}
                                        {kit.poolName && (
                                          <p
                                            className="text-xs text-sky-400 truncate"
                                            title={`One bag of thread fits any of: ${sharedWith.join(", ")}. The ${kit.kitsReady} shown is the whole shared pool, and ${bagsNeeded} of them are needed across those designs — not this design's own share. The canvases are still separate.`}
                                          >
                                            Shared bags · {kit.poolName} · {bagsNeeded} needed across{" "}
                                            {sharedWith.length > 1 ? sharedWith.join(", ") : kit.designName || kit.productTitle}
                                          </p>
                                        )}
                                        {/* Kit contents summary */}
                                        {kit.designId && (
                                          <button
                                            onClick={() => toggleKitExpanded(kit.designId!)}
                                            className="text-xs text-slate-400 hover:text-amber-400 flex items-center gap-1 mt-1"
                                          >
                                            <svg
                                              className={`w-3 h-3 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                                              fill="none"
                                              viewBox="0 0 24 24"
                                              stroke="currentColor"
                                            >
                                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                            </svg>
                                            {kitInfo ? `${kitInfo.totalColors} colors, ${kitInfo.totalSkeins} skeins` : "View kit contents"}
                                          </button>
                                        )}
                                      </div>
                                      <div className="text-center px-4">
                                        <p className="text-2xl font-bold text-amber-400">{kit.quantity}</p>
                                        <p className="text-xs text-slate-400">needed</p>
                                      </div>
                                      <div className="text-center px-4">
                                        {kit.designId ? (
                                          <CountStepper
                                            value={kit.kitsReady}
                                            onCommit={(next) => handleSetValue(kit.designId!, "kitsReady", next, kit.kitsReady)}
                                            onDelta={(d) => handleUpdateCount(kit.designId!, "kitsReady", d)}
                                            step={kitDelta}
                                            busy={updating === kit.designId}
                                            tone="home"
                                            label="ready"
                                            ariaLabel={kit.poolName
                                              ? `Kit bags ready in the ${kit.poolName} shared pool, used by ${sharedWith.join(", ")}`
                                              : `Kits ready for ${kit.designName}`}
                                            labelTitle={kit.poolName
                                              ? `Bags in the ${kit.poolName} pool. Editing this changes the pool, so it moves on every design that shares it.`
                                              : undefined}
                                            valueClassName={hasEnough ? "text-emerald-400" : "text-red-400"}
                                            decrementTitle={`Remove ${kitDelta}`}
                                            incrementTitle={`Add ${kitDelta}`}
                                          />
                                        ) : (
                                          <div className="text-center">
                                            <p className={`text-2xl font-bold ${hasEnough ? "text-emerald-400" : "text-red-400"}`}>
                                              {kit.kitsReady}
                                            </p>
                                            <p className="text-xs text-slate-400">ready</p>
                                          </div>
                                        )}
                                      </div>
                                      {!hasEnough && (
                                        <div className="text-center px-4">
                                          <p className="text-2xl font-bold text-red-400">-{shortage}</p>
                                          <p className="text-xs text-slate-400">short</p>
                                        </div>
                                      )}
                                      {kit.designId && (
                                        <Link
                                          href={`/design/${kit.designId}/kit`}
                                          className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg"
                                          title="View kit details"
                                        >
                                          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                          </svg>
                                        </Link>
                                      )}
                                    </div>

                                    {/* Expanded kit contents */}
                                    {isExpanded && kit.designId && (
                                      <div className="px-4 pb-4 pt-0">
                                        <div className="bg-slate-900/50 rounded-lg p-3 ml-16">
                                          {loadingKits ? (
                                            <p className="text-sm text-slate-400">Loading kit contents...</p>
                                          ) : kitInfo ? (
                                            <div className="space-y-2">
                                              <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                                                <span>Thread colors needed:</span>
                                                <span className={kitInfo.allInStock ? "text-emerald-400" : "text-amber-400"}>
                                                  {kitInfo.allInStock ? "All in stock" : "Some out of stock"}
                                                </span>
                                              </div>
                                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                                {kitInfo.kitContents.map((item) => {
                                                  const colorUsageKey = `${kit.designId}-${item.dmcNumber}`;
                                                  const isColorExpanded = expandedColors.has(colorUsageKey);
                                                  const otherDesigns = (colorUsage.get(item.dmcNumber) || []).filter(
                                                    (d) => d.id !== kit.designId
                                                  );
                                                  // Hoisted so the stepper's callbacks close over a
                                                  // non-null backup instead of asserting on each use.
                                                  const backup = item.backup;
                                                  return (
                                                  <div
                                                    key={item.dmcNumber}
                                                    className={`rounded text-xs ${
                                                      item.inStock ? "bg-slate-800" : "bg-red-900/30"
                                                    }`}
                                                  >
                                                    {/* Wraps: two steppers (the colour and its backup) plus the
                                                        name do not fit one line on a phone, and overflowing put
                                                        the backup's buttons off-screen. */}
                                                    <div className="flex flex-wrap items-center gap-2 p-2">
                                                      <Link
                                                        href={`/inventory/color/${item.dmcNumber}?size=${item.threadSize}`}
                                                        className="w-6 h-6 rounded flex-shrink-0 border border-slate-600 hover:ring-1 hover:ring-rose-500"
                                                        style={{ backgroundColor: item.hex }}
                                                        title={`View DMC ${item.dmcNumber}`}
                                                      />
                                                      <div className="min-w-0 flex-1">
                                                        <p className="text-white font-medium truncate">{item.dmcNumber} - {item.colorName}</p>
                                                        <p className="text-slate-500">
                                                          {item.fullSkeins > 0 ? `${item.fullSkeins} sk needed` : `${item.bobbinYards}y bobbin`}
                                                        </p>
                                                      </div>
                                                      <div className="flex-shrink-0">
                                                        <CountStepper
                                                          value={item.inventorySkeins}
                                                          onCommit={(next) => handleSetInventory(item.dmcNumber, next, item.threadSize, item.inventorySkeins)}
                                                          onDelta={(d) => handleUpdateInventory(item.dmcNumber, d, item.threadSize)}
                                                          busy={updatingInventory === `${item.dmcNumber}-${item.threadSize}`}
                                                          ariaLabel={`Skeins of DMC ${item.dmcNumber} (Size ${item.threadSize})`}
                                                          valueClassName={item.inStock ? "text-emerald-400" : "text-red-400"}
                                                        />
                                                      </div>
                                                      {/* Backup color: swatch changes it, stepper adjusts its stock */}
                                                      {backup ? (
                                                        <div className="flex items-center gap-1 ml-auto flex-shrink-0 pl-1 border-l border-amber-800/40">
                                                          <button
                                                            onClick={(e) => {
                                                              e.stopPropagation();
                                                              setEditingBackup({ designId: kit.designId!, dmcNumber: item.dmcNumber });
                                                            }}
                                                            className="flex items-center px-1 py-0.5 rounded bg-amber-900/30 border border-amber-800/50 hover:bg-amber-900/50 hover:border-amber-600 transition-colors"
                                                            title={`Backup for ${item.dmcNumber}: ${backup.dmcNumber} ${backup.colorName} (click to change)`}
                                                          >
                                                            <span
                                                              className="w-5 h-5 rounded flex items-center justify-center border border-white/20"
                                                              style={{ backgroundColor: backup.hex }}
                                                            >
                                                              <span
                                                                className="text-[6px] font-bold"
                                                                style={{ color: getContrastTextColor(backup.hex) }}
                                                              >
                                                                {backup.dmcNumber}
                                                              </span>
                                                            </span>
                                                          </button>
                                                          {/* The backup's own skeins. Same (dmc, size) inventory row as
                                                              anywhere else in the app, so this is the real stock of that
                                                              colour, not a per-design figure. */}
                                                          <CountStepper
                                                            value={backup.inventorySkeins}
                                                            onCommit={(next) => handleSetInventory(backup.dmcNumber, next, backup.threadSize, backup.inventorySkeins)}
                                                            onDelta={(d) => handleUpdateInventory(backup.dmcNumber, d, backup.threadSize)}
                                                            busy={updatingInventory === `${backup.dmcNumber}-${backup.threadSize}`}
                                                            ariaLabel={`Skeins of DMC ${backup.dmcNumber} (Size ${backup.threadSize}), the backup for DMC ${item.dmcNumber}`}
                                                            valueClassName={backup.inStock ? "text-emerald-400" : "text-red-400"}
                                                          />
                                                        </div>
                                                      ) : (
                                                        <button
                                                          onClick={(e) => {
                                                            e.stopPropagation();
                                                            setEditingBackup({ designId: kit.designId!, dmcNumber: item.dmcNumber });
                                                          }}
                                                          className="px-1.5 py-0.5 rounded bg-slate-700/50 border border-dashed border-slate-600 hover:border-amber-600 hover:bg-amber-900/20 transition-colors text-[9px] text-slate-500 hover:text-amber-400 ml-auto"
                                                          title="Add backup color"
                                                        >
                                                          + backup
                                                        </button>
                                                      )}
                                                    </div>
                                                    {/* Color usage indicator */}
                                                    {otherDesigns.length > 0 && (
                                                      <>
                                                        <button
                                                          onClick={() => {
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
                                                            {otherDesigns.map((design) => (
                                                              <Link
                                                                key={design.id}
                                                                href={`/design/${design.id}/kit`}
                                                                className="flex items-center gap-2 p-1.5 rounded bg-slate-700/30 hover:bg-slate-700/60 transition-colors"
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
                                                                <div className="min-w-0 flex-1">
                                                                  <p className="text-[10px] text-white truncate">{design.name}</p>
                                                                  <p className="text-[9px] text-slate-400">
                                                                    {design.bobbinYards > 0 && design.fullSkeins === 0 ? `${design.bobbinYards} yd` : `${design.fullSkeins} sk`}
                                                                  </p>
                                                                </div>
                                                              </Link>
                                                            ))}
                                                          </div>
                                                        )}
                                                      </>
                                                    )}
                                                  </div>
                                                  );
                                                })}
                                              </div>
                                            </div>
                                          ) : (
                                            <p className="text-sm text-slate-400">Kit data not available</p>
                                          )}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* All Canvases Needed View - Shows ALL orders since all need canvases */}
            {filter === "canvases" && (
              <div className="space-y-4">
                <h2 className="text-lg font-semibold text-white">All Canvases Needed</h2>
                {(() => {
                  // Aggregate ALL items by design (every order needs a canvas printed)
                  const canvasesByDesign = new Map<string, {
                    designId: string | null;
                    designName: string | null;
                    productTitle: string;
                    previewImageUrl: string | null;
                    quantity: number;
                    canvasPrinted: number;
                    kitsNeeded: number; // How many of these also need kits
                  }>();

                  for (const order of data.orders) {
                    for (const item of order.items) {
                      // Only include canvas items, not supplies
                      if (item.itemType !== "canvas") continue;

                      const key = item.designId || item.productTitle;
                      const existing = canvasesByDesign.get(key);
                      if (existing) {
                        existing.quantity += item.quantity;
                        if (item.needsKit) {
                          existing.kitsNeeded += item.quantity;
                        }
                      } else {
                        canvasesByDesign.set(key, {
                          designId: item.designId,
                          designName: item.designName,
                          productTitle: item.productTitle,
                          previewImageUrl: item.previewImageUrl,
                          quantity: item.quantity,
                          canvasPrinted: item.canvasPrinted,
                          kitsNeeded: item.needsKit ? item.quantity : 0,
                        });
                      }
                    }
                  }

                  const canvases = Array.from(canvasesByDesign.values()).sort((a, b) => b.quantity - a.quantity);

                  if (canvases.length === 0) {
                    return (
                      <div className="bg-slate-800 rounded-xl border border-slate-700 p-8 text-center">
                        <p className="text-slate-400">No orders</p>
                      </div>
                    );
                  }

                  return (
                    <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
                      <div className="divide-y divide-slate-700/50">
                        {canvases.map((canvas, idx) => {
                          const hasEnough = canvas.canvasPrinted >= canvas.quantity;
                          const shortage = canvas.quantity - canvas.canvasPrinted;
                          const isIntroCanvas = canvas.productTitle.toLowerCase().includes("intro") || canvas.productTitle.toLowerCase().includes("beginner");
                          const canvasDelta = isIntroCanvas ? 2 : 1;
                          return (
                            <div key={canvas.designId ?? `row-${idx}`} className="p-4 flex items-center gap-4">
                              {canvas.designId ? (
                                <Link href={`/design/${canvas.designId}/info`} className="flex-shrink-0">
                                  {canvas.previewImageUrl ? (
                                    <img
                                      src={canvas.previewImageUrl}
                                      alt={canvas.productTitle}
                                      className="w-14 h-14 rounded-lg object-cover hover:ring-2 hover:ring-rose-500 transition-all"
                                    />
                                  ) : (
                                    <div className="w-14 h-14 rounded-lg bg-slate-700 flex items-center justify-center hover:ring-2 hover:ring-rose-500 transition-all">
                                      <span className="text-slate-500 text-xs">?</span>
                                    </div>
                                  )}
                                </Link>
                              ) : canvas.previewImageUrl ? (
                                <img
                                  src={canvas.previewImageUrl}
                                  alt={canvas.productTitle}
                                  className="w-14 h-14 rounded-lg object-cover flex-shrink-0"
                                />
                              ) : (
                                <div className="w-14 h-14 rounded-lg bg-slate-700 flex items-center justify-center flex-shrink-0">
                                  <span className="text-slate-500 text-xs">?</span>
                                </div>
                              )}
                              <div className="flex-1 min-w-0">
                                {canvas.designId ? (
                                  <Link
                                    href={`/design/${canvas.designId}/info`}
                                    className="text-white font-medium truncate hover:text-rose-400 transition-colors block"
                                  >
                                    {canvas.designName || canvas.productTitle}
                                  </Link>
                                ) : (
                                  <p className="text-white font-medium truncate">
                                    {canvas.designName || canvas.productTitle}
                                  </p>
                                )}
                                {!canvas.designId && (
                                  <p className="text-xs text-yellow-500">No matching design</p>
                                )}
                                {canvas.kitsNeeded > 0 && (
                                  <p className="text-xs text-amber-400">
                                    {canvas.kitsNeeded} need kit{canvas.kitsNeeded > 1 ? "s" : ""}
                                  </p>
                                )}
                              </div>
                              <div className="text-center px-4">
                                <p className="text-2xl font-bold text-blue-400">{canvas.quantity}</p>
                                <p className="text-xs text-slate-400">canvases</p>
                              </div>
                              <div className="text-center px-4">
                                {canvas.designId ? (
                                  <CountStepper
                                    value={canvas.canvasPrinted}
                                    onCommit={(next) => handleSetValue(canvas.designId!, "canvasPrinted", next, canvas.canvasPrinted)}
                                    onDelta={(d) => handleUpdateCount(canvas.designId!, "canvasPrinted", d)}
                                    step={canvasDelta}
                                    busy={updating === canvas.designId}
                                    tone="home"
                                    label="printed"
                                    ariaLabel={`Canvases printed for ${canvas.designName}`}
                                    valueClassName={hasEnough ? "text-emerald-400" : "text-red-400"}
                                    decrementTitle={`Remove ${canvasDelta}`}
                                    incrementTitle={`Add ${canvasDelta}`}
                                  />
                                ) : (
                                  <div className="text-center">
                                    <p className={`text-2xl font-bold ${hasEnough ? "text-emerald-400" : "text-red-400"}`}>
                                      {canvas.canvasPrinted}
                                    </p>
                                    <p className="text-xs text-slate-400">printed</p>
                                  </div>
                                )}
                              </div>
                              {!hasEnough && (
                                <div className="text-center px-4">
                                  <p className="text-2xl font-bold text-red-400">-{shortage}</p>
                                  <p className="text-xs text-slate-400">short</p>
                                </div>
                              )}
                              {canvas.designId && (
                                <Link
                                  href={`/design/${canvas.designId}/info`}
                                  className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg"
                                  title="View design"
                                >
                                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                  </svg>
                                </Link>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Supplies View */}
            {filter === "supplies" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-white">Supplies Ordered</h2>
                  <Link
                    href="/inventory?tab=supplies"
                    className="text-sm text-purple-400 hover:text-purple-300"
                  >
                    Manage Supplies →
                  </Link>
                </div>
                {(() => {
                  // Aggregate supply items by supply ID or product title, and
                  // tally per-variant counts (e.g. Project Bag colors, scissor
                  // styles). Stock is one shared pool per supply, so we keep a
                  // single row but show the variant breakdown for prep/ordering.
                  const suppliesByKey = new Map<string, {
                    supplyId: string | null;
                    productTitle: string;
                    productType: string | null;
                    quantity: number;
                    inStock: number;
                    variants: Map<string, number>;
                  }>();

                  for (const order of data.orders) {
                    for (const item of order.items) {
                      if (item.itemType !== "supply") continue;

                      const key = item.supplyId || item.productTitle;
                      let entry = suppliesByKey.get(key);
                      if (!entry) {
                        entry = {
                          supplyId: item.supplyId,
                          productTitle: item.productTitle,
                          productType: item.productType,
                          quantity: 0,
                          inStock: item.supplyQuantity,
                          variants: new Map<string, number>(),
                        };
                        suppliesByKey.set(key, entry);
                      }
                      entry.quantity += item.quantity;
                      // Track the variant (color/style). Skip only Shopify's
                      // generic single-variant label ("Default Title"). NOTE: do
                      // NOT skip variants that appear in the product name — that
                      // wrongly dropped "Silver"/"Gold" for the product
                      // "Silver/Gold Embroidery Scissors".
                      const variant = (item.variantTitle || "").trim();
                      if (variant && !/^default(\s*title)?$/i.test(variant)) {
                        entry.variants.set(variant, (entry.variants.get(variant) || 0) + item.quantity);
                      }
                    }
                  }

                  const supplies = Array.from(suppliesByKey.values()).sort((a, b) => b.quantity - a.quantity);

                  if (supplies.length === 0) {
                    return (
                      <div className="bg-slate-800 rounded-xl border border-slate-700 p-8 text-center">
                        <p className="text-slate-400">No supplies ordered</p>
                        <p className="text-sm text-slate-500 mt-2">
                          Add supplies in &quot;Manage Supplies&quot; to track their inventory
                        </p>
                      </div>
                    );
                  }

                  return (
                    <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
                      <div className="divide-y divide-slate-700/50">
                        {supplies.map((supply, idx) => {
                          const hasEnough = supply.inStock >= supply.quantity;
                          const shortage = supply.quantity - supply.inStock;
                          return (
                            <div key={idx} className="p-4 flex items-center gap-4">
                              <div className="w-14 h-14 rounded-lg bg-purple-900/30 border border-purple-700/50 flex items-center justify-center flex-shrink-0">
                                <svg className="w-6 h-6 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                                </svg>
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-white font-medium truncate">{supply.productTitle}</p>
                                {supply.productType && (
                                  <p className="text-xs text-purple-400">{supply.productType}</p>
                                )}
                                {supply.variants.size > 0 && (
                                  <div className="mt-1 flex flex-wrap gap-1">
                                    {Array.from(supply.variants.entries())
                                      .sort((a, b) => b[1] - a[1])
                                      .map(([variant, qty]) => (
                                        <span
                                          key={variant}
                                          className="text-xs px-1.5 py-0.5 rounded bg-purple-900/40 border border-purple-700/50 text-purple-200"
                                        >
                                          {variant} <span className="font-semibold text-white">×{qty}</span>
                                        </span>
                                      ))}
                                  </div>
                                )}
                                {!supply.supplyId && (
                                  <p className="text-xs text-yellow-500">Not matched to a supply</p>
                                )}
                              </div>
                              <div className="text-center px-4">
                                <p className="text-2xl font-bold text-purple-400">{supply.quantity}</p>
                                <p className="text-xs text-slate-400">ordered</p>
                              </div>
                              {supply.supplyId && (
                                <>
                                  <div className="text-center px-4">
                                    <p className={`text-2xl font-bold ${hasEnough ? "text-emerald-400" : "text-red-400"}`}>
                                      {supply.inStock}
                                    </p>
                                    <p className="text-xs text-slate-400">in stock</p>
                                  </div>
                                  {!hasEnough && (
                                    <div className="text-center px-4">
                                      <p className="text-2xl font-bold text-red-400">-{shortage}</p>
                                      <p className="text-xs text-slate-400">short</p>
                                    </div>
                                  )}
                                </>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Mystery Misprints View */}
            {filter === "mystery" && (
              <div className="space-y-4">
                <div>
                  <h2 className="text-lg font-semibold text-white">Mystery Misprint Bags</h2>
                  <p className="text-sm text-slate-400">
                    Orders containing a bag. Any special instructions the customer
                    left are shown on the order below.
                  </p>
                </div>
                {(() => {
                  const mysteryOrders = data.orders.filter((o) => o.hasMysteryBag);
                  if (mysteryOrders.length === 0) {
                    return (
                      <div className="bg-slate-800 rounded-xl border border-slate-700 p-8 text-center">
                        <p className="text-slate-400">No orders with a Mystery Misprint Bag</p>
                      </div>
                    );
                  }
                  const demandByDesign = calculateDemandByDesign(data.orders);
                  const fulfillableOrders = calculateFulfillableOrders(data.orders);
                  return mysteryOrders.map((order) => (
                    <OrderCard
                      key={order.shopifyOrderId}
                      order={order}
                      demandByDesign={demandByDesign}
                      canFulfillOrder={fulfillableOrders.has(order.shopifyOrderId)}
                      onFulfill={handleFulfillOrder}
                      fulfilling={fulfilling === order.shopifyOrderId}
                      onUndo={handleUndoFulfillment}
                      undoing={undoing === order.shopifyOrderId}
                      onSetKind={handleSetOrderKind}
                      settingKind={settingKind === order.shopifyOrderId}
                      onToggleSkip={handleToggleSkip}
                      skipping={skipping === order.shopifyOrderId}
                    />
                  ));
                })()}
              </div>
            )}

            {/* All Orders View */}
            {filter === "all" && (
              <div className="space-y-4">
                <h2 className="text-lg font-semibold text-white">Unfulfilled Orders</h2>
                {data.orders.length === 0 ? (
                  <div className="bg-slate-800 rounded-xl border border-slate-700 p-8 text-center">
                    <p className="text-slate-400">No unfulfilled orders</p>
                  </div>
                ) : (
                  (() => {
                    const demandByDesign = calculateDemandByDesign(data.orders);
                    const fulfillableOrders = calculateFulfillableOrders(data.orders);
                    // Show express orders first to mirror the fulfillability
                    // priority. Unfulfilled before locally-fulfilled; within
                    // each group, express ahead of standard, then by date.
                    const sortedOrders = [...data.orders].sort((a, b) => {
                      if (a.locallyFulfilled !== b.locallyFulfilled) {
                        return a.locallyFulfilled ? 1 : -1;
                      }
                      // Skipped orders sink below the ones being packed, but
                      // stay on the page: they are still owed, and putting one
                      // back has to be one click away.
                      if (isSkipped(a) !== isSkipped(b)) return isSkipped(a) ? 1 : -1;
                      if (a.isExpress !== b.isExpress) return a.isExpress ? -1 : 1;
                      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
                    });
                    return sortedOrders.map((order) => (
                      <OrderCard
                        key={order.shopifyOrderId}
                        order={order}
                        demandByDesign={demandByDesign}
                        canFulfillOrder={fulfillableOrders.has(order.shopifyOrderId)}
                        onFulfill={handleFulfillOrder}
                        fulfilling={fulfilling === order.shopifyOrderId}
                        onUndo={handleUndoFulfillment}
                        undoing={undoing === order.shopifyOrderId}
                        onSetKind={handleSetOrderKind}
                        settingKind={settingKind === order.shopifyOrderId}
                        onToggleSkip={handleToggleSkip}
                        skipping={skipping === order.shopifyOrderId}
                      />
                    ));
                  })()
                )}
              </div>
            )}
          </>
        )}

        {/* Backup Color Picker Modal */}
        {editingBackup && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
            <div className="bg-slate-800 rounded-xl border border-slate-700 w-full max-w-lg mx-4 max-h-[90vh] flex flex-col">
              {/* Header */}
              <div className="p-4 border-b border-slate-700 flex-shrink-0">
                <h3 className="text-lg font-semibold text-white">Set Backup Color</h3>
                <p className="text-sm text-slate-400">
                  Select a substitute for DMC {editingBackup.dmcNumber}
                </p>
              </div>

              {/* Content */}
              <div className="p-4 space-y-4 flex-1 overflow-y-auto">
                {/* Search input */}
                <input
                  type="text"
                  value={backupSearch}
                  onChange={(e) => setBackupSearch(e.target.value)}
                  placeholder="Search DMC # or color name..."
                  className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-600"
                  autoFocus
                />

                {/* Color grid */}
                <div className="max-h-64 overflow-y-auto rounded-lg bg-slate-900 p-2">
                  <div className="grid grid-cols-8 sm:grid-cols-10 gap-1">
                    {(backupSearch.trim() ? backupColorSuggestions : DMC_PEARL_COTTON.slice(0, 100)).map((color) => {
                      const inStock = (inventoryStock.get(color.dmcNumber) || 0) > 0;
                      return (
                        <button
                          key={color.dmcNumber}
                          onClick={() => handleSaveBackup(color.dmcNumber)}
                          disabled={savingBackup}
                          className="relative aspect-square rounded-md flex items-center justify-center transition-all hover:scale-110 hover:ring-2 hover:ring-amber-500 disabled:opacity-50"
                          style={{ backgroundColor: color.hex }}
                          title={`DMC ${color.dmcNumber} - ${color.name}${inStock ? " (in stock)" : ""}`}
                        >
                          <span
                            className="text-[7px] font-bold leading-none select-none"
                            style={{ color: getContrastTextColor(color.hex) }}
                          >
                            {color.dmcNumber}
                          </span>
                          {inStock && (
                            <span className="absolute top-0 right-0 w-2 h-2 bg-emerald-500 rounded-full border border-white/50 transform translate-x-0.5 -translate-y-0.5" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                  {backupSearch.trim() && backupColorSuggestions.length === 0 && (
                    <p className="text-slate-500 text-center py-4 text-sm">No colors found</p>
                  )}
                  {!backupSearch.trim() && (
                    <p className="text-slate-500 text-center py-2 text-xs">
                      Search to see all {DMC_PEARL_COTTON.length} colors
                    </p>
                  )}
                </div>
              </div>

              {/* Footer */}
              <div className="p-4 border-t border-slate-700 flex gap-3 flex-shrink-0">
                <button
                  onClick={() => handleSaveBackup("")}
                  disabled={savingBackup}
                  className="px-4 py-2 bg-red-900/50 text-red-400 rounded-lg hover:bg-red-900/70 text-sm disabled:opacity-50"
                >
                  Remove Backup
                </button>
                <div className="flex-1" />
                <button
                  onClick={() => {
                    setEditingBackup(null);
                    setBackupSearch("");
                  }}
                  className="px-4 py-2 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600 text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

interface DemandMap {
  totalKitsNeeded: number;
  totalCanvasesNeeded: number;
}

interface OrderCardProps {
  order: Order;
  demandByDesign: Map<string, DemandMap>;
  canFulfillOrder: boolean;
  onFulfill: (order: Order) => void;
  fulfilling: boolean;
  onUndo: (shopifyOrderId: string) => void;
  undoing: boolean;
  onSetKind: (order: Order, kind: OrderKind) => void;
  settingKind: boolean;
  onToggleSkip: (order: Order) => void;
  skipping: boolean;
}

// Colours for the order-type chip. Retail has none — it is the normal case and
// a badge on every order is just noise.
const KIND_CHIP: Record<Exclude<OrderKind, "retail">, string> = {
  wholesale: "bg-violet-600 text-white",
  donation: "bg-teal-600 text-white",
  replacement: "bg-orange-600 text-white",
};

function OrderCard({ order, demandByDesign, canFulfillOrder, onFulfill, fulfilling, onUndo, undoing, onSetKind, settingKind, onToggleSkip, skipping }: OrderCardProps) {
  const [expanded, setExpanded] = useState(false);
  const skipped = isSkipped(order);

  // Only count canvas items for kits/canvases
  const canvasItems = order.items.filter(item => item.itemType === "canvas");
  const supplyItems = order.items.filter(item => item.itemType === "supply");

  const kitsInOrder = canvasItems.reduce((sum, item) => sum + (item.needsKit ? item.quantity : 0), 0);
  const canvasesInOrder = canvasItems.reduce((sum, item) => sum + item.quantity, 0);
  const suppliesInOrder = supplyItems.reduce((sum, item) => sum + item.quantity, 0);

  // Check if we have enough kits/canvases for THIS order specifically (for badge display)
  //
  // Kits are totalled by pool before comparing. Checked item by item, an order
  // for two Boylston and two Newbury sees pool-of-3 >= 2 twice and reads as
  // covered, when the four bags it needs come out of the same three.
  const kitNeedByPool = new Map<string, { need: number; ready: number }>();
  for (const item of canvasItems) {
    if (!item.needsKit || !item.designId) continue;
    const key = kitBudgetKey(item)!;
    const e = kitNeedByPool.get(key) ?? { need: 0, ready: item.kitsReady };
    e.need += item.quantity;
    kitNeedByPool.set(key, e);
  }
  const hasEnoughKitsForOrder = [...kitNeedByPool.values()].every((e) => e.ready >= e.need);
  const hasEnoughCanvasesForOrder = canvasItems.every((item) => {
    if (!item.designId) return true;
    return item.canvasPrinted >= item.quantity;
  });

  // canFulfillOrder is calculated by parent, accounting for older orders
  // consuming inventory first. A skipped order cannot be fulfilled at all:
  // "not ready to pack it" has to mean the Fulfill button won't deduct it by
  // mistake. Ticking it back is one click.
  const canFulfill = !order.locallyFulfilled && !skipped && canFulfillOrder;

  return (
    <div className={`bg-slate-800 rounded-xl border overflow-hidden ${
      order.locallyFulfilled
        ? "border-emerald-700/50 opacity-60"
        : skipped
          ? "border-slate-700 border-dashed opacity-50"
          : order.isExpress
            ? "border-sky-600/70 ring-1 ring-sky-600/40"
            : "border-slate-700"
    }`}>
      {/* Header */}
      <div className="p-4 flex items-center justify-between">
        {/* On the pick list? Ticked by default. Unticking parks the order: it
            leaves the canvas and kit totals, stops being allocated stock ahead
            of the orders being packed today, and cannot be fulfilled until it
            is ticked back. Hidden once deducted, where it means nothing. */}
        {!order.locallyFulfilled && (
          <label
            className="flex-shrink-0 mr-3 flex items-center cursor-pointer select-none"
            title={
              skipped
                ? "Not being packed today — tick to put it back on the pick list"
                : "On the pick list. Untick to leave it out of the canvas and kit counts."
            }
            onClick={(e) => e.stopPropagation()}
          >
            <input
              type="checkbox"
              checked={!skipped}
              disabled={skipping}
              onChange={() => onToggleSkip(order)}
              className="w-5 h-5 rounded border-slate-600 bg-slate-700 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-slate-800 cursor-pointer disabled:opacity-40"
              aria-label={skipped ? `Put order ${order.orderNumber} back on the pick list` : `Leave order ${order.orderNumber} off the pick list`}
            />
          </label>
        )}
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex-1 flex items-center gap-4 text-left hover:bg-slate-700/30 transition-colors rounded-lg -m-2 p-2"
        >
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-white font-medium">{order.orderNumber}</p>
              {skipped && (
                <span
                  className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-slate-600 text-slate-200"
                  title="Left off the pick list, so it isn't counted in the canvas and kit totals and isn't allocated stock. Still owed — tick the box to put it back."
                >
                  Not today
                </span>
              )}
              {order.isDraft && (
                <span
                  className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-amber-600 text-white"
                  title="Shopify draft order (created manually, not yet completed). Fulfilling it here deducts inventory now; completing it later in Shopify won't double-deduct."
                >
                  Draft
                </span>
              )}
              {order.kind !== "retail" && (
                <span
                  className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${KIND_CHIP[order.kind]}`}
                  title={ORDER_KIND_HELP[order.kind]}
                >
                  {ORDER_KIND_LABEL[order.kind]}
                </span>
              )}
              {order.isExpress && (
                <span
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-sky-600 text-white"
                  title={`Express shipping selected${order.shippingTitle ? `: ${order.shippingTitle}` : ""}. Gets inventory priority over standard-shipping orders.`}
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  Express
                </span>
              )}
            </div>
            <p className="text-sm text-slate-400">{order.customerName}</p>
            {order.locallyFulfilled && order.locallyFulfilledAt && (
              <p className="text-xs text-emerald-400 mt-0.5">
                Deducted {new Date(order.locallyFulfilledAt).toLocaleDateString()}
              </p>
            )}
          </div>

          <div className="flex items-center gap-4 ml-auto">
            <div className="text-right">
              <p className="text-sm text-slate-300">
                {order.items.length} {order.items.length === 1 ? "item" : "items"}
              </p>
              <p className="text-xs text-slate-500">
                {new Date(order.createdAt).toLocaleDateString()}
              </p>
            </div>

            <div className="flex items-center gap-2">
              {canvasesInOrder > 0 && (
                <span className={`px-2 py-1 rounded text-xs font-medium ${
                  hasEnoughCanvasesForOrder
                    ? "bg-emerald-900/50 text-emerald-400"
                    : "bg-red-900/50 text-red-400"
                }`}>
                  {canvasesInOrder} canvas{canvasesInOrder > 1 ? "es" : ""}
                </span>
              )}
              {kitsInOrder > 0 && (
                <span className={`px-2 py-1 rounded text-xs font-medium ${
                  hasEnoughKitsForOrder
                    ? "bg-emerald-900/50 text-emerald-400"
                    : "bg-red-900/50 text-red-400"
                }`}>
                  {kitsInOrder} kit{kitsInOrder > 1 ? "s" : ""}
                </span>
              )}
              {suppliesInOrder > 0 && (
                <span className="px-2 py-1 rounded text-xs font-medium bg-purple-900/50 text-purple-400">
                  {suppliesInOrder} suppl{suppliesInOrder > 1 ? "ies" : "y"}
                </span>
              )}
            </div>

            <svg
              className={`w-5 h-5 text-slate-400 transition-transform ${expanded ? "rotate-180" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </button>

        {/* Fulfill Order Button */}
        {order.locallyFulfilled ? (
          <div className="ml-4 flex items-center gap-2">
            <div className="px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 bg-emerald-900/30 text-emerald-400 border border-emerald-700/50">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Deducted
            </div>
            <button
              onClick={() => onUndo(order.shopifyOrderId)}
              disabled={undoing}
              className="px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-1.5 bg-amber-900/30 text-amber-400 border border-amber-700/50 hover:bg-amber-900/50 transition-colors disabled:opacity-50"
              title="Undo fulfillment and restore inventory"
            >
              {undoing ? (
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                </svg>
              )}
              Undo
            </button>
          </div>
        ) : (
          <button
            onClick={() => onFulfill(order)}
            disabled={fulfilling || !canFulfill}
            className={`ml-4 px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors ${
              canFulfill
                ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                : "bg-slate-700 text-slate-500 cursor-not-allowed"
            } disabled:opacity-50`}
            title={
              skipped
                ? "Left off the pick list — tick the box to pack this order"
                : canFulfill
                  ? "Mark as fulfilled and deduct inventory"
                  : "Not enough kits or canvases ready"
            }
          >
            {fulfilling ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Fulfilling...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Fulfill Order
              </>
            )}
          </button>
        )}
      </div>

      {/* Customer-entered special instructions (line-item custom attributes).
          Visible without expanding because it can change what we ship. */}
      {order.items.some((i) => i.customAttributes && i.customAttributes.length > 0) && (
        <div className="px-4 py-2 border-t border-slate-700 bg-slate-900/30 space-y-1">
          {order.items.flatMap((item) =>
            (item.customAttributes ?? []).map((attr, idx) => (
              <div key={`${item.lineItemId}-${idx}`} className="text-sm flex items-start gap-2">
                <span className="text-xs uppercase tracking-wide text-slate-500 mt-0.5 flex-shrink-0">
                  {attr.key}
                </span>
                <span className="text-slate-200">{attr.value}</span>
              </div>
            ))
          )}
        </div>
      )}

      {/* Expanded Content */}
      {expanded && (
        <div className="border-t border-slate-700 divide-y divide-slate-700/50">
          {order.items.map((item, idx) => (
            <OrderItemRow key={idx} item={item} demandByDesign={demandByDesign} />
          ))}
          {/* Order type. Stock is deducted either way — this decides whether
              the order counts as retail demand when sizing reorders. */}
          <div className="p-4 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <label htmlFor={`kind-${order.shopifyOrderId}`} className="text-sm text-slate-400">
              Order type
            </label>
            <select
              id={`kind-${order.shopifyOrderId}`}
              value={order.kind}
              disabled={settingKind}
              onChange={(e) => onSetKind(order, e.target.value as OrderKind)}
              className="bg-slate-900 border border-slate-600 text-white text-sm rounded-lg px-2 py-1 disabled:opacity-50"
            >
              {ORDER_KINDS.map((k) => (
                <option key={k} value={k}>
                  {ORDER_KIND_LABEL[k]}
                </option>
              ))}
            </select>
            <span className="text-xs text-slate-500 basis-full sm:basis-auto">
              {settingKind ? "Saving…" : ORDER_KIND_HELP[order.kind]}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function OrderItemRow({ item, demandByDesign }: { item: OrderItem; demandByDesign: Map<string, DemandMap> }) {
  // Get total demand for this design across ALL orders
  const demand = item.designId ? demandByDesign.get(item.designId) : null;
  const totalKitsNeeded = demand?.totalKitsNeeded || item.quantity;
  const totalCanvasesNeeded = demand?.totalCanvasesNeeded || item.quantity;

  // Check if there's enough for ALL orders, not just this one
  const hasEnoughKits = item.kitsReady >= totalKitsNeeded;
  const hasEnoughCanvases = item.canvasPrinted >= totalCanvasesNeeded;

  // Shortage across all orders
  const kitShortage = Math.max(0, totalKitsNeeded - item.kitsReady);
  const canvasShortage = Math.max(0, totalCanvasesNeeded - item.canvasPrinted);

  return (
    <div className="p-4 flex items-center gap-4">
      {/* Preview */}
      {item.designId ? (
        <Link href={`/design/${item.designId}/info`} className="flex-shrink-0">
          {item.previewImageUrl ? (
            <img
              src={item.previewImageUrl}
              alt={item.productTitle}
              className="w-12 h-12 rounded-lg object-cover hover:ring-2 hover:ring-rose-500 transition-all"
            />
          ) : (
            <div className="w-12 h-12 rounded-lg bg-slate-700 flex items-center justify-center hover:ring-2 hover:ring-rose-500 transition-all">
              <span className="text-slate-500 text-xs">?</span>
            </div>
          )}
        </Link>
      ) : item.previewImageUrl ? (
        <img
          src={item.previewImageUrl}
          alt={item.productTitle}
          className="w-12 h-12 rounded-lg object-cover flex-shrink-0"
        />
      ) : (
        <div className="w-12 h-12 rounded-lg bg-slate-700 flex items-center justify-center flex-shrink-0">
          <span className="text-slate-500 text-xs">?</span>
        </div>
      )}

      {/* Info */}
      <div className="flex-1 min-w-0">
        {item.designId ? (
          <Link
            href={`/design/${item.designId}/info`}
            className="text-white font-medium truncate hover:text-rose-400 transition-colors block"
          >
            {item.productTitle}
          </Link>
        ) : (
          // For supplies matched via variant (e.g. "Needle Minder" + "Hydrangea"),
          // show the resolved supply name ("Hydrangea Needle Minder").
          <p className="text-white font-medium truncate">
            {item.supplyName || item.productTitle}
          </p>
        )}
        {item.variantTitle && !/^default(\s*title)?$/i.test(item.variantTitle.trim()) && (
          <p className="text-sm text-slate-400 truncate">{item.variantTitle}</p>
        )}
        {item.isBundle ? (
          <p className="text-xs text-rose-300 truncate" title={item.bundleComponents.map((c) => `${c.quantity}× ${c.name}`).join(", ")}>
            Bundle → {item.bundleComponents.length > 0 ? item.bundleComponents.map((c) => c.name).join(", ") : "no components set (add in Bundles)"}
          </p>
        ) : (!item.designId && !item.supplyId && item.itemType !== "mystery_bag") ? (
          <p className="text-xs text-yellow-500">No matching product</p>
        ) : null}
      </div>

      {/* Quantity */}
      <div className="text-center px-3">
        <p className="text-white font-bold">{item.quantity}</p>
        <p className="text-xs text-slate-500">qty</p>
      </div>

      {/* Kit Status */}
      <div className="text-center px-3">
        {item.needsKit ? (
          <div className={hasEnoughKits ? "text-emerald-400" : "text-red-400"}>
            <p className="font-bold">{item.kitsReady}/{totalKitsNeeded}</p>
            <p className="text-xs">kits ready</p>
            {kitShortage > 0 && (
              <p className="text-xs text-red-400">need {kitShortage}</p>
            )}
          </div>
        ) : (
          <div className="text-slate-500">
            <p className="text-xs">No kit</p>
          </div>
        )}
      </div>

      {/* Canvas Status */}
      <div className="text-center px-3">
        <div className={hasEnoughCanvases ? "text-emerald-400" : "text-red-400"}>
          <p className="font-bold">{item.canvasPrinted}/{totalCanvasesNeeded}</p>
          <p className="text-xs">printed</p>
          {canvasShortage > 0 && (
            <p className="text-xs text-red-400">need {canvasShortage}</p>
          )}
        </div>
      </div>

      {/* Link to design */}
      {item.designId && (
        <Link
          href={`/design/${item.designId}/kit`}
          className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg"
          title="View kit"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </Link>
      )}
    </div>
  );
}
