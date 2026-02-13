export default function InventoryLoading() {
  return (
    <div className="min-h-screen bg-slate-900">
      {/* Header skeleton */}
      <header className="bg-slate-800 border-b border-slate-700 px-4 py-3">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 bg-slate-700 rounded-xl animate-pulse" />
            <div className="space-y-2">
              <div className="h-6 w-32 bg-slate-700 rounded animate-pulse" />
              <div className="h-4 w-24 bg-slate-700 rounded animate-pulse" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-9 w-24 bg-slate-700 rounded-lg animate-pulse" />
            <div className="h-9 w-28 bg-slate-700 rounded-lg animate-pulse" />
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-6">
        {/* Title skeleton */}
        <div className="flex items-center justify-between mb-6">
          <div className="h-8 w-40 bg-slate-800 rounded animate-pulse" />
          <div className="flex gap-2">
            <div className="h-10 w-32 bg-slate-800 rounded-lg animate-pulse" />
            <div className="h-10 w-10 bg-slate-800 rounded-lg animate-pulse" />
          </div>
        </div>

        {/* Tabs skeleton */}
        <div className="flex gap-2 mb-6">
          <div className="h-10 w-24 bg-slate-800 rounded-lg animate-pulse" />
          <div className="h-10 w-24 bg-slate-800 rounded-lg animate-pulse" />
        </div>

        {/* Search skeleton */}
        <div className="h-10 w-full max-w-md bg-slate-800 rounded-lg animate-pulse mb-6" />

        {/* Inventory grid skeleton */}
        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2">
          {[...Array(32)].map((_, i) => (
            <div key={i} className="bg-slate-800 rounded-lg p-2">
              <div className="aspect-square bg-slate-700 rounded animate-pulse mb-2" />
              <div className="h-4 w-12 bg-slate-700 rounded animate-pulse mx-auto mb-1" />
              <div className="h-3 w-8 bg-slate-700 rounded animate-pulse mx-auto" />
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
