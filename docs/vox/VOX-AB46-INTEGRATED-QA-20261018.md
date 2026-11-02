# VOX AB-4 / AB-5 / AB-6 combined source QA — 18 Oct 2026

**State: DRAFT SOURCE INTEGRATION / RELEASE HOLD / NOT A STAGING OR PRODUCTION DEPLOYMENT.**
**Integration branch:** `test/vox-ab46-local-integrated-20261018`, based on unmerged AB-3 Core #342, plus unmerged AB-3 Web #343 and four new Core/Web AB-4/AB-5 branches. Jarvis agent boundary remains a **separate unmerged** Jarvis draft PR #345.

## Parallel implementation outputs

1. **AB-4 Staff governance** — Core `POST /api/vox/v1/ab4-staff-review`, default disabled. A genuinely Auth-verified Superadmin AAL2 requests only immutable pending ledger evidence; separate current independently verified Staff Team Leader AAL2 writes a non-activating decision to a separate AB-3 SQL candidate. No Auth user creation, invitation delivery, Staff membership/department activation or private email/phone collection. SHA256 email/reference fields are NOT identity proof or signatures. Candidate SQL must be separately reviewed and installed only by approved release process.
2. **AB-4 Core native activity** — uninstalled `20261018010000_vox_ab4_native_work_source_writer_candidate.sql` trigger extends original Core Work event insertion in the **same** native PostgreSQL transaction to insert one canonical immutable F1 Core Work Staff event and nonce. Rechecks current neutral Staff membership, actor/assignee/work revision, exact source-object grant and dual support-vendor scope. Existing original protected Core Work RPC continues to enforce AAL2, department and canonical city. This does not connect Aarohi, Service Desk or Conversations native source writers yet.
3. **AB-4 Jarvis** — independent Jarvis candidate gate for current Staff + independent AAL2 TL + signed Core pause and Jarvis ACK evidence + current consent, leading only to `INTERNAL_HANDOVER_ACKNOWLEDGED`. Not a genuine WhatsApp takeover, no outbound message transport, no live gateway handler registration.
4. **AB-5 source readiness** — real default-OFF Core `GET /api/vox/v1/ab5-source-checkpoints` reads previous closed IST day's authorized SQL candidate rows after server-verified current Staff AAL2 and before/after team/city/object-grant checks. Returns `official:false`, `watermarkCryptoVerified:false`, `canSubmit:false`, `totalKnown:false`; SQL checksum does NOT cryptographically certify signed source manifests, nor replace official atomic EOD/TL ACK.
5. **AB-5 internal automation candidate** — server-only `services/vox/ab5InternalOutboxWorker.ts` wraps earlier uninstalled transactional in-app notification SQL claim/process/fail, bounded retries, uncertain-lease and dead-letter handling. **No scheduler or public route, no push, WhatsApp, SMS or email integration, no worker activated.**
6. **AB-5 Web** — real `/team/daily-report` integrates read-only separate previous-IST-day four-source SQL checkpoint cards through existing verified Staff MFA Core BFF. Missing sources appear as **Not recorded**, not fabricated zeros. Both current-day preview and closed-day checkpoint card remain partial/not official and locked when disabled.

## AB-6 evidence

- Five individual source PRs are **draft/unmerged**: Core #344 (Staff), #345 (atomic Work activity), #346 (EOD and in-app worker); VOX Web #347; Jarvis #345. Final initial individual GitHub CI **36/36 success**, exact initial heads. A subsequent AB-4 Staff HTTP test fix advanced Core #344 to `0ae9bc6e6966742568b7f6bf5c00bd141912a5f3`; recheck CI for the new SHA rather than citing old CI for latest commit.
- Combined Core+Web AB-6 branch merges 4 source branches plus latest Staff QA revision without conflicts.
- **384/384 local combined Core VOX Node tests PASS** after new 7 real-handler (mocked Auth/DB) checks, including owner/TL separation, forged/malformed actor request, default-disabled route, wrong DB receipt, replay and missing source.
- Staff candidate disposable PostgreSQL 17 PASS (nonce replay, self-review, unverified TL, immutability, RLS and deny anon); AB-3 EOD candidate disposable PostgreSQL 17 PASS (exact four sources, forged counts/duplicates, immutability and RLS); AB-4 Core native activity disposable PostgreSQL 17 PASS (one original event+canonical F1 event+nonce in same transaction; forgery/replay/revoked-grant fails and atomic rollback). All disposable DB tests use synthetic data and network-none Postgres containers removed afterward.
- Earlier integrated source QA: complete Web security suite incl. local role/UI preview **24/24**, AB-5 Web forged/locked schema **18/18**, AB-3 Web domain response checks **16/16**, actual Chrome/Puppeteer UI preview **23/23**, genuine built local Web daily-report HTTP 200 locked, Core published previous build default-disabled Staff-review POST=503, source-checkpoint GET=503, all source-checkpoint mutation verbs 405, /livez 200 with invalid synthetic credentials; compiled production Core and Web builds green. Re-run exact final integration SHA CI before certifying the final combined branch.
- Jarvis separate source QA `53/53` contracts, private gateway `19/19` HTTP Vitest, compile and typecheck; internal ACK synthetic 20-way JTI contention exactly one winner (not a real DB transaction).
- All browser/production-mode local preview servers on ports 3124/3125 stopped after testing; code and local records require verification before final report.

## Honest outstanding internal engineering

- Actual core-auth Staff invitation and neutral account lifecycle/grant writers, reviewer TOTP AAL2 bootstrap and revoke credentials; no bypass of independent first TL approval.
- Native `CRM_AAROHI`, `SUPPORT_DESK`, `CORE_CONVERSATION` transaction writers with verified immutable actor/source and current object-grants. Current AB-4 trigger covers only `CORE_WORK_LEDGER`.
- Source-watermark signing infrastructure, real four-source actor-bound source emission, official atomic full EOD and independently AAL2 Team Leader acknowledgment, corrections and redressal.
- Real private signed Core↔Jarvis HTTPS consent/pause/handoff/one-use persistent SQL nonce, actual consent lifecycle and human case accept/dismiss. No provider sender activation.
- Actual selected private notification worker registration/durable scheduling/metrics/worker identity proof, permission/row-policy audit, failure recovery and user experience. Current one is a source composition only.
- Full authorized staging browser/vendor/agent E2E, MFA enrollment, actual end-to-end p95 and load/fault injection, reproducible signed digest/rollback, first independent DBA/AppSec/TL approvals and Owner GO.
- Migrations ledger reconciliation and protected staging installs/AGNI 0008 are not done. **Never apply SQL candidates to Supabase staging or production without independent DBA/AppSec and Owner authorization.**

Cursor review is deferred per Owner request. No public `vox.quickfurno.in` ingress, messages or real vendor/customer impacts were activated.
