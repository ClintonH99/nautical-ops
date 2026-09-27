# Rule: Safety Equipment — Permissions

## Rule

Access to create, edit, and remove safety equipment is restricted by role.

## Permissions Matrix

| Action                  | HOD | MOV (Captain) | Crew |
|-------------------------|-----|---------------|------|
| View safety equipment   | ✅  | ✅            | ✅   |
| Add safety equipment    | ✅  | ✅            | ✅   |
| Edit safety equipment   | ✅  | ✅            | ✅   |
| Remove safety equipment | ✅  | ✅            | ❌   |
| Export to PDF           | ✅  | ✅            | ✅   |

## Role Definitions

- **HOD**: `user?.role === 'HOD'`
- **MOV (Master of Vessel)**: `user?.role === 'CAPTAIN_MOV'`
- **Crew**: `user?.role === 'CREW'`. Management and unauthenticated users do not gain create/edit access.

## Implementation

```ts
const isHOD = user?.role === 'HOD';
const isMOV = user?.role === 'CAPTAIN_MOV';
const canManage = isHOD || isMOV;
const canEdit = canManage || user?.role === 'CREW';
```

- Show Add / Edit UI when `canEdit` is `true`, including Crew.
- Show Delete for published plans only when `canManage` is `true` (HOD/MOV).
- The create/edit form and publish handler use `canEditSafetyEquipment` from `utils/access.ts`.
- Database INSERT/UPDATE policies allow Crew only on their current accessible vessel; cross-vessel access and DELETE permissions remain unchanged.
- The Export to PDF button is always visible to all roles.

## Screens Affected

- `SafetyEquipmentScreen`
- `CreateSafetyEquipmentScreen`

## When to Apply

Apply whenever modifying the safety equipment feature or adding new safety-related screens.
