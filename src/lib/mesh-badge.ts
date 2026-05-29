// Shared mesh count badge styling.
// 13 = purple (Size 3 thread), 14 = zinc/slate, 18 = amber (Size 5).

export function meshBadgeClassDark(meshCount: number): string {
  if (meshCount === 13) return "bg-purple-900/80 text-purple-300";
  if (meshCount === 18) return "bg-amber-900/80 text-amber-300";
  return "bg-slate-700/80 text-slate-300"; // 14
}

export function meshBadgeClassLight(meshCount: number): string {
  if (meshCount === 13) return "bg-purple-500/20 text-purple-400";
  if (meshCount === 18) return "bg-amber-500/20 text-amber-400";
  return "bg-zinc-500/20 text-zinc-400"; // 14
}
