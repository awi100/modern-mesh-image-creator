import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// This endpoint is called by Vercel Cron to permanently delete
// designs that have been in trash for more than 14 days

export async function GET(request: NextRequest) {
  // Verify the request is from Vercel Cron
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

    // Find and delete designs that have been in trash for more than 14 days
    const result = await prisma.design.deleteMany({
      where: {
        deletedAt: {
          not: null,
          lt: fourteenDaysAgo,
        },
      },
    });

    console.log(`Trash cleanup: permanently deleted ${result.count} designs`);

    return NextResponse.json({
      success: true,
      deleted: result.count,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error cleaning up trash:", error);
    return NextResponse.json(
      { error: "Failed to clean up trash" },
      { status: 500 }
    );
  }
}
