"use client";

import { useEffect, useState } from "react";

// Patch window.fetch exactly once across the app lifetime. A module-level flag
// survives React strict-mode's double effect invocation and remounts.
let fetchPatched = false;

// Resolve the URL from any fetch() first-argument shape.
function resolveUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  if (input instanceof Request) return input.url;
  return String(input);
}

// A 401 from one of our own API routes means the iron-session cookie expired
// (sessions last 4h). Auth endpoints legitimately return 401 for a bad
// password, so they're excluded — otherwise the login page would trip this.
function isSessionExpiry(url: string, status: number): boolean {
  if (status !== 401) return false;
  try {
    const parsed = new URL(url, window.location.origin);
    if (parsed.origin !== window.location.origin) return false;
    if (!parsed.pathname.startsWith("/api/")) return false;
    if (parsed.pathname.startsWith("/api/auth")) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Global session-expiry notice. Navigating to a page already redirects to
 * /login when the session is gone, but an in-page action (e.g. editing
 * inventory) would just fail a fetch silently. This wraps window.fetch so any
 * 401 from our API surfaces a clear, blocking modal telling the user to log
 * back in — so a failed action is never mistaken for a successful one.
 */
export default function SessionExpiryHandler() {
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    const onExpired = () => {
      // Don't pop the modal while already on the login screen.
      if (window.location.pathname === "/login") return;
      setExpired(true);
    };
    window.addEventListener("session-expired", onExpired);

    if (!fetchPatched) {
      fetchPatched = true;
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const response = await originalFetch(input, init);
        if (isSessionExpiry(resolveUrl(input), response.status)) {
          window.dispatchEvent(new CustomEvent("session-expired"));
        }
        return response;
      };
    }

    return () => window.removeEventListener("session-expired", onExpired);
  }, []);

  if (!expired) return null;

  const goToLogin = () => {
    const here = window.location.pathname + window.location.search;
    window.location.href = `/login?redirect=${encodeURIComponent(here)}`;
  };

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="session-expired-title"
    >
      <div className="w-full max-w-sm rounded-2xl bg-slate-800 border border-slate-700 shadow-2xl p-6 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/15 text-amber-400">
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M12 3a9 9 0 100 18 9 9 0 000-18z" />
          </svg>
        </div>
        <h2 id="session-expired-title" className="text-lg font-semibold text-white">
          Session expired
        </h2>
        <p className="mt-2 text-sm text-slate-300">
          You&apos;ve been logged out, so your last change <span className="font-semibold text-white">was not saved</span>.
          Log back in and try again.
        </p>
        <button
          onClick={goToLogin}
          className="mt-5 w-full rounded-xl bg-gradient-to-r from-rose-900 to-rose-800 px-4 py-3 font-medium text-white transition-all hover:from-rose-950 hover:to-rose-900 focus:outline-none focus:ring-2 focus:ring-rose-700"
        >
          Log in again
        </button>
      </div>
    </div>
  );
}
