"use client";

import React, { useState } from "react";

interface Folder {
  id: string;
  name: string;
}

interface Tag {
  id: string;
  name: string;
  color: string;
}

interface BatchActionBarProps {
  selectedCount: number;
  onMoveToFolder: (folderId: string | null) => Promise<void>;
  onAddTags: (tagIds: string[]) => Promise<void>;
  onRemoveTags: (tagIds: string[]) => Promise<void>;
  onDelete: () => Promise<void>;
  onExportKits: () => Promise<void>;
  onCancel: () => void;
  folders: Folder[];
  tags: Tag[];
}

export default function BatchActionBar({
  selectedCount,
  onMoveToFolder,
  onAddTags,
  onRemoveTags,
  onDelete,
  onExportKits,
  onCancel,
  folders,
  tags,
}: BatchActionBarProps) {
  const [showFolderDropdown, setShowFolderDropdown] = useState(false);
  const [showTagDropdown, setShowTagDropdown] = useState(false);
  const [tagAction, setTagAction] = useState<"add" | "remove">("add");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleMoveToFolder = async (folderId: string | null) => {
    setLoading(true);
    try {
      await onMoveToFolder(folderId);
    } finally {
      setLoading(false);
      setShowFolderDropdown(false);
    }
  };

  const handleTagAction = async (tagId: string) => {
    setLoading(true);
    try {
      if (tagAction === "add") {
        await onAddTags([tagId]);
      } else {
        await onRemoveTags([tagId]);
      }
    } finally {
      setLoading(false);
      setShowTagDropdown(false);
    }
  };

  const handleDelete = async () => {
    setLoading(true);
    try {
      await onDelete();
    } finally {
      setLoading(false);
      setShowDeleteConfirm(false);
    }
  };

  const handleExportKits = async () => {
    setLoading(true);
    try {
      await onExportKits();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-slate-800 border-t border-slate-600 shadow-lg">
      <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
        {/* Selection count */}
        <div className="flex items-center gap-2 text-white">
          <svg className="w-5 h-5 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <span className="font-medium">{selectedCount} selected</span>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Move to Folder */}
          <div className="relative">
            <button
              onClick={() => {
                setShowFolderDropdown(!showFolderDropdown);
                setShowTagDropdown(false);
              }}
              disabled={loading}
              className="px-3 py-1.5 bg-slate-700 text-slate-200 rounded-lg hover:bg-slate-600 disabled:opacity-50 text-sm flex items-center gap-1"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
              <span className="hidden sm:inline">Move</span>
            </button>

            {showFolderDropdown && (
              <div className="absolute bottom-full mb-2 left-0 w-48 bg-slate-700 rounded-lg shadow-xl border border-slate-600 overflow-hidden">
                <button
                  onClick={() => handleMoveToFolder(null)}
                  className="w-full px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-600"
                >
                  Unfiled
                </button>
                {folders.map((folder) => (
                  <button
                    key={folder.id}
                    onClick={() => handleMoveToFolder(folder.id)}
                    className="w-full px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-600"
                  >
                    {folder.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Tags */}
          <div className="relative">
            <button
              onClick={() => {
                setShowTagDropdown(!showTagDropdown);
                setShowFolderDropdown(false);
              }}
              disabled={loading}
              className="px-3 py-1.5 bg-slate-700 text-slate-200 rounded-lg hover:bg-slate-600 disabled:opacity-50 text-sm flex items-center gap-1"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
              </svg>
              <span className="hidden sm:inline">Tags</span>
            </button>

            {showTagDropdown && (
              <div className="absolute bottom-full mb-2 left-0 w-56 bg-slate-700 rounded-lg shadow-xl border border-slate-600 overflow-hidden">
                {/* Action toggle */}
                <div className="flex border-b border-slate-600">
                  <button
                    onClick={() => setTagAction("add")}
                    className={`flex-1 px-3 py-2 text-sm ${
                      tagAction === "add"
                        ? "bg-emerald-600 text-white"
                        : "text-slate-300 hover:bg-slate-600"
                    }`}
                  >
                    Add Tag
                  </button>
                  <button
                    onClick={() => setTagAction("remove")}
                    className={`flex-1 px-3 py-2 text-sm ${
                      tagAction === "remove"
                        ? "bg-red-600 text-white"
                        : "text-slate-300 hover:bg-slate-600"
                    }`}
                  >
                    Remove Tag
                  </button>
                </div>

                {/* Tag list */}
                <div className="max-h-48 overflow-y-auto">
                  {tags.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-slate-400">No tags available</div>
                  ) : (
                    tags.map((tag) => (
                      <button
                        key={tag.id}
                        onClick={() => handleTagAction(tag.id)}
                        className="w-full px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-600 flex items-center gap-2"
                      >
                        <span
                          className="w-3 h-3 rounded-full flex-shrink-0"
                          style={{ backgroundColor: tag.color }}
                        />
                        {tag.name}
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Export Kits */}
          <button
            onClick={handleExportKits}
            disabled={loading}
            className="px-3 py-1.5 bg-slate-700 text-slate-200 rounded-lg hover:bg-slate-600 disabled:opacity-50 text-sm flex items-center gap-1"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span className="hidden sm:inline">Export Kits</span>
          </button>

          {/* Delete */}
          <div className="relative">
            {showDeleteConfirm ? (
              <div className="flex items-center gap-2 bg-red-900/50 px-3 py-1.5 rounded-lg">
                <span className="text-red-200 text-sm">Delete {selectedCount}?</span>
                <button
                  onClick={handleDelete}
                  disabled={loading}
                  className="px-2 py-1 bg-red-600 text-white rounded text-xs hover:bg-red-700"
                >
                  Yes
                </button>
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  disabled={loading}
                  className="px-2 py-1 bg-slate-600 text-white rounded text-xs hover:bg-slate-500"
                >
                  No
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                disabled={loading}
                className="px-3 py-1.5 bg-red-900/50 text-red-200 rounded-lg hover:bg-red-900 disabled:opacity-50 text-sm flex items-center gap-1"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                <span className="hidden sm:inline">Delete</span>
              </button>
            )}
          </div>

          {/* Cancel */}
          <button
            onClick={onCancel}
            disabled={loading}
            className="px-3 py-1.5 text-slate-400 hover:text-white disabled:opacity-50 text-sm"
          >
            Cancel
          </button>
        </div>
      </div>

      {/* Loading overlay */}
      {loading && (
        <div className="absolute inset-0 bg-slate-800/80 flex items-center justify-center">
          <svg className="w-6 h-6 text-white animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        </div>
      )}
    </div>
  );
}
