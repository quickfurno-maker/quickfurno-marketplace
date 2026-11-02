# VOX RC9 — Tracks A–F Parallel Integration Checkpoint

**30 October 2026 · Protected PR #450 · SOURCE / DISPOSABLE ONLY · RELEASE HOLD**

**Scope:** Complete an actual internal integration round with A/B high-priority corrections; C recovery; D feature inventory and Finance source validation; E real GoTrue/PG QA; F release manifest. No managed Staging or Production modification, no payment/provider activation, no real human key enrolment, no migrations activated. RC8 protected PR baseline was `52a5ae1a8e15359064af45da01f7efbb9b6df7f0` (155 CI pass, 1 skipped). RC9 head must pass NEW exact-head CI after commit.

## Track A — Core conversation writer: schema-faithful destination/city/identity validation
- **Fixed a serious source-to-live-schema mismatch:** RC8 Core writer incorrectly read `marketplace_service_zones.city_id` which does **not exist** in the canonical `20261001144025_qf_verified_location_geofence_straight_line.sql`. RC9 resolves an active `public.cities.id` through a strict `lower(btrim(cities.name)) = lower(btrim(marketplace_service_zones.canonical_city))` join; requires active city and active/matching-enabled zone. Because cities.name is **not unique**, a duplicate produces two rows and is denied. No arbitrary fallback to a different city.
- **Strengthened actor revalidation:** native transaction now joins `auth.users` to require current server-owned `qf_principal='vox_staff'` and NO `admin_role` while rechecking active `profiles`, Staff membership/role/team, current city, departmental capability, exact conversation object grant, and canonical D2-C consent on one real SERIALIZABLE transaction.
- **Real PG17 verified:** `node scripts/mvp/vox/validate-vox-rc8-real-pg-vendor-core.mjs` **PASS**, now uses actual canonical columns `cities(name,is_active)` and `marketplace_service_zones(canonical_city,is_active,matching_enabled)`, actual `auth.users.raw_app_meta_data`. Positive vendor TAKEOVER + event + nonce in one transaction; negative nonce replay rollback, D2-C STOP, disabled zone, duplicate canonical city, revoked current Auth metadata and revoked membership, no provider send.
- **Still BLOCKED for production:** no approved canonical AB7B original source-row binding, no client/prospect city resolver, no trusted Auth-to-Native Staff AAL2 bridge, no approved minimal database role. `CORE_CONVERSATION` SQL check and production route remain hard-off.

## Track B — Signed approval pending intent: current Auth identity revalidation
- Pending-intent PG writer now **locks current** `auth.users` alongside `profiles` for Owner and Team Leader: Owner requires `admin_role='Superadmin'` and active admin profile; TL requires `qf_principal='vox_staff'`, `vox_role='team_leader'`, no admin role, active neutral profile, correct active team/city and unrevoked TL membership. These checks happen inside the same SQL transaction before signature verification and claims/intent persistence.
- Real PG17 harness now builds an actual `auth.users` fixture with scoped metadata; **PASS** for valid synthetic Ed25519 Owner+TL signature pair and 3 claims / 1 immutable pending intent, replay/tamper/key/TL revocation and Owner/TL Auth metadata revocation. Still **synthetic signers** and test-only writer; NO real human approval or official EOD enabled.
- Human signing key ceremony, genuine independent AAL2 sessions, qualified DBA/AppSec signer-role approval, DB-native trust validation and final release decision remain P0.

## Track C — Isolated recovery and ACL parity
- Re-ran the existing deterministic owner-only ACL replay probe on local disposable PG17 using all **30/30** source SQL files. Corrected catalog parity **TRUE** after exact owner-ACL replay; strict baseline full-fidelity parity **FALSE**, exit nonzero. Lossy restore differs. This is a successful local diagnostic, **NOT** certified managed recovery. Qualifying roles/ACL/Auth/Vault/Storage/PITR and independent review remain external blockers.

## Track D — Operational features
- Existing RC7 default-disabled Owner Finance read-only Core API and VOX Web `/finance` remain present, with no payment changes.
- Reviewed 11-feature source matrix: Staff lifecycle, Vendor360, CRM/Aarohi, Desk, Automation/Studio, Work, official EOD, Finance. Not all feature flags are enabled or managed Staging-accepted. Finance V2 full payment-attempt history, refunds, credits and operational security remain incomplete. No false feature activation.

## Track E — Continuous, real auth and QA
- Genuine local **GoTrue + PostgREST + PostgreSQL + actual Core owner route** integration: **8/8 PASS**, including real local GoTrue TOTP AAL2, anonymous/wrong-signature/AAL1/expired/revoked deny and read-only HTTP verb checks. Genuine MFA only for synthetic local identity; not live Owner MFA.
- Native PG17 Core + signed pending-intent positive/negative integration tests **BOTH PASS** separately; loopback containers removed.
- Source-only RC4 orchestrator: **114 suites / 756/756 PASS**, verdict `SOURCE_PASS` and `releaseDecision=HOLD`; local report SHA256 `03752768e9afaebcc30003e4277d416d59939695d59863d15e460b11fb5dd382`.
- Core `npm run typecheck` and Next.js 16.4.1 `npm run build` **PASS**. VOX Web pinned Next.js 16.3.8 `npm test` **PASS** (including unified preview 24/24), `npm run build` **PASS**. Real managed Staging/Production E2E still BLOCKED.

## Track F — Provenance/release evidence, not deployment
- Added `scripts/mvp/vox/rc9-release-evidence-manifest.mjs` with tests **2/2 PASS**. Automatically computes SHA256 for 11 critical protected source candidates and explicitly records `releaseDecision='HOLD'`, `signatureStatus='UNSIGNED_NOT_PRODUCTION_ATTESTED'`. Deterministic source bundle SHA256 `44b09e3893498d24c6d1e6c3352178de16b7c94618094cfd0f35fe87f8fc9dfd`. Local untracked JSON SHA256 `cd62f9564bfe729dd45ca023398ad4d93616598e1cd3735afb1d27ac8724e161`. These are hashes, not cryptographic release signatures.
- Do NOT install `ops/vox/rc7-review-candidates` SQL in managed Supabase; it is excluded from migration discovery. Keep quarantined SQL and source-only gate untouched. Commit to the same protected Draft PR; wait for exact-new-commit CI.

## Parallel assistant execution
- Claude Code 2.1.312 is installed on JARVIS. Two explicitly read-only bounded parallel audits were initiated (Core schema and approval trust boundary), but **both exceeded the configured USD 1 spending limits before returning usable findings**. No Claude-derived changes, test verdicts or sign-offs were accepted. The canonical source audit and fixes above were performed and tested directly.

## Hard acceptance / final launch gates
**RC9 IS NOT A fully functional managed Staging release, nor a production-ready VOX.** Still required: reviewed deployable Core original AB7B conversation source writer with client/vendor scope and trusted real Auth AAL2; signed EOD/operator writer bound to human-ceremonied Owner and distinct Team Leader keys and qualified independent verification; strict managed recovery + DBA/AppSec decision; full Finance and remaining feature E2E; authorized managed Staging install, 401/403/200 Staff/UI/business acceptance; independent Owner Production GO. All managed flags, releases, marketplace activation and human grants stay **HOLD**.
