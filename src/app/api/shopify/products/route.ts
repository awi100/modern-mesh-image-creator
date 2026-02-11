import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { shopifyGraphQL, normalizeTitle } from "@/lib/shopify";

interface ShopifyProduct {
  id: string;
  title: string;
  status: string;
  handle: string;
  featuredImage: {
    url: string;
  } | null;
  variants: {
    nodes: Array<{
      id: string;
      title: string;
      price: string;
    }>;
  };
}

interface ProductsQueryResult {
  products: {
    nodes: ShopifyProduct[];
    pageInfo: {
      hasNextPage: boolean;
      endCursor: string | null;
    };
  };
}

export interface ProductWithMatch {
  shopifyId: string;
  title: string;
  handle: string;
  status: string;
  imageUrl: string | null;
  variants: Array<{
    id: string;
    title: string;
    price: string;
  }>;
  // Matched design info
  matchedDesign: {
    id: string;
    name: string;
    previewImageUrl: string | null;
    widthInches: number;
    heightInches: number;
    meshCount: number;
    totalSold: number;
    kitsReady: number;
    isDraft: boolean;
  } | null;
  matchType: "exact" | "partial" | "none";
  normalizedTitle: string;
}

export interface ProductsResponse {
  products: ProductWithMatch[];
  summary: {
    total: number;
    matched: number;
    unmatched: number;
    partialMatched: number;
    activeProducts: number;
    draftProducts: number;
    archivedProducts: number;
  };
  unmatchedDesigns: Array<{
    id: string;
    name: string;
    previewImageUrl: string | null;
    totalSold: number;
  }>;
}

// Fetch all products from Shopify
async function fetchAllProducts(): Promise<ShopifyProduct[]> {
  const allProducts: ShopifyProduct[] = [];
  let cursor: string | undefined;
  let hasMore = true;

  while (hasMore) {
    const query = `
      query GetProducts($cursor: String) {
        products(first: 100, after: $cursor) {
          nodes {
            id
            title
            status
            handle
            featuredImage {
              url
            }
            variants(first: 10) {
              nodes {
                id
                title
                price
              }
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `;

    const result = await shopifyGraphQL<ProductsQueryResult>(query, { cursor });
    allProducts.push(...result.products.nodes);
    hasMore = result.products.pageInfo.hasNextPage;
    cursor = result.products.pageInfo.endCursor || undefined;
  }

  return allProducts;
}

// GET - Fetch all Shopify products with design matching info
export async function GET() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Check if Shopify is configured
  if (!process.env.SHOPIFY_STORE_DOMAIN || !process.env.SHOPIFY_ADMIN_TOKEN) {
    return NextResponse.json(
      { error: "Shopify not configured" },
      { status: 500 }
    );
  }

  try {
    // Fetch all Shopify products
    const shopifyProducts = await fetchAllProducts();

    // Fetch all designs
    const designs = await prisma.design.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        name: true,
        previewImageUrl: true,
        widthInches: true,
        heightInches: true,
        meshCount: true,
        totalSold: true,
        kitsReady: true,
        isDraft: true,
      },
    });

    // Create design lookup maps
    const designByNormalizedName = new Map<string, typeof designs[0]>();
    const designByPartialMatch = new Map<string, typeof designs[0]>();

    for (const design of designs) {
      const normalized = normalizeTitle(design.name);
      designByNormalizedName.set(normalized, design);

      // Also create partial match entries (first word, or without common suffixes)
      const words = normalized.split(/\s+/);
      if (words.length > 1) {
        // Add first two words as partial match key
        designByPartialMatch.set(words.slice(0, 2).join(" "), design);
      }
    }

    // Track which designs have been matched
    const matchedDesignIds = new Set<string>();

    // Match products to designs
    const productsWithMatches: ProductWithMatch[] = shopifyProducts.map((product) => {
      const normalizedTitle = normalizeTitle(product.title);

      // Try exact match first
      let matchedDesign = designByNormalizedName.get(normalizedTitle);
      let matchType: "exact" | "partial" | "none" = "none";

      if (matchedDesign) {
        matchType = "exact";
        matchedDesignIds.add(matchedDesign.id);
      } else {
        // Try partial match - check if design name is contained in product title
        for (const design of designs) {
          const designNormalized = normalizeTitle(design.name);
          if (normalizedTitle.includes(designNormalized) || designNormalized.includes(normalizedTitle)) {
            matchedDesign = design;
            matchType = "partial";
            matchedDesignIds.add(design.id);
            break;
          }
        }
      }

      return {
        shopifyId: product.id,
        title: product.title,
        handle: product.handle,
        status: product.status,
        imageUrl: product.featuredImage?.url || null,
        variants: product.variants.nodes.map((v) => ({
          id: v.id,
          title: v.title,
          price: v.price,
        })),
        matchedDesign: matchedDesign
          ? {
              id: matchedDesign.id,
              name: matchedDesign.name,
              previewImageUrl: matchedDesign.previewImageUrl,
              widthInches: matchedDesign.widthInches,
              heightInches: matchedDesign.heightInches,
              meshCount: matchedDesign.meshCount,
              totalSold: matchedDesign.totalSold,
              kitsReady: matchedDesign.kitsReady,
              isDraft: matchedDesign.isDraft,
            }
          : null,
        matchType,
        normalizedTitle,
      };
    });

    // Sort: unmatched first, then partial matches, then exact matches
    productsWithMatches.sort((a, b) => {
      const order = { none: 0, partial: 1, exact: 2 };
      return order[a.matchType] - order[b.matchType];
    });

    // Find designs not matched to any product
    const unmatchedDesigns = designs
      .filter((d) => !matchedDesignIds.has(d.id) && !d.isDraft)
      .map((d) => ({
        id: d.id,
        name: d.name,
        previewImageUrl: d.previewImageUrl,
        totalSold: d.totalSold,
      }));

    // Summary stats
    const summary = {
      total: productsWithMatches.length,
      matched: productsWithMatches.filter((p) => p.matchType === "exact").length,
      unmatched: productsWithMatches.filter((p) => p.matchType === "none").length,
      partialMatched: productsWithMatches.filter((p) => p.matchType === "partial").length,
      activeProducts: productsWithMatches.filter((p) => p.status === "ACTIVE").length,
      draftProducts: productsWithMatches.filter((p) => p.status === "DRAFT").length,
      archivedProducts: productsWithMatches.filter((p) => p.status === "ARCHIVED").length,
    };

    return NextResponse.json({
      products: productsWithMatches,
      summary,
      unmatchedDesigns,
    } as ProductsResponse);
  } catch (error) {
    console.error("Error fetching Shopify products:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch products" },
      { status: 500 }
    );
  }
}
