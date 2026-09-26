# Action Wording Standard

Use this wording on every current and future Nautical Ops screen. The same action must use the same words everywhere; screen-specific synonyms are not permitted.

## Page Titles

- Creating a persisted record: `Create [Record]`
- Editing an existing record: `Edit [Record]`
- Viewing a locked/read-only record: `View [Record]`
- Collection screens use the plural feature name, for example `Tasks` or `Shopping Lists`.
- Do not use bare titles such as `Create`, `Edit`, `New`, `Log`, `Job`, or `Task` when the record name can be stated.

## Primary Form Actions

| Situation                                                  | Exact wording       |
| ---------------------------------------------------------- | ------------------- |
| Create a normal persisted record                           | `Create [Record]`   |
| Make a new record visible vessel-wide                      | `Publish [Record]`  |
| Save any normal edit                                       | `Save Changes`      |
| Move to the next unsaved step                              | `Continue`          |
| Save without submitting                                    | `Save Draft`        |
| Send into an approval workflow                             | `Submit for Review` |
| Finish a modal or picker without a separate persisted save | `Done`              |
| Leave without applying changes                             | `Cancel`            |

`Save`, `Save changes`, `Update`, `Update [Record]`, `Save Entry`, `Add [Record]`, `New [Record]`, and `Save and Continue` must not be used as stylistic alternatives to the actions above.

## Add, Remove, and Delete

- Use `Add [Item]` only for a nested item inside the current form, such as `Add Location`, `Add Crew Member`, or `Add Contact`.
- Use `Remove` only for an unsaved or nested item within the current record.
- Use `Delete` for a complete persisted record. Confirmation buttons are `Cancel` and `Delete`.
- Published preview panels use the shared `PreviewActionButtons` labels `Edit` and `Delete`, as defined in `BUTTON_TAG_STANDARD.md`.

## Progress Labels

Use the action's present participle followed by the single ellipsis character:

- `Creating…`
- `Publishing…`
- `Saving…`
- `Deleting…`
- `Exporting…`

## Capitalization

- Buttons and page titles use Title Case: `Save Changes`, not `Save changes`.
- Supporting sentences use normal sentence case.
- Use the complete record name in page titles and primary actions, even when the surrounding page provides context.

## Domain-Specific Exceptions

Keep a different label only when it represents a genuinely different operation, not a visual or wording preference. Approved examples include:

- `Save Draft` and `Submit for Review`
- `Approve` and `Decline`
- `Save Correction`, `Save Receipt Correction`, and other audit-preserving correction actions
- Fuel inventory initialization, transfer, sounding, consumption, and adjustment actions whose wording distinguishes separate ledger operations
- Authentication and onboarding actions required by their dedicated flows
- Inventory auto-save: enabled by default, with `Disable Auto Save` / `Enable Auto Save` controls. While enabled, create/edit forms save in place without a draft or publish action. While disabled, retain the standard `Create Inventory Item` / `Save Changes` action. Show `Saved` only after server confirmation; incomplete or offline changes are retained locally and clearly distinguished from synced records.

When adding a new exception, document why the action has different behaviour from Create, Publish, Save Changes, Continue, Done, Add, Remove, or Delete.

## Implementation Rule

Where create and edit share one component, derive both the page title and primary action from the same edit-state flag. This prevents the title from saying `Create` while the button says `Update`, or an edit form from retaining a create title.
