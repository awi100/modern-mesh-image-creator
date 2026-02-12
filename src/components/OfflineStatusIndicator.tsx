"use client";

import { useOfflineSync } from "@/hooks/useOfflineSync";
import { Cloud, CloudOff, RefreshCw, AlertTriangle, Check } from "lucide-react";

interface OfflineStatusIndicatorProps {
  showText?: boolean;
  className?: string;
}

export function OfflineStatusIndicator({
  showText = true,
  className = "",
}: OfflineStatusIndicatorProps) {
  const {
    isOnline,
    isSyncing,
    pendingCount,
    failedCount,
    conflictCount,
    lastSyncTime,
    syncNow,
  } = useOfflineSync();

  // Determine status
  const hasIssues = failedCount > 0 || conflictCount > 0;
  const hasPending = pendingCount > 0;

  // Format last sync time
  const formatLastSync = () => {
    if (!lastSyncTime) return "Never synced";
    const date = new Date(lastSyncTime);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleDateString();
  };

  // Click handler
  const handleClick = () => {
    if (isOnline && (hasPending || hasIssues)) {
      syncNow();
    }
  };

  // Render icon based on state
  const renderIcon = () => {
    if (!isOnline) {
      return <CloudOff className="w-4 h-4 text-orange-500" />;
    }
    if (isSyncing) {
      return <RefreshCw className="w-4 h-4 text-blue-500 animate-spin" />;
    }
    if (hasIssues) {
      return <AlertTriangle className="w-4 h-4 text-red-500" />;
    }
    if (hasPending) {
      return <Cloud className="w-4 h-4 text-yellow-500" />;
    }
    return <Check className="w-4 h-4 text-green-500" />;
  };

  // Render text based on state
  const renderText = () => {
    if (!isOnline) return "Offline";
    if (isSyncing) return "Syncing...";
    if (conflictCount > 0) return `${conflictCount} conflict${conflictCount > 1 ? "s" : ""}`;
    if (failedCount > 0) return `${failedCount} failed`;
    if (pendingCount > 0) return `${pendingCount} pending`;
    return "Synced";
  };

  const isClickable = isOnline && (hasPending || hasIssues) && !isSyncing;

  return (
    <div
      className={`flex items-center gap-1.5 ${className} ${isClickable ? "cursor-pointer hover:opacity-80" : ""}`}
      onClick={isClickable ? handleClick : undefined}
      title={`Last synced: ${formatLastSync()}${isClickable ? "\nClick to sync now" : ""}`}
    >
      {renderIcon()}
      {showText && (
        <span className="text-xs text-gray-600 dark:text-gray-400">
          {renderText()}
        </span>
      )}
    </div>
  );
}
