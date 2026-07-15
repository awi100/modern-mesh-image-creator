import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/session";

// GET - Fetch all color backup pairs
export async function GET() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const backups = await prisma.colorBackup.findMany({
      orderBy: { dmcNumber: "asc" },
    });

    // Build a bidirectional map
    const backupMap: Record<string, string> = {};
    for (const backup of backups) {
      // Add both directions
      backupMap[backup.dmcNumber] = backup.backupDmcNumber;
      backupMap[backup.backupDmcNumber] = backup.dmcNumber;
    }

    return NextResponse.json({ backups, backupMap });
  } catch (error) {
    console.error("Error fetching color backups:", error);
    return NextResponse.json(
      { error: "Failed to fetch color backups" },
      { status: 500 }
    );
  }
}

// POST - Set a backup color for a DMC number
export async function POST(request: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { dmcNumber, backupDmcNumber } = await request.json();

    if (!dmcNumber) {
      return NextResponse.json(
        { error: "dmcNumber is required" },
        { status: 400 }
      );
    }

    // If backupDmcNumber is empty/null, remove any existing backup involving
    // this color (either direction), atomically.
    if (!backupDmcNumber || !backupDmcNumber.trim()) {
      await prisma.$transaction([
        prisma.colorBackup.deleteMany({ where: { dmcNumber } }),
        prisma.colorBackup.deleteMany({ where: { backupDmcNumber: dmcNumber } }),
      ]);
      return NextResponse.json({ success: true, removed: true });
    }

    const trimmedBackup = backupDmcNumber.trim();

    if (trimmedBackup === dmcNumber) {
      return NextResponse.json({ error: "A color cannot be its own backup" }, { status: 400 });
    }

    // The pair is symmetric and stored once. Atomically clear any existing pair
    // referencing either color (in either column), then create the single row.
    const pair = [dmcNumber, trimmedBackup];
    const [first, second] = [...pair].sort();
    await prisma.$transaction([
      prisma.colorBackup.deleteMany({ where: { dmcNumber: { in: pair } } }),
      prisma.colorBackup.deleteMany({ where: { backupDmcNumber: { in: pair } } }),
      prisma.colorBackup.create({ data: { dmcNumber: first, backupDmcNumber: second } }),
    ]);

    return NextResponse.json({ success: true, dmcNumber: first, backupDmcNumber: second });
  } catch (error) {
    console.error("Error setting color backup:", error);
    return NextResponse.json(
      { error: "Failed to set color backup" },
      { status: 500 }
    );
  }
}
