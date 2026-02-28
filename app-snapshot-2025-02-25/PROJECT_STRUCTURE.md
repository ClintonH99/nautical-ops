# 📁 Yachy App - Project Structure

**Complete folder and file organization**

---

## 🗂️ Root Structure

```
Yachy App/
├── yachy-app/                    # Main React Native application
│   ├── src/                      # All source code
│   ├── assets/                   # Images, icons, splash screens
│   ├── node_modules/             # Dependencies (auto-generated)
│   ├── .expo/                    # Expo cache (auto-generated)
│   │
│   ├── App.tsx                   # Main app entry point
│   ├── package.json              # Dependencies and scripts
│   ├── tsconfig.json             # TypeScript configuration
│   ├── app.json                  # Expo configuration
│   │
│   ├── .env                      # ✅ Supabase credentials (CONFIGURED)
│   ├── .env.example              # Template for .env
│   ├── .gitignore                # Git ignore rules
│   │
│   ├── SETUP_COMPLETE.md         # ✅ Setup status (NEW)
│   ├── QUICK_START.md            # ✅ Quick reference (NEW)
│   ├── CREDENTIALS.md            # ✅ Access info (NEW)
│   ├── PROJECT_STRUCTURE.md      # ✅ This file (NEW)
│   ├── SUPABASE_SETUP.md         # Database setup guide
│   ├── DEVELOPMENT.md            # Development guidelines
│   ├── CHECKLIST.md              # Feature checklist
│   ├── COMPLETION_SUMMARY.md     # What's been built
│   ├── GETTING_STARTED.md        # Initial setup guide
│   └── README.md                 # Project overview
│
└── PROJECT_SPEC.md               # Complete feature specification

```

---

## 📂 Source Code Structure (`src/`)

```
src/
├── screens/                      # All screen components
│   ├── auth/                     # Authentication screens
│   │   ├── LoginScreen.tsx       # ✅ Login form
│   │   └── RegisterScreen.tsx    # ✅ Registration form
│   ├── HomeScreen.tsx            # ✅ Main home screen
│   └── [future screens]          # Tasks, Inventory, etc.
│
├── components/                   # Reusable UI components
│   ├── common/                   # Generic components
│   │   ├── Button.tsx            # ✅ Custom button
│   │   └── Input.tsx             # ✅ Custom input field
│   └── [future components]       # TaskCard, InventoryItem, etc.
│
├── navigation/                   # Navigation setup
│   ├── AppNavigator.tsx          # ✅ Main navigator
│   └── types.ts                  # ✅ Navigation types
│
├── services/                     # External services
│   ├── supabase.ts               # ✅ Supabase client config
│   └── auth.ts                   # ✅ Authentication logic
│
├── store/                        # State management
│   ├── authStore.ts              # ✅ User session state
│   └── [future stores]           # Task store, inventory store, etc.
│
├── types/                        # TypeScript definitions
│   ├── auth.ts                   # ✅ User, session types
│   ├── database.ts               # Database table types
│   └── [future types]            # Task, inventory types
│
├── utils/                        # Helper functions
│   ├── validation.ts             # Input validation
│   └── [future utils]            # Date helpers, formatters
│
├── hooks/                        # Custom React hooks
│   └── [future hooks]            # useAuth, useTasks, etc.
│
├── theme/                        # Design system
│   ├── colors.ts                 # ✅ Color palette
│   ├── fonts.ts                  # ✅ Typography
│   ├── spacing.ts                # ✅ Spacing system
│   └── shadows.ts                # ✅ Shadow styles
│
└── constants/                    # App constants
    └── [future constants]        # API endpoints, configs

```

---

## 🎨 Assets Structure

```
assets/
├── icon.png                      # App icon
├── splash-icon.png               # Splash screen
├── adaptive-icon.png             # Android adaptive icon
├── favicon.png                   # Web favicon
└── [future assets]               # Images, logos, etc.

```

---

## 🗄️ Database Structure (Supabase)

