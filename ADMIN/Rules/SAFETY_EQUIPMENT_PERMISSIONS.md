# Rule: Safety Equipment — Permissions

## Rule

Access to create, edit, and remove safety equipment is restricted by role.

## Permissions Matrix

| Action                  | HOD | MOV (Captain) | Crew |
|-------------------------|-----|---------------|------|
| View safety equipment   | ✅  | ✅            | ✅   |
| Add safety equipment    | ✅  | ✅            | ❌   |
| Edit safety equipment   | ✅  | ✅            | ❌   |
| Remove safety equipment | ✅  | ✅            | ❌   |
| Export to PDF           | ✅  | ✅            | ✅   |

## Role Definitions

- **HOD**: `user?.role === 'HOD'`
- **MOV (Master of Vessel)**: `user?.position?.toLowerCase().includes('captain')`
- **Crew**: All other authenticated users

## Implementation

```ts
const isHOD = user?.role === 'HOD';
const isMOV = user?.position?.toLowerCase().includes('captain');
const canManage = isHOD || isMOV;
```

- Show Add / Edit / Delete UI only when `canManage` is `true`.
- Show an informational message to Crew: *"Only HOD or MOV can create or edit safety equipment. Crew can export to PDF."*
- The Export to PDF button is always visible to all roles.

## Screens Affected

- `SafetyEquipmentScreen`
- `CreateSafetyEquipmentScreen`

## When to Apply

Apply whenever modifying the safety equipment feature or adding new safety-related screens.
