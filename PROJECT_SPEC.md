# Yachy App - Project Specification

## Project Overview

**Name**: Yachy App (working title)

**Purpose**: Professional operations management app for super/mega yachts worldwide, designed to streamline crew workflows, inventory tracking, task management, and trip planning.

**Target Users**: Yacht crew members across all departments (Deck/Exterior, Interior, Engineering, Galley)

**Platform**: Mobile-first (iOS & Android), tablet-optimized, future web app

---

## Core Features (MVP)

### 1. Authentication & User Management

**Login Methods:**
- Apple Sign-In
- Google Sign-In
- Email/Password

**User Onboarding:**
- Unique invite link per vessel (one-time use, expirable - 48 hours)
- Select position/role (e.g., Deckhand, Chief Stew, Engineer, Captain)
- Select department: Deck (Exterior), Interior, Engineering, Galley

**User Roles:**
- **HOD (Head of Department)**: Full edit permissions for most modules
- **Crew**: Read-only for most modules, limited edit permissions
- **Management Company**: Super admin, accounting view only (future phase)

---

### 2. Tasks/Jobs to Complete

**Purpose**: Track work assignments with deadline-based priority system

**HOD Permissions:**
- Create, edit, delete tasks
- Assign to specific crew or department
- Set timeframe/deadline
- Add description, notes, attachments/photos

**Crew Permissions:**
- View all tasks
- Claim/assign themselves to tasks
- Add notes/updates
- Mark complete
- Upload progress photos

**Color-Based Time Progression:**
- 🟢 **GREEN**: 70-100% time remaining
- 🟡 **YELLOW**: 30-70% time remaining
- 🔴 **RED**: 0-30% time remaining
- 🔴 **OVERDUE**: Past deadline

**Timeframe Options:**
- 1 Day
- 3 Days
- 1 Week
- 2 Weeks
- 1 Month
- Custom date

**Visual Elements:**
- Task card with color tint
- Progress bar showing time remaining
- Countdown timer (e.g., "5 days 12 hours remaining")
- Status: Not Started / In Progress / Completed

---

### 3. Inventory Management

**Purpose**: Track equipment, supplies, and materials across all departments

**Permissions**: 
- **ALL users** (HOD + Crew) can create/edit/delete categories and items

**Category Examples:**
- Decorations
- Cutlery
- Crew Uniform
- Cleaning Supplies
- Spare Parts
- Safety Equipment
- Guest Amenities

**Item Fields:**
- Photo (optional)
- Description
- Quantity
- Location
- Last edited by (name + timestamp)
- Department

**Audit Trail:**
- Display "Last edited by: [Name] on [Date Time]"
- Track all changes for accountability

---

### 4. Watch Duties

**Purpose**: Schedule watch rotations with task checklists

**HOD Creates:**
- Watch period (date + time range, e.g., "Night Watch 00:00-06:00")
- Assign crew member(s)
- Task checklist for that watch

**Crew View:**
- See assigned watch schedule
- Personal checkboxes for tasks (LOCAL only, not synced)
- Checkboxes reset daily at midnight

**Example Watch Tasks:**
- ☐ Take out trash
- ☐ Clean crew mess
- ☐ Check anchor/mooring
- ☐ Monitor weather

**Important**: Each user's checkboxes are private and local to their device

---

### 5. General Duties

**Purpose**: Reference library of recurring duties organized by frequency

**HOD Creates Categories:**
- Daily
- Weekly
- Monthly
- Quarterly
- Custom categories

**Example Structure:**
```
Interior - Daily Duties:
- Guest cabin turndown
- Wipe down all surfaces
- Restock amenities

Interior - Weekly Duties:
- Deep clean galley
- Wash crew uniforms
- Polish silverware
```

**Important**: 
- These are REFERENCE lists only
- NOT auto-created as tasks
- HOD manually creates tasks in "Tasks" module when needed

---

### 6. Trips

**Purpose**: Plan and organize boss/owner trips and guest/charter trips

**Types:**
- Boss Trips (owner/family)
- Guest Trips (charter guests)

**Information Tracked:**
- Dates (arrival/departure)
- Itinerary (locations, activities, timing)
- Guest preferences (dietary, room preferences, activities)
- Special requests
- Notes

**Permissions:**
- HOD: Full edit
- Crew: Read-only

**Note**: Medical data intentionally excluded for legal/privacy reasons

---

### 7. Contractors

**Purpose**: Schedule and track external service providers

