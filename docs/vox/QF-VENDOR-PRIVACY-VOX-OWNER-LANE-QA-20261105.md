# QuickFurno — Vendor Privacy & VOX Owner Isolation Source Batch

**5 November 2026 | Internal source only | Managed Staging and Production: HOLD.**

## Verified actual code changes

- `app/api/vendor/private-evidence/route.ts` uses `withPrivateEvidenceBuffer` around the awaited byte sniffing, private bucket upload, hash calculation and Core case linkage. The request-scoped Buffer is cleared in a `finally` path on success, invalid format, unsafe private bucket, Storage failure, case-linkage rejection or exception. Best-effort heap hygiene; this does **not** claim to scrub the original File/FormData, the private object itself or runtime copies, and does not prove a compliant retention/deletion policy.
- The separately approved **one-shot, Staging-only** private scanner now clears its downloaded file buffer in a `finally` block. This includes hash mismatch, ClamAV scanner errors, persistence RPC failures and happy-path results. It remains OFF without independent environment flags; no external vendor data was downloaded during development.
- The standalone VOX Owner-only verification bridge delegates flag evaluation to a dedicated, side-effect-free Owner gate. All default OFF; Owner queue may be independently read-enabled only with `VOX_STAFF_PORTAL_ENABLED=staging` (legacy shared host master switch), `VOX_STAFF_VIEW_MODE=owner` and dedicated Owner-review enablement. Separate decision enablement is required. Modes `scoped`, `dual`, `disabled` never enable the new Owner-only vendor-review operation; existing Staff routines still independently require scoped/dual mode and `VOX_TEAM_WORKSPACE_ENABLED=staging`. No Staff work was enabled or rebuilt.
- The existing Vendor and VOX source-only GitHub workflows now enforce their respective new regressions. No new CI permissions or deployment steps were introduced.

## Local JARVIS evidence

- Actual byte-buffer lifecycle and private scanner/route checks **18/18 PASS**.
- Owner vendor-review projection, independent gate and Staff-isolation acceptance **22/22 PASS**.
- Root TypeScript and VOX Web TypeScript **PASS**.
- VOX Web offline dependency install, its existing test suite and Next.js production-mode build **PASS**.
- Historical strict G1 migration governance **334/334 assertions, 153/153 bad mutants rejected**.
- Offline isolated PostgreSQL 17: all **7 existing pinned vendor SQL migrations**, **18** sequential synthetic SQL fixture/acceptance steps, **pg_dump/pg_restore schema equivalence PASS**; no network, no managed DB, releaseDecision HOLD.
- Both workflows parsed correctly and retained `contents: read` token permission. No direct real provider or managed Supabase calls were performed in this batch.

## Still open and non-negotiable

- Seven new vendor SQL migrations **NOT applied to QuickFurno Staging**. Owner asked to defer fresh recovery/backup work; explicit Staging migration authorization from previous turn is retained, but a current independently restorable recovery point and exact-version migration path are still required before applying. No ledger repair or broad db push.
- Private nonpublic Storage bucket and genuine ClamAV daemon/signature/EICAR certification remain missing. WhatsApp Meta signed delivery/replay and Google Maps billing/restricted API usage are not certified.
- Actual deployed Web/Core immutable image digest, genuine Owner Cloudflare Access→Supabase AAL2 session and BFF decisions, production rollback, full protected Staging E2E and separate Production GO are unverified. No Staff, live lead assignment, credits, Finance, official EOD, external sends or public vendor registration enabled.

Notion launch board: https://app.notion.com/p/40f751ba167c81cdb55bf1ee0c368a2b
