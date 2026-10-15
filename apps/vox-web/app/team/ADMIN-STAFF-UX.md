# VOX Team Operations UI: one ADMIN, one STAFF experience

**Product decision approved 15 October 2026.** Owner and Admin are a single account/experience, labeled **Admin**. **Staff** is the second account category. Team Leader is an extra permission and workload view assigned to eligible Staff, not an independent admin account.

## Main navigation

### Admin home (after independently verified Core owner session)
- Overview: cross-team workload, exceptions, alerts, pending independent approvals and cross-city report drilldown.
- Assignments: governed claims/transfers/ownership and capacity visibility.
- Queues: team workload, pending, escalated, SLA risk, waiting external/owner.
- Inbox: Core-governed customer/vendor conversations and internal team chat. No new WhatsApp send service.
- Team: staff list, roles, membership, workload, access requests and suspension/revocation history.
- Reports: staff EOD submissions, TL acknowledgments, per-city and per-team aggregate metrics.
- Approvals: Core-owned final activation actions after distinct permitted reviewer (no self-review).
- Settings: operational business calendars, workload policies and approved app preferences; not unrestricted service configuration.

### Staff home (verified neutral AAL2 staff identity and exact Core grants)
- Today / My Work, authorized Queues, permitted Inbox, Team, Daily Report and Help/Escalation.
- Team Leader capability adds exact-team capacity/assignments, team read views and independent review queue; it **does not** add Admin, superadmin, cross-city, payment, approval activation or AGNI owner permissions.
- Auditor capability uses permitted read-only report/audit views, no mutation or provider sends.

## UX and implementation cautions

- A single responsive shell, shared components, and role-filtered navigation. Avoid two unrelated dashboard codebases or multiple auth services.
- **Do not show Admin as an available self-select role** on sign-in/invitation/signup forms. Never resolve authority by URL `?role=admin`, client headers, local storage or mutable email/user metadata.
- Actual Admin indicator must come from the existing Core owner verification path and current session with AAL2; for Staff use Core's neutral staff checks, membership and team grants. Every Core action rechecks authorization server-side.
- Status, unread counts and report metrics are real, permission-scoped, freshness-labeled Core projections; no dummy counts or unrestricted exports.
- During TO-01 the web workspace is a closed-mode **read-only staff preview**. Admin dashboard, assignment writes, chat sends and EOD publishing are not activated by this document. TO-02/TO-03 introduce controlled work after security review.
- Keep default `VOX_TEAM_WORKSPACE_ENABLED=disabled`. Never force release/merge/deploy or bypass the separate human GitHub reviewer.