```
Supabase Database
├── auth.users                    # ✅ Built-in auth table
│
├── public.vessels                # ✅ Yacht/vessel data
│   ├── id (uuid)
│   ├── name
│   ├── invite_code
│   └── invite_expiry
│
├── public.users                  # ✅ User profiles
│   ├── id (uuid) → auth.users
│   ├── email
│   ├── name
│   ├── position
│   ├── department
│   ├── role
│   └── vessel_id → vessels
│
├── public.tasks                  # ✅ Tasks/jobs
│   ├── id (uuid)
│   ├── title
│   ├── description
│   ├── vessel_id → vessels
│   ├── created_by → users
│   ├── assigned_to → users
│   ├── department
│   ├── deadline
│   └── status
│
├── public.inventory_categories   # ✅ Inventory categories
│   ├── id (uuid)
│   ├── name
│   ├── department
│   └── vessel_id → vessels
│
└── public.inventory_items        # ✅ Inventory items
    ├── id (uuid)
    ├── category_id → inventory_categories
    ├── name
    ├── quantity
    ├── location
    ├── last_edited_by → users
    └── vessel_id → vessels

```

---

## 📝 Documentation Files

### ✅ Setup & Configuration
- **SETUP_COMPLETE.md** - Current setup status and what's configured
- **QUICK_START.md** - Fast reference for starting the app
- **CREDENTIALS.md** - Supabase access information
- **PROJECT_STRUCTURE.md** - This file (folder organization)

### ✅ Development Guides
- **GETTING_STARTED.md** - Initial project kickoff guide
- **DEVELOPMENT.md** - How to develop features
- **SUPABASE_SETUP.md** - Backend setup instructions

### ✅ Project Planning
- **PROJECT_SPEC.md** - Complete feature specification
- **CHECKLIST.md** - Feature implementation checklist
- **COMPLETION_SUMMARY.md** - What's been built so far

### ✅ README Files
- **README.md** - Project overview

---

## 🔑 Important Files to Know

### Configuration Files (Don't Edit Manually)
- `package.json` - Dependencies (edit via `npm install`)
- `tsconfig.json` - TypeScript config (already set up)
- `app.json` - Expo config (rarely needs changes)

### Environment Files
- `.env` - **✅ CONFIGURED** with Supabase credentials
- `.env.example` - Template for new developers

### Git Files
- `.gitignore` - **✅ Protects `.env` from being committed**

---

## 🚫 Files/Folders to Ignore

These are auto-generated and managed by tools:

- `node_modules/` - NPM dependencies
- `.expo/` - Expo cache
- `dist/` - Build output
- `web-build/` - Web build output
- `.DS_Store` - macOS files

**Never edit these manually!**

---

## 📊 File Status Legend

- ✅ **Created & Working** - File exists and is configured
- 🔜 **To Be Created** - Planned for future development
- 📝 **Needs Update** - Exists but needs modification

---

## 🎯 What's Next to Build

### Priority 1: Tasks Module
```
src/
├── screens/
│   └── tasks/
│       ├── TasksListScreen.tsx      # 🔜 List all tasks
│       ├── TaskDetailScreen.tsx     # 🔜 View task details
│       └── CreateTaskScreen.tsx     # 🔜 Create new task
├── components/
│   └── tasks/
│       ├── TaskCard.tsx             # 🔜 Task list item
│       └── TaskFilters.tsx          # 🔜 Filter by department
└── services/
    └── tasks.ts                     # 🔜 Task CRUD operations
```

### Priority 2: Inventory Module
```
src/
├── screens/
│   └── inventory/
│       ├── InventoryListScreen.tsx  # 🔜 List inventory
│       ├── ItemDetailScreen.tsx     # 🔜 View item
│       └── CreateItemScreen.tsx     # 🔜 Add new item
└── services/
    └── inventory.ts                 # 🔜 Inventory operations
```

---

## 💡 Tips

### Finding Files
- Use Cursor's **Cmd+P** (Mac) or **Ctrl+P** (Windows) to quickly find files
- Search by partial name (e.g., "auth" finds all auth-related files)

### Opening Terminal
- In Cursor: **Terminal → New Terminal**
- Always `cd yachy-app` first before running commands

### Viewing This Structure
- All `.md` files can be viewed in Cursor with nice formatting
- Click any `.md` file to read it

---

**Last Updated:** February 12, 2026

**Status:** ✅ Foundation complete, ready for feature development
