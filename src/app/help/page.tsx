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
              { id: "custom-design", label: "Custom Design from Photo" },
              { id: "drawing-tools", label: "Drawing Tools" },
              { id: "selection-tools", label: "Selection Tools" },
              { id: "copy-paste", label: "Copy & Paste" },
              { id: "layers", label: "Layers" },
              { id: "text-tool", label: "Text Tool" },
              { id: "shape-tool", label: "Shape Tool" },
              { id: "image-import", label: "Image Import" },
              { id: "color-picker", label: "Color Picker" },
              { id: "canvas-management", label: "Canvas Management" },
              { id: "zoom-pan", label: "Zoom & Pan" },
              { id: "export", label: "Export Options" },
              { id: "design-management", label: "Design Management" },
              { id: "inventory", label: "Inventory & Kits" },
              { id: "keyboard-shortcuts", label: "Keyboard Shortcuts" },
              { id: "mobile", label: "Mobile & Touch" },
              { id: "pwa", label: "Install as App" },
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
                <li>Choose a canvas size preset or enter custom dimensions</li>
                <li>Select mesh count (14 or 18 mesh)</li>
                <li>Optionally select or create a folder</li>
                <li>Click <strong className="text-white">Create</strong></li>
              </ol>

              <h3 className="text-lg font-semibold text-white mt-6">Canvas Size Presets</h3>
              <div className="grid grid-cols-2 gap-2 text-sm">
                {[
                  "Coaster (4×4\")",
                  "Small Ornament (5×5\")",
                  "Ornament (6×6\")",
                  "Square 8\" (8×8\")",
                  "Square 10\" (10×10\")",
                  "Pillow 12\" (12×12\")",
                ].map((preset) => (
                  <div key={preset} className="px-3 py-2 bg-slate-800 rounded">{preset}</div>
                ))}
              </div>

              <h3 className="text-lg font-semibold text-white mt-6">The Editor Interface</h3>
              <ul className="list-disc list-inside space-y-2 ml-4">
                <li><strong className="text-white">Left Panel</strong>: Color Picker - select and manage DMC colors</li>
                <li><strong className="text-white">Center</strong>: Canvas - your design workspace</li>
                <li><strong className="text-white">Right Panel</strong>: Layers and Metrics - manage layers and view design info</li>
                <li><strong className="text-white">Top Toolbar</strong>: Drawing tools, transforms, and display options</li>
                <li><strong className="text-white">Header</strong>: Save, Import, Resize, Text, Shapes, Export</li>
              </ul>
              <p className="text-sm text-slate-400">On mobile, side panels are accessible via the bottom navigation bar.</p>
            </div>
          </section>

          {/* Custom Design from Photo */}
          <section id="custom-design">
            <h2 className="text-2xl font-bold text-white mb-4 pb-2 border-b border-slate-700">
              2. Custom Design from Photo
            </h2>
            <div className="space-y-4">
              <p>Create a needlepoint design from any photo using the 5-step wizard. Click <strong className="text-white">"From Photo"</strong> on the home page to start.</p>

              <h3 className="text-lg font-semibold text-white mt-6">Step 1: Upload</h3>
              <ul className="list-disc list-inside space-y-2 ml-4">
                <li>Drag and drop an image or click to browse</li>
                <li>Supports PNG, JPG, and other common formats</li>
                <li>Preview your image before proceeding</li>
              </ul>

              <h3 className="text-lg font-semibold text-white mt-6">Step 2: Prepare</h3>
              <ul className="list-disc list-inside space-y-2 ml-4">
                <li><strong className="text-white">Crop</strong>: Drag handles to select the area you want to use</li>
                <li><strong className="text-white">Remove Background</strong>: Click on a color in the image to remove it (useful for solid backgrounds)</li>
                <li><strong className="text-white">Tolerance</strong>: Adjust how much color variation is removed</li>
                <li>Rule-of-thirds grid overlay helps with composition</li>
              </ul>

              <h3 className="text-lg font-semibold text-white mt-6">Step 3: Canvas Settings</h3>
              <ul className="list-disc list-inside space-y-2 ml-4">
                <li>Choose from preset canvas sizes or enter custom dimensions</li>
                <li>Select mesh count (14 or 18 mesh)</li>
                <li>Adjust maximum colors (2-64)</li>
                <li>Preview updates to show final stitch count</li>
              </ul>

              <h3 className="text-lg font-semibold text-white mt-6">Step 4: Preview & Adjust Colors</h3>
              <ul className="list-disc list-inside space-y-2 ml-4">
                <li>See how your image will look as a needlepoint pattern</li>
                <li>View detected DMC colors sorted by stitch count</li>
                <li><strong className="text-white">Color Mapping</strong>: Click "Swap" to replace any detected color with a different DMC color</li>
                <li>Preview updates live as you remap colors</li>
              </ul>

              <h3 className="text-lg font-semibold text-white mt-6">Step 5: Create</h3>
              <ul className="list-disc list-inside space-y-2 ml-4">
                <li>Name your design</li>
                <li>Optionally add to a folder</li>
                <li>Click Create to generate your design</li>
                <li>You'll be taken directly to the editor to refine your design</li>
              </ul>

              <div className="p-4 bg-slate-800 rounded-lg mt-4">
                <p className="text-white font-medium mb-2">Tips for Best Results</p>
                <ul className="list-disc list-inside space-y-1 text-sm text-slate-400">
                  <li>High contrast images with distinct colors work best</li>
                  <li>Use background removal for photos with solid backgrounds</li>
                  <li>Start with fewer colors (8-16) for cleaner designs</li>
                  <li>Crop tightly to focus on the main subject</li>
                  <li>You can always refine the design in the editor after creation</li>
                </ul>
              </div>
            </div>
          </section>

          {/* Drawing Tools */}
          <section id="drawing-tools">
            <h2 className="text-2xl font-bold text-white mb-4 pb-2 border-b border-slate-700">
              3. Drawing Tools
            </h2>
            <div className="space-y-4">
              <div className="grid gap-4">
                {[
                  { icon: "✏️", name: "Pencil", desc: "Draw single pixels. Tap to place a pixel, or drag to pan the canvas. After a short hold (~120ms), dragging will draw." },
                  { icon: "✋", name: "Pan", desc: "Move around the canvas without drawing. Perfect for navigating large designs or touch devices." },
                  { icon: "🖌️", name: "Brush", desc: "Paint multiple pixels at once. Use +/- buttons to adjust size (1-10 pixels)." },
                  { icon: "🧼", name: "Eraser", desc: "Remove color from pixels. Choose S (1px), M (3px), or L (7px) size." },
                  { icon: "🪣", name: "Fill", desc: "Flood-fill connected areas with the current color." },
                  { icon: "⬜", name: "Rectangle", desc: "Click and drag to draw filled rectangles with the current color." },
                  { icon: "💧", name: "Eyedropper", desc: "Click any pixel to pick its color. Automatically switches to Pencil tool after picking." },
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
              4. Selection Tools
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
              <ul className="list-disc list-inside space-y-2 ml-4">
                <li><strong className="text-white">Center</strong>: Instantly center the selection on the canvas</li>
                <li><strong className="text-white">Delete</strong>: Remove all pixels within the selection</li>
                <li><strong className="text-white">Deselect</strong>: Clear the current selection</li>
              </ul>

              <h3 className="text-lg font-semibold text-white mt-6">Transform on Selection</h3>
              <p>When you have an active selection, the transform tools (Flip H, Flip V, Rotate) will only affect the selected area, not the entire canvas.</p>

              <h3 className="text-lg font-semibold text-white mt-6">Center Alignment</h3>
              <p>When moving a selection, <strong className="text-white">green guide lines</strong> appear when your selection is centered horizontally or vertically on the canvas. Use the <strong className="text-white">Center</strong> button in the toolbar to instantly center your selection.</p>
            </div>
          </section>

          {/* Copy & Paste */}
          <section id="copy-paste">
            <h2 className="text-2xl font-bold text-white mb-4 pb-2 border-b border-slate-700">
              5. Copy & Paste
            </h2>
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-white">Copying</h3>
              <ol className="list-decimal list-inside space-y-2 ml-4">
                <li>Select an area using the Select or Magic Wand tool</li>
                <li>Press <strong className="text-white">Ctrl+C</strong> (or Cmd+C) to copy, or use the copy button in the toolbar</li>
                <li>Use <strong className="text-white">Ctrl+X</strong> (or Cmd+X) to cut (removes the original)</li>
              </ol>

              <h3 className="text-lg font-semibold text-white mt-6">Pasting with Positioning</h3>
              <ol className="list-decimal list-inside space-y-2 ml-4">
                <li>Press <strong className="text-white">Ctrl+V</strong> (or Cmd+V) or click the paste button</li>
                <li>A preview of your pasted content appears following your cursor</li>
                <li>Move your cursor to position the paste exactly where you want it</li>
                <li>Click to place the content</li>
                <li>Press <strong className="text-white">Escape</strong> to cancel</li>
              </ol>

              <h3 className="text-lg font-semibold text-white mt-6">Flip Before Pasting</h3>
              <p>While in paste placement mode, you can flip the content before placing it:</p>
              <ul className="list-disc list-inside space-y-2 ml-4">
                <li><strong className="text-white">↔️ Flip Horizontal</strong>: Mirror the content left-to-right</li>
                <li><strong className="text-white">↕️ Flip Vertical</strong>: Mirror the content top-to-bottom</li>
              </ul>
              <p className="text-sm text-slate-400 mt-2">The flip buttons appear in the blue placement bar at the top of the canvas.</p>
            </div>
          </section>

          {/* Layers */}
          <section id="layers">
            <h2 className="text-2xl font-bold text-white mb-4 pb-2 border-b border-slate-700">
              6. Layers
            </h2>
            <div className="space-y-4">
              <p>Work with up to 10 independent layers, similar to Photoshop or Procreate. Layers allow you to separate different elements of your design for easier editing.</p>

              <h3 className="text-lg font-semibold text-white mt-6">Layer Controls</h3>
              <ul className="list-disc list-inside space-y-2 ml-4">
                <li><strong className="text-white">👁️ Visibility</strong>: Toggle layer visibility on/off</li>
                <li><strong className="text-white">🔒 Lock</strong>: Prevent accidental edits to a layer</li>
                <li><strong className="text-white">Opacity</strong>: Adjust layer transparency (0-100%)</li>
                <li><strong className="text-white">Rename</strong>: Click on layer name to edit</li>
              </ul>

              <h3 className="text-lg font-semibold text-white mt-6">Layer Actions</h3>
              <ul className="list-disc list-inside space-y-2 ml-4">
                <li><strong className="text-white">Add Layer (+)</strong>: Create a new empty layer above</li>
                <li><strong className="text-white">Duplicate</strong>: Copy the current layer</li>
                <li><strong className="text-white">Delete</strong>: Remove a layer (must have at least one)</li>
                <li><strong className="text-white">Reorder</strong>: Drag layers or use arrow buttons to change stacking order</li>
                <li><strong className="text-white">Merge Down</strong>: Combine a layer with the one below it</li>
                <li><strong className="text-white">Flatten All</strong>: Merge all layers into one</li>
              </ul>

              <h3 className="text-lg font-semibold text-white mt-6">Working with Layers</h3>
              <ul className="list-disc list-inside space-y-2 ml-4">
                <li>Click a layer to make it the active layer for drawing</li>
                <li>Layers render from bottom to top (top layers appear in front)</li>
                <li>When saving/exporting, layers are automatically flattened</li>
              </ul>
            </div>
          </section>

          {/* Text Tool */}
          <section id="text-tool">
            <h2 className="text-2xl font-bold text-white mb-4 pb-2 border-b border-slate-700">
              7. Text Tool
            </h2>
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-white">How to Add Text</h3>
              <ol className="list-decimal list-inside space-y-2 ml-4">
                <li>Click the <strong className="text-white">Text (Aa)</strong> button in the header</li>
                <li>Enter your text and configure options</li>
                <li>Preview updates in real-time</li>
                <li>Click <strong className="text-white">"Add to Canvas"</strong></li>
                <li>Position the text preview where you want it</li>
                <li>Use <strong className="text-white">+/-</strong> buttons to resize before placing</li>
                <li>Click to place the text</li>
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
                <li><strong className="text-white">Letter Spacing</strong>: Adjust space between characters</li>
                <li><strong className="text-white">Border</strong>: Add a decorative border around the text</li>
                <li><strong className="text-white">Border Width</strong>: Thickness of the border</li>
                <li><strong className="text-white">Padding</strong>: Space between text and border</li>
              </ul>
            </div>
          </section>

          {/* Shape Tool */}
          <section id="shape-tool">
            <h2 className="text-2xl font-bold text-white mb-4 pb-2 border-b border-slate-700">
              8. Shape Tool
            </h2>
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-white">Available Shapes</h3>
              <div className="grid grid-cols-3 md:grid-cols-5 gap-2 text-sm text-center">
                {["Heart", "Circle", "Square", "Rectangle", "Oval", "Diamond", "Triangle", "Arrow", "Hexagon", "Star", "Moon", "Flower", "Bow", "Cross"].map((shape) => (
                  <div key={shape} className="px-3 py-2 bg-slate-800 rounded">{shape}</div>
                ))}
              </div>

              <h3 className="text-lg font-semibold text-white mt-6">Adding Shapes</h3>
              <ol className="list-decimal list-inside space-y-2 ml-4">
                <li>Click <strong className="text-white">Shapes</strong> in the header</li>
                <li>Select a shape and configure size</li>
                <li>Click <strong className="text-white">"Add to Canvas"</strong></li>
                <li>Position the shape preview where you want it</li>
                <li>Use <strong className="text-white">+/-</strong> buttons to resize before placing</li>
                <li>Click to place the shape</li>
              </ol>

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
              9. Image Import
            </h2>
            <div className="space-y-4">
              <p>Import images directly into your existing design. For creating a new design from a photo, see <a href="#custom-design" className="text-rose-400 hover:text-rose-300">Custom Design from Photo</a>.</p>

              <h3 className="text-lg font-semibold text-white mt-6">Basic Import</h3>
              <ol className="list-decimal list-inside space-y-2 ml-4">
                <li>Click the <strong className="text-white">Import</strong> button in the header</li>
                <li>Select an image file (PNG, JPG, etc.)</li>
                <li>Adjust <strong className="text-white">Maximum Colors</strong> slider (2-64)</li>
                <li>Toggle <strong className="text-white">"Treat white as empty"</strong> for background removal</li>
                <li>Preview shows how the image will look as stitches</li>
                <li>Click <strong className="text-white">Import</strong></li>
              </ol>

              <h3 className="text-lg font-semibold text-white mt-6">Restrict to Existing Palette</h3>
              <p>Check <strong className="text-white">"Use only colors from existing design"</strong> to limit the import to colors already in your design. This is useful for:</p>
              <ul className="list-disc list-inside space-y-2 ml-4">
                <li>Maintaining a consistent color palette across elements</li>
                <li>Working with a limited thread inventory</li>
                <li>Creating cohesive multi-element designs</li>
              </ul>

              <h3 className="text-lg font-semibold text-white mt-6">Color Mapping</h3>
              <p>After the initial import preview, you can remap colors before finalizing:</p>
              <ul className="list-disc list-inside space-y-2 ml-4">
                <li>View all detected colors sorted by stitch count</li>
                <li>Click <strong className="text-white">"Swap"</strong> next to any color to replace it</li>
                <li>Choose from the full DMC palette or search by number/name</li>
                <li>Preview updates instantly to show your changes</li>
                <li>Great for creating color variations of the same image</li>
              </ul>

              <div className="p-4 bg-slate-800 rounded-lg mt-4">
                <p className="text-white font-medium mb-2">Tips for Better Imports</p>
                <ul className="list-disc list-inside space-y-1 text-sm text-slate-400">
                  <li>Use images with good contrast</li>
                  <li>Simple images with fewer colors work best</li>
                  <li>Use "treat white as empty" for photos with plain backgrounds</li>
                  <li>Resize your canvas first to control the final stitch count</li>
                  <li>Use Remove Color feature after import to clean up unwanted colors</li>
                  <li>Use color mapping to adjust colors without re-importing</li>
                </ul>
              </div>
            </div>
          </section>

          {/* Color Picker */}
          <section id="color-picker">
            <h2 className="text-2xl font-bold text-white mb-4 pb-2 border-b border-slate-700">
              10. Color Picker
            </h2>
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-white">Selecting Colors</h3>
              <p>Click any color swatch in the Colors panel to select it. The selected color is highlighted with a ring. Use the <strong className="text-white">Search</strong> box to find colors by DMC number or name.</p>

              <h3 className="text-lg font-semibold text-white mt-6">Tabs</h3>
              <ul className="list-disc list-inside space-y-2 ml-4">
                <li><strong className="text-white">Used</strong>: Colors currently in your design (quick access)</li>
                <li><strong className="text-white">All Colors</strong>: Complete DMC Pearl Cotton palette (450+ colors)</li>
              </ul>

              <h3 className="text-lg font-semibold text-white mt-6">Color Actions</h3>
              <ul className="list-disc list-inside space-y-2 ml-4">
                <li><strong className="text-white">Replace Color</strong>: Swap all instances of one color with another throughout your design</li>
                <li><strong className="text-white">Remove Color</strong>: Delete all instances of a color from your design (useful for cleaning up backgrounds)</li>
              </ul>

              <h3 className="text-lg font-semibold text-white mt-6">Eyedropper Tool</h3>
              <p>Select the Eyedropper tool (💧) and click on any pixel in your design to pick that color.</p>
            </div>
          </section>

          {/* Canvas Management */}
          <section id="canvas-management">
            <h2 className="text-2xl font-bold text-white mb-4 pb-2 border-b border-slate-700">
              11. Canvas Management
            </h2>
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-white">Resizing the Canvas</h3>
              <ol className="list-decimal list-inside space-y-2 ml-4">
                <li>Click the <strong className="text-white">Resize</strong> button in the header</li>
                <li>Choose a preset size or enter custom dimensions (inches)</li>
                <li>Select mesh count (14 or 18)</li>
                <li>Choose how to handle your existing design (see below)</li>
                <li>Click <strong className="text-white">Apply</strong></li>
              </ol>

              <h3 className="text-lg font-semibold text-white mt-6">Resize Modes</h3>
              <div className="space-y-3">
                <div className="p-3 bg-slate-800 rounded-lg">
                  <p className="text-white font-medium">Scale Design</p>
                  <p className="text-sm text-slate-400">Stretches or shrinks your entire design to fit the new canvas size. Use this when you want to make your design bigger or smaller while keeping the overall composition.</p>
                </div>
                <div className="p-3 bg-slate-800 rounded-lg">
                  <p className="text-white font-medium">Crop / Extend</p>
                  <p className="text-sm text-slate-400">Keeps your design at its current scale. Making the canvas smaller will crop edges; making it larger adds empty space. Use this to adjust canvas boundaries without changing stitch size.</p>
                </div>
              </div>

              <h3 className="text-lg font-semibold text-white mt-6">Anchor Position (Crop/Extend Mode)</h3>
              <p>When using Crop/Extend mode, choose where your design should be anchored:</p>
              <ul className="list-disc list-inside space-y-2 ml-4">
                <li><strong className="text-white">Center</strong> (default): Design stays centered, edges added/removed equally</li>
                <li><strong className="text-white">Corner anchors</strong>: Design anchors to a corner (e.g., top-left keeps top and left edges)</li>
                <li><strong className="text-white">Edge anchors</strong>: Design anchors to an edge (e.g., bottom center adds space at top)</li>
              </ul>
              <p className="text-sm text-slate-400 mt-2">Click the 9-position grid to select an anchor point.</p>

              <h3 className="text-lg font-semibold text-white mt-6">Transform Options</h3>
              <p>Found in the toolbar. When you have a selection, transforms apply only to the selected area. Without a selection, they apply to the entire canvas.</p>
              <ul className="list-disc list-inside space-y-2 ml-4">
                <li><strong className="text-white">↔️ Flip Horizontal</strong>: Mirror left-to-right</li>
                <li><strong className="text-white">↕️ Flip Vertical</strong>: Mirror top-to-bottom</li>
                <li><strong className="text-white">↻ Rotate 90°</strong>: Rotate clockwise</li>
              </ul>

              <h3 className="text-lg font-semibold text-white mt-6">Display Options</h3>
              <ul className="list-disc list-inside space-y-2 ml-4">
                <li><strong className="text-white">#️⃣ Grid</strong>: Show/hide pixel grid lines</li>
                <li><strong className="text-white">Aa Symbols</strong>: Show/hide color symbols on pixels (helpful for distinguishing similar colors)</li>
              </ul>
            </div>
          </section>

          {/* Zoom & Pan */}
          <section id="zoom-pan">
            <h2 className="text-2xl font-bold text-white mb-4 pb-2 border-b border-slate-700">
              12. Zoom & Pan
            </h2>
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-white">Zooming</h3>
              <ul className="list-disc list-inside space-y-2 ml-4">
                <li><strong className="text-white">Mouse wheel</strong>: Scroll to zoom in/out (zooms toward cursor)</li>
                <li><strong className="text-white">Pinch gesture</strong>: Two fingers on touch devices</li>
                <li><strong className="text-white">🔄 Reset button</strong>: Click in toolbar to reset to 100% and recenter</li>
              </ul>
              <p className="text-sm text-slate-400">The current zoom level is shown in the toolbar (e.g., "150%").</p>

              <h3 className="text-lg font-semibold text-white mt-6">Panning</h3>
              <ul className="list-disc list-inside space-y-2 ml-4">
                <li><strong className="text-white">✋ Pan tool</strong>: Click and drag to move the canvas freely</li>
                <li><strong className="text-white">Pencil tool</strong>: Drag to pan (activates after ~6 pixels of movement)</li>
                <li><strong className="text-white">Two-finger drag</strong>: On touch devices</li>
              </ul>

              <div className="p-4 bg-slate-800 rounded-lg mt-4">
                <p className="text-white font-medium mb-2">Pro Tip</p>
                <p className="text-sm text-slate-400">Use the Pan tool (✋) when navigating large designs. It's dedicated to movement only, so you won't accidentally draw.</p>
              </div>
            </div>
          </section>

          {/* Export */}
          <section id="export">
            <h2 className="text-2xl font-bold text-white mb-4 pb-2 border-b border-slate-700">
              13. Export Options
            </h2>
            <div className="space-y-4">
              <p>Click the <strong className="text-white">Export</strong> button in the header to access export options.</p>

              <h3 className="text-lg font-semibold text-white mt-6">PDF Exports</h3>
              <div className="space-y-3">
                <div className="p-3 bg-slate-800 rounded-lg">
                  <p className="text-white font-medium">Print Artwork</p>
                  <p className="text-sm text-slate-400">Full-size PDF at exact proportions, no grid lines. Perfect for printing on canvas or framing.</p>
                </div>
                <div className="p-3 bg-slate-800 rounded-lg">
                  <p className="text-white font-medium">Stitch Guide</p>
                  <p className="text-sm text-slate-400">Multi-page document with cover page, color legend with DMC numbers, and gridded pattern with symbols. Essential for stitching.</p>
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
              14. Design Management
            </h2>
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-white">Saving</h3>
              <ul className="list-disc list-inside space-y-2 ml-4">
                <li><strong className="text-white">Auto-save</strong>: Your work is automatically saved in the background</li>
                <li><strong className="text-white">Manual save</strong>: Click the Save button in the header anytime</li>
              </ul>

              <h3 className="text-lg font-semibold text-white mt-6">Organizing</h3>
              <ul className="list-disc list-inside space-y-2 ml-4">
                <li><strong className="text-white">Folders</strong>: Create folders from the home page sidebar to group related designs</li>
                <li><strong className="text-white">Tags</strong>: Apply color-coded tags for easy filtering</li>
                <li><strong className="text-white">Draft/Complete</strong>: Toggle status to track work in progress</li>
              </ul>

              <h3 className="text-lg font-semibold text-white mt-6">Categorization</h3>
              <p>Organize designs for customers by setting:</p>
              <ul className="list-disc list-inside space-y-2 ml-4">
                <li><strong className="text-white">Skill Level</strong>: Easy, Intermediate, or Advanced</li>
                <li><strong className="text-white">Size Category</strong>: Small, Medium, or Large</li>
              </ul>
              <p className="text-sm text-slate-400 mt-2">Use the filter buttons on the home page to show designs by skill level or size.</p>

              <h3 className="text-lg font-semibold text-white mt-6">Design Cards</h3>
              <p>Each design card on the home page shows:</p>
              <ul className="list-disc list-inside space-y-2 ml-4">
                <li>Preview image</li>
                <li>Design name</li>
                <li>Dimensions (e.g., 8" × 8")</li>
                <li>Total stitch count</li>
                <li>Tags and folder</li>
              </ul>

              <h3 className="text-lg font-semibold text-white mt-6">Deleting</h3>
              <p>Deleted designs move to <strong className="text-white">Trash</strong> where they're kept for 14 days before permanent deletion. You can restore designs from the trash at any time during this period.</p>
            </div>
          </section>

          {/* Inventory & Kits */}
          <section id="inventory">
            <h2 className="text-2xl font-bold text-white mb-4 pb-2 border-b border-slate-700">
              15. Inventory & Kits
            </h2>
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-white">Thread Inventory</h3>
              <p>Track your DMC Pearl Cotton thread inventory from the <strong className="text-white">Inventory</strong> page (accessible from the sidebar).</p>
              <ul className="list-disc list-inside space-y-2 ml-4">
                <li>Add thread by DMC number and size (5 or 8)</li>
                <li>Track skein quantities</li>
                <li>See which designs use each color</li>
                <li>Get low stock alerts</li>
                <li>Search and filter by color</li>
              </ul>

              <h3 className="text-lg font-semibold text-white mt-6">Color Usage View</h3>
              <p>Toggle to <strong className="text-white">"By Color"</strong> view to see yarn usage across all designs:</p>
              <ul className="list-disc list-inside space-y-2 ml-4">
                <li>Total yards and skeins needed for each color</li>
                <li>Breakdown by design (click to expand)</li>
                <li>Quick links to design editor or kit page</li>
                <li>Shows skeins in stock vs. needed</li>
              </ul>

              <h3 className="text-lg font-semibold text-white mt-6">Kit View</h3>
              <p>Each design has a <strong className="text-white">Kit</strong> page showing all materials needed:</p>
              <ul className="list-disc list-inside space-y-2 ml-4">
                <li>Canvas size and type</li>
                <li>Complete thread list with DMC numbers</li>
                <li>Skeins needed per color</li>
                <li>Inventory status (in stock / need to order)</li>
                <li>Total yarn requirements</li>
              </ul>

              <h3 className="text-lg font-semibold text-white mt-6">Shopping List Export</h3>
              <p>Export shopping lists for easy restocking:</p>
              <ul className="list-disc list-inside space-y-2 ml-4">
                <li><strong className="text-white">From Inventory</strong>: Click "Print Low Stock" to get a printable list of items to reorder</li>
                <li><strong className="text-white">From Kit Page</strong>: Click the print or CSV button to export the kit's thread requirements</li>
                <li><strong className="text-white">Print Format</strong>: Opens a printable page with checkboxes and color swatches</li>
                <li><strong className="text-white">CSV Format</strong>: Downloads a spreadsheet-compatible file with DMC numbers, colors, and quantities</li>
              </ul>

              <h3 className="text-lg font-semibold text-white mt-6">Kits Page</h3>
              <p>The <strong className="text-white">Kits</strong> page shows all designs grouped by collection/folder with:</p>
              <ul className="list-disc list-inside space-y-2 ml-4">
                <li>Kits ready count (assembled kits awaiting sale)</li>
                <li>Canvas printed count</li>
                <li>Quick access to kit details</li>
                <li>Record kit sales</li>
              </ul>

              <h3 className="text-lg font-semibold text-white mt-6">Kit Sales</h3>
              <p>Track sales history and automatically update inventory when recording a kit sale.</p>
            </div>
          </section>

          {/* Keyboard Shortcuts */}
          <section id="keyboard-shortcuts">
            <h2 className="text-2xl font-bold text-white mb-4 pb-2 border-b border-slate-700">
              16. Keyboard Shortcuts
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
                  <tr><td className="py-2">Redo</td><td className="py-2 text-slate-400">Ctrl+Y or Ctrl+Shift+Z</td><td className="py-2 text-slate-400">Cmd+Y or Cmd+Shift+Z</td></tr>
                  <tr><td className="py-2">Copy</td><td className="py-2 text-slate-400">Ctrl+C</td><td className="py-2 text-slate-400">Cmd+C</td></tr>
                  <tr><td className="py-2">Cut</td><td className="py-2 text-slate-400">Ctrl+X</td><td className="py-2 text-slate-400">Cmd+X</td></tr>
                  <tr><td className="py-2">Paste (with positioning)</td><td className="py-2 text-slate-400">Ctrl+V</td><td className="py-2 text-slate-400">Cmd+V</td></tr>
                  <tr><td className="py-2">Select All</td><td className="py-2 text-slate-400">Ctrl+A</td><td className="py-2 text-slate-400">Cmd+A</td></tr>
                  <tr><td className="py-2">Delete Selection</td><td className="py-2 text-slate-400">Delete / Backspace</td><td className="py-2 text-slate-400">Delete / Backspace</td></tr>
                  <tr><td className="py-2">Cancel (placement, move, etc.)</td><td className="py-2 text-slate-400">Escape</td><td className="py-2 text-slate-400">Escape</td></tr>
                </tbody>
              </table>
            </div>
          </section>

          {/* Mobile */}
          <section id="mobile">
            <h2 className="text-2xl font-bold text-white mb-4 pb-2 border-b border-slate-700">
              17. Mobile & Touch Support
            </h2>
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-white">Touch Gestures</h3>
              <ul className="list-disc list-inside space-y-2 ml-4">
                <li><strong className="text-white">Tap and hold</strong>: Place a single pixel (requires ~120ms hold to prevent accidental drawing)</li>
                <li><strong className="text-white">Single finger drag</strong>: Pan the canvas (with Pencil tool) or draw (with Brush/Eraser)</li>
                <li><strong className="text-white">Two-finger pinch</strong>: Zoom in/out centered on your fingers</li>
                <li><strong className="text-white">Two-finger drag</strong>: Pan canvas while zooming</li>
              </ul>

              <h3 className="text-lg font-semibold text-white mt-6">Mobile Interface</h3>
              <ul className="list-disc list-inside space-y-2 ml-4">
                <li><strong className="text-white">Bottom Bar</strong>: Quick access to Colors, Layers, and Design Info panels</li>
                <li><strong className="text-white">Panels</strong>: Open as slide-up drawers from the bottom</li>
                <li><strong className="text-white">Toolbar</strong>: Scrolls horizontally on smaller screens</li>
              </ul>

              <div className="p-4 bg-slate-800 rounded-lg mt-4">
                <p className="text-white font-medium mb-2">iPad Tip</p>
                <p className="text-sm text-slate-400">Use the <strong>Pan tool (✋)</strong> when you want to navigate without accidentally placing pixels. Two fingers always pan and zoom regardless of the active tool.</p>
              </div>

              <div className="p-4 bg-slate-800 rounded-lg mt-4">
                <p className="text-white font-medium mb-2">Precision Drawing</p>
                <p className="text-sm text-slate-400">Zoom in close for precise pixel placement. The grid lines become visible at higher zoom levels.</p>
              </div>
            </div>
          </section>

          {/* PWA Installation */}
          <section id="pwa">
            <h2 className="text-2xl font-bold text-white mb-4 pb-2 border-b border-slate-700">
              18. Install as App
            </h2>
            <div className="space-y-4">
              <p>Modern Mesh can be installed as an app on your phone, tablet, or computer for quick access and offline capabilities.</p>

              <h3 className="text-lg font-semibold text-white mt-6">Installing on iPhone/iPad</h3>
              <ol className="list-decimal list-inside space-y-2 ml-4">
                <li>Open Modern Mesh in Safari</li>
                <li>Tap the Share button (square with arrow)</li>
                <li>Scroll down and tap <strong className="text-white">"Add to Home Screen"</strong></li>
                <li>Tap <strong className="text-white">Add</strong></li>
              </ol>

              <h3 className="text-lg font-semibold text-white mt-6">Installing on Android</h3>
              <ol className="list-decimal list-inside space-y-2 ml-4">
                <li>Open Modern Mesh in Chrome</li>
                <li>Tap the menu (three dots)</li>
                <li>Tap <strong className="text-white">"Add to Home screen"</strong> or <strong className="text-white">"Install app"</strong></li>
                <li>Follow the prompts to install</li>
              </ol>

              <h3 className="text-lg font-semibold text-white mt-6">Installing on Desktop</h3>
              <ol className="list-decimal list-inside space-y-2 ml-4">
                <li>Open Modern Mesh in Chrome, Edge, or another compatible browser</li>
                <li>Look for the install icon in the address bar (or menu)</li>
                <li>Click <strong className="text-white">"Install"</strong></li>
              </ol>

              <h3 className="text-lg font-semibold text-white mt-6">Getting Updates</h3>
              <p>The app automatically checks for updates. When a new version is available:</p>
              <ul className="list-disc list-inside space-y-2 ml-4">
                <li>A notification banner appears at the top of the screen</li>
                <li>Click <strong className="text-white">"Refresh Now"</strong> to get the latest version</li>
                <li>Your work is preserved during updates</li>
              </ul>

              <div className="p-4 bg-slate-800 rounded-lg mt-4">
                <p className="text-white font-medium mb-2">Benefits of Installing</p>
                <ul className="list-disc list-inside space-y-1 text-sm text-slate-400">
                  <li>Launch directly from your home screen or dock</li>
                  <li>Full-screen experience without browser controls</li>
                  <li>Faster loading after initial install</li>
                  <li>Works even with spotty internet connection</li>
                </ul>
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
