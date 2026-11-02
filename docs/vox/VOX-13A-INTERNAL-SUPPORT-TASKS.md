# VOX-13A — Assigned Service Desk internal follow-up (source-only)

This adds a **staff-only, internal-only support follow-up task** to native QuickFurno Vendor CRM. It does not introduce a competing case ledger, send Meta/WhatsApp replies, change case status, or update wallet/lead/matching. The existing `createVendorTask` service remains the writer.

- Core path: `POST /api/vox/v1/support-task`; Web BFF: `POST /api/support-task`.
- Core verifies real Supabase Auth user and AAL2, active staff/team/city/object grant. Client supplies only `threadId`, `nonce`, `priority`, `dueAt`. The vendor ID comes exclusively from the canonical support thread; vendor service zone is rechecked in Core before insertion. Closed/unknown support-case states and unassigned/cross-city targets fail closed.
- Creates fixed `task_type=complaint`, non-PII title, 5-minute to 30-day due date, hashed identity/case/nonce idempotency key. Retries preserve nonce; ambiguous results do not count as success in the UI.
- Web `SupportFollowup` form is server feature gated and bound to Core-assigned cases. The browser never receives Core bearer, provider credentials or privileged vendor IDs. Origin+Host validation and body allowlist apply to POST.
- Core `VOX_SUPPORT_INTERNAL_TASKS_ENABLED` and Web `VOX_SUPPORT_TASK_UI_ENABLED` are both absent/disabled in live configurations. **Never enable until private signed staging has real owner/staff MFA, cross-city IDOR, revocation, case status, race/idempotency and rollback certification.**
- Because native `createVendorTask` currently uses a read-before-insert idempotency check, this source milestone is **not** an independently proven concurrent exactly-once database transaction. Ensure unique task idempotency constraints and concurrent replay certification before activation.
- Service Desk **provider replies, attachment handling, SLA assignment/escalation and closure** remain pending. Approved `SUPPORT_REPLY` operational proposal remains non-executing.

Evidence: Core 30/30 new checks, Web 16/16 new checks; existing 343 Core source checks and strict portability pass, Core+Web TS and optimized Next build passed locally. Dedicated Linux CI required on exact PR head; no real table rows changed.