**Fields:**
- Department (which dept needs service)
- Service type (e.g., "Carpet Cleaning", "Engine Maintenance")
- Date & Time
- Company/Contact Name
- Phone Number
- Email
- Notes

**Permissions:**
- HOD: Full edit
- Crew: Read-only

---

### 8. Calendar

**Purpose**: Unified timeline view of all activities

**Filter Tabs:**
- **View All** (default - shows everything color-coded)
- Boss Trips (blue)
- Guest Trips (green)
- Contractors (yellow)
- Jobs/Tasks (red gradient by deadline)
- Duties (purple)

**Features:**
- Month/Week/Day views
- Tap event to see details
- Export to device calendar (Google Calendar, Apple Calendar)
- Optional sync (user permission-based)

**Visual Design:**
- Color-coded markers/dots on dates
- Clean, uncluttered interface
- Smooth filter transitions

---

### 9. Location-Based Store Finder (AI)

**Purpose**: Help crew find local stores/services in unfamiliar ports

**Features:**
- AI chatbot powered by OpenAI/Anthropic
- Detects vessel location
- Searches for:
  - Fresh produce markets
  - Hardware stores
  - Marine suppliers
  - Provisioning
  - Medical facilities
  - Laundry services
  - etc.

**User Features:**
- Save favorite locations
- Save chat history (optional, user choice)
- Share locations with crew

**AI Behavior:**
- Researches online for best matches
- Provides store names, addresses, hours, ratings
- Suggests best options based on user needs

---

## Technical Architecture

### Frontend
- **Framework**: React Native with Expo
- **Language**: TypeScript
- **Navigation**: React Navigation
- **State Management**: Zustand or Redux Toolkit
- **Styling**: NativeWind (Tailwind for React Native) or Styled Components

### Backend
- **BaaS**: Supabase
  - PostgreSQL database
  - Authentication (Apple, Google, Email)
  - File storage (photos)
  - Real-time subscriptions
  - Row-level security (RLS)

### Offline Support
- **Local Database**: Watermelon DB
- **Sync Strategy**: Queue-based sync when online
- **Storage**: AsyncStorage for user preferences and local watch checkboxes

### Key Libraries
- `react-native-calendars` - Calendar views
- `expo-camera` - Photo capture
- `expo-location` - Location services
- `react-query` - Data fetching/caching
- `expo-image-picker` - Image selection
- OpenAI API - AI chatbot

---

## User Permissions Matrix

| Feature | HOD | Crew |
|---------|-----|------|
| Tasks/Jobs | ✅ Full CRUD | 📖 View, claim, update, complete |
| Inventory | ✅ Full CRUD | ✅ Full CRUD |
| Watch Duties | ✅ Create schedule | 📖 View + ✅ Personal checkboxes |
| General Duties | ✅ Create/edit categories | 📖 View only |
| Trips | ✅ Full CRUD | 📖 View only |
| Contractors | ✅ Full CRUD | 📖 View only |
| Calendar | 📖 View all | 📖 View all |
| Store Finder | ✅ Use | ✅ Use |

---

## Push Notifications

**User Permission Required**: Yes (standard iOS/Android prompt)

**Notification Types:**
- Task deadline approaching (24hrs before, 1hr before red)
- Task assigned to you
- Upcoming trips (1 day before)
- Contractor arriving today
- Optional: Task completion updates

**User Control:**
- Enable/disable in app settings
- Customize notification types

---

## Data Privacy & Security

**Personal Data Collected:**
- Name
- Email (for login)
- Position/Role
- Department
- Profile photo (optional)

**Data NOT Collected:**
- No financial/accounting data
- No medical records
- No sensitive personal information

**Security Measures:**
- End-to-end encryption
- Row-level security (Supabase RLS)
- Secure authentication (OAuth, JWT)
- Audit logs for accountability

---

## Multi-Tenancy

**Vessel Isolation:**
- Each yacht is a separate tenant
- Crew can only see data for their assigned vessel(s)
- Management company can see aggregated data across their vessels

**Invite System:**
- Unique invite link per vessel
- One-time use, expires after 48 hours
- Links generated by HOD or admin

---

## Design Requirements

**Overall Style:**
- Professional
- Clean, modern UI
- Simple, intuitive navigation
- Minimal learning curve
- Tablet-optimized layouts

**Color Scheme:**
- Professional nautical theme
- Blues, whites, grays
- Clear task status colors (green/yellow/red)

