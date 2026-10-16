import { redirect } from "next/navigation";

// Market Prep used to be its own page, reached from Inventory Tools. Everything
// market-related now lives on the Inventory page's Market tab, so this just
// forwards old links and bookmarks to the view that replaced it.
export default function MarketPrepRedirect() {
  redirect("/inventory?tab=market&view=plan");
}
