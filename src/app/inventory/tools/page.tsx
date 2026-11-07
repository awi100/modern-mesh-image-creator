import { redirect } from "next/navigation";

/** Tools moved up a level to /tools, since it is where occasional workflows
 *  live rather than an Inventory sub-page. Kept so an old link or bookmark
 *  still lands somewhere useful. */
export default function InventoryToolsRedirect() {
  redirect("/tools");
}
