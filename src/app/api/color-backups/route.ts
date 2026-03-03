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

    // If backupDmcNumber is empty/null, remove any existing backup
    if (!backupDmcNumber || !backupDmcNumber.trim()) {
      // Delete any existing backup where this color is primary
      await prisma.colorBackup.deleteMany({
        where: { dmcNumber },
      });
      // Also delete any where this color is the backup (to clean up the pair)
      await prisma.colorBackup.deleteMany({
        where: { backupDmcNumber: dmcNumber },
      });

      return NextResponse.json({ success: true, removed: true });
    }

    const trimmedBackup = backupDmcNumber.trim();

    // Check if the reverse relationship exists (backup -> this color)
    const reverseExists = await prisma.colorBackup.findUnique({
      where: { dmcNumber: trimmedBackup },
    });

    if (reverseExists) {
      // Update the existing reverse relationship to point to this color
      // This ensures we only have one record for the pair
      if (reverseExists.backupDmcNumber !== dmcNumber) {
        // Delete the old relationship
        await prisma.colorBackup.delete({
          where: { dmcNumber: trimmedBackup },
        });
      }
    }

    // Delete any existing backup for this color
    await prisma.colorBackup.deleteMany({
      where: { dmcNumber },
    });

    // Also remove any backup where either color is already paired with something else
    await prisma.colorBackup.deleteMany({
      where: { backupDmcNumber: dmcNumber },
    });
    await prisma.colorBackup.deleteMany({
      where: { dmcNumber: trimmedBackup },
    });
    await prisma.colorBackup.deleteMany({
      where: { backupDmcNumber: trimmedBackup },
    });

    // Create the new backup relationship (we only store one direction)
    // Store with the lower DMC number first for consistency
    const [first, second] = [dmcNumber, trimmedBackup].sort();

    await prisma.colorBackup.create({
      data: {
        dmcNumber: first,
        backupDmcNumber: second,
      },
    });

    return NextResponse.json({ success: true, dmcNumber: first, backupDmcNumber: second });
  } catch (error) {
    console.error("Error setting color backup:", error);
    return NextResponse.json(
      { error: "Failed to set color backup" },
      { status: 500 }
    );
  }
}
