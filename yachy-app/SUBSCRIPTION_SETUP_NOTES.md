# Subscription Setup Notes

This document records the current subscription behavior during setup and testing.

## Current State

- `Subscribe via App Store` currently does not trigger a purchase flow.
- `Pay with Card` currently shows `Payment Unavailable`.

## Source of Truth

- Supabase is the source of truth for vessel subscription status.
- RevenueCat can still be configured for native IAP paths, but is not the canonical subscription record when the payment flow is handled via card checkout.

## Follow-up Work

- Implement and connect live checkout for card payments.
- Wire native in-app purchase flow end-to-end for App Store/Play Store.
- Ensure both payment entry points update Supabase subscription state consistently.
