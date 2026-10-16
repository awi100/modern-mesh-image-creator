import { redirect } from "next/navigation";

// "Missing from Market" is now the Market tab's "To pack" view.
export default function MissingFromMarketRedirect() {
  redirect("/inventory?tab=market&view=pack");
}
