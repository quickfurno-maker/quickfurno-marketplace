# QuickFurno — Phase 3B-14 A–E internal parallel implementation (24 Oct 2026)

**Source baseline:** `9e39178d9a86ae212b19fa9c7f2f55529fa96fa1` (draft #408). **No managed Staging or Production writes, Auth changes, paid ads, external sends or payment changes in this batch.** External DBA/AppSec engagement deferred by Owner, not treated as approved.

## A — Rehearse complete TEST marketplace root cleanup, not actual deletion
`scripts/scale/step3b14a-purge-rehearsal.sql` uses actual local PG17.10 with an **intentionally simplified synthetic FK model**, populating:
- 29 vendor roots (27 Pune, two Mumbai), 74 lead roots, 71 lead assignments, 73 assignment events, 135 delivery logs, 81 vendor credit logs, 36 assignment operations, 36 lead matching runs, 41 notifications, vendor dashboard-user links and simulated separate Owner/Staff/Auth identities.
- Proof: race/expected-count mismatch rolls back, restrictive FK prevents blind vendor delete, child-first transaction removes exactly target synthetic roots, no related leftovers in modeled tables, Owner/Staff/9 vendor Auth records and configuration remain unchanged.
- Direct local `psql -X -v ON_ERROR_STOP=1 -f ...` returned `STEP3B14A_LOCAL_PG17_EXACT_COUNT_PURGE_ROLLBACK_FK_SURVIVOR_TEST_PASS`. Local server stopped. An initial Windows PG-start wrapper was nonrepeatable/hung due process lifecycle and was removed; robust isolated `--network none` Docker PostgreSQL17 CI harness is `scripts/scale/step3b14a-offline-ci.sh`; it must pass GitHub exact-head before claiming reproducible CI.
- **Not** a complete Production referential-graph rehearsal, because source mock excludes live's many vendor/lead-linked tables, triggers, unrestricted text IDs, storage objects and Auth-service lifecycle. This SQL MUST NOT be run on Supabase.
- Hard gate: all 29 Production vendors + all 74 leads still present. Fresh 4-schema backup on JARVIS requires Production DB password entered locally by Owner; Oct13 backup is stale. Complete tested rollback and payment/audit retention decisions before real purge.

## B — Core marketplace lifecycle, Riya and assignment controls
- Full local `npm run test:mvp`: **137/137 PASS** (marketplace 87, assignment 26, communication 24).
- Existing source validator Client Journey Phase1: **19/19 PASS**, Riya Phase2 sync: **16/16 PASS** after using repo's actual TS-loader. Both are deterministic/isolated; do not imply outbound WhatsApp delivery.
- Added 3B14 launch contracts under `scripts/scale/step3b14-b-e-contract.test.mjs`: server requires consent, normalized phone, rate limit, duplicate RPC before insert; matcher checks mutating-switch OFF before evaluation/credits, credible launch-control wording.
- Important fact: `auto_assignment_mode='auto_suggest'` persisted in real Production previously. `auto_suggest`/ `preview` can create real assignment and debit credits. Default on unreadable settings is `off`; read-only Owner UI must not conflate fallback with observed source truth. Fixed an **outdated comment** in `services/adminLaunchControlService.ts` (runtime unchanged).
- **Newly observed historical strict test failure:** `node scripts/mvp/matching/validate-qf-mvp-80-01.mjs` passed 86 / failed 1 because strict G05 expects **169** local migration `.sql` files but actual branch contains **162**. Do NOT re-pin a number or delete historical migrations to force green. Reconcile exact source set and multiple environments/ledger 86 deployed versions before launch. This is an OPEN FAIL, although the focused smaller marketplace suite remains green. Public client OTP is not asserted certified from inspected lead-service source.

## C — Public website and mobile/source readiness
- Real read-only HTTP GET `https://quickfurno.in/`, `/enquiry`, `/privacy`, `/terms`, `/vendors`, `/readyz`, and intentional `/pricing -> /vendors` HTTP 307: **7/7 PASS**. Script `scripts/scale/step3b14c-public-readonly-smoke.mjs --live-read-only`. Never used POST, never submitted fake leads, and not run inside CI.
- Two customer entry points include consent and submit through server action; server validates contact and duplicate/rate-limit. Privacy/terms have canonical metadata and state marketplace boundary.
- LIVE `/readyz` is only WEB INSTANCE liveness, deliberately NOT live Google Places, WhatsApp, DB or credits/assignment health.
- No real mobile-device cross-browser, OTP delivery, form submission, vendor signup, accessibility, paid campaign conversion or full provider E2E performed. No broad paid ads while zero genuine vendors.

## D — Governed real vendor onboarding readiness (advisory only)
- Existing vendor onboarding source checks **6/6 scripts PASS** for activation, office request, restricted intake, category isolation, coverage finalizers and admin approval. Older Google Places mock + vendor activation mock each passed 9/9 last phase.
- New pure OFFLINE `assessBetaVendorReadiness` in `lib/vendors/betaVendorReadinessEvidence.ts` and six behavioral tests: fail-closed on approval, active, public, accepting, linked Auth, positive credits, server-verified Google Place/zone, verified office status, category, approved identity-provider attestation, Aadhaar consent attestation and explicit Owner approval.
- **Not wired into live vendor services**. Does not query UIDAI, Google or store raw Aadhaar, docs or OTP. Actual lawful Aadhaar/identity integration, verified evidence and consent protocol require chosen authorized provider, privacy/security/legal decisions and separate governed implementation. A generic `verification_status='Verified'` cannot be treated as Aadhaar proof.
- After purge and verified recovery, onboard first real Pune cohort under existing Admin control; at least three genuinely eligible teams in each promoted category rather than city-wide total.

## E — Continuous testing and release governance
- New source contracts **12/12 PASS**, advisory vendor readiness **6/6 PASS**.
- Full local Core VOX **512/512 PASS**, Finance **88/88 PASS**, Owner **31/31 PASS**, VOX Web `npm test` PASS, Core/Web TypeScript typecheck PASS.
- Expanded `.github/workflows/finance-v2-pay3-hold.yml` to run new source/TS contract checks and isolated PG17 Docker network-none synthetic cleanup. New commit CI results must be measured on exact new SHA; prior #408 7/7 CI is no substitute.
- **No release permission changes.** Protected VOX/Finance migrations, seven same-version conflicting SQL-array hashes, 104 ledger differences, 69 RLS cases, Owner AAL2 + initial Team Leader, credential/backup recovery, Staging signed integration & Razorpay TEST remain blocked.
- The existing QuickFurno website is visible, but **real marketplace launch still NOT CERTIFIED**: test vendor/lead purge pending backup; no genuine supplier cohort or approved credit/lead provider canary.

## Precise nearest blocking actions
1. Owner JARVIS PowerShell, on their schedule: `& "$env:USERPROFILE\QuickFurno-VL05-Predelete-Backup-20261013\Backup-Production-AllTestData-20261024.ps1"`; enter Production database password only locally, then test restore and sign exact-scoped purge.
2. Source-ledger security owner: reconcile G05 169 expected vs 162 current SQL files and seven managed same-version SQL fingerprint conflicts; do not mask count.
3. First genuine Pune service/category cohorts verified with actual provider evidence, then narrow authorized real lead canary (no broad campaign launch until supply).
4. VOX/Finance remain distinct protected release HOLD until database/AppSec/identity/canary controls are satisfied.
