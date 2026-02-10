import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/session";
import { syncFulfilledOrders, SyncResult } from "@/lib/shopify-sync";

export type { SyncResult };

// POST - Manual sync of fulfilled orders (triggered from UI)
export async function POST(_request: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await syncFulfilledOrders();
    return NextResponse.json(result);
  } catch (error) {
    console.error("Error syncing Shopify orders:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to sync orders" },
      { status: 500 }
    );
  }
}
