# VOX UI-04 — six-track internal-first source implementation (17 Oct 2026)

**Classification:** INTERNAL SOURCE / ISOLATED QA. **RELEASE HOLD**. Not live managed staging, not production, not a certified login and not permission to deploy SQL.

## Integration boundaries
1. **T1 Staff lifecycle:** `contracts/vox/ui04StaffLifecycle.mjs` queues independently reviewable requests *only* for existing neutral staff identities. Uses existing Core `prepareStaffCapabilityRequest`; requires current Core Superadmin AAL2, current neutral target, city/team binding, separate reviewer and injected durable one-use nonce transaction receipt. Only returns PENDING_INDEPENDENT_REVIEW if all proofs pass. This is not a user creation/invite/suspend executor, and does not bypass independent Team Leader bootstrap.
2. **T2 Work queue:** `ui04UnifiedQueue.mjs` composes two already verified, current Core read-only projections: canonical work records (Aarohi/vendor/support), and separately authorized client/Riya case metadata. Rechecks session/department/source/object grants via trusted injected callbacks; hides raw personal data, truncates after verification, no claim/transition/takeover.
3. **T3 Agents:** in Jarvis draft branch; `ui04AgentDeskReadiness.mjs` views Riya/Anisha/Aarohi current subject-bound handover states without messages/PII. `ui04PrivateAgentMount.mjs` is a proposed injection-only private staging route using existing signed Core->Jarvis pause handler and trusted private gateway transport. It is NOT registered in live Jarvis, and cannot approve takeover or reply.
4. **T4 Internal notices:** `ui04InternalNotices.mjs` validates Core persisted recipient-scoped metadata only, with current AAL2/nonce/subject callback. Outbox outcomes distinguish clean internal completion from uncertain/failed/dead-letter status requiring Owner attention. No push, WhatsApp or provider send worker.
5. **T5 Daily reports:** `ui04EodReview.mjs` refuses to convert current incomplete source-liveness into official totals. Reuses signed four-source EOD reader + database-verified pending submit and independent AAL2 Team Leader ACK; no self review, fabricated counts, export or automatic certification.
6. **T6 Security/QA:** `scripts/mvp/vox/validate-voxUI04-parallel-core.test.mjs` focused adversarial QA (forged Core scope, reviewer self-approval, stale grants, nonce replay, foreign city/user, duplicate messages, unsigned/partial sources, false receipt). `scripts/mvp/vox/validate-voxUI04-f1-pg17.ps1` applies **uninstalled candidate** `20261017010000_vox_f1_four_source_attribution_candidate.sql` to a disposable `postgres:17-alpine --network none`, checks RLS, roles, unique source revisions, source-subject constraint, immutable update/delete, and cleans up. `.github/workflows/vox-ui04-six-tracks-release-hold.yml` adds continuous PR contract/isolated PG source checks.

## Verified QA (local, date 17 Oct)
- **300/300** Core VOX `node --test scripts/mvp/vox/*.test.mjs` passed before stronger EOD status guard (re-run after change).
- Jarvis: **36/36** agent contract tests and separate `QFJ_F1_RIYA_PG17_PASS` on disposable PG17.
- Cross-repository synthetic contract test (JARVIS-only): **4/4**; no runtime Core/Jarvis network integration.
- Core F1 attribution SQL candidate disposable PG17: RLS force, anon/authenticated denial, uniqueness, immutable triggers and source-kind check PASS. sha256 `cf512a122ed126161ae3962547a1085d28aa4dc2d0cccd8729688704c89ba1ea`.
- Legacy VOX-16 full-seven PostgreSQL script could not start because branch does not include the seven managed 20261014 migrations: `MIGRATION_COUNT_MISMATCH`. Deliberate release hold; do not copy unreviewed SQL into `supabase/migrations` to conceal this.
- Core fresh `npm ci --ignore-scripts` on isolated worktree; typecheck PASS; production build verification pending when first recorded.

## Actual deployment and business effects
**NONE.** No managed staging/prod queries or migrations, no Staff account invitation, no session, no external messaging, no Core queues mutated, no agent takeover, no AGNI incident, no credit or lead matching change. New Core/agent modules are unregistered/injected source contracts; no live authenticated route claims.

## Remaining implementation and external gates
- Wire real Core-owned HTTP/RPC handlers with existing Supabase Auth AAL2, durable nonce and existing permission tables only after release review.
- Complete authoritative Staff lifecycle request/review/activate/revoke SQL with independent reviewer and MFA, first Team Leader approval, real source event attribution for Aarohi/support/conversation and current client object grants.
- Reconcile 25 migration aliases/6 staging-only SQL sources and the genuine 86-migration ledger; obtain qualified DBA restore/RLS/rollback approval. No second authentication system.
- Install and certify all seven VOX Core migrations and AGNI 0008 on protected staging only after approval; signed immutable staging builds, secrets and TLS, real end-to-end tests and rollback.
- Cursor AI review deliberately deferred by Owner. Independent human AppSec/DBA review and signed Owner GO/NO-GO remain release gates.
