# VOX-07 integrated source & isolated SQL certification — 2026-10-14

**Release status: SOURCE CANDIDATE ONLY / STAGING HOLD / NO PUBLIC ACCESS.**

### Exact integration branch
`test/vox-07-core-integrated` derives from `test/vox-06-core-integration` (Core VOX-02/03/04 + Aarohi/VendorCRM #207 + Automation #209) with independent cherry-picks of Staff Review #210 and Staff Grant Activation & Revocation #211. This integration branch is **not another production merge plan**: its constituent features should be reviewed/merged once in dependency order without double application.

### Evidence reproduced together on connected Windows JARVIS worktree
- Core staff source authority contract: 20/20.
- Core MFA owner read gateway: 13/13.
- Core staff membership/city/object grants: 33/33.
- Governed Service Desk HUMAN metadata: 28/28.
- Reuse of existing canonical Aarohi + Vendor CRM: 26/26.
- Canonical Automation Studio workflow catalog: 12/12.
- Two-person staff grant-review receipt: 15/15.
- Reviewed atomic staff grant finalizer / emergency revocation: 38/38.
- **Total combined source checks: 185/185 PASS.** Isolated root `npm ci` and full `npm run typecheck`: **PASS**.

### Genuine PostgreSQL engine (but not live Supabase)
- Isolated `postgres:16-alpine` disposable Docker container, with `--network none` and synthetic accounts/cities/prospects. Executed ALL 4 ordered source migrations: staff teams/scopes, access request review, atomic activation, emergency revocation.
- Approved distinct Superadmin reviewer created one staff membership and one exact-city prospect grant through atomic activation.
- Wrong-city scope, unapproved request, wrong reviewer, duplicate request activation denied.
- Atomic emergency revocation set membership `is_active=false`, closed every active object-scope grant and appended separate uniquely correlated audit incident. Wrong-team, non-Superadmin and replay attempts denied.
- **Final SQL assertion:** one membership (inactive), one object scope (revoked), three audit entries (two grants + one revocation) and two activation receipts. All public/anon/authenticated direct role privileges to grant RPCs absent. Disposable database was removed afterward.
- Verified marker: `VOX07_DISPOSABLE_FINALIZER_PASS member=1 prospect_scope=1 audit=3 activation=2 replay_denied=true wrong_city_denied=true unapproved_denied=true bad_actor_denied=true revoked=true revoke_replay_denied=true browser_grants_none=true`.
- The SQL proves native PostgreSQL transactional behavior under synthetic fixtures, **not** the live Supabase access model or browser-to-Core semantics.

### Deployment gating and product truth
1. As of this audit, live Supabase Staging project `uckafzuochmbvtiodmcl` contains **no** `vox_staff_*_v1` tables. These are **source-only unapplied migrations**; do not assume a staff team or synthetic users exist.
2. `staging-core.quickfurno.in` responded over HTTPS but `/api/vox/v1/overview` HTTP **404** on previous read-only probe; VOX code not signed into that Staging runtime.
3. New Core `POST /api/vox/v1/staff-grants` defaults to **503** unless `VOX_STAFF_GRANTS_ENABLED=staging`. It authenticates a fresh Supabase AAL2 active Superadmin per request before accessing service-role database. Do not set flag in production; first require isolated Staging ingress, rate/Origin control, AAL2 positive/negative HTTP tests, and independent code review.
4. **Emergency revocation** is an explicitly scoped incident-containment exception to dual-person approval of privilege issuance; it cannot grant or publish.
5. Browser VOX Web latest source is #208 (staged gated, 69/69 guards, Next build). It does not yet expose the new staff-grants route or run authenticated browser Core E2E.
6. **Full CRM functional parity remains pending**: existing Aarohi CRM and vendor records reused via read-only projections; staff writes, campaigns, tasks, follow-ups and complete Vendor360 approvals not integrated.
7. HUMAN inbox views are read-only metadata: Core outbox/Meta template consent, message sending, handoff, reply service window, SLA/notifications, signed Jarvis replay ledger not yet production wired.
8. Automation Studio is a real Core workflow **catalog**, not executed/published from VOX. Jarvis Agent Flow, AOS and AGNI remain **NOT_CONNECTED** on actual runtime.
9. Production-safe promotion requires review of the PR stack, staging DB backup and restore, schema permission certification, existing staff identity/MFA enrollment, private signed build/ingress, multi-role and cross-city E2E, 24h resource soak and rollback proof before connecting public VOX hostname.

**No live DB writes, Core main merge, deployment, DNS change, Meta message, vendor activation, finance or other product mutation performed by this source-only certification batch.**
