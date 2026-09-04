# Next Agent Briefing — Yachy App
_Last updated: 2026-02-23_

---

## 1. Project Overview

A React Native / Expo mobile app for yacht crew management. Backend: Supabase (PostgreSQL + RLS + Auth).

Key tech stack:
- **React Native + Expo** (managed workflow)
- **Supabase** – database, auth, RLS
- **React Navigation** – stack-based navigation
- **expo-print + expo-sharing** – PDF generation and sharing
- **@react-native-community/datetimepicker** – native date/time pickers
- **TypeScript** throughout

---

## 2. What Was Done This Session

### 2.1 Shopping List — General / Trip (NEW)
The Shopping List page was restructured into two sections:
- **General Shopping** — primary button, department filter, list of general shopping lists
- **Trip Shopping** — outline button, department filter, list of trip shopping lists

Each section has its own department filter. Lists are categorized by `list_type` ('general' | 'trip').
- Migration: `ADD_SHOPPING_LIST_TYPE.sql` (adds `list_type` column to `shopping_lists`)
- Service: `shoppingLists.ts` updated with `listType` in create/read
- Screens: `ShoppingListScreen.tsx` (two sections), `AddEditShoppingListScreen.tsx` (passes `listType`)

### 2.2 Vessel Logs Module (NEW)
A brand-new module was added to the app. Users can now log three types of operational records:

| Log Type | Screen (List) | Screen (Add/Edit) | Service | Migration |
|---|---|---|---|---|
| General Waste | `GeneralWasteLogScreen.tsx` | `AddEditGeneralWasteLogScreen.tsx` | `services/generalWasteLogs.ts` | `CREATE_GENERAL_WASTE_LOGS_TABLE.sql` |
| Fuel Log | `FuelLogScreen.tsx` | `AddEditFuelLogScreen.tsx` | `services/fuelLogs.ts` | `CREATE_FUEL_LOGS_TABLE.sql` |
| Pump Out | `PumpOutLogScreen.tsx` | `AddEditPumpOutLogScreen.tsx` | `services/pumpOutLogs.ts` | `CREATE_PUMP_OUT_LOGS_TABLE.sql` |

**General Waste fields:** Date, Time, Position/Location, Description of Garbage  
**Fuel Log fields:** Location of Refueling, Date, Time, Amount of Fuel (gal), Price per Gallon, Total Price (auto-calculated)  
**Pump Out fields:** Discharge Type (Direct Discharge / Treatment Plant Discharge / Pumpout Service), conditional Pumpout Service name, Location, Amount in Gallons, Description (optional), Date, Time  

**Selective PDF export** is implemented on all three list screens:
- Tap a card to select it (navy border + checkbox fills)
- "Select All / Deselect All" link appears when logs are present
- "Download PDF (N)" button — disabled until at least one entry is selected
- The PDF includes only the selected entries; totals rows in Fuel/Pump Out PDFs reflect only the selection

**Entry point:** HomeScreen → "Vessel Logs" card (notepad icon 🗒️) → `VesselLogsScreen` → category selection

### 2.3 Search / Filter on Vessel Logs (NEW)
Search fields were added to all three vessel log list screens:
- **General Waste Log** — search by date, time, position, description
- **Fuel Log** — search by date, time, location
- **Pump Out Log** — search by date, time, location, service, description, discharge type

Search is case-insensitive and filters as you type. Select All / PDF export work on filtered results.

### 2.4 Unified PDF Design
All PDF exports in the app now share the same visual design (matching the Vessel Logs style):

| File | Change |
|---|---|
| `src/utils/vesselLogsPdf.ts` | Reference design (unchanged) |
| `src/utils/inventoryPdf.ts` | Rewritten to match — navy header, dept badges, alternating rows |
| `src/screens/MaintenanceLogScreen.tsx` | Inline HTML updated — same design (A4 landscape for 9-column table) |
| `src/screens/WatchScheduleScreen.tsx` | Inline HTML updated — same design (A4 portrait, vessel subtitle) |

