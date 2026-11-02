# VOX-06 integrated Core source certification — 14 October 2026
**Scope:** isolated development branch `test/vox-06-core-integration`. **Not merged, not deployed, no migration applied.**

## Integrated baseline
- Source chain: VOX Core #199 staff authority contract → #201 owner Core gateway → #204 scoped-staff tables/membership/city/object grant contract → #205 integrated HUMAN desk.
- CRM #207 `6ec675bf6f67f22169cdca2630c14bcf8bbe03cb` cherry-picked as `361ffe1`; Studio #209 `f142b8cb45f6595f2e381a9ca20d530721682f8a` cherry-picked as `f279f27`.
- Independent VOX web PR #208 `009dea7dc6d1fee1fb79f212e5f55e7bfafa18ab` is stacked on #206 and includes 3 new staff workspace routes.
- Independent Jarvis #325 `79b04dd397a0c3b95c1fd49b0de51cfda66fd456` is stacked on #324.

## Observed full source tests, on integrated Core worktree
```text
VOX_00_ADAPTER_CONTRACT_PASS       20/20
VOX_02_CORE_READ_PASS             13/13
VOX_03_SCOPED_STAFF_PASS          33/33
VOX_04_DESK_PROJECTION_PASS       28/28
VOX_05_CANONICAL_CRM_REUSE_PASS   26/26
VOX_05_STUDIO_REUSE_PASS          12/12
---------------------------------------
VOX_06_INTEGRATED_CORE_SOURCE_PASS 132/132
```
`npm ci --ignore-scripts --prefer-offline --no-audit --no-fund` (489 packages) and `npm run typecheck` on integrated Core **PASS exit 0**.

## Observed independent source and HTTP checks
- VOX independent Next.js web PR #208: shell 12 + MFA 26 + staff Service Desk 15 + staff CRM 16 = **69/69** tests PASS; `npm run typecheck` and `npm run build` PASS. Final production build compiled `/acquisition`, `/vendor360`, `/service-desk`, and matching read-only BFF routes after navigation change.
- Actual loopback production-mode HTTP with `VOX_STAFF_PORTAL_ENABLED=disabled`, `VOX_STAFF_VIEW_MODE=scoped`: all four APIs `/api/acquisition`, `/api/vendor360`, `/api/service-desk`, `/api/overview` → **HTTP 503**. All four pages `/acquisition`, `/vendor360`, `/service-desk`, `/` → **HTTP 200** showing locked/hold UI, no business rows.
- Jarvis signing contract source tests 14/14 and new one-time replay/advisory checks 13/13 PASS. New Jarvis worktree local ESLint cannot load @eslint/js due to missing local node_modules; **GitHub dedicated VOX Jarvis CI passes** on PR #325. Local Prettier PASS. The live replay store is still **NOT wired**.
- Core four-table staff authority SQL previously certified in separate disposable network-disabled PostgreSQL 16: 4/4 RLS + FORCE, 0 browser table grants, service-role-only reads and expected deny to authenticated. **Not applied to real Staging.**
- New Core CRM source reuses canonical `aarohi_prospects`, `aarohi_tasks`, `aarohi_vendor_conversion_links`, `vendor_crm_profiles`, `vendors`, `vendor_tasks` with city/service-zone and object grant filters. Does NOT call pre-existing global Superadmin `listAarohiProspects` unscoped, does NOT duplicate CRM tables or mark conversion links as vendor activation.
- New Studio source imports **actual Core `AUTOMATION_STUDIO_WORKFLOWS`**, but Jarvis Agent Flow, AOS and AGNI integrations are marked NOT_CONNECTED. No fake live health or automated execution.

## Live Staging reachability (non-mutating)
- Windows DNS lookup: `staging-core.quickfurno.in` A resolved to current Jarvis VPS. `curl` public TLS verification **0 = valid**, `GET /` HTTP **200**.
- `GET https://staging-core.quickfurno.in/api/vox/v1/overview` HTTP **404** at time of check, consistent with new Core PRs **not deployed**.
- `vox.quickfurno.in` still Cloudflare proxied to reserved documentation-placeholder target in Cloudflare, not a live VOX app. No DNS cutover.

## Critical release HOLDs — not satisfied
1. Nine+ stacked draft source PRs require independent security review and safe merge/release ordering; promoting Core main might trigger current signed production CI/CD, so do NOT merge merely because source gates pass.
2. Real Staging `vox_staff_teams_v1`, memberships, object grants and audit tables still absent; backup+restore, migration review and external schema certification first.
3. Atomic Core-controlled 2-party provisioning/grant review and revocation has **not been implemented**, so no active delegated staff identities.
4. Genuine synthetic Superadmin and delegated staff Auth enrollment/AAL2, positive bearer roundtrip, negative wrong-role/city/vendor, expired grant and session revocation tests still needed.
5. Native case assignments, SLA, approved replies/takeover and real provider certainty/consent/human pause remain **not integrated**; existing desk is read-only.
6. Automation Studio published version/simulation controls, Jarvis Flow Studio editor and AOS/AGNI status adapters remain **not connected** to VOX; current registry is explicitly informational.
7. Signed isolated Docker Staging deployment, origin private ingress, WAF/security, 24-hour peak load, rollback and final launch certification not performed. VPS upgrade only if measured necessary.

**Overall conclusion:** substantial tested source convergence; no production-ready, live VOX claim. Preserve canonical Core and Jarvis authority and keep public hostname disabled.
