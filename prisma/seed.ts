import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// RGB to Lab conversion
function rgbToLab(r: number, g: number, b: number): { l: number; a: number; b: number } {
  let rNorm = r / 255;
  let gNorm = g / 255;
  let bNorm = b / 255;

  rNorm = rNorm > 0.04045 ? Math.pow((rNorm + 0.055) / 1.055, 2.4) : rNorm / 12.92;
  gNorm = gNorm > 0.04045 ? Math.pow((gNorm + 0.055) / 1.055, 2.4) : gNorm / 12.92;
  bNorm = bNorm > 0.04045 ? Math.pow((bNorm + 0.055) / 1.055, 2.4) : bNorm / 12.92;

  const x = (rNorm * 0.4124564 + gNorm * 0.3575761 + bNorm * 0.1804375) / 0.95047;
  const y = (rNorm * 0.2126729 + gNorm * 0.7151522 + bNorm * 0.0721750) / 1.00000;
  const z = (rNorm * 0.0193339 + gNorm * 0.1191920 + bNorm * 0.9503041) / 1.08883;

  const xLab = x > 0.008856 ? Math.pow(x, 1/3) : (7.787 * x) + 16/116;
  const yLab = y > 0.008856 ? Math.pow(y, 1/3) : (7.787 * y) + 16/116;
  const zLab = z > 0.008856 ? Math.pow(z, 1/3) : (7.787 * z) + 16/116;

  return {
    l: (116 * yLab) - 16,
    a: 500 * (xLab - yLab),
    b: 200 * (yLab - zLab)
  };
}

// Sample DMC colors for seeding
const dmcColors = [
  { dmcNumber: "B5200", name: "Snow White", hex: "#FFFFFF" },
  { dmcNumber: "BLANC", name: "White", hex: "#FCFCFC" },
  { dmcNumber: "ECRU", name: "Ecru", hex: "#F0EAD6" },
  { dmcNumber: "310", name: "Black", hex: "#000000" },
  { dmcNumber: "321", name: "Red", hex: "#C52F3C" },
  { dmcNumber: "666", name: "Bright Red", hex: "#E31D3D" },
  { dmcNumber: "498", name: "Dark Red", hex: "#8B0A1E" },
  { dmcNumber: "970", name: "Light Pumpkin", hex: "#F78B3B" },
  { dmcNumber: "307", name: "Lemon", hex: "#F7E718" },
  { dmcNumber: "973", name: "Bright Canary", hex: "#F7E328" },
  { dmcNumber: "699", name: "Green", hex: "#185028" },
  { dmcNumber: "702", name: "Kelly Green", hex: "#38B050" },
  { dmcNumber: "995", name: "Dark Electric Blue", hex: "#1088C8" },
  { dmcNumber: "996", name: "Medium Electric Blue", hex: "#30B0E8" },
  { dmcNumber: "550", name: "Very Dark Violet", hex: "#481878" },
  { dmcNumber: "553", name: "Violet", hex: "#8848B0" },
  { dmcNumber: "938", name: "Ultra Dark Coffee Brown", hex: "#301810" },
  { dmcNumber: "436", name: "Tan", hex: "#B88048" },
  { dmcNumber: "414", name: "Dark Steel Gray", hex: "#686868" },
  { dmcNumber: "318", name: "Light Steel Gray", hex: "#989898" },
];

async function main() {
  console.log("Seeding DMC colors...");

  for (const color of dmcColors) {
    const red = parseInt(color.hex.slice(1, 3), 16);
    const green = parseInt(color.hex.slice(3, 5), 16);
    const blue = parseInt(color.hex.slice(5, 7), 16);
    const lab = rgbToLab(red, green, blue);

    await prisma.dmcColor.upsert({
      where: { dmcNumber: color.dmcNumber },
      update: {},
      create: {
        dmcNumber: color.dmcNumber,
        name: color.name,
        hexColor: color.hex,
        red,
        green,
        blue,
        labL: lab.l,
        labA: lab.a,
        labB: lab.b,
      },
    });

    console.log(`  Seeded DMC ${color.dmcNumber}: ${color.name}`);
  }

  // Create default user settings
  const existingSettings = await prisma.userSettings.findFirst();
  if (!existingSettings) {
    await prisma.userSettings.create({
      data: {},
    });
    console.log("Created default user settings");
  }

  console.log("Seeding complete!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
