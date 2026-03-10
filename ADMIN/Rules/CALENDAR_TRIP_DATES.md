# Calendar Trip Dates

## Rule

Trip dates displayed **must** match the selected YYYY-MM-DD exactly. No timezone shift is allowed (e.g. selecting July 1 must never show as June 30).

## Implementation

- Use `parseLocalDate` and `formatLocalDateString` from `src/utils` for parsing and formatting trip dates
- Never use `new Date('YYYY-MM-DD')` or `toISOString().slice(0, 10)` for date-only strings in trip flows
- When iterating over date ranges (e.g. for marked dates), use `parseLocalDate` and build YYYY-MM-DD keys from local date components

## Scope

Applies to: AddEditTripScreen, HomeScreen, YardPeriodTripsScreen, UpcomingTripsScreen, GuestTripsScreen, BossTripsScreen, DeliveryTripsScreen, AddEditPreDepartureChecklistScreen, and any screen that displays or iterates over trip dates.
