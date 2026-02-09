import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import pako from "pako";
import Editor from "@/components/editor";

// Force dynamic rendering - never cache this page
export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface Props {
  params: Promise<{ id: string }>;
}

export default async function DesignPage({ params }: Props) {
  const { id } = await params;

  const design = await prisma.design.findUnique({
    where: { id },
    include: {
      folder: true,
      tags: {
        include: {
          tag: true,
        },
      },
    },
  });

  if (!design) {
    notFound();
  }

  // Decompress pixel data
  let grid: (string | null)[][] = [];
  if (design.pixelData) {
    try {
      const decompressed = pako.inflate(design.pixelData);
      const jsonStr = new TextDecoder().decode(decompressed);
      grid = JSON.parse(jsonStr);
    } catch {
      // If decompression fails, try parsing as plain JSON
      try {
        const jsonStr = design.pixelData.toString();
        grid = JSON.parse(jsonStr);
      } catch {
        // Fall back to empty grid
        grid = Array.from({ length: design.gridHeight }, () =>
          Array(design.gridWidth).fill(null)
        );
      }
    }
  }

  const initialData = {
    name: design.name,
    folderId: design.folderId,
    isDraft: design.isDraft,
    widthInches: design.widthInches,
    heightInches: design.heightInches,
    meshCount: design.meshCount as 14 | 18,
    gridWidth: design.gridWidth,
    gridHeight: design.gridHeight,
    grid,
    stitchType: design.stitchType as "continental" | "basketweave",
    bufferPercent: design.bufferPercent,
    referenceImageUrl: design.referenceImageUrl,
    referenceImageOpacity: design.referenceImageOpacity,
  };

  return <Editor designId={id} initialData={initialData} />;
}
