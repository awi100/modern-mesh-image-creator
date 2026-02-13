"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import type { ProductsResponse, ProductWithMatch } from "@/app/api/shopify/products/route";
import { Breadcrumb } from "@/components/Breadcrumb";

type FilterType = "all" | "matched" | "unmatched" | "partial";

export default function ShopifyProductsPage() {
  const [data, setData] = useState<ProductsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterType>("all");
  const [search, setSearch] = useState("");
  const [showUnmatchedDesigns, setShowUnmatchedDesigns] = useState(false);

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/shopify/products");
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to fetch products");
      }
      const json: ProductsResponse = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  // Filter products
  const filteredProducts = data?.products.filter((product) => {
    // Filter by match type
    if (filter === "matched" && product.matchType !== "exact") return false;
    if (filter === "unmatched" && product.matchType !== "none") return false;
    if (filter === "partial" && product.matchType !== "partial") return false;

    // Filter by search
    if (search) {
      const searchLower = search.toLowerCase();
      if (
        !product.title.toLowerCase().includes(searchLower) &&
        !product.matchedDesign?.name.toLowerCase().includes(searchLower)
      ) {
        return false;
      }
    }

    return true;
  });

  return (
    <div className="min-h-screen bg-slate-900">
      {/* Header */}
      <header className="bg-slate-800 border-b border-slate-700 sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-slate-400 hover:text-white">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
            </Link>
            <h1 className="text-xl font-bold text-white">Shopify Products</h1>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/orders"
              className="px-3 py-2 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600 text-sm"
            >
              Orders
            </Link>
            <button
              onClick={fetchProducts}
              disabled={loading}
              className="px-3 py-2 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600 disabled:opacity-50 text-sm flex items-center gap-2"
            >
              <svg className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Refresh
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        <Breadcrumb items={[{ label: "Shopify Products" }]} className="mb-2" />

        {/* Error */}
        {error && (
          <div className="p-4 bg-red-900/30 border border-red-700 rounded-lg">
            <p className="text-red-400">{error}</p>
          </div>
        )}

        {/* Loading */}
        {loading && !data && (
          <div className="flex items-center justify-center py-12">
            <div className="text-slate-400 flex items-center gap-3">
              <svg className="animate-spin h-6 w-6" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Loading products from Shopify...
            </div>
          </div>
        )}

        {data && (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
                <p className="text-3xl font-bold text-white">{data.summary.total}</p>
                <p className="text-sm text-slate-400">Total Products</p>
              </div>
              <div className="bg-slate-800 rounded-xl p-4 border border-emerald-700/50">
                <p className="text-3xl font-bold text-emerald-400">{data.summary.matched}</p>
                <p className="text-sm text-slate-400">Exact Matches</p>
              </div>
              <div className="bg-slate-800 rounded-xl p-4 border border-amber-700/50">
                <p className="text-3xl font-bold text-amber-400">{data.summary.partialMatched}</p>
                <p className="text-sm text-slate-400">Partial Matches</p>
              </div>
              <div className={`rounded-xl p-4 border ${data.summary.unmatched > 0 ? "bg-red-900/20 border-red-700" : "bg-slate-800 border-slate-700"}`}>
                <p className={`text-3xl font-bold ${data.summary.unmatched > 0 ? "text-red-400" : "text-slate-400"}`}>
                  {data.summary.unmatched}
                </p>
                <p className="text-sm text-slate-400">Unmatched</p>
              </div>
            </div>

            {/* Product Status Summary */}
            <div className="flex items-center gap-4 text-sm">
              <span className="text-slate-400">
                <span className="text-emerald-400 font-medium">{data.summary.activeProducts}</span> active
              </span>
              <span className="text-slate-400">
                <span className="text-amber-400 font-medium">{data.summary.draftProducts}</span> draft
              </span>
              <span className="text-slate-400">
                <span className="text-slate-500 font-medium">{data.summary.archivedProducts}</span> archived
              </span>
            </div>

            {/* Unmatched Designs Warning */}
            {data.unmatchedDesigns.length > 0 && (
              <div className="bg-purple-900/20 border border-purple-700 rounded-lg overflow-hidden">
                <button
                  onClick={() => setShowUnmatchedDesigns(!showUnmatchedDesigns)}
                  className="w-full p-4 flex items-center justify-between hover:bg-purple-900/30 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-purple-400 font-medium">
                      {data.unmatchedDesigns.length} Designs Without Shopify Products
                    </span>
                    <span className="text-sm text-slate-400">
                      (non-draft designs not matched to any product)
                    </span>
                  </div>
                  <svg
                    className={`w-5 h-5 text-purple-400 transition-transform ${showUnmatchedDesigns ? "rotate-180" : ""}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {showUnmatchedDesigns && (
                  <div className="border-t border-purple-700 divide-y divide-purple-700/50">
                    {data.unmatchedDesigns.map((design) => (
                      <div key={design.id} className="p-4 flex items-center gap-4">
                        {design.previewImageUrl ? (
                          <img
                            src={design.previewImageUrl}
                            alt={design.name}
                            className="w-12 h-12 rounded-lg object-cover flex-shrink-0"
                          />
                        ) : (
                          <div className="w-12 h-12 rounded-lg bg-slate-700 flex items-center justify-center flex-shrink-0">
                            <span className="text-slate-500 text-xs">?</span>
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-white font-medium truncate">{design.name}</p>
                          <p className="text-xs text-purple-400">{design.totalSold} sold</p>
                        </div>
                        <Link
                          href={`/design/${design.id}`}
                          className="px-3 py-1.5 bg-purple-800/50 text-purple-300 rounded-lg hover:bg-purple-700/50 text-sm"
                        >
                          Edit Design
                        </Link>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Filters and Search */}
            <div className="flex flex-col md:flex-row items-start md:items-center gap-4">
              {/* Filter Buttons */}
              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-400 mr-2">Show:</span>
                {[
                  { key: "all", label: "All", count: data.summary.total },
                  { key: "matched", label: "Matched", count: data.summary.matched },
                  { key: "partial", label: "Partial", count: data.summary.partialMatched },
                  { key: "unmatched", label: "Unmatched", count: data.summary.unmatched },
                ].map((f) => (
                  <button
                    key={f.key}
                    onClick={() => setFilter(f.key as FilterType)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      filter === f.key
                        ? f.key === "matched"
                          ? "bg-emerald-600 text-white"
                          : f.key === "unmatched"
                          ? "bg-red-600 text-white"
                          : f.key === "partial"
                          ? "bg-amber-600 text-white"
                          : "bg-slate-600 text-white"
                        : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white"
                    }`}
                  >
                    {f.label} ({f.count})
                  </button>
                ))}
              </div>

              {/* Search */}
              <div className="flex-1 md:max-w-xs">
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search products or designs..."
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-rose-800"
                />
              </div>
            </div>

            {/* Products Table */}
            <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-700">
                      <th className="text-left p-4 text-sm font-medium text-slate-400">Shopify Product</th>
                      <th className="text-left p-4 text-sm font-medium text-slate-400">Status</th>
                      <th className="text-center p-4 text-sm font-medium text-slate-400">Match</th>
                      <th className="text-left p-4 text-sm font-medium text-slate-400">Matched Design</th>
                      <th className="text-center p-4 text-sm font-medium text-slate-400">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700/50">
                    {filteredProducts?.map((product) => (
                      <ProductRow key={product.shopifyId} product={product} />
                    ))}
                    {filteredProducts?.length === 0 && (
                      <tr>
                        <td colSpan={5} className="p-8 text-center text-slate-400">
                          No products found
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Matching Rules Info */}
            <div className="p-4 bg-slate-800 rounded-lg border border-slate-700">
              <h3 className="text-sm font-semibold text-white mb-2">Product Matching Rules</h3>
              <ul className="text-sm text-slate-400 space-y-1">
                <li><span className="text-emerald-400">Exact match:</span> Product title matches design name exactly (case insensitive)</li>
                <li><span className="text-amber-400">Partial match:</span> Product title contains design name or vice versa</li>
                <li><span className="text-red-400">Unmatched:</span> No design found with matching name</li>
              </ul>
              <p className="text-xs text-slate-500 mt-2">
                To match a product, ensure the Shopify product title exactly matches the design name in this system.
              </p>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function ProductRow({ product }: { product: ProductWithMatch }) {
  const matchColors = {
    exact: { bg: "bg-emerald-900/30", text: "text-emerald-400", border: "border-emerald-700" },
    partial: { bg: "bg-amber-900/30", text: "text-amber-400", border: "border-amber-700" },
    none: { bg: "bg-red-900/30", text: "text-red-400", border: "border-red-700" },
  };
  const colors = matchColors[product.matchType];

  const statusColors: Record<string, string> = {
    ACTIVE: "text-emerald-400",
    DRAFT: "text-amber-400",
    ARCHIVED: "text-slate-500",
  };

  return (
    <tr className="hover:bg-slate-700/30">
      {/* Shopify Product */}
      <td className="p-4">
        <div className="flex items-center gap-3">
          {product.imageUrl ? (
            <img
              src={product.imageUrl}
              alt={product.title}
              className="w-12 h-12 rounded-lg object-cover flex-shrink-0"
            />
          ) : (
            <div className="w-12 h-12 rounded-lg bg-slate-700 flex items-center justify-center flex-shrink-0">
              <span className="text-slate-500 text-xs">No img</span>
            </div>
          )}
          <div className="min-w-0">
            <p className="text-white font-medium truncate">{product.title}</p>
            <p className="text-xs text-slate-500 truncate">/{product.handle}</p>
          </div>
        </div>
      </td>

      {/* Status */}
      <td className="p-4">
        <span className={`text-sm ${statusColors[product.status] || "text-slate-400"}`}>
          {product.status.toLowerCase()}
        </span>
      </td>

      {/* Match Type */}
      <td className="p-4 text-center">
        <span className={`inline-flex px-2 py-1 rounded text-xs font-medium ${colors.bg} ${colors.text}`}>
          {product.matchType === "exact" ? "Exact" : product.matchType === "partial" ? "Partial" : "None"}
        </span>
      </td>

      {/* Matched Design */}
      <td className="p-4">
        {product.matchedDesign ? (
          <div className="flex items-center gap-3">
            {product.matchedDesign.previewImageUrl ? (
              <img
                src={product.matchedDesign.previewImageUrl}
                alt={product.matchedDesign.name}
                className="w-10 h-10 rounded object-cover flex-shrink-0"
              />
            ) : (
              <div className="w-10 h-10 rounded bg-slate-700 flex items-center justify-center flex-shrink-0">
                <span className="text-slate-500 text-xs">?</span>
              </div>
            )}
            <div className="min-w-0">
              <p className="text-sm text-white truncate">{product.matchedDesign.name}</p>
              <p className="text-xs text-slate-500">
                {product.matchedDesign.widthInches}&quot; x {product.matchedDesign.heightInches}&quot; @ {product.matchedDesign.meshCount}mesh
                {product.matchedDesign.isDraft && <span className="ml-1 text-amber-400">(draft)</span>}
              </p>
            </div>
          </div>
        ) : (
          <span className="text-sm text-slate-500">-</span>
        )}
      </td>

      {/* Actions */}
      <td className="p-4 text-center">
        <div className="flex items-center justify-center gap-2">
          {product.matchedDesign && (
            <Link
              href={`/design/${product.matchedDesign.id}`}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg"
              title="View design"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
              </svg>
            </Link>
          )}
          <a
            href={`https://${process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN || "your-store.myshopify.com"}/admin/products/${product.shopifyId.split("/").pop()}`}
            target="_blank"
            rel="noopener noreferrer"
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg"
            title="View in Shopify"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
        </div>
      </td>
    </tr>
  );
}
