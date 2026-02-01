"use client";

import { useEffect, useState, useCallback } from "react";

export default function PWAProvider({ children }: { children: React.ReactNode }) {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    const registerSW = async () => {
      try {
        const reg = await navigator.serviceWorker.register("/sw.js");
        setRegistration(reg);

        // Check for updates on page load
        reg.update();

        // Check for updates periodically (every 5 minutes)
        const interval = setInterval(() => {
          reg.update();
        }, 5 * 60 * 1000);

        // Listen for new service worker waiting
        reg.addEventListener("updatefound", () => {
          const newWorker = reg.installing;
          if (newWorker) {
            newWorker.addEventListener("statechange", () => {
              if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
                // New version available
                setUpdateAvailable(true);
              }
            });
          }
        });

        // Handle controller change (when new SW takes over)
        navigator.serviceWorker.addEventListener("controllerchange", () => {
          window.location.reload();
        });

        return () => clearInterval(interval);
      } catch (error) {
        console.error("Service worker registration failed:", error);
      }
    };

    registerSW();
  }, []);

  const handleRefresh = useCallback(() => {
    if (registration?.waiting) {
      // Tell the waiting service worker to skip waiting
      registration.waiting.postMessage("skipWaiting");
    }
  }, [registration]);

  return (
    <>
      {children}

      {/* Update notification banner */}
      {updateAvailable && (
        <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-96 bg-slate-800 border border-rose-800 rounded-xl shadow-2xl p-4 z-[9999] animate-slide-up">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 w-10 h-10 bg-rose-900/50 rounded-full flex items-center justify-center">
              <svg className="w-5 h-5 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white">Update Available</p>
              <p className="text-xs text-slate-400 mt-0.5">
                A new version of Modern Mesh is ready.
              </p>
            </div>
          </div>
          <div className="flex gap-2 mt-3">
            <button
              onClick={() => setUpdateAvailable(false)}
              className="flex-1 px-3 py-2 text-sm text-slate-400 hover:text-white transition-colors"
            >
              Later
            </button>
            <button
              onClick={handleRefresh}
              className="flex-1 px-3 py-2 bg-rose-900 text-white text-sm font-medium rounded-lg hover:bg-rose-950 transition-colors flex items-center justify-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Refresh Now
            </button>
          </div>
        </div>
      )}
    </>
  );
}
