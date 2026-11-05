# QuickFurno Launch — P2/P3 Private Object, Places Single Flight & Owner Decision Reliability

**5 November 2026 | Internal source-only candidate | RELEASE HOLD.** Stacked after Draft PR #500; no managed Staging or Production operations.

## P2 Private document read correctness

`createPrivateVendorEvidenceStorage().read()` keeps the existing exact-key private Storage, nonpublic bucket, size limits and service-only access checks. Its newly extracted `decodeVerifiedPrivateObject()` compares a downloaded private blob's declared length against its decoded bytes and **clears the temporary decoded Uint8Array if inconsistent** before returning null. An accepted byte array remains the caller's responsibility for cleanup after scan/use. This does not erase provider buffers, original objects, persisted Storage, or memory held outside the helper. No new user-facing public URL or identity upload authority.

Actual test `vendor-private-read-memory.test.mjs` executes correct size, both mismatch directions, synthetic download failure and source call-path assertions. Existing bounded multipart/scan-memory and fail-closed checks remain in CI.

## P2 Google Places concurrent library import

`loadGoogleMaps()` now checks the single shared `window.__qfGooglePlacesPromise` **before** inspecting a preloaded Google importLibrary global. Concurrent mounted location fields reuse a single active SDK import and successful cached library; after an import error, null is cleared and a **later** explicit interaction can retry. It no longer auto-retries a failed *same* pending request. Existing 2500-ms runtime key and 8000-ms SDK limits, manual input fallback and server geofence remain unchanged. This does not certify Google billing or treat manual location text as a verified Google Place ID.

New `validate-google-places-singleflight.test.mjs` exercises actual concurrent Promise identity/import count, fail→retry recovery and completed success caching. Existing stalled Google import/SDK missing tests remain.

## P3 VOX Owner decision duplicate protection

`OwnerReviewConsole.tsx` adds synchronous `decisionBusyRef`: a second invocation during one active decision exits **before another POST**, independently of React's asynchronous `inFlight` render. It claims the lock before the first await and clears it in `finally` on success, bad Core response or exception. After a confirmed immutable Core decision, the selected vendor row is removed from the stale *local* queue until the next authoritative refresh. Core's signed Owner AAL2, Superadmin requirement and atomic caseVersion CAS remain the only decision authority. No automatic vendor business activation, credits, lead assignment, Staff, finance or document viewing.

Existing P3 UI source contract now checks the real synchronous lock, ordering before fetch, clearing after the request, old-case pruning after confirmed response and preserved Core caseVersion.

## Test boundaries and release

- New development worktrees: three isolated source branches combined into one stacked candidate; historical VOX SQL and seven November vendor SQL source pins untouched.
- Local JARVIS focused checks: **19/19** private source and actual temporary-byte tests; **13/13** Google Places source/runtime import checks; **14/14** Owner/Staff isolation tests.
- Integrated Core TypeScript **PASS**, combined private/Places **32/32 PASS**; existing VOX Web tests **10/10 PASS**, Owner UI **8/8 PASS**, Web TypeScript **PASS**, offline Web dependency install and Next.js production-mode compiled build **PASS**. GitHub exact-head CI still pending.
- Historical SQL G1 **334/334 PASS; 153/153 corrupt mutants rejected**; disconnected PostgreSQL17 ran all **7** source-pinned SQL migrations and **18** synthetic fixture steps, then schema-equivalent dump/restore PASS, but **actualStagingRestored=false**.
- GitHub source CI updated to include new private read and Google concurrency tests and watch their paths. No managed deploy, provider sends, public registration, private bucket provisioning or live decision writes.
- **Owner deferred fresh Staging backup; 7 new vendor migrations remain unapplied to actual Staging.** Protected Staging backup/rollback, private Storage+real ClamAV/EICAR, Meta WhatsApp OTP and Google billing, genuine deployed Owner TOTP AAL2 and signed Web/Core OCI provenance remain unverified. Production and all release features HOLD.

[30-task Notion launch board](https://app.notion.com/p/40f751ba167c81cdb55bf1ee0c368a2b).
