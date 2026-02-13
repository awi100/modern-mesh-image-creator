"use client";

export function DesignCardSkeleton() {
  return (
    <div className="bg-slate-800 rounded-xl overflow-hidden animate-pulse">
      {/* Image placeholder */}
      <div className="aspect-square bg-slate-700" />
      {/* Content */}
      <div className="p-3 space-y-2">
        {/* Title */}
        <div className="h-4 bg-slate-700 rounded w-3/4" />
        {/* Subtitle */}
        <div className="h-3 bg-slate-700 rounded w-1/2" />
        {/* Tags */}
        <div className="flex gap-1 pt-1">
          <div className="h-5 bg-slate-700 rounded w-12" />
          <div className="h-5 bg-slate-700 rounded w-16" />
        </div>
      </div>
    </div>
  );
}

export function DesignGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <DesignCardSkeleton key={i} />
      ))}
    </div>
  );
}
