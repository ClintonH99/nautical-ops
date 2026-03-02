# Export to PDF Buttons

## Rule

1. All PDF export buttons must say **"Export to PDF"** (with optional count when items are selected, e.g. "Export to PDF (3)").
2. In Dark Mode: button text and border must be **white**.

## Implementation

- Rename any "Download PDF", "Export as PDF", etc. to "Export to PDF".
- Use `variant="outlineLight"` or equivalent styling when `themeColors.isDark` is true so text and border are white.

## Scope

Applies to: General Waste Log, Fuel Log, Pump Out Log, Maintenance Log, Pre-Departure Checklist, Inventory, Watch Schedule, Rules, Safety Equipment, Muster Station, and Create screens that export to PDF.
