"use client";

import React, { useState, useEffect, useCallback } from "react";

interface SessionExpiredModalProps {
  isOpen: boolean;
  onSessionRestored: () => void;
  onClose: () => void;
}

export default function SessionExpiredModal({
  isOpen,
  onSessionRestored,
  onClose,
}: SessionExpiredModalProps) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error || "Invalid password");
        return;
      }

      // Session restored successfully
      setPassword("");
      onSessionRestored();
    } catch (err) {
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[200] p-4">
      <div className="bg-slate-800 rounded-xl w-full max-w-md shadow-2xl border border-slate-700">
        {/* Header */}
        <div className="p-6 border-b border-slate-700">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center">
              <svg className="w-5 h-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <div>
              <h2 className="text-xl font-semibold text-white">Session Expired</h2>
              <p className="text-sm text-slate-400">Your session has timed out</p>
            </div>
          </div>
          <p className="text-slate-300 text-sm mt-3">
            Your work is safe! Enter the password to continue saving your design.
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleLogin} className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-900/30 border border-red-800 rounded-lg text-red-300 text-sm">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-800"
              placeholder="Enter password"
              required
              autoFocus
            />
          </div>

          <button
            type="submit"
            disabled={loading || !password}
            className="w-full py-2.5 bg-rose-900 text-white rounded-lg hover:bg-rose-950 disabled:opacity-50 font-medium"
          >
            {loading ? "Signing in..." : "Continue Session"}
          </button>
        </form>

        {/* Footer */}
        <div className="px-6 pb-6">
          <p className="text-xs text-slate-500 text-center">
            Your design changes are preserved locally. They will sync once you sign in.
          </p>
        </div>
      </div>
    </div>
  );
}

// Hook to manage session expiration state globally
let sessionExpiredCallback: (() => void) | null = null;

export function setSessionExpiredCallback(callback: (() => void) | null) {
  sessionExpiredCallback = callback;
}

export function triggerSessionExpired() {
  if (sessionExpiredCallback) {
    sessionExpiredCallback();
  }
}

// Hook for components to use
export function useSessionMonitor() {
  const [isSessionExpired, setIsSessionExpired] = useState(false);

  useEffect(() => {
    // Register the callback
    setSessionExpiredCallback(() => setIsSessionExpired(true));

    return () => {
      setSessionExpiredCallback(null);
    };
  }, []);

  const handleSessionRestored = useCallback(() => {
    setIsSessionExpired(false);
  }, []);

  return {
    isSessionExpired,
    setIsSessionExpired,
    handleSessionRestored,
  };
}
