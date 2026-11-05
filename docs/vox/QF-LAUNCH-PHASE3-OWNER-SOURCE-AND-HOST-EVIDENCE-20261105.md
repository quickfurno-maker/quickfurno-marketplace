# QuickFurno Launch — Phase 3 VOX Owner Handoff and Genuine MFA Readiness

**5 Nov 2026. Source-only, Draft, managed Staging/Production and public onboarding remain HOLD.**

## Phase 3 Owner-only scope and ownership
VOX Web is the separate Owner operating interface. Existing QuickFurno Core remains the sole vendor case authority and enforces current signed Owner AAL2, Superadmin and immutable caseVersion in the Core queue/case/decision routes. Do not create second vendor decision, matching, credit, payment or evidence stores. Staff dashboard and Team Leader integrations remain frozen. Automation Studio remains in JARVIS. Owner data reads are narrowly projected and contain no raw identity documents, private URLs or phone numbers.

## Parallel source changes
1. **Owner review UX:** existing `apps/vox-web/app/owner/vendors/verification` only renders after Owner read feature gate + real `verifiedMfaSession`. On mount, the client requests the canonical Core pending queue through the existing VOX same-origin BFF. New `ownerReviewUiGuard` verifies exact queue (20 max, distinct vendor IDs, no extra PII fields), case snapshot and vendor ID/version. Approval availability now requires **Core's explicit `readyForCoreApproval===true`** in addition to independent contact, identity, office, category, zone, consent and evidence checks. This is browser defense-in-depth, **not** independent authorization; server/Core AAL2/RLS/CAS remains decisive. The Owner case decision still does not directly activate a vendor or consume credits.
2. **TOTP request security:** on the same existing Owner/VOX Auth route, replace `await request.text()` with a real **256-byte streamed request cap**, not trusting `Content-Length`. Strict UTF-8 and JSON, exact allowed fields (code only for challenge, code+factorId for enrollment confirmation), fail-closed on bad lengths, malformed content, unknown fields. These checks occur before Supabase Auth calls; the verified GoTrue TOTP AAL2 gate and same-origin CSRF remain intact. No production identity, real MFA or provider calls in tests.
3. **Image/provenance evidence:** new `scripts/mvp/vox/owner-phase3-image-precheck.mjs` compares local Git HEAD with exact OCI source-revision labels, local RepoTags and content-addressed RepoDigests through existing read-only Docker inspector. It **never** builds, pulls, runs, pushes or deploys, and **cannot** authorize Staging, Owner reviews, decisions or Production even if local images match. It still requires independently authenticated deployed-host Web and Core digests, real Owner Cloudflare Access→TOTP AAL2 browser UAT, Core read/CAS tests, managed migrations and signed recovery/rollback.

## Local source QA and truthful current evidence
- New Owner queue/case/BFF UI negative tests **6/6 PASS**.
- New TOTP streaming/auth-negative tests **6/6 PASS**; existing auth script continues PASS (its own static summary reports 27 checks despite a legacy '/26' suffix).
- Local OCI provenance tests **4/4 PASS**, and existing owner image/Core bridge tests retained.
- Combined branch targeted Phase 3 Web tests **12/12 PASS**, Web TypeScript PASS, existing native VOX Web regressions PASS, Core TypeScript PASS, Owner/Core image/bridge suites **12/12 PASS**; historical G1 source/migration guard **334/334** assertions PASS with **153/153** mutations rejected.
- JARVIS actual local image precheck at integrated Phase 2 SHA: **VOX Web local image missing**, Core historical QA image revision mismatched; `localPairSourceVerified=false`, `releaseDecision=HOLD`. A local image label or old QA image **does not describe the deployed host**.
- All green statements above refer to local source/mock/disposable checks. A clean or complete CI pipeline is NOT a signed deployment/production GO. GitHub exact-head outcomes must be recorded after the Phase 3 draft push.

## Protected Staging / Owner UAT checklist (NOT executed)
1. Separate Owner approval, read-only first: capture verified running VOX Web and Core container IDs, immutable image digests and OCI labels, signed provenance against the **actual reviewed PR commit**; preserve sanitized hashes and rollback digest. Do not infer current runtime from tags.
2. Establish Cloudflare Access protected route and public-origin pinned session; verify Owner sign-in with correctly configured MFA factor; test AAL1 denial, AAL2 admission, expired/revoked/forged session denial and user-not-Superadmin denial. **Do not collect or store a real TOTP/OTP value in notes.**
3. Reconcile seven exact source-pending vendor SQL migrations against real approved Staging ledgers/catalog, private bucket, scan receipt permissions, RLS/grants and the isolated backup/recovery exercise. Core queue/case/decision cannot pass a true positive with uninstalled SQL.
4. Enable read-only gates only after independent Staging certification. Confirm one synthetic vendor queue with 20-item cap, no PII/private evidence URLs and immutable case version. Deliberate case-version mismatch rejects a decision. Decision gate remains independently OFF until separate explicit approval. A verified case is **not** vendor business activation, lead assignment or wallet credit mutation.
5. Sign backout: exact previous image digests/config version, isolated snapshot and restore exercise, alerting, DNS and Cloudflare rollback plan. Production and public vendor signup remain HOLD until distinct Owner Production GO.

**Never claim completed external access, real image attestation, real Owner MFA positive UAT, signed rollback, scanned real identity proof or managed SQL installation from this internal packet.**

Notion: https://app.notion.com/p/40f751ba167c819d8827cb89a5340dcc
