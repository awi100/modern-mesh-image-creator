import { redirect } from "next/navigation";

// Retired in favour of the Inventory → Supplies tab.
//
// This standalone page was a strict subset that had drifted out of date: it had
// no knowledge of `andoverQuantity` at all, so its "total" was wrong for any
// supply with Andover stock and there was no way to manage that bucket here.
// It also couldn't edit the market count (read-only, and only rendered when
// non-zero) and bypassed the cache invalidation every other write uses.
//
// Since Orders linked here, this was the most-trafficked supplies entry point —
// i.e. the broken one. Redirect so those links land on the real editor.
export default function SuppliesRedirect() {
  redirect("/inventory?tab=supplies");
}
