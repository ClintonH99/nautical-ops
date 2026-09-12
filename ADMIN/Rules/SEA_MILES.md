# My Sea Miles

## Ownership

- A sea-mile entry permanently belongs to the user account that created it.
- Leaving a vessel, joining another vessel, or being temporarily between vessels must not move, hide, or delete that user's sea-mile history.
- The vessel used for review is recorded only when an entry is submitted. Approval stores a historical snapshot of the reviewing Captain/MOV's name, e-signature, and verification contact details.

## Entry Workflow

1. Any signed-in user can create and save their own sea-mile entry as a Draft, including while they are not assigned to a vessel.
2. Submission requires the user to be assigned to a vessel with a Captain/MOV.
3. Submitted entries become Pending Review and cannot be changed by their owner while pending.
4. Only the Captain/MOV of the reviewing vessel can edit, approve, or decline a pending entry.
   A Captain/MOV may also review and approve their own submitted sea-mile entry.
5. Declining requires a comment. A declined entry returns to its owner for correction and resubmission.
6. Approval uses the Captain/MOV's saved e-signature and saved verification contact details, then permanently locks the entry. Approved entries cannot be edited or deleted by any app user.

## Captain Verification Contact

- `Crew Management` → `Sign Off Sea Miles` contains one editable contact setup for the signed-in Captain/MOV.
- First name and last name are required. The Captain/MOV must provide a cell number with area code, an email address, or both.
- The details are entered once and reused for future approvals until the Captain/MOV edits them.
- Every approval snapshots the contact details so the crew member's historical record remains independently verifiable.

## Vessel Length

- Vessel length is entered as a number with a required `ft` or `m` unit selector.
- New entries show `ft / m` as the unit prompt and default to `ft` if no unit is selected.
- Existing entries must reopen with their previously saved unit selected.

## Personal Organisation

- Every crew member has an `All Sea Miles` view and an `Unfiled` view.
- Crew members can create, rename, and delete personal folders and move any of their entries between folders.
- Each entry can belong to no more than one folder at a time.
- Folder assignments are separate from the official Sea Miles record, allowing approved entries to be organised without changing their locked information.
- Deleting a folder requires confirmation and removes only the folder. Its entries remain intact and return to `Unfiled`.
- Draft and declined entries retain their confirmed delete option. Pending and approved entries cannot be deleted.
- Search matches vessel name, departure location, or destination within the selected folder view.

## PDF Export

- Only approved entries can be selected or exported.
- The PDF is a landscape A4 **Personal Sea Service Record**.
- Each page contains up to 15 entries and repeats the document heading, crew details, and table headings.
- Every row shows the approving skipper's saved Captain Contact Details name and e-signature so one page can contain entries approved by different Captains. Older records without a contact snapshot fall back to the login-profile name.
- Between the crew details and records table, each approving Captain/MOV represented on that page appears once under `Captain's Contact Details to Verify Information`.
- The records table is introduced by the title `Sea Miles Record`.
- Page numbering is shown as `Page 1`, `Page 2`, and so on.

## Access Points

- `Settings` → `My Profile` → `My Sea Miles`: the signed-in user's permanent record.
- `Crew Management` → `Sign Off Sea Miles`: Captain/MOV-only pending review queue.
