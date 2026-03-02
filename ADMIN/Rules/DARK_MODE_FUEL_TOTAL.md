# Fuel Log Total in Dark Mode

## Rule

The total amount displayed in the Fuel Log information card must be **white text** in Dark Mode.

## Implementation

In FuelLogScreen, the total value (e.g. price) in the stats row of each ButtonTagCard should use:

`color: themeColors.isDark ? COLORS.white : COLORS.primary`

## Scope

Applies to the Fuel Log screen information cards only.
