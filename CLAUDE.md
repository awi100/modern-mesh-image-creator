# Modern Mesh Image Creator - Internal App

## Project Overview

This is the **internal app** for creating needlepoint designs that will be sold as physical kits. It includes inventory management, kit sales tracking, and organizational features (folders, tags) that aren't needed in the public SaaS version.

**Purpose**: Design creation tool for a needlepoint business - create designs, track thread inventory, assemble and sell kits.

## Tech Stack

- **Framework**: Next.js 15 (App Router)
- **Database**: PostgreSQL (local or cloud)
- **ORM**: Prisma
- **Auth**: iron-session (simple password auth)
- **State Management**: Zustand
- **Styling**: Tailwind CSS v4
- **PDF**: jsPDF

## Project Structure

```
src/
├── app/
│   ├── api/
│   │   ├── designs/         # Design CRUD
│   │   │   └── [id]/
│   │   │       ├── kit/     # Kit requirements for design
│   │   │       └── route.ts
│   │   ├── inventory/       # Thread inventory management
│   │   ├── kit-sales/       # Track kit sales
│   │   ├── folders/         # Folder management
│   │   └── tags/            # Tag management
│   ├── design/[id]/         # Design editor
│   │   └── kit/             # Kit details page
│   ├── inventory/           # Inventory management page
│   ├── kits/                # Kit overview page
│   ├── help/                # Help documentation
│   ├── login/               # Simple login page
│   └── page.tsx             # Home (design gallery with folders/tags)
├── components/
│   └── editor/              # Editor components (similar to public app)
└── lib/
    ├── store.ts             # Zustand editor state (SHARED)
    ├── color-utils.ts       # Image processing (SHARED)
    ├── dmc-pearl-cotton.ts  # DMC color database (SHARED)
    ├── yarn-calculator.ts   # Yarn usage (SHARED)
    ├── shapes.ts            # Shapes (SHARED)
    ├── text-renderer.ts     # Text rendering (SHARED)
    ├── symbols.ts           # Chart symbols (SHARED)
    ├── pdf-export.ts        # PDF/image export
    ├── shopping-list-export.ts # Shopping list export
    ├── session.ts           # iron-session auth
    └── prisma.ts            # Prisma client
```

## Key Features

### Design Editor
- Same core editor as public app
- Pixel drawing with DMC colors
- Layers, selection, transforms
- Text and shape tools
- Image import with color quantization
- Auto-save

### Organization
- **Folders**: Organize designs into folders (nested supported)
- **Tags**: Color-coded tags for filtering
- **Draft Status**: Mark designs as draft/complete

### Inventory Management
- Track thread stock by DMC number and size (5 or 8)
- See which colors are in stock when picking colors
- Shopping list generation for low stock

### Kit Features
- View kit requirements for each design
- Track "kits ready" (assembled kits)
- Track "canvases printed"
- Record kit sales with automatic inventory deduction

## Database Schema

```prisma
model Design {
  id           String
  name         String
  pixelData    Bytes        // Compressed grid
  folderId     String?      // Folder organization
  tags         DesignTag[]  // Tag relations
  kitSales     KitSale[]    // Sale history
  kitsReady    Int          // Assembled kits count
  canvasPrinted Int         // Printed canvases
  isDraft      Boolean
  deletedAt    DateTime?    // Soft delete
  // ... dimensions, settings
}

model Folder {
  id       String
  name     String
  parentId String?    // Nested folders
  designs  Design[]
}

model Tag {
  id      String
  name    String
  color   String
  designs DesignTag[]
}

model InventoryItem {
  id        String
  dmcNumber String
  size      Int      // 5 or 8
  skeins    Int      // Stock count
}

model KitSale {
  id       String
  designId String
  items    KitSaleItem[]  // Thread deductions
  note     String?
}

model CanvasPreset {
  id           String
  name         String
  widthInches  Float
  heightInches Float
}
```

## Environment Variables

