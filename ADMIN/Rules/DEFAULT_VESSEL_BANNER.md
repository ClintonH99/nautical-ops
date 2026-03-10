# Default Vessel Banner for New Captain Accounts

## Rule

1. **Default banner for new vessels:** When a captain creates a new vessel (first-time vessel creation flow), the vessel must use the default banner image: the luxury superyacht "GALACTICA STAR" image.

2. **Do not overwrite custom photos:** If a user has already changed the vessel photo (uploaded a custom banner), this rule does not apply. Never overwrite or replace a user's custom vessel banner with the default.

3. **Scope:** Applies only to vessels created through the CreateVesselScreen flow by new captains. Existing vessels or vessels where the captain has uploaded a custom banner are excluded.

## Implementation

- **Asset:** The default vessel banner image is stored at `assets/default-vessel-banner.png`.
- **Vessel creation:** When a vessel is successfully created via CreateVesselScreen, upload the default banner to `vessel-banners/<vesselId>/banner.jpg` so new vessels display it immediately.
- **HomeScreen fallback:** When a vessel has no custom banner (or the banner fails to load), display the default banner asset.
- **VesselSettingsScreen:** The "change photo" flow must not be affected; users who upload a custom photo keep their photo.

## Scope

Applies to CreateVesselScreen, vesselService, and HomeScreen.
