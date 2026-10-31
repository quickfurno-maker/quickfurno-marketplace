# VOX RC4 Track A: Conversation authorization (#444), 30 October 2026

SOURCE-ONLY / RELEASE HOLD. `CORE_CONVERSATION` stays **BLOCKED**. No flag, role grant, SQL, RLS or migration was changed. Tests were **written but not executed** (author had Read/Glob/Grep/Edit/Write only). Do not treat anything below as passed.

## Verdict
A genuine atomic SQL-authoritative consent lookup is **not possible today**. Consent truth is TypeScript (D2-C behind `authorizeConversationalWhatsAppConsent`, scope fixed `transactional`) and must not be re-implemented in SQL. A TS check followed by a SQL insert is check-then-act. This track therefore adds a transaction interface and guard that detect consent change (fence) and replay, plus tests that pin exactly where the remaining race lives. The commit path is behind a gate that is hard-off.

## Files
| File | Purpose |
|---|---|
| `contracts/vox/rc4ConversationAuthorization.mjs` | New. Phase 1 `prepareConversationDecision`, Phase 2 `commitConversationDecision`, closed gate `RC4_CONVERSATION_GATE`, production wrapper `commitConversationDecisionProduction`. Imports only `node:crypto` and the existing unsigned AB7K binding. |
| `scripts/mvp/vox/rc4-conversation-authorization.test.mjs` | New. 15 `node:test` cases over an in-memory transactional model with snapshot/rollback. |
| this doc | New. |

No SQL overlay was written: nothing in the repo supports a source-backed one yet (see Phase 2 below).

## Design: two phases
**Phase 1 (outside tx, TypeScript Core).** Request is exactly `{action: PAUSE_AI|TAKEOVER, conversationId, nonce, revision}`; any consent flag, hash, actor, team, scope or channel field is `REQUEST_SHAPE_INVALID`. Then: Staff from the server session (active, not revoked/expired, active team, `profiles.role` null, `operations_manager` + `client_success`, AAL2, per-conversation grant); Core conversation row (tenant, state OPEN/PAUSED, channel whatsapp, 64-hex `destination_hash`, subject client/vendor, revision equal, subject team/city equal Staff team/city); injected consent authority must return exactly `{kind:"allow",scope:"transactional"}`; then a consent-ledger **fence** `{eventCount, latestEventId, policyVersion}` for that `(destination_hash, channel)` is read **after** the authority answered. Output is a deep-frozen decision `{body, digest}` registered in a module-private `WeakSet`, with a 60 s TTL. `body` binds destination_hash, channel, scope, subject type/id, consent version fence, actor (user/team/city/role/department/aal), conversation id, revision, action and nonce. JSON clones, hand-minted objects with a valid digest, and mutated copies are `DECISION_FORGED`.

**Phase 2 (one transaction).** The gate is checked before any transaction opens. Then fixed lock order: `lockConsentDestination` -> `lockConversationForUpdate` -> `lockStaffForUpdate`. Under locks it re-verifies: Staff identity equals the decision actor and passes the same checks as Phase 1; conversation passes the same checks and equals the decision's revision, hash and subject; the consent fence equals the Phase 1 fence; `consumeNonce` (unique insert) returns true. Only then `insertSourceRow` and `commit`. Any deny or throw calls `rollback` exactly once (nonce and row vanish with it). A throwing `commit` returns `COMMIT_STATE_UNKNOWN` and is never retried blindly; the nonce row decides on reconcile.

## What the tests prove (once run) and what they do not
Proven in the model: gate-off never opens a transaction; no self-asserted consent/actor; each wrong role, department, AAL, revoked, expired, team, city, grant denies; consent event after Phase 1 -> `CONSENT_CHANGED_AFTER_DECISION` and full rollback; Staff or conversation changing between phases denies; replay (same decision or same nonce) writes one row; forged/expired decisions never reach the DB; commit/insert failure semantics; module has no I/O or provider code; SQL CHECK untouched.

**Not proven:** real PG17 locking, real D2-C behaviour, RLS, grants, cross-process races. Test "TOCTOU 3" deliberately shows that **without writer-side serialization a consent event can land after the in-tx fence read and the transaction still commits**. That is why `consentWritersSerialized` is `false`.

## Remaining blockers (gate stays closed)
1. **Consent writers must take the same destination lock.** D2-D (consent event/suppression writers) must call `pg_advisory_xact_lock` on a key derived from `(destination_hash, channel)` before appending to `communication_consent_events`; `tx.lockConsentDestination` takes the same key. That is outside Track A scope. Without it the in-tx fence is a detector, not a lock.
2. **Fence must be a real reviewed read.** `readConsentFence` = count, latest `id` and `policy_version` of `communication_consent_events` for the hash/channel (append-only, indexed on `destination_hash, channel, scope, occurred_at`). Needs DBA review of ordering (`occurred_at` vs insert order) and a PG17 test against the real table. It is an opaque version, not a decision.
3. **Authority-in-transaction.** Even with 1 and 2, D2-C runs on its own connection, so its answer is only as fresh as Phase 1. The fence covers events after Phase 1; it does not cover a D2-C bug. Equivalence with D2-C against real `communication_*` tables needs PG17 evidence.
4. **Native Staff writer.** AB7F RPC requires `profiles.role='admin'` and does no consent check; the source guard requires `p.role is null`. A distinct Staff RPC (security definer, `service_role` only) must implement the Phase 2 steps in SQL, take the lock, verify the digest, and write the `CORE_CONVERSATION` row. Not written (needs reviewed Core resolver for conversation -> subject team/city and independent AppSec review).
5. **Forward migration** to drop `vox_ab7b_core_conversation_blocked`, regenerated 7+23 fingerprint, PG17 and Staging evidence.

## Next wiring (when unblocked)
1. D2-D takes the destination lock (separate track). 2. Reviewed SQL for `readConsentFence`, `lockConsentDestination`, `consumeNonce`, Staff RPC. 3. Adapter implementing the `beginTransaction()` interface over those RPCs. 4. PG17 tests mirroring each case in the test file against real tables. 5. Code change flipping both gate fields, never an env flag or request value.

## Owner policy decisions still needed
- Required consent scope for a Staff pause/takeover: `transactional` is assumed for parity with conversational replies; product/legal must confirm (no provider send occurs).
- Role/department mapping `operations_manager` + `client_success` (unsigned since RC3); `support_agent` is the alternative only if SUPPORT_DESK attribution is resolved.
- Whether `unknown`/`prospect` subjects may ever be actioned (this track allows client/vendor only).

## Tests to run
`node --test scripts/mvp/vox/rc4-conversation-authorization.test.mjs` and, as regression, `node --test scripts/mvp/vox/validate-voxAB7K-core-conversation-consent-binding.test.mjs`. Fix any failure before relying on this packet.

## Residuals
Existing `ab7ConversationPauseGate.mjs` still uses `client_success_agent` (untouched, out of scope). Other tracks' paths untouched.
