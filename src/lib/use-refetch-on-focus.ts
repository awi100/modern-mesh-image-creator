import { useEffect } from "react";

/**
 * Re-run `refetch` whenever the tab regains focus / becomes visible. Use on
 * pages that hold data in local state (not SWR) so a page left open in the
 * background self-heals after an inventory change made elsewhere — mirroring
 * SWR's revalidateOnFocus. Pass a STABLE callback (useCallback) to avoid
 * re-subscribing every render.
 */
export function useRefetchOnFocus(refetch: () => void) {
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") refetch();
    };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refetch]);
}
