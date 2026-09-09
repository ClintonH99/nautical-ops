# Shipyard List Date Ranges

The Shipyard List is the single source of truth for yard-period work.

- Each Shipyard List job has its own required start date and end date.
- A one-day job uses the same date for both values.
- The end date cannot be earlier than the start date.
- The home-screen Yard Period calendar displays every day covered by each Shipyard List job.
- The home-screen action opens the Shipyard List directly. There is no separate Add Yard Period flow.
- Guest, Boss, and Delivery remain trip types. Legacy `YARD_PERIOD` trip rows are preserved only for migration history and are not shown in the active trip flow.
- Shipyard spreadsheet imports create Shipyard List jobs, never trip records.
- Shipyard PDFs display the job date range and never label it as a Done By date.

## Legacy transfer

- A job linked to a legacy Yard Period inherits that period's start and end dates.
- An unlinked job with a legacy Done By date receives a one-day range on that date.
- A legacy Yard Period without linked jobs becomes one Shipyard List job carrying its available title, notes, department, yard, contractor, contact, and range.
- Legacy rows and `done_by_date` remain intact until a separate, explicitly approved cleanup verifies the transfer.
