# Modern Mesh Image Creator - User Guide

A comprehensive guide to using the Modern Mesh Image Creator application for designing needlepoint and cross-stitch patterns.

---

## Table of Contents

1. [Getting Started](#1-getting-started)
2. [Drawing Tools](#2-drawing-tools)
3. [Selection Tools](#3-selection-tools)
4. [Text Tool](#4-text-tool)
5. [Shape Tool](#5-shape-tool)
6. [Image Import](#6-image-import)
7. [Color Picker](#7-color-picker)
8. [Canvas Management](#8-canvas-management)
9. [Zoom and Pan Controls](#9-zoom-and-pan-controls)
10. [Export Options](#10-export-options)
11. [Design Management](#11-design-management)
12. [Metrics Panel](#12-metrics-panel)
13. [Keyboard Shortcuts](#13-keyboard-shortcuts)
14. [Mobile and Touch Support](#14-mobile-and-touch-support)
15. [Inventory Integration](#15-inventory-integration)
16. [Troubleshooting](#16-troubleshooting)

---

## 1. Getting Started

### Creating a New Design

1. Click the **"New Design"** button on the home page
2. Enter a name for your design
3. Optionally select or create a folder to organize it
4. Click **Create**

Your design will start with a default canvas size of 112 x 112 stitches (8" x 8" at 14 mesh).

### The Editor Interface

The editor has three main areas:

- **Left Panel (Desktop)**: Color Picker - select and manage colors
- **Center**: Canvas - your design workspace
- **Right Panel (Desktop)**: Metrics Panel - design info and yarn calculations
- **Top Toolbar**: Drawing tools and actions
- **Header**: Design name, save, export, and additional tools

On mobile devices, the side panels are accessible via the bottom navigation bar.

---

## 2. Drawing Tools

Access all drawing tools from the main toolbar at the top of the editor.

### Pencil Tool

- **Purpose**: Draw single pixels one at a time
- **How to use**: Click to place individual pixels, or click and drag to draw continuous lines
- **Special feature**: If you click and drag more than 6 pixels, it switches to pan mode to move the canvas

### Brush Tool

- **Purpose**: Paint multiple pixels at once
- **How to use**: Click and drag to paint
- **Size control**: Use the **+/-** buttons to adjust brush size (1-10 pixels)

### Eraser Tool

- **Purpose**: Remove color from pixels (makes them empty/transparent)
- **How to use**: Click and drag to erase
- **Size options**:
  - **S** = 1 stitch
  - **M** = 3 stitches
  - **L** = 7 stitches

### Fill (Bucket) Tool

- **Purpose**: Fill connected areas with the current color
- **How to use**: Click on any pixel to flood-fill all connected pixels of the same color

### Rectangle Tool

- **Purpose**: Draw filled rectangles
- **How to use**: Click and drag to define the rectangle size

### Eyedropper Tool

- **Purpose**: Pick a color from the canvas
- **How to use**: Click on any colored pixel to select that DMC color
- **Note**: Automatically switches to Pencil tool after picking a color

---

## 3. Selection Tools

### Select Tool (Rectangle)

- **Purpose**: Select rectangular areas for copying, cutting, moving, or deleting
- **Creating a selection**: Click and drag to define a rectangular area
- **Moving a selection**: Click inside an existing selection and drag to move the pixels to a new location
- **Visual feedback**: Selected areas show a blue translucent overlay

### Magic Wand Tool

- **Purpose**: Select all connected pixels of the same color
- **How to use**: Click on any colored pixel to select all connected pixels of that color
- **Use case**: Great for selecting large areas of a single color quickly

### Selection Actions

When you have an active selection, these options appear in the toolbar:

| Action | Description | Keyboard |
|--------|-------------|----------|
| **Copy** | Copy selected pixels to clipboard | Ctrl+C / Cmd+C |
| **Cut** | Cut selected pixels to clipboard | Ctrl+X / Cmd+X |
| **Paste** | Paste clipboard content | Ctrl+V / Cmd+V |
| **Delete** | Remove selected pixels | Delete / Backspace |
| **Deselect** | Clear the selection | - |

### Moving Selections

1. Create a selection with the Select tool
2. Click **inside** the selection and drag
3. A semi-transparent preview shows where the pixels will land
4. Release to confirm the move
5. Press **Escape** to cancel the move

---

## 4. Text Tool

Add text to your design as stitched pixels.

### How to Add Text

1. Click the **Text (Aa)** button in the header
2. Enter your text in the input field
3. Configure the options (see below)
4. Click **"Add to Canvas"**
5. Click on the canvas where you want to place the text
6. Press **Escape** to cancel placement

### Text Options

| Option | Description |
|--------|-------------|
| **Font** | Choose from 10 available fonts |
| **Height** | Text height in stitches (6-100) |
| **Bold** | Make text heavier/thicker |
| **Italic** | Slant the text |
| **Border** | Add a border around the text |
| **Border Width** | Border thickness (1-5 stitches) |
| **Padding** | Space between text and border (0-10 stitches) |

### Available Fonts

1. **Sans Serif** - Clean, modern (Arial)
2. **Serif** - Traditional, elegant (Georgia)
3. **Monospace** - Fixed-width (Courier New)
4. **Block** - Heavy, bold (Impact)
5. **Script** - Flowing, decorative (Brush Script)
6. **Rounded** - Soft, friendly (Verdana)
7. **Narrow** - Compressed (Arial Narrow)
8. **Classic** - Formal (Palatino)
9. **Handwritten** - Casual (Comic Sans)
10. **Stencil** - Bold, military style

---

## 5. Shape Tool

Add pre-made shapes to your design.

### How to Add a Shape

1. Click the **Shape** button in the header
2. Select a shape from the catalog
3. Adjust the size
4. Click **"Add to Canvas"**
5. Click on the canvas where you want to place the shape
6. Press **Escape** to cancel placement

### Available Shapes

**Basic Shapes (10):**
- Heart, Circle, Square, Rectangle, Oval
- Diamond, Triangle Up, Triangle Down, Arrow, Hexagon

**Decorative Shapes (5):**
- Star, Crescent Moon, Flower, Bow, Cross

### Shape Options

| Option | Description |
|--------|-------------|
| **Keep Aspect Ratio** | When ON, maintains shape proportions |
| **Size** | Single slider when aspect ratio is locked (5-100 stitches) |
| **Width/Height** | Separate controls when aspect ratio is unlocked |

---

## 6. Image Import

Convert photos and images into needlepoint designs.

### How to Import an Image

1. Click the **Import** button in the header
2. Click **"Select Image"** to choose a file
3. Adjust the **Maximum Colors** slider (2-64 colors)
4. Check/uncheck **"Treat white/light backgrounds as empty"**
5. View the live preview on the right
6. Click **Import** to apply

### Import Options

| Option | Description |
|--------|-------------|
| **Maximum Colors** | Fewer = simpler design, More = more detail |
| **Treat white as empty** | Removes white/light backgrounds (default: ON) |

### Tips for Better Imports

- Use images with good contrast
- Simple images with fewer colors work best
- The "treat white as empty" option helps with photos that have plain backgrounds
- Adjust the color slider until the preview looks right
- You can always use the Remove Color feature after import to clean up

---

## 7. Color Picker

The Color Picker panel lets you select and manage DMC Pearl Cotton colors.

### Selecting Colors

1. Open the Colors panel (left sidebar on desktop, bottom drawer on mobile)
2. Click any color swatch to select it
3. The current color displays at the top with its DMC number and name

### Tabs

| Tab | Contents |
|-----|----------|
| **Used** | Only colors currently in your design |
| **All Colors** | Complete DMC Pearl Cotton palette |

### Search

Type in the search box to find colors by:
- DMC number (e.g., "310")
- Color name (e.g., "black", "red")

### Replace Color

Replace one color with another throughout your entire design:

1. Click **"Replace Color"** button
2. Click **"From"** and select the source color
3. Click **"To"** and select the replacement color
4. Click **"Replace All"**

### Remove Color

Delete all instances of a color from your design:

1. Click **"Remove Color"** button
2. Click the color slot and select the color to remove
3. Click **"Remove All Instances"**

This is useful for removing backgrounds from imported images.

### In-Stock Indicator

If you have inventory set up, colors in stock show a green dot in the corner of their swatch.

---

## 8. Canvas Management

### Resizing the Canvas

1. Click the **Resize** button in the header
2. Choose a preset size OR enter custom dimensions
3. Select mesh count (14 or 18)
4. Check **"Scale Content"** to resize your design with the canvas
5. Click **Apply**

### Preset Sizes

| Preset | Size |
|--------|------|
| Coaster | 4" x 4" |
| Small Ornament | 5" x 5" |
| Ornament | 6" x 6" |
| Square 8" | 8" x 8" |
| Square 10" | 10" x 10" |
| Pillow 12" | 12" x 12" |
| Pillow 14" | 14" x 14" |
| Rectangle 9x12 | 9" x 12" |
| Rectangle 12x16 | 12" x 16" |
| Belt | 2" x 36" |

### Mesh Count

- **14 mesh**: 14 stitches per inch (larger stitches, easier to work)
- **18 mesh**: 18 stitches per inch (finer detail, more stitches)

### Transform Options

Available in the toolbar:

| Button | Action |
|--------|--------|
| **Flip Horizontal** | Mirror left-to-right |
| **Flip Vertical** | Mirror top-to-bottom |
| **Rotate 90°** | Rotate clockwise |

---

## 9. Zoom and Pan Controls

### Zooming

| Method | How |
|--------|-----|
| **Mouse wheel** | Hold Ctrl/Cmd and scroll |
| **Pinch gesture** | Two fingers on touch devices |
| **Reset** | Click the reset button (circular arrow) in toolbar |

Zoom range: 10% to 1000%

### Panning

| Method | How |
|--------|-----|
| **Pencil tool** | Click and drag (moves after 6+ pixels) |
| **Two-finger drag** | On touch devices |

### Display Options

| Toggle | Effect |
|--------|--------|
| **Grid** | Show/hide pixel grid lines |
| **Symbols** | Show/hide color symbols on pixels |

Grid lines appear at 50%+ zoom. Heavy lines appear every 10 pixels.

---

## 10. Export Options

Click the **Export** button in the header to access export options.

### PDF Exports

**Print Artwork**
- Full-size, exact proportions
- No grid lines
- Best for printing and framing

**Stitch Guide**
- Multi-page document including:
  - Cover page with design info
  - Color legend with DMC numbers and symbols
  - Gridded pattern with symbols
- Option: "Fit pattern to one page"

### Image Exports

| Format | Best For |
|--------|----------|
| **PNG** | High quality, supports transparency |
| **JPEG** | Smaller file size, no transparency |

Image resolution = grid size x mesh count (e.g., 112x112 at 14 mesh = 1568x1568 pixels)

---

## 11. Design Management

### Saving

- **Auto-save**: Runs automatically in the background
- **Manual save**: Click the Save button in the header
- **Status indicator**: Shows "Saving...", "Saved", or "Save failed"

### Design Status

Toggle between **Draft** and **Complete** using the button below the design name.

### Organizing Designs

**Folders**
- Create folders from the home page sidebar
- Move designs by clicking the folder icon on a design card

**Tags**
- Apply color-coded tags to designs
- Filter by tags on the home page

### Duplicating Designs

Click the duplicate icon on any design card to create a copy.

### Deleting Designs

1. Click the delete icon on a design card
2. Design moves to **Trash** (14-day grace period)
3. Restore from Trash, or let it auto-delete after 14 days
4. Use **Empty Trash** for immediate permanent deletion

---

## 12. Metrics Panel

The Metrics Panel (right sidebar) shows design information and yarn calculations.

### Design Information

- Size (inches)
- Mesh count
- Grid size (stitches)
- Total stitches
- Colors used

### Yarn Calculations

| Setting | Options |
|---------|---------|
| **Stitch Type** | Continental or Basketweave |
| **Buffer** | 0-50% extra yarn for waste/mistakes |

### Yarn by Color

A breakdown showing for each color:
- Color swatch
- DMC number
- Stitch count
- Yards needed
- Skeins needed

---

## 13. Keyboard Shortcuts

| Action | Windows/Linux | Mac |
|--------|---------------|-----|
| Undo | Ctrl+Z | Cmd+Z |
| Redo | Ctrl+Y | Cmd+Y |
| Redo (alt) | Ctrl+Shift+Z | Cmd+Shift+Z |
| Copy | Ctrl+C | Cmd+C |
| Cut | Ctrl+X | Cmd+X |
| Paste | Ctrl+V | Cmd+V |
| Select All | Ctrl+A | Cmd+A |
| Delete | Delete or Backspace | Delete |
| Cancel | Escape | Escape |

**Note**: Most shortcuts are disabled when typing in input fields. Undo/Redo work everywhere.

---

## 14. Mobile and Touch Support

### Mobile Layout

- Side panels become bottom drawers
- Access Colors and Info via bottom navigation bar
- Toolbar scrolls horizontally if needed

### Touch Gestures

| Gesture | Action |
|---------|--------|
| **Single tap** | Place pixel / Select |
| **Single finger drag** | Draw / Pan (with pencil tool) |
| **Two-finger pinch** | Zoom in/out |
| **Two-finger drag** | Pan canvas |

### iPad Tips

- Two-finger gestures work for zoom and pan
- All drawing tools work with single touch
- Text and shape placement works the same as desktop

---

## 15. Inventory Integration

### Thread Size Mapping

| Mesh Count | Thread Size |
|------------|-------------|
| 14 mesh | Size 5 |
| 18 mesh | Size 8 |

### In-Stock Colors

- Colors in stock show a green dot in the Color Picker
- Design cards show an "ORDER" badge if missing colors
- Manage inventory from the Inventory page (link in header)

### Kit Management

- Click **Kit** on any saved design to access kit management
- Calculate yarn quantities
- Track canvas prints and kits ready

---

## 16. Troubleshooting

### Common Issues

**Colors not showing when I draw**
- Make sure you have a color selected in the Color Picker
- The current color is shown at the top of the Colors panel

**Text/shape placement was cancelled**
- Press Escape accidentally? Try adding the text/shape again
- Click on the canvas after clicking "Add to Canvas"

**Can't undo my last action**
- Check if the Undo button is enabled (not grayed out)
- Some actions may have been auto-saved

**Canvas is too zoomed in/out**
- Click the Reset View button (circular arrow) in the toolbar

**Image import looks wrong**
- Adjust the "Maximum Colors" slider for better results
- Try checking/unchecking "Treat white as empty"
- Use Remove Color feature to clean up after import

**Missing thread colors warning**
- Check the Inventory page to update your stock
- The "ORDER" badge shows which designs need colors

**Can't find a tool on mobile**
- Scroll the toolbar horizontally
- Some tools are hidden on very small screens

**Design not saving**
- Check for "Save failed" status
- Make sure you have an internet connection
- Try clicking the Save button manually

---

## Quick Reference Card

### Essential Tools
- **Pencil**: Single pixels
- **Brush**: Multiple pixels
- **Fill**: Flood fill areas
- **Select**: Rectangle selection
- **Magic Wand**: Color selection

### Essential Shortcuts
- **Ctrl/Cmd + Z**: Undo
- **Ctrl/Cmd + C**: Copy
- **Ctrl/Cmd + V**: Paste
- **Escape**: Cancel placement

### Essential Actions
- **Save**: Click Save button or wait for auto-save
- **Export**: Click Export for PDF/PNG options
- **Resize**: Click Resize to change canvas size

---

*Last updated: January 2026*
