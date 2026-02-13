export default function DesignLoading() {
  return (
    <div className="h-screen flex flex-col bg-slate-900">
      {/* Header skeleton */}
      <header className="bg-slate-800 border-b border-slate-700 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-8 h-8 bg-slate-700 rounded-lg animate-pulse" />
            <div className="space-y-2">
              <div className="h-5 w-32 bg-slate-700 rounded animate-pulse" />
              <div className="h-4 w-48 bg-slate-700 rounded animate-pulse" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="w-16 h-8 bg-slate-700 rounded-lg animate-pulse" />
            ))}
          </div>
        </div>
      </header>

      {/* Toolbar skeleton */}
      <div className="bg-slate-800 border-b border-slate-700 p-2">
        <div className="flex items-center gap-4">
          {[...Array(9)].map((_, i) => (
            <div key={i} className="w-10 h-10 bg-slate-700 rounded-lg animate-pulse" />
          ))}
        </div>
      </div>

      {/* Main content skeleton */}
      <div className="flex-1 flex overflow-hidden">
        {/* Color picker skeleton */}
        <div className="hidden md:block w-64 bg-slate-800 border-r border-slate-700 p-4">
          <div className="space-y-4">
            <div className="h-16 bg-slate-700 rounded-lg animate-pulse" />
            <div className="h-10 bg-slate-700 rounded-lg animate-pulse" />
            <div className="grid grid-cols-5 gap-1">
              {[...Array(25)].map((_, i) => (
                <div key={i} className="aspect-square bg-slate-700 rounded animate-pulse" />
              ))}
            </div>
          </div>
        </div>

        {/* Canvas area skeleton */}
        <div className="flex-1 bg-slate-900 flex items-center justify-center">
          <div className="text-center">
            <div className="w-12 h-12 border-4 border-slate-700 border-t-rose-500 rounded-full animate-spin mx-auto mb-4" />
            <p className="text-slate-400">Loading design...</p>
          </div>
        </div>

        {/* Right panels skeleton */}
        <div className="hidden lg:block w-64 bg-slate-800 border-l border-slate-700 p-4">
          <div className="space-y-4">
            <div className="h-6 w-24 bg-slate-700 rounded animate-pulse" />
            <div className="space-y-2">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-12 bg-slate-700 rounded animate-pulse" />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Mobile bottom bar skeleton */}
      <div className="md:hidden bg-slate-800 border-t border-slate-700 px-2 py-2 flex items-center justify-around">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="w-20 h-10 bg-slate-700 rounded-lg animate-pulse" />
        ))}
      </div>
    </div>
  );
}
