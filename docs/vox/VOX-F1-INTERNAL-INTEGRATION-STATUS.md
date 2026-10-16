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
