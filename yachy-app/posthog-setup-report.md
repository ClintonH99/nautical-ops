<wizard-report>
# PostHog post-wizard report

The wizard has completed a deep integration of PostHog analytics into the Nautical Ops Expo (React Native) application. The following changes were made:

**New files created:**

- `app.config.js` — Expo config that reads `POSTHOG_PROJECT_TOKEN` and `POSTHOG_HOST` from environment variables and exposes them as `expo.extra` fields.
- `src/config/posthog.ts` — PostHog client singleton, initialised via `expo-constants` from `app.config.js` extras. Gracefully disabled when the token is not set.
- `.env` — Environment variable file with `POSTHOG_PROJECT_TOKEN` and `POSTHOG_HOST` (covered by `.gitignore`).

**Modified files:**

- `src/navigation/RootNavigator.tsx` — Imports `PostHogProvider` and `posthog`, wraps `Stack.Navigator` inside `PostHogProvider` (inside `NavigationContainer`, per React Navigation v7 guidance). Autocapture enabled for touches; screens tracked manually.
- `src/screens/LoginScreen.tsx` — Calls `posthog.identify()` and captures `user_signed_in` on successful email login.
- `src/screens/RegisterScreen.tsx` — Calls `posthog.identify()` and captures `user_signed_up` on successful registration.
- `src/screens/CreateVesselScreen.tsx` — Captures `vessel_created` after the vessel is successfully created in Supabase.
- `src/screens/JoinVesselScreen.tsx` — Captures `vessel_joined` after a crew member successfully joins via invite code.
- `src/screens/AddEditTaskScreen.tsx` — Captures `task_created` (new) and `task_updated` (edit) on save.
- `src/screens/AddEditTripScreen.tsx` — Captures `trip_created` on new trip save.
- `src/screens/AddEditMaintenanceLogScreen.tsx` — Captures `maintenance_log_created` on new log save.
- `src/screens/AddEditPreDepartureChecklistScreen.tsx` — Captures `pre_departure_checklist_created` on new checklist creation.
- `src/screens/VesselSettingsScreen.tsx` — Captures `invite_code_copied` and `invite_code_shared` on the respective HOD actions.
- `src/screens/VesselPlansScreen.tsx` — Captures `vessel_plans_viewed` on mount (top of subscription funnel).

**Packages installed:** `posthog-react-native`, `react-native-svg`

---

| Event                             | Description                                                                   | File                                                 |
| --------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------- |
| `user_signed_in`                  | User successfully signed in with email and password                           | `src/screens/LoginScreen.tsx`                        |
| `user_signed_up`                  | New user successfully completed registration (captain or crew)                | `src/screens/RegisterScreen.tsx`                     |
| `vessel_created`                  | A new vessel was successfully created by a captain                            | `src/screens/CreateVesselScreen.tsx`                 |
| `vessel_joined`                   | A crew member successfully joined a vessel using an invite code               | `src/screens/JoinVesselScreen.tsx`                   |
| `task_created`                    | A new maintenance or operations task was created                              | `src/screens/AddEditTaskScreen.tsx`                  |
| `task_updated`                    | An existing task was updated                                                  | `src/screens/AddEditTaskScreen.tsx`                  |
| `trip_created`                    | A new vessel trip was created                                                 | `src/screens/AddEditTripScreen.tsx`                  |
| `maintenance_log_created`         | A new maintenance log entry was created                                       | `src/screens/AddEditMaintenanceLogScreen.tsx`        |
| `pre_departure_checklist_created` | A pre-departure checklist was created or saved                                | `src/screens/AddEditPreDepartureChecklistScreen.tsx` |
| `invite_code_shared`              | HOD shared the vessel invite code with crew                                   | `src/screens/VesselSettingsScreen.tsx`               |
| `invite_code_copied`              | HOD copied the vessel invite code to clipboard                                | `src/screens/VesselSettingsScreen.tsx`               |
| `vessel_plans_viewed`             | User viewed the vessel subscription plans screen (top of subscription funnel) | `src/screens/VesselPlansScreen.tsx`                  |

## Next steps

We've built some insights and a dashboard for you to keep an eye on user behavior, based on the events we just instrumented:

- **Dashboard — Analytics basics:** https://us.posthog.com/project/378128/dashboard/1456498
- **New Signups & Daily Active Users** (weekly trend): https://us.posthog.com/project/378128/insights/fGiSyoSD
- **Captain Onboarding Funnel** (signup → vessel created → invite shared): https://us.posthog.com/project/378128/insights/l4UH0tBx
- **Subscription Conversion Funnel** (plans viewed → vessel created): https://us.posthog.com/project/378128/insights/MMl4ZPD2
- **Operations Activity — Tasks & Maintenance** (weekly bar chart): https://us.posthog.com/project/378128/insights/k6cDHJUM
- **Trip & Checklist Planning Activity** (weekly line chart): https://us.posthog.com/project/378128/insights/v5FZlj4g

### Agent skill

We've left an agent skill folder in your project. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.

</wizard-report>
