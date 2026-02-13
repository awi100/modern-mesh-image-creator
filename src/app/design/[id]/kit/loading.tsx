export default function KitLoading() {
  return (
    <div className="min-h-screen bg-slate-900">
      {/* Header skeleton */}
      <header className="bg-slate-800 border-b border-slate-700 px-4 py-3">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-8 h-8 bg-slate-700 rounded animate-pulse" />
            <div className="h-6 w-32 bg-slate-700 rounded animate-pulse" />
          </div>
          <div className="flex items-center gap-2">
            <div className="h-9 w-24 bg-slate-700 rounded-lg animate-pulse" />
            <div className="h-9 w-24 bg-slate-700 rounded-lg animate-pulse" />
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-6">
        {/* Breadcrumb skeleton */}
        <div className="h-5 w-64 bg-slate-800 rounded animate-pulse mb-6" />

        {/* Title and stats skeleton */}
        <div className="flex items-center justify-between mb-6">
          <div className="space-y-2">
            <div className="h-8 w-48 bg-slate-800 rounded animate-pulse" />
            <div className="h-5 w-64 bg-slate-800 rounded animate-pulse" />
          </div>
          <div className="flex gap-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="bg-slate-800 rounded-lg p-4 w-24">
                <div className="h-8 w-16 bg-slate-700 rounded animate-pulse mb-2" />
                <div className="h-4 w-12 bg-slate-700 rounded animate-pulse" />
              </div>
            ))}
          </div>
        </div>

        {/* Kit contents table skeleton */}
        <div className="bg-slate-800 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-slate-700">
            <div className="h-6 w-32 bg-slate-700 rounded animate-pulse" />
          </div>
          <div className="divide-y divide-slate-700">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="p-4 flex items-center gap-4">
                <div className="w-10 h-10 bg-slate-700 rounded animate-pulse" />
                <div className="flex-1 space-y-2">
                  <div className="h-5 w-24 bg-slate-700 rounded animate-pulse" />
                  <div className="h-4 w-32 bg-slate-700 rounded animate-pulse" />
                </div>
                <div className="h-5 w-20 bg-slate-700 rounded animate-pulse" />
                <div className="h-5 w-16 bg-slate-700 rounded animate-pulse" />
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
