# VOX unified interface — local UI review (17 October 2026)

## Status
**Source implemented, desktop/mobile browser tested. Internal UI preview only; release hold remains.** No managed SQL, public DNS, VPS, Staff Auth, user records, WhatsApp, payment, matching, or provider actions changed.

## Screens
- Unified desktop/sidebar and mobile-scrollable navigation with grouped sections: Command Center; Operations; Admin & Intelligence. All links to actual workflows remain separately Core-gated.
- Development-only Mission Control at `/` when BOTH `NODE_ENV=development` and `VOX_DEMO_PREVIEW=local-only`. KPI values are em-dashes, marked NOT CONNECTED. Priority queue explicitly empty and no fake work events or approvals.
- Development-only Staff Management layout at `/preview/staff-management`. The route responds 404 in production or without preview flag.
- Actual `/team/admin/staff` keeps `fetchAdminStaffCapabilityCatalog()` Core-authority gate; only after verified Core response renders the same component with real permission-limited capability catalog, directory and eligible teams.
- Staff interface contains directory, staff onboarding responsibilities, current team/city scope selector, independent review, MFA activation guidance and a permanently disabled Create & Invite button. Preview catalogue labels are illustrative only; no real user data.
- Login design on the same isolated branch is inherited from `d2971c68`. Local-only styling review; production auth disabled.

## Evidence
- Local Web `npm test`, `npm run typecheck`, `npm run build`: all passed after UI + CSP edits.
- New source security gates `node scripts/validate-unified-preview.mjs`: **15/15 PASS** and appended to npm test.
- Browser automation (Puppeteer; synthetic UI only): **11/11 PASS**, including navigation, non-saving department selection, disabled invitation, protected Admin route, protected Core API and 390px mobile no horizontal overflow.
- Development `Content-Security-Policy` allows `unsafe-eval` only for React local-debugging; production CSP has NO `unsafe-eval` (verified via HTTP).
- Development routes: `/` HTTP 200, `/preview/staff-management` HTTP 200 and `/api/overview` HTTP 503 with feature flags disabled.
- Production (loopback/disabled): `/` HTTP 200 showing locked home, `/preview/staff-management` HTTP **404**, `/team/admin/staff` locked display, `/api/overview` HTTP 503, `/api/health` HTTP 200.
- Desktop screenshots on JARVIS PC: `D:\QuickFurno-Workspace\VOX-Mission-Control-V2-20261017.png`, `D:\QuickFurno-Workspace\VOX-Staff-Management-V2-Full-20261017.png`.
- Mobile screenshots on JARVIS PC: `D:\QuickFurno-Workspace\VOX-dashboard-mobile-QA-20261017.png`, `D:\QuickFurno-Workspace\VOX-staff-mobile-QA-20261017.png`.
- Browser QA harness: `D:\QuickFurno-Workspace\VOX-UI-BROWSER-QA-20261017.cjs` (local tooling, outside tracked repo).

## Locally review
Only on the connected JARVIS PC, after starting dev server from `apps/vox-web` with `VOX_DEMO_PREVIEW=local-only` and `VOX_STAFF_PORTAL_ENABLED=disabled`:
- `http://127.0.0.1:3108/` — Mission Control preview.
- `http://127.0.0.1:3108/preview/staff-management` — full Staff Management UI review.
Do not enter production credentials or infer live grants from the preview.

## Remaining work
- Owner UI approval/feedback and merge of isolated UI branch via normal review.
- Protected Staging Core/Auth credentials, real TOTP AAL2 Staff identity, city/team/object grants, verified personnel catalogue/directory, server-authoritative approval workflows, and actual integration end-to-end tests.
- Independent human DBA/AppSec/release review and first Team Leader bootstrap approval where governance requires it.
- Signed immutable stage image, managed migration reconciliation/review, controlled VPS deployment, Traefik/Cloudflare rollout and Owner GO/NO-GO.

**No bypass of external reviewer requirement has occurred. Cursor AI review may supply additional evidence but is not an independent human approval.**
