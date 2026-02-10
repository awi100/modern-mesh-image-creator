import { NextRequest, NextResponse } from "next/server";
import { syncFulfilledOrders } from "@/lib/shopify-sync";

// Vercel Cron Job - runs every 10 minutes to sync fulfilled Shopify orders
// Automatically deducts kitsReady and canvasPrinted when orders are fulfilled

export async function GET(request: NextRequest) {
  // Verify the request is from Vercel Cron
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    console.log("[Cron] Unauthorized request - missing or invalid CRON_SECRET");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  console.log("[Cron] Starting Shopify sync...");

  try {
    const result = await syncFulfilledOrders();

    console.log("[Cron] Sync complete:", {
      processedOrders: result.processedOrders,
      kitsDeducted: result.kitsDeducted,
      canvasesDeducted: result.canvasesDeducted,
      errors: result.errors.length,
    });

    return NextResponse.json({
      success: true,
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[Cron] Sync failed:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Sync failed",
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
