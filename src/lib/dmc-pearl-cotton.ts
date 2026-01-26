// DMC Pearl Cotton Color Palette with Lab values for perceptual color matching

export interface DmcColor {
  dmcNumber: string;
  name: string;
  hex: string;
  rgb: { r: number; g: number; b: number };
  lab: { l: number; a: number; b: number };
}

// RGB to Lab conversion
export function rgbToLab(r: number, g: number, b: number): { l: number; a: number; b: number } {
  // Normalize RGB to 0-1
  let rNorm = r / 255;
  let gNorm = g / 255;
  let bNorm = b / 255;

  // Apply gamma correction
  rNorm = rNorm > 0.04045 ? Math.pow((rNorm + 0.055) / 1.055, 2.4) : rNorm / 12.92;
  gNorm = gNorm > 0.04045 ? Math.pow((gNorm + 0.055) / 1.055, 2.4) : gNorm / 12.92;
  bNorm = bNorm > 0.04045 ? Math.pow((bNorm + 0.055) / 1.055, 2.4) : bNorm / 12.92;

  // Convert to XYZ
  const x = (rNorm * 0.4124564 + gNorm * 0.3575761 + bNorm * 0.1804375) / 0.95047;
  const y = (rNorm * 0.2126729 + gNorm * 0.7151522 + bNorm * 0.0721750) / 1.00000;
  const z = (rNorm * 0.0193339 + gNorm * 0.1191920 + bNorm * 0.9503041) / 1.08883;

  // Convert to Lab
  const xLab = x > 0.008856 ? Math.pow(x, 1/3) : (7.787 * x) + 16/116;
  const yLab = y > 0.008856 ? Math.pow(y, 1/3) : (7.787 * y) + 16/116;
  const zLab = z > 0.008856 ? Math.pow(z, 1/3) : (7.787 * z) + 16/116;

  return {
    l: (116 * yLab) - 16,
    a: 500 * (xLab - yLab),
    b: 200 * (yLab - zLab)
  };
}

// Delta E (CIE76) - perceptual color difference
export function deltaE76(lab1: { l: number; a: number; b: number }, lab2: { l: number; a: number; b: number }): number {
  return Math.sqrt(
    Math.pow(lab1.l - lab2.l, 2) +
    Math.pow(lab1.a - lab2.a, 2) +
    Math.pow(lab1.b - lab2.b, 2)
  );
}

// Find nearest DMC color to a given RGB
export function findNearestDmcColor(r: number, g: number, b: number): DmcColor {
  const targetLab = rgbToLab(r, g, b);
  let nearest = DMC_PEARL_COTTON[0];
  let minDistance = Infinity;

  for (const color of DMC_PEARL_COTTON) {
    const distance = deltaE76(targetLab, color.lab);
    if (distance < minDistance) {
      minDistance = distance;
      nearest = color;
    }
  }

  return nearest;
}

// Find nearest from a subset of colors
export function findNearestFromSubset(r: number, g: number, b: number, subset: DmcColor[]): DmcColor {
  const targetLab = rgbToLab(r, g, b);
  let nearest = subset[0];
  let minDistance = Infinity;

  for (const color of subset) {
    const distance = deltaE76(targetLab, color.lab);
    if (distance < minDistance) {
      minDistance = distance;
      nearest = color;
    }
  }

  return nearest;
}

// Helper to create color entry
function createColor(dmcNumber: string, name: string, hex: string): DmcColor {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const lab = rgbToLab(r, g, b);
  return { dmcNumber, name, hex, rgb: { r, g, b }, lab };
}

