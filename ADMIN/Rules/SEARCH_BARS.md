# Search Bars

## Rule

All search bars in the app (current and newly added) **must** have:
- White background
- Black text for typed input
- Appropriate placeholder color (e.g. gray)

## Implementation

Use the Input component with `variant="search"` for all search fields. This variant applies fixed styling regardless of theme:
- `backgroundColor: COLORS.white`
- `color: COLORS.black` (typed text)
- `placeholderTextColor: COLORS.gray500`

## Scope

Applies to: General Waste Log, Fuel Log, Pump Out Log, Inventory, and any future screens that add search functionality.
