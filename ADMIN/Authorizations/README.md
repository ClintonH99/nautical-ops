# Authorizations

User hierarchy, roles (crewmember, HOD, etc.), permissions, and access rules.

Reference this folder when implementing or modifying permissions or role-based access.

## Hours of Rest — 21 October 2026

- Only Captain/MOV may edit, approve or sign off another user's Hours of Rest
  within their vessel, subject to existing vessel/device access checks.
- HOD status and historical department-signer assignments grant no review access.
  There is no delegated-approver setup flow.
- Crew/HOD access to their own entries and existing confirmation locks are unchanged.
- Captain/MOV may still review their own entries. Non-compliant hours remain
  saveable; this permission change must not suppress truthful records.
- Preserve historical entries and confirmations. Apply the Captain-only database
  migration before treating the new restriction as enforced against old clients.
