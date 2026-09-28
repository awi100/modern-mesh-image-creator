"use client";

import { useEffect, useState } from "react";
import type { MeshFilter } from "@/components/MeshFilterChips";

/**
 * Session-persisted mesh filter for a page.
 *
 * This existed four times, copy-pasted, and had drifted: each page picked its
 * own default ("all" on Kits, "order" elsewhere) and the Orders copy returned
 * "all" on the server but "order" on the client, so the two disagreed even with
 * an empty sessionStorage.
 *
 * The stored value is adopted AFTER mount, not in the useState initialiser. All
 * of these pages are server-rendered, the server has no sessionStorage, and
 * every copy read it during the initial render — so a stored filter made the
 * client's first render disagree with the server HTML and React threw the
 * server tree away.
 *
 * `storageKey` stays per-page on purpose: the filter is a view preference, and
 * sharing one key would make changing it on Kits silently re-filter Inventory.
 */
export function useMeshFilter(
  storageKey: string,
  defaultFilter: MeshFilter = "order",
): [MeshFilter, (f: MeshFilter) => void] {
  const [meshFilter, setMeshFilter] = useState<MeshFilter>(defaultFilter);

  useEffect(() => {
    const stored = sessionStorage.getItem(storageKey) as MeshFilter | null;
    if (stored) setMeshFilter(stored);
  }, [storageKey]);

  const change = (f: MeshFilter) => {
    setMeshFilter(f);
    sessionStorage.setItem(storageKey, f);
  };

  return [meshFilter, change];
}