```env
# Database
DATABASE_URL=postgresql://...
DIRECT_URL=postgresql://...

# Session (for iron-session)
SESSION_PASSWORD=your-32-char-secret

# Cloudinary (optional)
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
```

## Common Commands

```bash
npm run dev          # Start development server
npm run build        # Build for production
npm run db:push      # Push schema changes
npm run db:seed      # Seed DMC colors
npm run db:studio    # Open Prisma Studio
```

## Workflows

### Creating a New Design
1. Click "New Design" on home page
2. Choose canvas size (preset or custom)
3. Draw/import design
4. Save (auto-saves every 30 seconds)

### Tracking Inventory
1. Go to Inventory page
2. Add thread stock by DMC number
3. Colors in stock show green dot in color picker

### Recording a Kit Sale
1. Go to design → Kit page
2. Click "Record Sale"
3. Inventory automatically deducted

### Batch Operations
1. Click "Select" to enter selection mode
2. Check multiple designs
3. Use toolbar to move/tag/delete in bulk

---

## SYNC WITH PUBLIC APP

This project shares core libraries with the **public SaaS app** at:
`/Users/andrewimrie/Documents/modern-mesh`

### Files That MUST Be Kept In Sync

When modifying these files, **update both projects**:

| File | Purpose |
|------|---------|
| `src/lib/store.ts` | Zustand editor state - layers, tools, history |
| `src/lib/color-utils.ts` | Image processing, color quantization, grid operations |
| `src/lib/dmc-pearl-cotton.ts` | DMC color database (446 colors) |
| `src/lib/yarn-calculator.ts` | Yarn usage calculations |
| `src/lib/shapes.ts` | Heart, star, circle shape rendering |
| `src/lib/text-renderer.ts` | Text to pixel conversion |
| `src/lib/symbols.ts` | Symbols for stitch charts |

### Files Unique to This Project (Internal App)

- `src/lib/session.ts` - iron-session auth (simpler than Supabase)
- `src/lib/shopping-list-export.ts` - Shopping list export
- `src/app/api/inventory/` - Inventory management
- `src/app/api/kit-sales/` - Kit sale tracking
- `src/app/api/folders/` - Folder management
- `src/app/api/tags/` - Tag management
- `src/app/inventory/` - Inventory page
- `src/app/kits/` - Kits overview page

### Features Only in Public App (NOT here)

These features exist in the public app but NOT in this internal app:

- Supabase authentication (we use iron-session)
- Stripe payments/subscriptions
- AI design generation (OpenAI)
- Multi-user support (userId)
- Watermarks on exports
- Color palette suggestions
- Realistic stitch preview
- Subscription feature gating

### Differences From Public App

| Aspect | Internal App | Public App |
|--------|-------------|-----------|
| Auth | iron-session | Supabase + Google OAuth |
| Multi-user | No | Yes |
| Payments | None | Stripe subscriptions |
| Folders/Tags | Yes | No |
| Inventory | Yes | No |
| Kit Sales | Yes | No |
| AI Features | No | Yes (Creator plan) |
| Watermarks | No | Yes (free tier) |

---

## Development Notes

### Adding Features to Both Apps

If adding a feature that should be in both apps:
1. Implement in whichever app you're working in
2. Copy the shared lib files to the other app
3. Adapt any UI components as needed (different auth, different features)

### Inventory Integration

The color picker shows stock status:
- Green dot = in stock
- Dimmed = not in stock
- This helps when designing to prefer colors you have

### Kit Calculations

Kit requirements are calculated from the design:
1. Count stitches per color
2. Calculate yards needed (yarn-calculator.ts)
3. Add buffer percentage
4. Round up to whole skeins

### Session Auth

Simple password auth:
```typescript
// Login sets session
await session.save()

// Protected routes check session
if (!session.isLoggedIn) redirect('/login')
```

### Soft Delete (Trash)

Designs aren't permanently deleted immediately:
1. Delete sets `deletedAt` timestamp
2. Design moves to "Trash" view
3. Cron job permanently deletes after 30 days
4. Can restore from trash
