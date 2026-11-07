# QuickFurno F19 — Internal-only regression repair and real local integration certification

**Date:** 7 November 2026

**Mode:** INTERNAL FIRST; leave ALL external dependencies until final release batch.

**Scope:** Marketplace Core, Vendor signup/Login, Client–Vendor isolation, VOX Owner + Staff, deterministic matching, local Docker HTTP, isolated DB recovery.

**Release:** HOLD. No Meta sends, managed Supabase mutation, Staging/Production deployment or external configuration.

## F19 changes — actual internal issues repaired

### 1. Legacy marketplace suite: five outdated expectations

The original `npm run test:mvp` exposed **five** failing marketplace test assertions (82 pass/5 fail), while the separate assignment+communications suites passed. The failing assertions pinned old password-based vendor registration and old vendor portal copy after the approved WhatsApp OTP+atomic Pending migration; one asserted the retired success heading. After reading the *actual* shipped `components/VendorRegisterForm.tsx`, `app/vendor/page.tsx`, `components/vendor/VendorPortal.tsx`, and `app/api/vendor/onboarding/complete/route.ts`, updated **only tests**, not production route logic:

- The client wizard must call `POST /api/vendor/onboarding/request-otp` exactly once and `POST /api/vendor/onboarding/complete` exactly once, validate OTP, require registration consent, and never call retired `submitVendorAccountRegistration` or a password signup flow.
- Server authority stays at the signed Supabase OTP and `enrollPendingVendorAfterWhatsappOtp`; same-origin, bounded request, provider gate, consent and Pending/no credits must remain fail-closed. The client cannot insert a vendor or bypass the Owner review.
- Current page metadata states **mobile WhatsApp verification and separate Owner approval** rather than old lead promises. The success heading is `Application submitted for verification`; all inline wizard steps and success headings remain h2, modal dialog heading remains h3.
- The original Google Places coordinates, city compatibility, category source, privacy and tracking, no device-geolocation, no PAN, optional GST/email, and matching eligibility requirements are still checked.

**After correction:** `npm run test:mvp` — **137/137 PASS**, three suites (marketplace/assignment/communications); original change had five false-negative legacy assertions. No production app file was edited.

### 2. Assignment runtime setting — protected fail-closed invariant

`npm run test:mvp:80-04` initially reported **32 PASS / 1 FAIL**: its original historical migration ledger pin was **162**, while the current repository correctly includes the ten Nov 4–6 migrations that F18 independently certified against real managed Staging SQL. The invariant was updated **without editing the 162-file historical ledger**:

- `80_04` itself may introduce **no migration or seed**, and missing/error/invalid runtime modes still evaluate to `off`.
- The only additions admitted are **exactly ten unique F18 ledger-version/file identifiers**, which must all exist and match their pinned SHA-256 source bytes; repository count must be precisely historical count + 10.
- No unknown migration may pass just by bumping a counter. All prior mutation/halt/no-credit-spend tests remain active.

**After correction:** `npm run test:mvp:80-04` — **33/33 PASS**.

### 3. Real offline runtime, database, and staff regression

- **Vendor two-WABA/source tests: 208/208 PASS** using original Riya/Anisha signatures and F16 time-limited RED canary tests; both accounts remain isolated.
- **VOX Owner internal gates: 161/161 PASS**, including bounded staff read controls; standalone VOX staff-admin-read **25/25 PASS** (overlaps final VOX suite; do not add totals as unique coverage).
- **Marketplace, assignment and communication: 137/137 PASS**.
- **Seven additional source suites: 7/7 PASS** — vendor V1/V2, V3/V5, deterministic matching, fair-opportunity fairness, straight-line geography, vendor media EXIF, and runtime 80.04.
- Full TypeScript `npm run typecheck`: **PASS**.
- **Actual Docker Core HTTP in `--network none`: 17/17 PASS**, using previously built exact-runtime-source F17 image `qf-core-f17-candidate:cb9a1919`. No ports, CAP_DROP ALL, read-only filesystem, fake credentials, temporary container auto removed. Verified `/livez` 200, signup/login/deeplink 200, legacy registration 307, OTP/registration/private evidence/Owner queue/Owner decision/Owner readiness deliberately 503 when integrations OFF, unsigned Meta and Supabase POST 401, Meta bare GET 403, Supabase bare GET 405. This confirms **fail-closed negative integration and route rendering**, NOT real WhatsApp delivery or positive Auth/Owner workflow. One initial harness run raced with server startup; after waiting for `/livez`, the full 17-case test passed.
- **Real isolated PostgreSQL logical restore rerun: PASS**, from the **November 5 backup**, all ten subsequent migrations replayed and strict private-RLS/provider-dormancy postflight PASS, with `--network none` and temporary container removed. The local restore harness was hardened against a PostgreSQL warm-up/restart race; first rerun failed transiently, fixed retry completed successfully. **Not** current DB+Auth+Storage object-byte/PITR verification.
- Original F10 cross-phase recert remains `valid:true`; actual F18 ten-SQL source parity remains `valid:true`.

**Evidence:** `docs/launch/qf-f19-verified-internal-evidence-20261107.json` contains aggregate pass counts, sanitized HTTP status names, immutable runtime-image reference and operator-only restore outcome. Does **not** include tokens, SQL rows, phone numbers, customer data or OTP.

## F19 GitHub QA and release handling

The new F19 CI executes vendor/F16, marketplace, VOX Owner/Staff, matching and runtime 80.04, TypeScript and F18/F10 source checks against the stacked F18 branch. Only the two historic regression harness files, one Docker offline test runner, one sanitized evidence file, this memo and one CI workflow are changed. Historical protected F1/F5/F6/F7 workflows or SHA-pinned manifests **are not modified, waived or disabled**.

**No rollout:** F17 image remains quarantined on VPS. Actual Staging Core remains the old October image and its Meta providers dormant. This batch contains no runtime application code change; the F17 Docker image therefore tests the same runtime implementation as F19, but **does not by itself certify an F19 signed image**.

## Internal-first roadmap and deferred external gate

Remaining internal work to continue in later internal batches: further protected integration-branch reconciliation review, vendor/Owner positive tests with purely local simulated providers, staff time-tracking/attendance QA where implemented, full source audit of document scan-dependent gates, release rollback automation rehearsal and signed artifact packaging once the code is pinned. Preserve completed work; no reimplementation of Core into VOX.

**External dependencies deliberately parked until internal work finishes:** rotation/revocation of previously exposed Staging Supabase legacy service-role and Meta bearer credentials; Meta app effective vendor callback and Riya production-domain override safe handling; Supabase Auth → Send SMS Hook URL and signing; current managed DB/Auth/Storage object bytes and recovery; approved signed image/Owner Staging GO; consented handset OTP. **No vendor registration launch or production activation yet.**

**Important policy note for final signoff:** The current registration copy requires identity verification but treats Aadhaar as voluntary, with an alternative document, while a previous business brief requested mandatory Aadhaar. Resolve this with privacy/legal advice before activating vendor approvals; do not silently collect Aadhaar numbers or enforce a legally unsupported mandatory rule. PAN remains absent and GST optional.
