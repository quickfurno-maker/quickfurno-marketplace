# F20 — Internal-only Owner / document scan / assignment protection and offline PostgreSQL recovery

**7 November 2026 — INTERNAL FIRST, EXTERNAL LAST.** Draft and NO DEPLOY / NO SEND. F19 base exact SHA `ee70537221512f94cea8f339c4bb9c192af71d40`. Reuse existing Core and VOX Owner bridge, do not rebuild Owner/Staff screens.

## Track A — Cross-layer source and Owner/Staff QA

Verified existing real Core endpoint `app/api/vox/v1/owner-vendor-verification-case/route.ts`: Superadmin Owner AAL2 bearer is independently revalidated before privileged write, bounded payload 2048 bytes, strict case version and action allowlist, same-origin validation, no browser-selected reviewer ID. The service-role RPC writes only the immutable Owner review decision and returns no document bytes; it does **not** activate vendor business status, spend or grant vendor credits, or assign leads. The standalone VOX decision BFF enforces browser Origin, validated form, signed AAL2 Core bridge and no service-role direct write.

Actual JARVIS `VOX_FINAL_INTERNAL_REGRESSION_PASS 161/161` source-only; marketplace/assignment/communication 137/137 PASS; full TS typecheck PASS. F10 cross-phase recert `valid:true`; F18 ten managed migration source parity `valid:true`. Original historical protected F1/F5/F6/F7 checks still fail their exact old per-branch diff/hash rules on stacked changes. Do not disable, waive, or silently rewrite them; formal integrated release acceptance is still pending.

New F20 verifier `f20_verify_owner_scan_internal.py` checks source-side protected seams against regressions. **21 hostile mutation tests PASS**, including deliberate removal of scan receipts, content SHA link, clean verdict, case version, immutable receipt trigger, browser permission revokes, assignment trigger, post-approval recheck, owner role/AAL2, VOX Origin and Core-only bridge, and F17 release HOLD.

## Track B — Real private-scan / approval / assignment SQL on disposable Postgres 17

Actual **local Docker PostgreSQL** restored existing **Nov 5** logical Staging snapshot, replayed all **10 F18-verified November migrations** and then executed `f20_private_scan_isolated_postflight.sql` against the *actual parsed PostgreSQL objects*. The check ran in a separate transaction with `ROLLBACK` and the entire disposable container was removed.

**PASS:** immutable `qf_vendor_private.verification_scan_receipts` table RLS and BEFORE UPDATE/DELETE trigger; anon/authenticated denied reading/writing receipts and executing scan queue/receipt functions; service_role-only narrow scanner ledger; latest-case `qf_vendor_verification_case_ready` requires immutable office evidence receipt with matching SHA256, ClamAV engine and clean verdict; review decision RPC rechecks readiness before committing approved state; `trg_qf_vendor_new_assignment_verification` present on new assignment inserts/updates; randomized nonexistent vendor readiness FALSE; fake scan for random nonexistent evidence returns `denied`. **Actual recovered local scan receipt count 0**.

This is negative integration certification with real local PostgreSQL function/permission/trigger definitions, not a real ClamAV scanner run and **not** a live managed backup or Auth/Storage object-byte restore. Because ClamAV remains Owner-deferred, scan-dependent approval/assignment/credit usage must remain fail closed. No fake clean scan receipt was written.

The first isolated test failed due to a mistaken PostgreSQL UPDATE trigger bit assertion in our *test only*; fixed the audit (BEFORE=2, UPDATE=16, DELETE=8) and independently reran the full restore/postflight successfully. Both executions removed the local container. No actual application SQL changed.

## Track C — Local release/rollback evidence, no provider operations

JARVIS existing F17 exact source Docker image remains archived in local Releases, 227,779,072 bytes, SHA256 `c2eb6c782a76496633834fac9355970ceb1602a0f5600f82ca4b779de1ab626c`. This is an **integrity checksum, not a publisher signature**. F19 already demonstrated 17/17 offline Docker HTTP endpoint checks with no network, external tokens or published ports. F20 confirmed immutable archive bytes and F17 source/release verifier; no image promotion or restart attempted.

F20 evidence file `docs/launch/qf-f20-internal-closure-evidence-20261107.json` stores only aggregate counts, policy outcomes and image/checksum metadata. Raw database dumps, scanner output, private document bytes, contact data, OTP and credentials remain outside Git. No managed Supabase, Meta Graph or VPS changes performed.

## Current GO/NO-GO

**Internal F20 local SQL and source certification PASS. Deployment remains HOLD.** Internal tasks still to continue: protected integration release packaging/review, more Owner/Staff positive local-only API/role tests, comprehensive vendor privacy/document consent review and local rollback drill from tagged image/digest. External last: rotate/revoke earlier exposed Staging service-role/Meta credentials (P0), independently check actual Meta and Supabase Auth Hook callbacks and separate WABA secrets, fresh managed DB/Auth/Storage recovery, image publisher signing/Owner GO, live consented test OTP. A previous mandatory-Aadhaar business request conflicts with current voluntary-Aadhaar alternative-ID copy; resolve in legally reviewed product policy before real document approval. No PAN, optional GST and email, WhatsApp OTP mandatory. Production and live Staging untouched.
