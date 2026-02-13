import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/session";
import { syncFulfilledOrders, SyncResult } from "@/lib/shopify-sync";

export type { SyncResult };

// POST - Manual sync of fulfilled orders (triggered from UI)
// Pass ?fullHistory=true to sync ALL orders from entire Shopify history
export async function POST(request: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Check for fullHistory param in query string or body
    const { searchParams } = new URL(request.url);
    const fullHistory = searchParams.get("fullHistory") === "true";

    const result = await syncFulfilledOrders({ fullHistory });
    return NextResponse.json(result);
  } catch (error) {
    console.error("Error syncing Shopify orders:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to sync orders" },
      { status: 500 }
    );
  }
}
