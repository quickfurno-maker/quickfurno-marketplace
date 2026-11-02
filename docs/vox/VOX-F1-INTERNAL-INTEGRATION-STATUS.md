# VOX-F1 integrated internal source candidate — 17 October 2026

**Release state: DRAFT / NOT DEPLOYED / STAGING AND PRODUCTION HOLD.**
Base: L6 unified Core/Web source -> L8 canonical SQL/identity preflight -> L9 four-source EOD evidence. This branch additionally incorporates the earlier reviewed 08T staging-only *one-shot* internal notification adapter. It does **not** merge into main or change managed SQL, Supabase Auth, flags, payments, vendor matching, or external provider transports.

## Consolidated components
1. **EOD:** Four separately named, bounded, actor-scoped read-only event-evidence contract. Explicit fresh Core AAL2 and current object-grant verifier callbacks, full IST business-day source cursor coverage, strict event identity/team/city/actor and no double counting of the same source/object/revision. It never enables official EOD submission on synthetic or partial evidence.
2. **Riya:** Core canonical read-only client case metadata is included from L6; separately stacked Jarvis L9 signed observation and pause-ACK *review* contracts are tracked in Jarvis PR #339 and its latest branch. They are **not yet live Jarvis pause RPCs**, provider delivery or Core takeover.
3. **Notifications:** Transactional in-app outbox candidate from L6 plus default-OFF 08T Core one-shot runner, with a separate injected trusted signed-release/DB verification dependency, bounded internal-only processing and sanitized AGNI observation callback. No scheduler, live SQL, credentials or external send.
4. **AGNI:** Existing signed private Core metrics route in L6 and Owner Gateway AGNI draft #87, with offline signing/verification tests. No live Core↔AGNI HTTP, owner replay table migration, alert schedule or production credential activation.
5. **Release:** L8 SQL inventory/provenance and independent human reviewer crypto remain release blockers. Every protected environment must remain off.

## QA instructions
- `node --test scripts/mvp/vox/*.test.mjs`
- `node --experimental-vm-modules --test scripts/mvp/vox/validate-voxL3-private-metrics-http.spec.mjs scripts/mvp/vox/validate-voxL6-core-eod-riya-http.spec.mjs`
- `npm run typecheck`
- In `apps/vox-web`: `npm test`, `npm run typecheck`, `npm run build`
- Core-to-AGNI runtime interop requires separately pinned, actually compiled AGNI #87 artifact, and is not silently assumed by this CI.

## Unresolved F1 functionality — do not disguise as complete
- **Real Core activity readers:** Source object existence is not an action ledger. Aarohi historical events can be bot/system events and are not signed neutral Staff attribution; vendor support messages use legacy sender classifications; conversations/messages lack the independent Staff actor grants needed for employee EOD. Source-specific immutable Staff attribution, snapshot cursor/watermark issuance, late-correction semantics and transactional audited complete EOD submission need implemented/certified.
- **Jarvis:** Genuine Core↔Jarvis signed pause command and durable acknowledgment, replay storage, current client/project/consent proof and Core-governed human takeover are not live.
- **Worker:** Needs approved SQL installation, actual service-role credential isolation, supervisor, lease/canary operation, dead-letter alerts and multi-instance staging tests.
- **AGNI:** Needs protected private HTTP and durable PG replay + alerting; existing signed source-only proof is not live monitoring.
- **Security gates:** DBA migration-history provenance (86 entries but zero VOX tables), independent AppSec and first Team Leader, genuine neutral Staff AAL2, protected staging rollbacks and signed Owner release are mandatory. No synthetic reviewer is an independent human signature.

**F1 source assembly is complete only to the scope tested; genuine end-to-end integration and official complete EOD remain not certified.**

## F1 implementation increment — authenticated canonical EOD preview, source candidate and bounded supervisor (17 Oct IST)
- Core `contracts/vox/f1CertifiedFourSourceEod.mjs` is a real DB-adapter for a future canonical immutable 4-source event/watermark inventory, with HMAC source seal, independently rechecked exact current grants, AAL2 staff scope, full **closed** IST day, no overflow, subject identity bound to SHA-256 checksum, tamper/replay and revoked-grant denial. A signed empty day is distinguishable from an unavailable source. The read-only Core route `GET /api/vox/v1/eod-certified-preview` additionally rechecks current Staff identity before returning; feature flags default OFF, no write verbs.
- Unmanaged candidate `ops/vox/sql-candidates/20261017010000_vox_f1_four_source_attribution_candidate.sql` creates immutable, forced-RLS event and full-day watermark tables. It is NOT in `supabase/migrations`. Local disposable Docker PostgreSQL 17 `--network none` smoke passed, with checked append-only denial and anon/authenticated SELECT rejection; SQL file SHA-256 `CF512A122ED126161AE3962547A1085D28AA4DC2D0CCCD8729688704C89BA1EA`. Need independent DBA/AppSec to approve source attribution and grant writers; no historical backfill or DDL rollout.
- Internal worker supervisor `worker/voxInternalNotificationSupervisor.mjs` uses 08T/08N transactional Core-only batches; requires staging, live verified reviewer attestation EACH batch, independently approved managed schema and service-role worker adapter. It never sends provider messages or starts a scheduler.
- Actual legacy Aarohi, vendor-support and communication tables still lack independently certified neutral Staff immutable events and 4 signed writer watermarks. The new endpoint will correctly reject these until genuine actor-verifying source writers and watermark issuers exist. A verified preview is NOT an official EOD submission; current partial EOD submit/TL acknowledgment remain partial, not falsely relabeled complete.
- No staging/production migrations, Auth/MFA/grants, feature flags, queue supervisor or provider sends changed. Signature keys in tests are synthetic. Human-reviewed F2, real Staff AAL2, approved canonical database writer, official EOD submit/TL acknowledgment remain gating.

## F1 parallel source batch 17 October 2026 (A+B+D, no release)
F1-A: new `contracts/vox/f1CanonicalSourceRecorder.mjs` verifies genuine Ed25519-signed canonical neutral Staff actor/action, exact immutable source provenance and current object/department grant before an injected **atomic** Core DB insert. The real source-specific writer/SQL adapter is NOT yet connected for legacy CRM, Support Desk or conversations; synthetic callbacks in tests do NOT count real marketplace Staff actions.
F1-B: `f1OfficialEodTransitions.mjs` builds only a verified four-source, full *closed* IST day snapshot and demands an exact transactionally rechecked result before labeling it `PENDING_REVIEW`. Independent current AAL2 TL ACK is separately gated, self-review rejected and it demands a source-seal recheck within the DB transaction. Actual official reviewed Core SQL commit/review handlers NOT deployed or wired; this is a source contract, not achieved official EOD.
F1-D: `voxInternalNotificationSupervisor.mjs` now accumulates retry/dead-letter counts, requires Owner review on DLQ or uncertain receipts, never proceeds to next cycle after unverifiable SQL, and revalidates signed independent approval per batch. Isolated test subjects cover retry, fifth-attempt dead letter and ambiguous receipt. No worker timer, credentials, queue deployment or provider sends.
QA: Core VOX 285/285 PASS; root tsc PASS; disposable Docker PG17 source candidate previously PASSED. No managed migrations or release flags applied. Four-source writer instruments, durable SQL and cross-system authenticated staging remain HOLD.
