import { redirect } from "next/navigation";

// Retired. This page moved canvases from Andover to Home and was superseded by
// Andover Pickup, which does the same thing for canvases AND kits AND supplies,
// lets you edit the quantity before moving, and reconciles with the server.
//
// It had been orphaned (nothing linked to it) while still being reachable by
// URL, and it answered "what's low?" differently from Andover Pickup — it
// listed designs with nothing at Andover and offered no way to act on them.
// Redirecting rather than deleting so old bookmarks keep working.
export default function RestockRedirect() {
  redirect("/inventory/andover-pickup");
}
