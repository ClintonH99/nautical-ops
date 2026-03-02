# Role Display in Settings and Profile

## Rule

Within Settings and Profile screens, the Role field must display:

| User type                             | Display                                |
|---------------------------------------|----------------------------------------|
| Captain (position contains "captain")  | MOV (Master of Vessel)                 |
| HOD (role is HOD, not Captain)         | HOD (Head of Department)               |
| Other (CREW, MANAGEMENT)              | Crew                                   |

## Implementation

Add display logic:
- `position?.toLowerCase().includes('captain')` → "MOV (Master of Vessel)"
- `role === 'HOD'` → "HOD (Head of Department)"
- else → "Crew"

## Scope

Applies to ProfileScreen and SettingsScreen where user role is displayed.
