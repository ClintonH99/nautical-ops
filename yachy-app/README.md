# Yachy App

Professional operations management app for super/mega yachts worldwide.

## 🚢 About

Yachy is designed to streamline yacht crew workflows including:
- Task management with deadline tracking
- Inventory management across all departments
- Watch duties scheduling
- Trip planning (Boss & Guest trips)
- Contractor management
- Unified calendar view
- AI-powered location-based store finder

## 📋 Current Status

**✅ Completed:**
- Project setup with React Native + Expo
- TypeScript configuration
- Authentication screens (Login & Register)
- Basic navigation structure
- Theme system and reusable components
- State management with Zustand
- Supabase integration setup

**🚧 In Progress:**
- Tasks module
- Inventory module
- Main navigation tabs

**📅 Coming Next:**
- Calendar integration
- Watch duties
- Trips management
- Offline mode

## 🛠️ Tech Stack

- **Frontend:** React Native (Expo)
- **Language:** TypeScript
- **Navigation:** React Navigation
- **State Management:** Zustand
- **Backend:** Supabase (PostgreSQL, Auth, Storage)
- **Offline:** Watermelon DB (planned)

## 📦 Installation

### Prerequisites
- Node.js (v18+)
- npm or yarn
- Xcode (for iOS development)
- Android Studio (for Android development)

### Setup

1. **Clone the repository** (or you're already here!)

2. **Install dependencies:**
```bash
npm install
```

3. **Set up Supabase:**
   - Go to [https://supabase.com](https://supabase.com) and create a new project
   - Copy `.env.example` to `.env`
   - Add your Supabase URL and anon key to `.env`

4. **Start the development server:**
```bash
npm start
```

5. **Run on iOS/Android:**
```bash
# iOS
npm run ios

# Android
npm run android

# Web (for testing)
npm run web
```

## 📁 Project Structure

```
yachy-app/
├── src/
│   ├── components/       # Reusable UI components
│   ├── screens/          # Screen components
│   ├── navigation/       # Navigation setup
│   ├── services/         # API services (Supabase, etc.)
│   ├── store/           # Zustand state management
│   ├── types/           # TypeScript type definitions
│   ├── constants/       # Theme, colors, sizes
│   └── utils/           # Helper functions
├── assets/              # Images, fonts, etc.
├── App.tsx             # Main app entry point
└── package.json        # Dependencies
```

## 🎨 Design System

The app uses a professional nautical-inspired design:
- **Primary Color:** Deep navy blue (#1E3A8A)
- **Status Colors:** Green (on track), Yellow (attention needed), Red (urgent)
- **Module Colors:** Color-coded for calendar (trips, tasks, contractors, etc.)

## 🔐 Authentication

Currently supports:
- Email/Password authentication
- User roles (HOD vs Crew)
- Department selection
- Invite code validation

**Coming Soon:**
- Apple Sign-In
- Google Sign-In

## 📱 Features in Detail

### Tasks Management
- Create/assign tasks with deadlines
- Color-coded priority (green/yellow/red based on time remaining)
- HOD can create, crew can claim and complete
- Notes and attachments support

### Inventory Tracking
- Create categories by department
- Track quantity and location
- Photo support
- "Last edited by" audit trail
- Full edit access for all crew

### Watch Duties
- Schedule watch rotations
- Task checklists for each watch
- Personal checkboxes (local, resets daily)

### General Duties
- Reference library organized by frequency (Daily/Weekly/Monthly/Quarterly)
- Not auto-created, used as templates

### Trips
- Boss trips and Guest trips
- Itineraries with dates/locations
- Guest preferences and special requests

### Calendar
- Unified view of all activities
- Filter by type (trips, tasks, contractors, duties)
- Export to device calendar

## 🔄 Offline Mode (Planned)

The app will support:
- Local data storage
- Automatic sync when online
- Queue-based sync for changes
- Conflict resolution

## 📝 Development Notes

### Database Schema (Supabase)

You'll need to create these tables in Supabase:

1. **users** - User profiles
2. **vessels** - Yacht information
3. **tasks** - Task management
4. **inventory_categories** - Inventory categories
5. **inventory_items** - Inventory items
6. **watch_duties** - Watch schedules
7. **duty_categories** - General duty categories
8. **duties** - General duties
9. **trips** - Trip planning
10. **contractors** - Contractor information

See `PROJECT_SPEC.md` for detailed schema.

### Environment Variables

Copy `.env.example` to `.env` and fill in your values:
```bash
cp .env.example .env
```

## 🤝 Contributing

This is a private project currently in development.

## 📄 License

Proprietary - All rights reserved

## 📞 Contact

For questions or support, contact the project owner.

---

**Version:** 0.1.0 (Alpha)  
**Last Updated:** February 12, 2026
