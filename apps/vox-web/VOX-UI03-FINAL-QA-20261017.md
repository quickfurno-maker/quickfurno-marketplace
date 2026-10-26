# VOX UI-03 — final local design freeze candidate (17 Oct 2026)

**Classification:** SOURCE-TESTED LOCAL UI. **NOT** authenticated staging or production certification. No Core grants, Staff identity, managed SQL, vendor or customer data, WhatsApp, payments, Cloudflare, Traefik, or VPS services were changed.

## Implementation tracks (completed as source)
1. **Unified discoverable navigation:** grouped sidebar; scoped search of rendered navigation items with `/` shortcut, max 65 chars, keyboard focus and bounded UI state; responsive horizontal navigation for smaller displays. In local preview, only Mission Control and design-only Staff Management are clickable. All other private modules are visibly LOCKED and are not linked from the preview.
2. **Role-focused experience:** client-side *display-only* Admin/Superadmin, Team Leader, Staff Member panels showing relevant responsibilities. `aria-pressed` buttons present distinct operational focus and explicitly say NO PERMISSION CHANGES. This is **not** role switching or an Auth/claim bypass. Admin cannot approve own first Team Leader; actual AAL2 and Core grants remain prerequisites.
3. **Staff administration UX:** improved bounded directory searching with roster-state filter for already-authorized Core DTOs; local department/catalogue search and clearing non-saving selections; planning-only lifecycle cards for Joiner/Mover/Leaver; preserved disabled invitation button and actual `fetchAdminStaffCapabilityCatalog` route gate.
4. **Safety and accessible behavior:** explicit preview badges and empty metrics; no fake counts, staff or cases. Search bounded; keyboard navigation, disabled/unavailable role controls and responsive layouts. Nothing adds a new authentication system.

## Source and browser QA evidence
- VOX Web `npm test` — PASS (includes expanded `validate-unified-preview.mjs` **24/24** source security checks).
- VOX Web `npm run typecheck` — PASS.
- VOX Web `npm run build` (Next.js 16.3.8) — PASS, standalone output.
- Browser Puppeteer UI-03 QA outside Git tree at `D:\QuickFurno-Workspace\VOX-UI03-BROWSER-QA-20261017.cjs` — **23/23 PASS**, covering Admin/Team Leader/Staff preview switching, search, keyboard shortcut, disabled protected links, department filter/reset, empty directory, non-saving lifecycle, route denial, mobile 320/390/760/1280 no overflow, no JS page exceptions.
- Loopback standalone **production-mode**: `/` HTTP 200 with locked holding page, `/preview/staff-management` HTTP **404**, protected Core overview HTTP **503**, actual Staff Management displays access gate, `/login` HTTP 200 with operations disabled, `/api/health` HTTP 200. CSP does **not** allow unsafe-eval in production.
- Desktop screenshots: `D:\QuickFurno-Workspace\VOX-UI03-mission-desktop-20261017.png` and `D:\QuickFurno-Workspace\VOX-UI03-staff-desktop-20261017.png`. All screenshots are synthetic local UI with no real user data.
- Isolated Git branch `feat/vox-login-ui-review-20261017`, based on prior login UI commit `d2971c68841bb63e910fed45ab1c538cd2853c46` and unified UI commit `71248327641e01399582d1bcff6b471bd8d951f7`. This work's final commit to be recorded separately.

## Real integration still outstanding
- Authenticated protected staging connection to live Core/Supabase user/role grants, verified MFA AAL2 and independent first Team Leader bootstrap.
- Staff creation/invite, grant/revoke, scoped routing, EOD, chats and all data-connected actions require reviewed server-side handlers + source-specific Core instrumentation and isolated/load/E2E QA. The current screen cannot actually create staff accounts, approve requests, or modify access.
- Independent human DBA/AppSec/migration reconciliation and signed Owner GO; Cursor AI review is helpful second pass, but **not** human signoff.
- Signed immutable staging image, rollback, Core/Jarvis/AGNI deploy approval, Cloudflare/Traefik public route and production certification.
- No SQL migrations, deploys, credits, matching or external sends in UI-03.

## Result
UI-03 implementation meets its *design review* objectives under local-only safety controls. Public `vox.quickfurno.in` remains intentionally offline pending release gates.
