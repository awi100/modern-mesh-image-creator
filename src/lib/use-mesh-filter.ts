"use client";

import { useCallback, useEffect, useState } from "react";
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
 * That leaves a window where the filter is still the default, so the hook also
 * returns `ready`. Callers MUST gate their fetches on it: without that gate a
 * page whose stored filter isn't the default fires every request twice, once
 * per filter, and none of these fetches carry a sequence token — so if the
 * stale response lands second it wins, and you get rows for one mesh count
 * under a chip reading another.
 *
 * `storageKey` stays per-page on purpose: the filter is a view preference, and
 * sharing one key would make changing it on Kits silently re-filter Inventory.
 */
export function useMeshFilter(
  storageKey: string,
  defaultFilter: MeshFilter = "order",
): { meshFilter: MeshFilter; setMeshFilter: (f: MeshFilter) => void; ready: boolean } {
  const [meshFilter, setFilter] = useState<MeshFilter>(defaultFilter);
  const [ready, setReady] = useState(false);

  // sessionStorage THROWS (rather than returning null) in Safari private mode,
  // with site data blocked, and in a cross-origin iframe. Callers gate their
  // fetches on `ready`, so letting that throw escape would leave every one of
  // them waiting forever on a page that never loads. Always become ready.
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(storageKey) as MeshFilter | null;
      if (stored) setFilter(stored);
    } catch {
      // No persistence available — the default filter is a fine fallback.
    } finally {
      setReady(true);
    }
  }, [storageKey]);

  // Stable identity so a caller can safely put it in a dependency array.
  const setMeshFilter = useCallback(
    (f: MeshFilter) => {
      setFilter(f);
      try {
        sessionStorage.setItem(storageKey, f);
      } catch {
        // Filter still applies for this visit; it just won't be remembered.
      }
    },
    [storageKey],
  );

  return { meshFilter, setMeshFilter, ready };
}
