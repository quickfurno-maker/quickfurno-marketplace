# VOX-09 — Staff workbench and owner AOS observation

**Source-only development; no deployment or positive Staging Auth test.**

Acquisition, Vendor 360 and Core HUMAN Service Desk use the same accessible `ScopedQueue` client component. Search by assigned ID/name/status, status selection, attention filter, counts, filter reset and empty states operate *only on the already scoped 12-record Core DTO*. There are no new prospect, vendor, support, case or message databases; no unscoped search, credit change, vendor approval, WhatsApp send or CRM mutation.

New `/intelligence` and `/api/intelligence` are owner-only BFF screens. They require three independent gates `VOX_STAFF_PORTAL_ENABLED=staging`, `VOX_STAFF_VIEW_MODE=owner`, `VOX_INTELLIGENCE_VIEW_ENABLED=staging`, a genuine verified MFA server session and the pinned HTTPS staging Core origin. They read Core `/api/vox/v1/aos-health` (implemented source-only in VOX-10). A second DTO whitelist accepts only observation counts and safe source-authority markers; no model traces, vendor IDs or raw recommendations. AGNI is labelled **NOT_CONNECTED**. This is not an autonomous AOS interface.

Local guard suites include shell 12, auth/MFA 26, staff desk BFF 15, CRM BFF 16, new workbench controls/owner AOS 20. Next build & disabled HTTP certification should be checked before PR promotion. Staging, Core main, host and DNS remain untouched. Full profile mutations, SLA cases, real Jarvis/AGNI links, approved sends/automation remain future gates.

## Additional Team Leader access review workbench (source-only)
`/staff-reviews` displays ONLY pending Core team-scoped review requests through a server-only MFA BFF and new Core VOX-09 `GET /api/vox/v1/staff-review-queue`. Reviewer can confirm APPROVE/REJECT through same-origin JSON `POST /api/staff-reviews`, which generates a server-side unique correlation ID and forwards to the existing Core atomic `qf_vox_review_staff_access_v1` workflow. Team Leader review cannot itself issue a staff grant; owner finalization is separate. Feature flags default OFF and no real Staging identity or database was provisioned. No user emails/phone are displayed or logged.
