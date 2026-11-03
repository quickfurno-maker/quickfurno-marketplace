# VOX Basic V1 — Owner-only integrations (source candidate)

**Scope:** Existing VOX Web, actual Owner/Superadmin only. Staff, Team Leader, attendance, shift management, live meetings, signed EOD, and Staff chat remain frozen and unchanged. This branch does not install managed SQL, create staff principals, or deploy.

## Already built / reused

- Supabase Owner MFA and verified Core Superadmin bearer, with live active-profile revalidation.
- VOX Owner Operations dashboard, Owner Intelligence, finance read previews and existing staff-scoped UI preserved.
- QuickFurno Core Admin for actual vendor review, CRM changes, Aarohi outreach, manual lead assignment, support, audit, packages, and payments. **Never create parallel write authority.**

## New integration

- `GET /api/vox/v1/owner-workspaces?kind=vendor360|acquisition|desk` on QuickFurno Core.
  - Private staging only; explicit `VOX_OWNER_WORKSPACES_ENABLED=staging` and `VOX_OWNER_WORKSPACES_STAGE=private`.
  - Authenticated Owner AAL2; Core role=admin, active profile, signed `app_metadata.admin_role=Superadmin`.
  - Fresh Owner re-verification **after** all bounded database reads and before response; PII excluded by selective columns and safe projection; no contact details, message bodies, provider IDs or balances.
  - Max 12 recent records per section; not an exhaustive directory. Strict kind filter. POST/PUT/PATCH/DELETE return HTTP 405. No Staff grant table reads.
- VOX Web `fetchScopedCrm` and `fetchScopedServiceDesk` branch to that Owner-only endpoint **only** in `VOX_STAFF_VIEW_MODE=owner`. All original Staff and dual-mode paths stay intact.
- Owner screens reuse existing pages, hide Staff proposal actions in Owner mode and link Owner actions to canonical protected Staging Core Admin. Staging-origin pinning prevents accidental Production actions.
- Owner approvals page uses canonical Superadmin vendor/lead approval links; frozen Staff-proposal ledger is not required.
- Owner Finance preview can be read under the new isolated Owner staging gate without enabling Staff grants. **Read-only**, still separately gated by `VOX_FINANCE_READ_ENABLED=staging` on Core and `VOX_FINANCE_READ_UI_ENABLED=staging` on Web, never refunds/activates or reconciles.

## Proposed private-Staging activation checklist (HOLD until authorized)

1. Use reviewed, signed and pinned Core + VOX Web images. Back up and record rollback digest. Confirm Cloudflare Access, Full (strict), origin authentication, and existing Owner TOTP are working.
2. Core env: `VOX_OWNER_WORKSPACES_ENABLED=staging`, `VOX_OWNER_WORKSPACES_STAGE=private`. Preserve `VOX_STAFF_READ_ENABLED` and Staff grants **OFF** unless separately approved for Staff (not in this release).
3. VOX Web env: `VOX_STAFF_PORTAL_ENABLED=staging`, `VOX_STAFF_VIEW_MODE=owner`, `VOX_OWNER_WORKSPACES_ENABLED=staging`, `VOX_OWNER_WORKSPACES_STAGE=private`, `VOX_CORE_ORIGIN=https://staging-core.quickfurno.in`.
4. Keep `VOX_OPERATIONAL_PROPOSAL_UI_ENABLED`, `VOX_VENDOR_TASK_UI_ENABLED`, `VOX_FOLLOWUP_PROPOSALS_WEB_ENABLED`, provider sending, real credits, Finance writes, and official EOD **OFF**.
5. If separately approved, enable only **read-only** Finance flags on Core and Web. No live payment activation.
6. Genuine Browser UAT: Cloudflare Access -> existing Owner login -> TOTP AAL2 -> Operations -> Vendor 360 -> Aarohi -> Service Desk -> Owner Approvals -> Finance. Validate actual records, empty states, navigation to **Staging** Admin routes, and unauthorized requests without MFA.
7. API smoke: no bearer returns 403, invalid kind 400, POST 405, Owner with verified AAL2 gets a non-PII 200; verify no untrusted data; revoke TOTP/session and confirm fails closed. Check Cloudflare Access no open origin.
8. Restore by switching both Owner-workspace flags OFF and rolling back signed images. No database migration or managed ledger aliasing needed for this slice.

## Certification

Source local: 18/18 Owner/projection/Finance tests, 6/6 Owner Web BFF tests, complete existing VOX Web suite, root Core typecheck, Web typecheck and compiled Web build (Webpack locally because linked worktree dependency directory is outside Turbopack root). GitHub exact-head checks required before promotion.

**Not certified:** Managed Staging positive Owner session, signed deployment/rollback, Production, live money/credits, provider messaging, end-to-end first vendor contact, independent external DBA/AppSec. Leave all in HOLD until their gates pass. Staff source stays frozen.
