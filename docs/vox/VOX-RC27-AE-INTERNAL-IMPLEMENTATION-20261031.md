# VOX RC27 — Internal implementation and release HOLD (31 October 2026)

## Release decision
**SOURCE AND DISPOSABLE-PG INTEGRATION VALIDATED, PROTECTED RELEASE HOLD.** Draft PR #450 only. No managed Staging/Production deployment, real provider/refund/credit, outbound WhatsApp, official EOD publishing, human MFA enrollment or database migration application. Independent DBA/AppSec + Owner GO remain mandatory.

## Implemented and tested
1. **CI first.** Historical Razorpay V1 parser test intermittently queried the temporary initdb Unix socket and then observed a missing PostgreSQL connection. The harness now requires the final localhost TCP postgres server and synthetic password. The genuine disposable PG17 parser/first-claim danger test passed **6 consecutive startups**. On exact intermediate PR head `0f39fd2f`, GitHub's previously failing RC17 Finance real-PG17 workflow **PASSED**.
2. **A — Core priority.** RC8 operator obtains the D2-D destination session advisory lock *before* SERIALIZABLE snapshot, with bounded timeout, re-verified destination, explicit unlock and backend destruction on unknown or leaked lock. Existing Staff AAL2 and source release gates stay OFF. The captured legacy RC26 writer is pinned as a SHA-256 fixture so shallow CI can reproduce the old race. **12/12 focused tests, real disposable PostgreSQL STOP vs TAKEOVER positive and legacy negative controls, bounded wait and no session lock leak PASS.** RC19 adapter release(false/true) pool contract updated.
3. **B — Finance priority.** A pure provider-event ledger repository/orchestration contract now supports exactly-once envelope claiming, replay, quarantine vs retry and exact receipt confirmation, with no provider calls or ledger SQL. The existing service performs a fail-closed gate after HMAC/classification and before any Core/provider/order lookup. **17/17 focused tests PASS.** Only TEST with ledger OFF retains legacy flow; LIVE/enforce without a reviewed durable repository is denied. This is a safety guard, NOT Finance V2 activation; real ledger SQL/grants, HMAC-signed event-id wiring, refunds and consumed-credit mutation remain unimplemented.
4. **C — Signed EOD.** A transaction-scoped intent lock and nonblocking read-only reconciliation probe ensure a lost COMMIT response cannot be judged as rolled back while the writer may still finish. Strict Owner/TL registry/revocation checks remain; no official EOD authority. **12/12 source tests, native disposable PostgreSQL pending receipt/revocation/in-flight proof PASS**.
5. **D — Migration engineering.** Deterministic, SHA-pinned handoff checks all captured 31 managed-only and 107 source-only entries, SQL provenance, dependency graph, writer grant/ownership review probes and null-approval rollback/recovery evidence. **21/21 migration and handoff tests PASS**, plan output remains `HOLD_EXTERNAL_EVIDENCE_REQUIRED`, zero migrations applied, 12 evidence gaps remain.
6. **E — QA.** Additional D2-D STOP vs TAKEOVER native PG17 race tests prove old snapshot patterns lose the STOP while corrected lock ordering prevents it, plus broad Finance refund-mode fuzz and fail-closed migration probes. GitHub CI workflow now runs RC27 tests, verified migration handoff, actual native Core race and independently isolated PG17 QA (not just a source-only test).

## Actual integrated JARVIS validation
- All `scripts/mvp/vox/*.test.mjs`: **958 tests, 957 passed, zero failed, one native test skipped by default**; that same optional test rerun with `RC27_NATIVE_PG17=1` **6/6 PASS, zero skipped**.
- QF MVP Razorpay payment authority: **51/51 PASS**.
- Real isolated PostgreSQL 17: Core consent/AB7B/vendor, Razorpay V2 five-functions, historical V1 parser hazards and signed pending EOD **PASS**.
- Root `npm run typecheck`, VOX Web `npm test` and Next production `npm run build`: **PASS**.
- Source GitHub workflow YAML parsed; last exact integrated-head GitHub CI must finish before anyone claims GitHub-green.

## Still pending — do not certify production-ready
- Core: genuine reviewed Staff AAL2 bootstrap/bridge, operational Core/AB7B writer routes, full D2-C/D2-D mutation path integration and managed DB roles/grants.
- Finance: real authenticated provider id and source-of-truth ledger, transactional webhook claim/complete SQL+HTTP integration, settlement reconciliation, refund execution and consumed-credit policy; actual financial use HARD OFF.
- EOD: independently enrolled real Owner and distinct Team Leader MFA/signing credentials; reviewed official EOD writer and publication privileges.
- Database: independent qualified DBA/AppSec statement/permissions adjudication of 31/107 drift, 2 unknown Staging SQL versions, historic Razorpay V1, 12 source gaps; complete Auth/Storage/Vault/roles/ACL/physical storage/PITR restore certification.
- Deployment: approved protected managed Staging installation, genuine Staff/CRM/Vendor 360/Service Desk end-to-end acceptance, signed Release GO and separate Owner Production GO.

This is **new internal engineering**, not another audit-only phase; safely implementable work remains and all protected activation gates stay closed.