**UX Priorities:**
- Fast load times
- Offline-first approach
- Minimal clicks to complete actions
- Clear visual hierarchy
- Touch-friendly (large tap targets)

---

## Excluded Features (Scope Reduction)

### ❌ Accounting/Financial Management
**Reason**: Too complex for MVP, use existing tools (QuickBooks, Xero, Voly)

### ❌ Medical Records
**Reason**: Legal/compliance complexity (HIPAA, GDPR), privacy concerns

### ❌ Crew Messaging/Chat
**Reason**: Use WhatsApp/Signal, focus on operations not communication

---

## Development Phases

### Phase 1: MVP (3-4 months)
- ✅ Authentication & user onboarding
- ✅ Tasks module (full functionality)
- ✅ Inventory module (full functionality)
- ✅ Basic calendar view
- ✅ Offline mode foundation
- ✅ Tablet-responsive design

### Phase 2: Enhanced Features (2-3 months)
- ✅ Watch Duties
- ✅ General Duties
- ✅ Trips
- ✅ Contractors
- ✅ Advanced calendar (filters, export)
- ✅ Push notifications
- ✅ AI store finder

### Phase 3: Scale & Optimize (2-3 months)
- ✅ Management company dashboard
- ✅ Web app version (React Native Web)
- ✅ Performance optimization
- ✅ Advanced reporting
- ✅ Multi-vessel support per user

---

## Success Metrics

**Key Performance Indicators:**
- Number of active vessels using the app
- Daily active users (crew members)
- Task completion rate
- Time saved vs. paper/spreadsheet methods
- Management company adoption rate

**User Feedback:**
- Ease of use rating
- Feature request tracking
- Bug reports and resolution time
- Crew satisfaction surveys

---

## Technical Decisions Record

### Why React Native?
- Single codebase for iOS + Android
- Can add web support later (React Native Web)
- Large ecosystem, mature libraries
- Good offline support
- Expo makes development faster

### Why Supabase?
- PostgreSQL (robust relational data)
- Built-in authentication
- Real-time capabilities
- File storage included
- Good offline sync options
- Cost-effective for startups

### Why TypeScript?
- Fewer bugs (type safety)
- Better IDE support
- Easier refactoring
- Industry standard

### Why Percentage-Based Task Colors?
- Consistent user experience across all task durations
- Intuitive warning system
- Fair time allocation (30/70 split)

### Why Local-Only Watch Checkboxes?
- Personal productivity tool
- Reduces sync overhead
- Works perfectly offline
- No clutter on other devices
- Can add shared tracking later if needed

---

## Open Questions / Future Decisions

1. **Watch reset timing**: Midnight vs. watch start time (PENDING)
2. **Multi-vessel access**: Can crew be on multiple vessels? (PENDING)
3. **Multiple HODs**: Can one department have multiple HODs? (PENDING)
4. **Offline conflict resolution**: How to handle simultaneous edits?
5. **Image compression**: What quality/size for yacht bandwidth?

---

## Getting Started (Developer Setup)

### Prerequisites
- Node.js (v18+)
- npm or yarn
- Xcode (for iOS)
- Android Studio (for Android)
- Git

### Installation
```bash
# Clone repository
git clone [repo-url]

# Install dependencies
npm install

# Start Expo development server
npm start

# Run on iOS simulator
npm run ios

# Run on Android emulator
npm run android
```

### Environment Variables
```
SUPABASE_URL=
SUPABASE_ANON_KEY=
OPENAI_API_KEY=
```

---

## Project Timeline (Estimated)

**Week 1-2**: Project setup, authentication, basic navigation  
**Week 3-4**: Tasks module UI and functionality  
**Week 5-6**: Inventory module UI and functionality  
**Week 7-8**: Offline sync setup, testing  
**Week 9-10**: Calendar integration  
**Week 11-12**: Polish, bug fixes, testing with real crew  

**Total MVP**: ~3 months with dedicated developer(s)

---

## Contact & Resources

**Project Owner**: Clinton Handford  
**Development Tool**: Cursor IDE  
**Version Control**: Git (to be initialized)  
**Documentation**: This file + inline code comments  

---

## Changelog

- **2026-02-12**: Initial specification document created based on requirements gathering
- Features defined: Tasks, Inventory, Watch Duties, General Duties, Trips, Contractors, Calendar, AI Store Finder
- Excluded: Accounting, Medical records
- Technical stack decided: React Native + Supabase

---

**Last Updated**: February 12, 2026  
**Version**: 1.0  
**Status**: Ready for development
