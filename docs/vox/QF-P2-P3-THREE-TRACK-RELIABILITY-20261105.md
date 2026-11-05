# QuickFurno — P2/P3 Three-Track Source Reliability Batch

**5 Nov 2026. Source and offline QA only; no managed Staging or Production writes.**

## Track A — Private evidence intake ordering

Existing `app/api/vendor/private-evidence/route.ts` called `qf_vendor_begin_private_verification_case` before checking that the configured object Storage bucket was actually nonpublic. A missing or accidentally public bucket could therefore produce a pending database case even though the upload would fail. The route now calls `privateEvidenceStorage.assertPrivate()` **before** its first privileged case RPC, while retaining real verified-user session, Origin, bounded multipart, file signature, explicit consent, rate-limits, randomized private keys, status Pending and fail-closed return codes. Its `put` adapter rechecks bucket privacy. No Aadhaar/PAN scans, public URLs, vendor activation, credits or assignments.

New source-order regression `vendor-private-bucket-first.test.mjs`: checks private bucket attestation precedes begin-case/Storage/attach; missing/unsafe bucket returns 503 with no approved-state response; personal documents never public. These tests do not constitute a genuine private bucket/Storage acceptance test.

## Track B — Google Places loader finite wait

Existing `lib/google-maps/loadGoogleMaps.ts` could indefinitely await runtime key fetch or preloaded `google.maps.importLibrary("places")`. Runtime public browser-key retrieval now uses `AbortSignal.timeout(2500)`; both preloaded-SDK recovery and scripted Places import use `boundedPlacesImport` with a maximum 8000 ms and a null fallback on reject/malformed SDK/timeout. A null result is not permanently cached and later customer input may retry. No key, API-response payload or sensitive location is logged. This does NOT certify expired Google Cloud billing or produce a fabricated Place ID or supported-city evidence. Manual text entry remains a UI fallback, **not** server-side location authority for vendor registration.

New real async `validate-google-places-bounded-import.test.mjs` verifies healthy Places NEW library, malformed/legacy library, injected provider rejection, permanently unresolved import, invalid timing bounds and both actual call paths. Existing timeout tests retained.

## Track C — VOX Owner concurrent read correctness

`OwnerReviewConsole.tsx` now tracks an incrementing read generation. Every queue refresh, case selection and decision attempt invalidates older in-flight *reads*, so a late case response cannot silently repopulate an outdated verification snapshot or re-enable controls. Earlier fetch errors and finally-clears cannot clear the current busy state. Queue states distinguish loading, genuinely empty and unavailable, without displaying private documents/phone info. `isLatestOwnerRead` in `ownerReviewUiGuard.ts` is pure, tested against stale/malformed epochs and is a defense-in-depth UI check—not a substitute for Core caseVersion CAS, real Owner Superadmin AAL2 or immutable review receipts. Staff routes untouched/frozen.

## Actual local JARVIS QA

- Private upload/bucket-first/memory cleanup/ClamAV contract and Places timeout/SDK checks **31/31 PASS**, root Core TypeScript PASS.
- VOX historical Web test suite **PASS**, Owner queue/case UI contract tests **17/17 PASS**, Web TypeScript PASS.
- Strict historical migration governance **334/334 assertions PASS**, **153/153** corrupted mutants rejected. Offline PostgreSQL 17 **7 pinned SQL + 18 synthetic acceptance steps + isolated dump/restore schema equivalence PASS**; no real managed restore occurred.
- Existing Vendor CI augmented to run new private+Places tests, both triggers updated, `permissions: contents: read` unchanged. No additional deploy jobs or broad secrets.
- VOX Web offline dependency installation, TypeScript and Next.js production-mode compiled build **PASS locally**. Exact-head GitHub checks must be recorded separately before marking source candidate green.

## Still protected

Owner deferred fresh Staging recovery/backup, so all 7 November vendor migrations **remain unapplied to live Staging**. No actual nonpublic vendor Storage bucket, real ClamAV signatures/EICAR, approved Meta WhatsApp delivery and replay, Google billing/Places, cloud-published immutable Core/VOX images, genuine Cloudflare Owner TOTP AAL2 and protected Staging E2E proven. Production, live provider messaging, public vendor signup, credits, lead assignment, Finance, Staff and official EOD HOLD. Previous source-only draft PRs #492–#499 remain unmerged; this is a stacked draft candidate, not deployment GO.

[30-task launch board](https://app.notion.com/p/40f751ba167c81cdb55bf1ee0c368a2b).
