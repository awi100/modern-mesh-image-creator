"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface Tag {
  id: string;
  name: string;
  color: string;
}

interface Folder {
  id: string;
  name: string;
}

interface Design {
  id: string;
  name: string;
  widthInches: number;
  heightInches: number;
  meshCount: number;
  gridWidth: number;
  gridHeight: number;
  previewImageUrl: string | null;
  folder: Folder | null;
  tags: Tag[];
  createdAt: string;
  updatedAt: string;
}

export default function HomePage() {
  const router = useRouter();
  const [designs, setDesigns] = useState<Design[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    fetchDesigns();
    fetchFolders();
    fetchTags();
  }, [selectedFolder, selectedTag, searchQuery]);

  const fetchDesigns = async () => {
    try {
      const params = new URLSearchParams();
      if (selectedFolder !== null) params.set("folderId", selectedFolder || "null");
      if (selectedTag) params.set("tagId", selectedTag);
      if (searchQuery) params.set("search", searchQuery);

      const response = await fetch(`/api/designs?${params.toString()}`);
      if (response.ok) {
        const data = await response.json();
        setDesigns(data);
      }
    } catch (error) {
      console.error("Error fetching designs:", error);
    }
    setLoading(false);
  };

  const fetchFolders = async () => {
    try {
      const response = await fetch("/api/folders");
      if (response.ok) {
        const data = await response.json();
        setFolders(data);
      }
    } catch (error) {
      console.error("Error fetching folders:", error);
    }
  };

  const fetchTags = async () => {
    try {
      const response = await fetch("/api/tags");
      if (response.ok) {
        const data = await response.json();
        setTags(data);
      }
    } catch (error) {
      console.error("Error fetching tags:", error);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this design?")) return;

    try {
      const response = await fetch(`/api/designs/${id}`, { method: "DELETE" });
      if (response.ok) {
        setDesigns(designs.filter((d) => d.id !== id));
      }
    } catch (error) {
      console.error("Error deleting design:", error);
    }
  };

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  };

  return (
    <div className="min-h-screen bg-slate-900">
      {/* Header */}
      <header className="bg-slate-800 border-b border-slate-700 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-3 md:px-4 py-3 md:py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 md:gap-3 min-w-0">
            <div className="w-9 h-9 md:w-10 md:h-10 bg-gradient-to-br from-purple-500 to-pink-500 rounded-xl flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 md:w-6 md:h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
              </svg>
            </div>
            <div className="min-w-0">
              <h1 className="text-lg md:text-xl font-bold text-white truncate">Modern Mesh</h1>
              <p className="text-xs md:text-sm text-slate-400 hidden sm:block">Image Creator</p>
            </div>
          </div>

          <div className="flex items-center gap-2 md:gap-4">
            <Link
              href="/design/new"
              className="px-3 md:px-4 py-2 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-lg hover:from-purple-700 hover:to-pink-700 transition-all flex items-center gap-2 text-sm md:text-base"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              <span className="hidden sm:inline">New Design</span>
            </Link>
            <button
              onClick={handleLogout}
              className="p-2 text-slate-400 hover:text-white"
              title="Logout"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-3 md:px-4 py-4 md:py-6">
        {/* Mobile Search and Filter Toggle */}
        <div className="mb-4 md:hidden">
          <div className="flex gap-2">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search designs..."
              className="flex-1 px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`px-4 py-2.5 rounded-lg border transition-colors ${
                showFilters
                  ? "bg-purple-600 border-purple-600 text-white"
                  : "bg-slate-800 border-slate-700 text-slate-300"
              }`}
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
              </svg>
            </button>
          </div>

          {/* Mobile Filters Dropdown */}
          {showFilters && (
            <div className="mt-3 p-4 bg-slate-800 rounded-lg border border-slate-700 space-y-4">
              {/* Folders */}
              <div>
                <h3 className="text-sm font-medium text-slate-400 mb-2 uppercase tracking-wider">
                  Folders
                </h3>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setSelectedFolder(null)}
                    className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                      selectedFolder === null
                        ? "bg-purple-600 text-white"
                        : "bg-slate-700 text-slate-300"
                    }`}
                  >
                    All
                  </button>
                  <button
                    onClick={() => setSelectedFolder("")}
                    className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                      selectedFolder === ""
                        ? "bg-purple-600 text-white"
                        : "bg-slate-700 text-slate-300"
                    }`}
                  >
                    Unfiled
                  </button>
                  {folders.map((folder) => (
                    <button
                      key={folder.id}
                      onClick={() => setSelectedFolder(folder.id)}
                      className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                        selectedFolder === folder.id
                          ? "bg-purple-600 text-white"
                          : "bg-slate-700 text-slate-300"
                      }`}
                    >
                      {folder.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Tags */}
              {tags.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-slate-400 mb-2 uppercase tracking-wider">
                    Tags
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {tags.map((tag) => (
                      <button
                        key={tag.id}
                        onClick={() => setSelectedTag(selectedTag === tag.id ? null : tag.id)}
                        className={`px-3 py-1 rounded-full text-sm text-white transition-colors ${
                          selectedTag === tag.id ? "ring-2 ring-white" : "opacity-80"
                        }`}
                        style={{ backgroundColor: tag.color }}
                      >
                        {tag.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex gap-6">
          {/* Sidebar - hidden on mobile */}
          <aside className="hidden md:block w-64 flex-shrink-0">
            {/* Search */}
            <div className="mb-6">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search designs..."
                className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>

            {/* Folders */}
            <div className="mb-6">
              <h3 className="text-sm font-medium text-slate-400 mb-3 uppercase tracking-wider">
                Folders
              </h3>
              <div className="space-y-1">
                <button
                  onClick={() => setSelectedFolder(null)}
                  className={`w-full text-left px-3 py-2 rounded-lg transition-colors ${
                    selectedFolder === null
                      ? "bg-purple-600/20 text-purple-400"
                      : "text-slate-300 hover:bg-slate-800"
                  }`}
                >
                  All Designs
                </button>
                <button
                  onClick={() => setSelectedFolder("")}
                  className={`w-full text-left px-3 py-2 rounded-lg transition-colors ${
                    selectedFolder === ""
                      ? "bg-purple-600/20 text-purple-400"
                      : "text-slate-300 hover:bg-slate-800"
                  }`}
                >
                  Unfiled
                </button>
                {folders.map((folder) => (
                  <button
                    key={folder.id}
                    onClick={() => setSelectedFolder(folder.id)}
                    className={`w-full text-left px-3 py-2 rounded-lg transition-colors ${
                      selectedFolder === folder.id
                        ? "bg-purple-600/20 text-purple-400"
                        : "text-slate-300 hover:bg-slate-800"
                    }`}
                  >
                    📁 {folder.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Tags */}
            <div>
              <h3 className="text-sm font-medium text-slate-400 mb-3 uppercase tracking-wider">
                Tags
              </h3>
              <div className="flex flex-wrap gap-2">
                {tags.map((tag) => (
                  <button
                    key={tag.id}
                    onClick={() => setSelectedTag(selectedTag === tag.id ? null : tag.id)}
                    className={`px-3 py-1 rounded-full text-sm text-white transition-colors ${
                      selectedTag === tag.id
                        ? "ring-2 ring-white"
                        : "opacity-80 hover:opacity-100"
                    }`}
                    style={{ backgroundColor: tag.color }}
                  >
                    {tag.name}
                  </button>
                ))}
                {tags.length === 0 && (
                  <p className="text-slate-500 text-sm">No tags yet</p>
                )}
              </div>
            </div>
          </aside>

          {/* Main content */}
          <main className="flex-1 min-w-0">
            {loading ? (
              <div className="flex items-center justify-center h-64">
                <div className="text-white flex items-center gap-3">
                  <svg className="animate-spin h-6 w-6" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Loading designs...
                </div>
              </div>
            ) : designs.length === 0 ? (
              <div className="text-center py-12 md:py-16">
                <div className="w-14 h-14 md:w-16 md:h-16 bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-7 h-7 md:w-8 md:h-8 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                  </svg>
                </div>
                <h2 className="text-lg md:text-xl font-semibold text-white mb-2">No designs yet</h2>
                <p className="text-slate-400 mb-6 text-sm md:text-base px-4">Create your first needlepoint design to get started.</p>
                <Link
                  href="/design/new"
                  className="inline-flex items-center gap-2 px-5 md:px-6 py-2.5 md:py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-lg hover:from-purple-700 hover:to-pink-700 transition-all text-sm md:text-base"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Create New Design
                </Link>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 md:gap-6">
                {designs.map((design) => (
                  <div
                    key={design.id}
                    className="bg-slate-800 rounded-xl overflow-hidden border border-slate-700 hover:border-purple-500/50 transition-colors group"
                  >
                    {/* Preview */}
                    <Link href={`/design/${design.id}`} className="block aspect-square relative bg-slate-900">
                      {design.previewImageUrl ? (
                        <img
                          src={design.previewImageUrl}
                          alt={design.name}
                          className="w-full h-full object-contain"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-slate-600">
                          <svg className="w-12 h-12 md:w-16 md:h-16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
                          </svg>
                        </div>
                      )}
                    </Link>

                    {/* Info */}
                    <div className="p-3 md:p-4">
                      <Link href={`/design/${design.id}`}>
                        <h3 className="font-semibold text-white mb-1 group-hover:text-purple-400 transition-colors text-sm md:text-base truncate">
                          {design.name}
                        </h3>
                      </Link>
                      <p className="text-xs md:text-sm text-slate-400 mb-2 md:mb-3">
                        {design.widthInches}&quot; x {design.heightInches}&quot; @ {design.meshCount} mesh
                      </p>

                      {/* Tags */}
                      {design.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-2 md:mb-3">
                          {design.tags.map((tag) => (
                            <span
                              key={tag.id}
                              className="px-2 py-0.5 rounded-full text-xs text-white"
                              style={{ backgroundColor: tag.color }}
                            >
                              {tag.name}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Actions */}
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-slate-500">
                          {new Date(design.updatedAt).toLocaleDateString()}
                        </span>
                        <button
                          onClick={() => handleDelete(design.id)}
                          className="p-1.5 text-slate-500 hover:text-red-400 transition-colors"
                          title="Delete"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