// DMC Pearl Cotton palette (~200 colors)
export const DMC_PEARL_COTTON: DmcColor[] = [
  // Whites and Ecrus
  createColor("B5200", "Snow White", "#FFFFFF"),
  createColor("BLANC", "White", "#FCFCFC"),
  createColor("ECRU", "Ecru", "#F0EAD6"),

  // Reds
  createColor("321", "Red", "#C52F3C"),
  createColor("304", "Medium Red", "#B72431"),
  createColor("498", "Dark Red", "#8B0A1E"),
  createColor("816", "Garnet", "#971E2A"),
  createColor("815", "Medium Garnet", "#7B1B25"),
  createColor("814", "Dark Garnet", "#5C1420"),
  createColor("666", "Bright Red", "#E31D3D"),
  createColor("349", "Dark Coral", "#CF3B3B"),
  createColor("350", "Medium Coral", "#E15656"),
  createColor("351", "Coral", "#E97171"),
  createColor("352", "Light Coral", "#F09090"),
  createColor("353", "Peach", "#F7B8B8"),
  createColor("817", "Very Dark Coral Red", "#B41C2D"),
  createColor("3705", "Dark Melon", "#E55B5B"),
  createColor("3706", "Medium Melon", "#F08888"),
  createColor("3708", "Light Melon", "#F7BABA"),
  createColor("3801", "Very Dark Melon", "#CC3B3B"),
  createColor("3802", "Very Dark Antique Mauve", "#6B2538"),
  createColor("3803", "Dark Mauve", "#8B2F47"),
  createColor("3804", "Dark Cyclamen Pink", "#A33558"),
  createColor("3805", "Cyclamen Pink", "#C44B73"),
  createColor("3806", "Light Cyclamen Pink", "#D9749B"),

  // Pinks
  createColor("956", "Geranium", "#E77B8B"),
  createColor("957", "Pale Geranium", "#F4A4AF"),
  createColor("961", "Dark Dusty Rose", "#CF6B7B"),
  createColor("962", "Medium Dusty Rose", "#E28A97"),
  createColor("963", "Ultra Very Light Dusty Rose", "#F7D5DA"),
  createColor("3354", "Light Dusty Rose", "#E8A3AC"),
  createColor("3733", "Dusty Rose", "#D88A95"),
  createColor("3731", "Very Dark Dusty Rose", "#B85567"),
  createColor("3350", "Ultra Dark Dusty Rose", "#984455"),
  createColor("150", "Ultra Very Dark Dusty Rose", "#7D3040"),
  createColor("151", "Very Light Dusty Rose", "#F4C8CE"),
  createColor("893", "Light Carnation", "#F4A0B0"),
  createColor("894", "Very Light Carnation", "#F8C4CF"),
  createColor("891", "Dark Carnation", "#E66080"),
  createColor("892", "Medium Carnation", "#EF8098"),
  createColor("818", "Baby Pink", "#FFDFE5"),
  createColor("776", "Medium Pink", "#F4B8C4"),
  createColor("899", "Medium Rose", "#E87088"),
  createColor("335", "Rose", "#D65070"),
  createColor("326", "Very Dark Rose", "#B33050"),
  createColor("309", "Dark Rose", "#9B2545"),

  // Oranges
  createColor("970", "Light Pumpkin", "#F78B3B"),
  createColor("971", "Pumpkin", "#F56B1B"),
  createColor("946", "Medium Burnt Orange", "#E55318"),
  createColor("947", "Burnt Orange", "#F76E35"),
  createColor("900", "Dark Burnt Orange", "#CF4010"),
  createColor("608", "Bright Orange", "#F85B20"),
  createColor("606", "Bright Orange-Red", "#F03B18"),
  createColor("740", "Tangerine", "#F77B28"),
  createColor("741", "Medium Tangerine", "#F79848"),
  createColor("742", "Light Tangerine", "#F7B068"),
  createColor("743", "Medium Yellow", "#F7CF68"),
  createColor("744", "Pale Yellow", "#F7E088"),
  createColor("745", "Very Light Pale Yellow", "#F8E8A8"),
  createColor("721", "Medium Orange Spice", "#E87838"),
  createColor("722", "Light Orange Spice", "#F09858"),
  createColor("720", "Dark Orange Spice", "#C85830"),
  createColor("3340", "Medium Apricot", "#F79070"),
  createColor("3341", "Apricot", "#F7A890"),
  createColor("3824", "Light Apricot", "#F8C8B8"),
  createColor("402", "Very Light Mahogany", "#E89868"),
  createColor("3776", "Light Mahogany", "#C87048"),
  createColor("301", "Medium Mahogany", "#A85030"),
  createColor("400", "Dark Mahogany", "#883820"),

  // Yellows
  createColor("307", "Lemon", "#F7E718"),
  createColor("444", "Dark Lemon", "#F7D718"),
  createColor("973", "Bright Canary", "#F7E328"),
  createColor("972", "Deep Canary", "#F7C818"),
  createColor("726", "Light Topaz", "#F7E078"),
  createColor("725", "Medium Light Topaz", "#F7D058"),
  createColor("783", "Medium Topaz", "#CF9828"),
  createColor("782", "Dark Topaz", "#B88018"),
  createColor("781", "Very Dark Topaz", "#A06810"),
  createColor("780", "Ultra Very Dark Topaz", "#885008"),
  createColor("729", "Medium Old Gold", "#C8A838"),
  createColor("680", "Dark Old Gold", "#A08018"),
  createColor("676", "Light Old Gold", "#D8C068"),
  createColor("677", "Very Light Old Gold", "#E8D898"),
  createColor("3078", "Very Light Golden Yellow", "#F8F0B8"),
  createColor("727", "Very Light Topaz", "#F8E898"),
  createColor("3821", "Straw", "#E8C048"),
  createColor("3820", "Dark Straw", "#D8A828"),
  createColor("3852", "Very Dark Straw", "#C89818"),
  createColor("3822", "Light Straw", "#F0D878"),
  createColor("3823", "Ultra Pale Yellow", "#F8F0D0"),

  // Greens
  createColor("699", "Green", "#185028"),
  createColor("700", "Bright Green", "#187830"),
  createColor("701", "Light Green", "#289840"),
  createColor("702", "Kelly Green", "#38B050"),
  createColor("703", "Chartreuse", "#58C868"),
  createColor("704", "Bright Chartreuse", "#78D878"),
  createColor("905", "Dark Parrot Green", "#388040"),
  createColor("906", "Medium Parrot Green", "#48A050"),
  createColor("907", "Light Parrot Green", "#78C880"),
  createColor("904", "Very Dark Parrot Green", "#285830"),
  createColor("909", "Very Dark Emerald Green", "#106038"),
  createColor("910", "Dark Emerald Green", "#108840"),
  createColor("911", "Medium Emerald Green", "#18A850"),
  createColor("912", "Light Emerald Green", "#28C060"),
  createColor("913", "Medium Nile Green", "#68D090"),
  createColor("954", "Nile Green", "#88E0A8"),
  createColor("955", "Light Nile Green", "#B8F0C8"),
  createColor("943", "Medium Aquamarine", "#18A088"),
  createColor("3812", "Very Dark Seagreen", "#188878"),
  createColor("3813", "Light Blue Green", "#98D8C0"),
  createColor("3814", "Aquamarine", "#489080"),
  createColor("3815", "Dark Celadon Green", "#487868"),
  createColor("3816", "Celadon Green", "#689888"),
  createColor("3817", "Light Celadon Green", "#98C0B0"),
  createColor("319", "Very Dark Pistachio Green", "#184828"),
  createColor("367", "Dark Pistachio Green", "#386038"),
  createColor("320", "Medium Pistachio Green", "#588858"),
  createColor("368", "Light Pistachio Green", "#78A878"),
  createColor("369", "Very Light Pistachio Green", "#A8D0A8"),
  createColor("890", "Ultra Dark Pistachio Green", "#103818"),
  createColor("986", "Very Dark Forest Green", "#284028"),
  createColor("987", "Dark Forest Green", "#386838"),
  createColor("988", "Medium Forest Green", "#588858"),
  createColor("989", "Forest Green", "#78A878"),
  createColor("3345", "Dark Hunter Green", "#183820"),
  createColor("3346", "Hunter Green", "#386038"),
  createColor("3347", "Medium Yellow Green", "#588050"),
  createColor("3348", "Light Yellow Green", "#98B088"),
  createColor("580", "Dark Moss Green", "#485028"),
  createColor("581", "Moss Green", "#687038"),
  createColor("734", "Light Olive Green", "#989858"),
  createColor("733", "Medium Olive Green", "#888840"),
  createColor("732", "Olive Green", "#686828"),
  createColor("731", "Dark Olive Green", "#585818"),
  createColor("730", "Very Dark Olive Green", "#484808"),

  // Blues
  createColor("995", "Dark Electric Blue", "#1088C8"),
  createColor("996", "Medium Electric Blue", "#30B0E8"),
  createColor("3843", "Electric Blue", "#10A8E8"),
  createColor("3844", "Dark Bright Turquoise", "#1098D0"),
  createColor("3845", "Medium Bright Turquoise", "#28C0E8"),
  createColor("3846", "Light Bright Turquoise", "#68D8F0"),
  createColor("807", "Peacock Blue", "#487898"),
  createColor("806", "Dark Peacock Blue", "#306080"),
  createColor("3760", "Medium Wedgwood", "#3880A0"),
  createColor("3761", "Light Sky Blue", "#98C8E0"),
  createColor("519", "Sky Blue", "#78B8D8"),
  createColor("518", "Light Wedgwood", "#5898B8"),
  createColor("517", "Dark Wedgwood", "#386888"),
  createColor("516", "Medium Wedgwood", "#387898"),
  createColor("311", "Medium Navy Blue", "#183868"),
  createColor("336", "Navy Blue", "#182858"),
  createColor("823", "Dark Navy Blue", "#101848"),
  createColor("939", "Very Dark Navy Blue", "#081038"),
  createColor("312", "Very Dark Baby Blue", "#284878"),
  createColor("322", "Dark Baby Blue", "#386090"),
  createColor("334", "Medium Baby Blue", "#5888B0"),
  createColor("3755", "Baby Blue", "#88B0D0"),
  createColor("3325", "Light Baby Blue", "#B8D0E8"),
  createColor("775", "Very Light Baby Blue", "#D8E8F8"),
  createColor("813", "Light Blue", "#78A8C8"),
  createColor("826", "Medium Blue", "#4880A0"),
  createColor("825", "Dark Blue", "#305878"),
  createColor("824", "Very Dark Blue", "#183858"),
  createColor("827", "Very Light Blue", "#B0D0E8"),
  createColor("828", "Ultra Very Light Blue", "#D0E8F8"),
  createColor("799", "Medium Delft Blue", "#5078B0"),
  createColor("798", "Dark Delft Blue", "#3858A0"),
  createColor("797", "Royal Blue", "#2040A8"),
  createColor("796", "Dark Royal Blue", "#182890"),
  createColor("820", "Very Dark Royal Blue", "#101870"),
  createColor("809", "Delft Blue", "#78A0D0"),
  createColor("800", "Pale Delft Blue", "#B8D0F0"),
  createColor("3838", "Dark Lavender Blue", "#5870A8"),
  createColor("3839", "Medium Lavender Blue", "#7890C0"),
  createColor("3840", "Light Lavender Blue", "#A0B8D8"),
  createColor("340", "Medium Blue Violet", "#8888C8"),
  createColor("341", "Light Blue Violet", "#A8A8D8"),
  createColor("333", "Very Dark Blue Violet", "#4848A8"),
  createColor("791", "Very Dark Cornflower Blue", "#384090"),
  createColor("792", "Dark Cornflower Blue", "#485098"),
  createColor("793", "Medium Cornflower Blue", "#6878B0"),
  createColor("794", "Light Cornflower Blue", "#88A0C8"),

  // Purples
  createColor("550", "Very Dark Violet", "#481878"),
  createColor("552", "Medium Violet", "#682898"),
  createColor("553", "Violet", "#8848B0"),
  createColor("554", "Light Violet", "#A878C8"),
  createColor("208", "Very Dark Lavender", "#583898"),
  createColor("209", "Dark Lavender", "#7858B0"),
  createColor("210", "Medium Lavender", "#9878C8"),
  createColor("211", "Light Lavender", "#C0A8E0"),
  createColor("3837", "Ultra Dark Lavender", "#482888"),
  createColor("3746", "Dark Blue Violet", "#6060B0"),
  createColor("3747", "Very Light Blue Violet", "#C8C8E8"),
  createColor("327", "Dark Violet", "#582080"),
  createColor("153", "Very Light Violet", "#E0C8F0"),
  createColor("718", "Plum", "#982878"),
  createColor("917", "Medium Plum", "#881870"),
  createColor("915", "Dark Plum", "#781058"),
  createColor("3607", "Light Plum", "#B84888"),
  createColor("3608", "Very Light Plum", "#D080A8"),
  createColor("3609", "Ultra Light Plum", "#E8A8C8"),

  // Browns
  createColor("938", "Ultra Dark Coffee Brown", "#301810"),
  createColor("801", "Dark Coffee Brown", "#402818"),
  createColor("898", "Very Dark Coffee Brown", "#382010"),
  createColor("300", "Very Dark Mahogany", "#682818"),
  createColor("433", "Medium Brown", "#583018"),
  createColor("434", "Light Brown", "#784828"),
  createColor("435", "Very Light Brown", "#986038"),
  createColor("436", "Tan", "#B88048"),
  createColor("437", "Light Tan", "#D0A068"),
  createColor("738", "Very Light Tan", "#E0C098"),
  createColor("739", "Ultra Very Light Tan", "#F0E0C8"),
  createColor("420", "Dark Hazelnut Brown", "#785028"),
  createColor("869", "Very Dark Hazelnut Brown", "#583818"),
  createColor("422", "Light Hazelnut Brown", "#A88050"),
  createColor("3828", "Hazelnut Brown", "#906838"),
  createColor("3827", "Pale Golden Brown", "#D8A858"),
  createColor("977", "Light Golden Brown", "#C89038"),
  createColor("976", "Medium Golden Brown", "#B87828"),
  createColor("975", "Dark Golden Brown", "#884818"),
  createColor("3826", "Golden Brown", "#A86828"),
  createColor("355", "Dark Terra Cotta", "#984838"),
  createColor("356", "Medium Terra Cotta", "#B86858"),
  createColor("758", "Very Light Terra Cotta", "#E8A898"),
  createColor("3778", "Light Terra Cotta", "#D08878"),
  createColor("3830", "Terra Cotta", "#B85848"),
  createColor("407", "Dark Desert Sand", "#987868"),
  createColor("3773", "Medium Desert Sand", "#C8A090"),
  createColor("3064", "Desert Sand", "#D0A898"),
  createColor("632", "Ultra Very Dark Desert Sand", "#684838"),
  createColor("3772", "Very Dark Desert Sand", "#886858"),
  createColor("3862", "Dark Mocha Beige", "#705848"),
  createColor("3863", "Medium Mocha Beige", "#907868"),
  createColor("3864", "Light Mocha Beige", "#C8B0A0"),
  createColor("842", "Very Light Beige Brown", "#D0C0B0"),
  createColor("841", "Light Beige Brown", "#B8A898"),
  createColor("840", "Medium Beige Brown", "#988878"),
  createColor("839", "Dark Beige Brown", "#786858"),
  createColor("838", "Very Dark Beige Brown", "#584838"),
  createColor("3790", "Ultra Dark Beige Gray", "#685848"),
  createColor("3781", "Dark Mocha Brown", "#584030"),
  createColor("3782", "Light Mocha Brown", "#A89080"),
  createColor("3032", "Medium Mocha Brown", "#908070"),
  createColor("3031", "Very Dark Mocha Brown", "#483828"),
  createColor("3033", "Very Light Mocha Brown", "#C8B8A8"),

  // Grays
  createColor("310", "Black", "#000000"),
  createColor("3799", "Very Dark Pewter Gray", "#383838"),
  createColor("413", "Dark Pewter Gray", "#484848"),
  createColor("414", "Dark Steel Gray", "#686868"),
  createColor("317", "Pewter Gray", "#787878"),
  createColor("318", "Light Steel Gray", "#989898"),
  createColor("415", "Pearl Gray", "#B0B0B0"),
  createColor("762", "Very Light Pearl Gray", "#D0D0D0"),
  createColor("3072", "Very Light Beaver Gray", "#E0E0D8"),
  createColor("648", "Light Beaver Gray", "#B8B0A8"),
  createColor("647", "Medium Beaver Gray", "#989088"),
  createColor("646", "Dark Beaver Gray", "#787068"),
  createColor("645", "Very Dark Beaver Gray", "#585048"),
  createColor("844", "Ultra Dark Beaver Gray", "#484040"),
  createColor("535", "Very Light Ash Gray", "#989898"),
  createColor("3023", "Light Brown Gray", "#A8A098"),
  createColor("3022", "Medium Brown Gray", "#888078"),
  createColor("3024", "Very Light Brown Gray", "#C8C0B8"),
  createColor("3787", "Dark Brown Gray", "#585048"),
  createColor("3021", "Very Dark Brown Gray", "#403830"),

  // Blue-Grays
  createColor("927", "Light Gray Green", "#B8C8C0"),
  createColor("926", "Medium Gray Green", "#90A8A0"),
  createColor("3768", "Dark Gray Green", "#688880"),
  createColor("924", "Very Dark Gray Green", "#486860"),
  createColor("928", "Very Light Gray Green", "#D0E0D8"),
  createColor("3756", "Ultra Very Light Baby Blue", "#E8F0F8"),
  createColor("931", "Medium Antique Blue", "#5878A0"),
  createColor("930", "Dark Antique Blue", "#385878"),
  createColor("932", "Light Antique Blue", "#88A8C8"),
  createColor("3752", "Very Light Antique Blue", "#B8C8D8"),
  createColor("3753", "Ultra Very Light Antique Blue", "#D8E8F0"),
  createColor("169", "Light Pewter", "#A0A0A0"),
  createColor("168", "Very Light Pewter", "#C0C0C0"),
  createColor("597", "Turquoise", "#38A0A8"),
  createColor("598", "Light Turquoise", "#70C0C8"),
  createColor("3811", "Very Light Turquoise", "#A8E0E8"),
  createColor("3810", "Dark Turquoise", "#288890"),
  createColor("3809", "Very Dark Turquoise", "#187078"),
  createColor("3808", "Ultra Very Dark Turquoise", "#106060"),
];

// Get color by DMC number
export function getDmcColorByNumber(dmcNumber: string): DmcColor | undefined {
  return DMC_PEARL_COTTON.find(c => c.dmcNumber === dmcNumber);
}

// Search colors by name
export function searchDmcColors(query: string): DmcColor[] {
  const lowerQuery = query.toLowerCase();
  return DMC_PEARL_COTTON.filter(c =>
    c.name.toLowerCase().includes(lowerQuery) ||
    c.dmcNumber.toLowerCase().includes(lowerQuery)
  );
}
