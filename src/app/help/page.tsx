"use client";

import React from "react";
import Link from "next/link";

export default function HelpPage() {
  return (
    <div className="min-h-screen bg-slate-900">
      {/* Header */}
      <header className="bg-slate-800 border-b border-slate-700 px-4 py-3">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <span className="text-xl">🧵</span>
            <span className="text-white font-semibold">Modern Mesh</span>
          </Link>
          <Link
            href="/"
            className="px-4 py-2 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600"
          >
            Back to Designs
          </Link>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold text-white mb-8">User Guide</h1>

        {/* Table of Contents */}
        <nav className="bg-slate-800 rounded-xl p-6 mb-8">
          <h2 className="text-lg font-semibold text-white mb-4">Quick Navigation</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {[
              { id: "getting-started", label: "Getting Started" },
              { id: "drawing-tools", label: "Drawing Tools" },
              { id: "selection-tools", label: "Selection Tools" },
              { id: "text-tool", label: "Text Tool" },
              { id: "shape-tool", label: "Shape Tool" },
              { id: "image-import", label: "Image Import" },
              { id: "color-picker", label: "Color Picker" },
              { id: "canvas-management", label: "Canvas Management" },
              { id: "zoom-pan", label: "Zoom & Pan" },
              { id: "export", label: "Export Options" },
              { id: "design-management", label: "Design Management" },
              { id: "keyboard-shortcuts", label: "Keyboard Shortcuts" },
            ].map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                className="text-sm text-rose-400 hover:text-rose-300"
              >
                {item.label}
              </a>
            ))}
          </div>
        </nav>

        {/* Sections */}
        <div className="space-y-12 text-slate-300">
          {/* Getting Started */}
          <section id="getting-started">
            <h2 className="text-2xl font-bold text-white mb-4 pb-2 border-b border-slate-700">
              1. Getting Started
            </h2>
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-white">Creating a New Design</h3>
              <ol className="list-decimal list-inside space-y-2 ml-4">
                <li>Click the <strong className="text-white">"New Design"</strong> button on the home page</li>
                <li>Enter a name for your design</li>
                <li>Optionally select or create a folder</li>
                <li>Click <strong className="text-white">Create</strong></li>
              </ol>
              <p>Your design will start with a default canvas size of 112 x 112 stitches (8" x 8" at 14 mesh).</p>

              <h3 className="text-lg font-semibold text-white mt-6">The Editor Interface</h3>
              <ul className="list-disc list-inside space-y-2 ml-4">
                <li><strong className="text-white">Left Panel</strong>: Color Picker - select and manage colors</li>
                <li><strong className="text-white">Center</strong>: Canvas - your design workspace</li>
                <li><strong className="text-white">Right Panel</strong>: Metrics Panel - design info and yarn calculations</li>
                <li><strong className="text-white">Top Toolbar</strong>: Drawing tools and actions</li>
              </ul>
              <p className="text-sm text-slate-400">On mobile, side panels are accessible via the bottom navigation bar.</p>
            </div>
          </section>

          {/* Drawing Tools */}
          <section id="drawing-tools">
            <h2 className="text-2xl font-bold text-white mb-4 pb-2 border-b border-slate-700">
              2. Drawing Tools
            </h2>
            <div className="space-y-4">
              <div className="grid gap-4">
                {[
                  { icon: "✏️", name: "Pencil", desc: "Draw single pixels. Click to place, drag to draw lines. Dragging also pans the canvas." },
                  { icon: "🖌️", name: "Brush", desc: "Paint multiple pixels at once. Use +/- buttons to adjust size (1-10 pixels)." },
                  { icon: "🧼", name: "Eraser", desc: "Remove color from pixels. Choose S (1), M (3), or L (7) stitch size." },
                  { icon: "🪣", name: "Fill", desc: "Flood-fill connected areas with the current color." },
                  { icon: "⬜", name: "Rectangle", desc: "Click and drag to draw filled rectangles." },
                  { icon: "💧", name: "Eyedropper", desc: "Click any pixel to pick its color. Auto-switches to Pencil after." },
                ].map((tool) => (
                  <div key={tool.name} className="flex items-start gap-3 p-3 bg-slate-800 rounded-lg">
                    <span className="text-2xl">{tool.icon}</span>
                    <div>
                      <p className="text-white font-medium">{tool.name}</p>
                      <p className="text-sm text-slate-400">{tool.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Selection Tools */}
          <section id="selection-tools">
            <h2 className="text-2xl font-bold text-white mb-4 pb-2 border-b border-slate-700">
              3. Selection Tools
            </h2>
            <div className="space-y-4">
              <div className="grid gap-4">
                <div className="flex items-start gap-3 p-3 bg-slate-800 rounded-lg">
                  <span className="text-2xl">⬚</span>
                  <div>
                    <p className="text-white font-medium">Select Tool</p>
                    <p className="text-sm text-slate-400">Click and drag to select a rectangular area. Click inside an existing selection and drag to move it.</p>
                  </div>
                </div>
                <div className="flex items-start gap-3 p-3 bg-slate-800 rounded-lg">
                  <span className="text-2xl">🪄</span>
                  <div>
                    <p className="text-white font-medium">Magic Wand</p>
                    <p className="text-sm text-slate-400">Click to select all connected pixels of the same color.</p>
                  </div>
                </div>
              </div>

              <h3 className="text-lg font-semibold text-white mt-6">Selection Actions</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-700">
                      <th className="text-left py-2 text-white">Action</th>
                      <th className="text-left py-2 text-white">Shortcut</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700">
                    <tr><td className="py-2">Copy</td><td className="py-2 text-slate-400">Ctrl+C / Cmd+C</td></tr>
                    <tr><td className="py-2">Cut</td><td className="py-2 text-slate-400">Ctrl+X / Cmd+X</td></tr>
                    <tr><td className="py-2">Paste</td><td className="py-2 text-slate-400">Ctrl+V / Cmd+V</td></tr>
                    <tr><td className="py-2">Delete</td><td className="py-2 text-slate-400">Delete / Backspace</td></tr>
                  </tbody>
                </table>
              </div>

              <h3 className="text-lg font-semibold text-white mt-6">Center Alignment</h3>
              <p>When moving a selection, <strong className="text-white">green guide lines</strong> appear when your selection is centered horizontally or vertically on the canvas. Use the <strong className="text-white">Center</strong> button in the toolbar to instantly center your selection.</p>
            </div>
          </section>

          {/* Text Tool */}
          <section id="text-tool">
            <h2 className="text-2xl font-bold text-white mb-4 pb-2 border-b border-slate-700">
              4. Text Tool
            </h2>
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-white">How to Add Text</h3>
              <ol className="list-decimal list-inside space-y-2 ml-4">
                <li>Click the <strong className="text-white">Text (Aa)</strong> button in the header</li>
                <li>Enter your text and configure options</li>
                <li>Click <strong className="text-white">"Add to Canvas"</strong></li>
                <li>Click on the canvas to place the text</li>
                <li>Press <strong className="text-white">Escape</strong> to cancel</li>
              </ol>

              <h3 className="text-lg font-semibold text-white mt-6">Available Fonts</h3>
              <div className="grid grid-cols-2 gap-2 text-sm">
                {["Sans Serif", "Serif", "Monospace", "Block", "Script", "Rounded", "Narrow", "Classic", "Handwritten", "Stencil"].map((font) => (
                  <div key={font} className="px-3 py-2 bg-slate-800 rounded">{font}</div>
                ))}
              </div>

              <h3 className="text-lg font-semibold text-white mt-6">Text Options</h3>
              <ul className="list-disc list-inside space-y-2 ml-4">
                <li><strong className="text-white">Height</strong>: Text height in stitches (6-100)</li>
                <li><strong className="text-white">Bold/Italic</strong>: Style toggles</li>
                <li><strong className="text-white">Border</strong>: Add a border around the text</li>
                <li><strong className="text-white">Padding</strong>: Space between text and border</li>
              </ul>
            </div>
          </section>

          {/* Shape Tool */}
          <section id="shape-tool">
            <h2 className="text-2xl font-bold text-white mb-4 pb-2 border-b border-slate-700">
              5. Shape Tool
            </h2>
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-white">Available Shapes</h3>
              <div className="grid grid-cols-3 md:grid-cols-5 gap-2 text-sm text-center">
                {["Heart", "Circle", "Square", "Rectangle", "Oval", "Diamond", "Triangle", "Arrow", "Hexagon", "Star", "Moon", "Flower", "Bow", "Cross"].map((shape) => (
                  <div key={shape} className="px-3 py-2 bg-slate-800 rounded">{shape}</div>
                ))}
              </div>

              <h3 className="text-lg font-semibold text-white mt-6">Shape Options</h3>
              <ul className="list-disc list-inside space-y-2 ml-4">
                <li><strong className="text-white">Keep Aspect Ratio</strong>: Lock proportions (default ON)</li>
                <li><strong className="text-white">Size</strong>: 5-100 stitches when locked</li>
                <li><strong className="text-white">Width/Height</strong>: Independent control when unlocked</li>
              </ul>
            </div>
          </section>

          {/* Image Import */}
          <section id="image-import">
            <h2 className="text-2xl font-bold text-white mb-4 pb-2 border-b border-slate-700">
              6. Image Import
            </h2>
            <div className="space-y-4">
              <ol className="list-decimal list-inside space-y-2 ml-4">
                <li>Click the <strong className="text-white">Import</strong> button in the header</li>
                <li>Select an image file</li>
                <li>Adjust <strong className="text-white">Maximum Colors</strong> slider (2-64)</li>
                <li>Toggle <strong className="text-white">"Treat white as empty"</strong> for background removal</li>
                <li>Click <strong className="text-white">Import</strong></li>
              </ol>

              <div className="p-4 bg-slate-800 rounded-lg mt-4">
                <p className="text-white font-medium mb-2">Tips for Better Imports</p>
                <ul className="list-disc list-inside space-y-1 text-sm text-slate-400">
                  <li>Use images with good contrast</li>
                  <li>Simple images with fewer colors work best</li>
                  <li>Use "treat white as empty" for photos with plain backgrounds</li>
                  <li>Use Remove Color feature after import to clean up</li>
                </ul>
              </div>
            </div>
          </section>

          {/* Color Picker */}
          <section id="color-picker">
            <h2 className="text-2xl font-bold text-white mb-4 pb-2 border-b border-slate-700">
              7. Color Picker
            </h2>
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-white">Selecting Colors</h3>
              <p>Click any color swatch in the Colors panel to select it. Use the <strong className="text-white">Search</strong> box to find colors by DMC number or name.</p>

              <h3 className="text-lg font-semibold text-white mt-6">Tabs</h3>
              <ul className="list-disc list-inside space-y-2 ml-4">
                <li><strong className="text-white">Used</strong>: Colors currently in your design</li>
                <li><strong className="text-white">All Colors</strong>: Complete DMC Pearl Cotton palette</li>
              </ul>

              <h3 className="text-lg font-semibold text-white mt-6">Replace Color</h3>
              <p>Replace all instances of one color with another throughout your design.</p>

              <h3 className="text-lg font-semibold text-white mt-6">Remove Color</h3>
              <p>Delete all instances of a color from your design. Useful for removing backgrounds from imports.</p>
            </div>
          </section>

          {/* Canvas Management */}
          <section id="canvas-management">
            <h2 className="text-2xl font-bold text-white mb-4 pb-2 border-b border-slate-700">
              8. Canvas Management
            </h2>
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-white">Resizing</h3>
              <ol className="list-decimal list-inside space-y-2 ml-4">
                <li>Click the <strong className="text-white">Resize</strong> button</li>
                <li>Choose a preset or enter custom dimensions</li>
                <li>Select mesh count (14 or 18)</li>
                <li>Check <strong className="text-white">"Scale Content"</strong> to resize your design with the canvas</li>
              </ol>

              <h3 className="text-lg font-semibold text-white mt-6">Preset Sizes</h3>
              <div className="grid grid-cols-2 gap-2 text-sm">
                {[
                  "Coaster (4×4)",
                  "Small Ornament (5×5)",
                  "Ornament (6×6)",
                  "Square 8\" (8×8)",
                  "Square 10\" (10×10)",
                  "Pillow 12\" (12×12)",
                ].map((preset) => (
                  <div key={preset} className="px-3 py-2 bg-slate-800 rounded">{preset}</div>
                ))}
              </div>

              <h3 className="text-lg font-semibold text-white mt-6">Transform Options</h3>
              <ul className="list-disc list-inside space-y-2 ml-4">
                <li><strong className="text-white">Flip Horizontal</strong>: Mirror left-to-right</li>
                <li><strong className="text-white">Flip Vertical</strong>: Mirror top-to-bottom</li>
                <li><strong className="text-white">Rotate 90°</strong>: Rotate clockwise</li>
              </ul>
            </div>
          </section>

          {/* Zoom & Pan */}
          <section id="zoom-pan">
            <h2 className="text-2xl font-bold text-white mb-4 pb-2 border-b border-slate-700">
              9. Zoom & Pan
            </h2>
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-white">Zooming</h3>
              <ul className="list-disc list-inside space-y-2 ml-4">
                <li><strong className="text-white">Mouse wheel</strong>: Hold Ctrl/Cmd and scroll</li>
                <li><strong className="text-white">Pinch gesture</strong>: Two fingers on touch devices</li>
                <li><strong className="text-white">Reset button</strong>: Click the circular arrow in toolbar</li>
              </ul>

              <h3 className="text-lg font-semibold text-white mt-6">Panning</h3>
              <ul className="list-disc list-inside space-y-2 ml-4">
                <li><strong className="text-white">Pencil tool</strong>: Click and drag (activates after 6+ pixels)</li>
                <li><strong className="text-white">Two-finger drag</strong>: On touch devices</li>
              </ul>

              <h3 className="text-lg font-semibold text-white mt-6">Display Options</h3>
              <ul className="list-disc list-inside space-y-2 ml-4">
                <li><strong className="text-white">Grid toggle</strong>: Show/hide pixel grid lines</li>
                <li><strong className="text-white">Symbols toggle</strong>: Show/hide color symbols on pixels</li>
              </ul>
            </div>
          </section>

          {/* Export */}
          <section id="export">
            <h2 className="text-2xl font-bold text-white mb-4 pb-2 border-b border-slate-700">
              10. Export Options
            </h2>
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-white">PDF Exports</h3>
              <div className="space-y-3">
                <div className="p-3 bg-slate-800 rounded-lg">
                  <p className="text-white font-medium">Print Artwork</p>
                  <p className="text-sm text-slate-400">Full-size, exact proportions, no grid. Best for printing and framing.</p>
                </div>
                <div className="p-3 bg-slate-800 rounded-lg">
                  <p className="text-white font-medium">Stitch Guide</p>
                  <p className="text-sm text-slate-400">Multi-page document with cover, color legend, and gridded pattern with symbols.</p>
                </div>
              </div>

              <h3 className="text-lg font-semibold text-white mt-6">Image Exports</h3>
              <ul className="list-disc list-inside space-y-2 ml-4">
                <li><strong className="text-white">PNG</strong>: High quality, supports transparency</li>
                <li><strong className="text-white">JPEG</strong>: Smaller file size, no transparency</li>
              </ul>
            </div>
          </section>

          {/* Design Management */}
          <section id="design-management">
            <h2 className="text-2xl font-bold text-white mb-4 pb-2 border-b border-slate-700">
              11. Design Management
            </h2>
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-white">Saving</h3>
              <ul className="list-disc list-inside space-y-2 ml-4">
                <li><strong className="text-white">Auto-save</strong>: Runs automatically in the background</li>
                <li><strong className="text-white">Manual save</strong>: Click the Save button in the header</li>
              </ul>

              <h3 className="text-lg font-semibold text-white mt-6">Organizing</h3>
              <ul className="list-disc list-inside space-y-2 ml-4">
                <li><strong className="text-white">Folders</strong>: Create from home page sidebar</li>
                <li><strong className="text-white">Tags</strong>: Apply color-coded tags to designs</li>
                <li><strong className="text-white">Draft/Complete</strong>: Toggle status below design name</li>
              </ul>

              <h3 className="text-lg font-semibold text-white mt-6">Deleting</h3>
              <p>Deleted designs move to <strong className="text-white">Trash</strong> with a 14-day grace period before permanent deletion.</p>
            </div>
          </section>

          {/* Keyboard Shortcuts */}
          <section id="keyboard-shortcuts">
            <h2 className="text-2xl font-bold text-white mb-4 pb-2 border-b border-slate-700">
              12. Keyboard Shortcuts
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700">
                    <th className="text-left py-2 text-white">Action</th>
                    <th className="text-left py-2 text-white">Windows/Linux</th>
                    <th className="text-left py-2 text-white">Mac</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700">
                  <tr><td className="py-2">Undo</td><td className="py-2 text-slate-400">Ctrl+Z</td><td className="py-2 text-slate-400">Cmd+Z</td></tr>
                  <tr><td className="py-2">Redo</td><td className="py-2 text-slate-400">Ctrl+Y</td><td className="py-2 text-slate-400">Cmd+Y</td></tr>
                  <tr><td className="py-2">Copy</td><td className="py-2 text-slate-400">Ctrl+C</td><td className="py-2 text-slate-400">Cmd+C</td></tr>
                  <tr><td className="py-2">Cut</td><td className="py-2 text-slate-400">Ctrl+X</td><td className="py-2 text-slate-400">Cmd+X</td></tr>
                  <tr><td className="py-2">Paste</td><td className="py-2 text-slate-400">Ctrl+V</td><td className="py-2 text-slate-400">Cmd+V</td></tr>
                  <tr><td className="py-2">Select All</td><td className="py-2 text-slate-400">Ctrl+A</td><td className="py-2 text-slate-400">Cmd+A</td></tr>
                  <tr><td className="py-2">Delete</td><td className="py-2 text-slate-400">Delete</td><td className="py-2 text-slate-400">Delete</td></tr>
                  <tr><td className="py-2">Cancel</td><td className="py-2 text-slate-400">Escape</td><td className="py-2 text-slate-400">Escape</td></tr>
                </tbody>
              </table>
            </div>
          </section>

          {/* Mobile */}
          <section id="mobile">
            <h2 className="text-2xl font-bold text-white mb-4 pb-2 border-b border-slate-700">
              13. Mobile & Touch Support
            </h2>
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-white">Touch Gestures</h3>
              <ul className="list-disc list-inside space-y-2 ml-4">
                <li><strong className="text-white">Single tap</strong>: Place pixel / Select</li>
                <li><strong className="text-white">Single finger drag</strong>: Draw / Pan</li>
                <li><strong className="text-white">Two-finger pinch</strong>: Zoom in/out</li>
                <li><strong className="text-white">Two-finger drag</strong>: Pan canvas</li>
              </ul>

              <div className="p-4 bg-slate-800 rounded-lg mt-4">
                <p className="text-white font-medium mb-2">iPad Tip</p>
                <p className="text-sm text-slate-400">Use two fingers to zoom and pan the canvas while keeping single-finger actions for drawing.</p>
              </div>
            </div>
          </section>

        </div>

        {/* Back to top */}
        <div className="mt-12 pt-8 border-t border-slate-700 text-center">
          <a href="#" className="text-rose-400 hover:text-rose-300">Back to top</a>
        </div>
      </main>
    </div>
  );
}