**Design spec (all PDFs):**
- `@page` A4 with `20mm 16mm` margins (Maintenance Log uses `landscape`)
- Navy `#1E3A8A` thead with white bold text
- `#f9fafb` alternating even rows
- `1px solid #e5e7eb` row dividers (no harsh black borders)
- `20px` bold navy page title + `11px` grey subtitle (`VesselName · Generated YYYY-MM-DD`)
- `system-ui, sans-serif` font

### 2.5 Date/Time Picker Rule
A `.cursor/rules/date-time-picker.mdc` Cursor rule was created. All future date/time pickers must follow this pattern:
- **iOS**: `display="compact"` — auto-collapses after selection; do **not** use `is24Hour` with compact mode
- **Android**: `display="default"` (dialog) triggered by a `TouchableOpacity`

---

## 3. Supabase Schema Baseline

The current production `public` schema is captured in:

1. `supabase/migrations/20260213000000_PRODUCTION_SCHEMA_BASELINE.sql`
2. The remaining timestamped migrations, applied in filename order

The 41 old untimestamped scripts were ignored by Supabase CLI and now live in
`supabase/legacy-migrations/` for historical reference only. Do not run those
scripts individually against production. The baseline is schema-only and
contains no customer rows or webhook credentials.

---

## 4. Navigation

`RootNavigator.tsx` — the following screens were added to the navigator this session:

- `VesselLogs` → `VesselLogsScreen`
- `GeneralWasteLog` → `GeneralWasteLogScreen`
- `AddEditGeneralWasteLog` → `AddEditGeneralWasteLogScreen`
- `FuelLog` → `FuelLogScreen`
- `AddEditFuelLog` → `AddEditFuelLogScreen`
- `PumpOutLog` → `PumpOutLogScreen`
- `AddEditPumpOutLog` → `AddEditPumpOutLogScreen`

---

## 5. File Index (Key Files)

```
src/
  screens/
    HomeScreen.tsx                     — Vessel Logs shortcut card added
    VesselLogsScreen.tsx               — Category selector (General Waste, Fuel, Pump Out)
    GeneralWasteLogScreen.tsx          — List + selective PDF export
    AddEditGeneralWasteLogScreen.tsx   — Add/Edit form
    FuelLogScreen.tsx                  — List + selective PDF export
    AddEditFuelLogScreen.tsx           — Add/Edit form (auto-calculates total price)
    PumpOutLogScreen.tsx               — List + selective PDF export
    AddEditPumpOutLogScreen.tsx        — Add/Edit form (conditional pumpout service field)
    MaintenanceLogScreen.tsx           — PDF design updated
    WatchScheduleScreen.tsx            — PDF design updated
  services/
    generalWasteLogs.ts
    fuelLogs.ts
    pumpOutLogs.ts
  utils/
    vesselLogsPdf.ts                   — PDF generation for all three vessel log types
    inventoryPdf.ts                    — PDF design updated
  types/
    index.ts                           — GeneralWasteLog, FuelLog, PumpOutLog, DischargeType added
  navigation/
    RootNavigator.tsx                  — All seven new screens registered
supabase/migrations/
    20260213000000_PRODUCTION_SCHEMA_BASELINE.sql
supabase/legacy-migrations/
    CREATE_GENERAL_WASTE_LOGS_TABLE.sql
    CREATE_FUEL_LOGS_TABLE.sql
    CREATE_PUMP_OUT_LOGS_TABLE.sql
.cursor/rules/
    date-time-picker.mdc               — Cursor rule: compact iOS / dialog Android
```

---

## 6. Suggested Next Steps

- **Engine Room Waste log** — was originally in scope but removed; could be re-added following the same pattern as the other three log types
- **Crew management / profiles** — per-crew member views, hours tracking
- **Push notifications** — watch schedule reminders, maintenance due alerts
- ~~**Search / filter** on log list screens~~ — done
- **Edit button on log detail** — currently logs show in a card; a detail modal with edit/delete could be added
