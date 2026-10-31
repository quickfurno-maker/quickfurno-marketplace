# VOX AB7K RC3 — CORE_CONVERSATION consent binding contract — 30 October 2026

SOURCE-SHAPE / RELEASE HOLD. Issue #444 stays **open**. `CORE_CONVERSATION` is **not authorized**: `vox_ab7b_core_conversation_blocked` CHECK and the guard block are untouched. No SQL, RLS, grant or privilege changed. Nothing here was executed (author had Read/Glob/Grep/Edit/Write only); no node, PG17 or Staging run, no human signoff.

## Decision: not provable today
A trusted native integration needs consent evaluated by current Core authority **inside the same transaction** as the source row. Three facts prevent that:

1. **Authority is TypeScript, not SQL.** Consent = D2-C (`communicationConsentDecisionService`) behind `authorizeConversationalWhatsAppConsent` (`services/outboundConsentEnforcementService.ts`, scope fixed `transactional`). That module states it must never be duplicated. A SQL trigger would be a second truth; a TS pre-check followed by a separate insert is check-then-act (TOCTOU), not same-transaction.
2. **The only existing native conversation writer cannot be the source.** `qf_vox_ab7f_conversation_atomic_operator_candidate_v1` requires `profiles.role='admin'` (Owner) and performs **no** consent check. The source guard requires `p.role is null` (Staff). The actor populations are disjoint, so that RPC can never legitimately emit a Staff-attributed `CORE_CONVERSATION` row. It also writes `communication_conversation_events` only, with no staff team/city.
3. **`communication_conversations` has no team/city/consent column.** Team/city must be resolved from the subject (client/vendor) by Core; no reviewed resolver exists.

Also still unsigned: which consent scope applies to a staff pause/takeover (no provider send occurs; `transactional` is proposed for parity with conversational replies, a product/legal call).

## Proposed role mapping (UNSIGNED, `signedOff:false`)
| | Choice | Reason |
|---|---|---|
| `staff_role` | `operations_manager` | In the conversation object-scope role set (`vendor_success_agent, acquisition_agent, operations_manager, support_agent`). `acquisition_agent` and `support_agent` are already consumed by CRM_AAROHI/SUPPORT_DESK; reusing them blurs lane attribution. `vendor_success_agent` covers vendor subjects only. |
| department | `client_success` (existing enum value) | Matches the conversation lane; capability is team+city scoped and expiring. |
| narrowing | per-conversation `vox_staff_object_scopes_v1` grant (`scope_kind='conversation'`), AAL2, `p.role is null` | `operations_manager` is broad by role, so least privilege comes from the object grant, not the role. Owner/Team Leader may reject this mapping; `support_agent` is the alternative only if SUPPORT_DESK lane attribution is separately resolved. |

## Delivered (scaffold only)
- `contracts/vox/ab7kCoreConversationConsentBinding.mjs` — pure, no I/O. `authorizeCoreConversationSourceRow` is hard-bound to the unsigned binding and **always denies** (`BINDING_NOT_SIGNED_OFF`) after running every check; `mayWriteSourceRow` is always `false`, `providerMessagesSent` always 0. Request accepts only `{conversationId, nonce, revision}`; any consent flag, hash, actor, team or channel field is rejected. Actor comes from injected server session; destination_hash/channel/subject come from the Core row; consent comes from the injected D2-C-shaped authority and must return exactly `{kind:"allow",scope:"transactional"}`. Checks: current staff (active, not revoked/expired, active team, `profiles.role` null), role+department, AAL2, conversation grant, nonce unused, forged id, tenant, revision, state, channel, subject team/city equality, consent, and Core re-read for change.
- `scripts/mvp/vox/validate-voxAB7K-core-conversation-consent-binding.test.mjs` — **source-shape** tests (injected fakes, not PG17): missing/suppressed/not-granted/malformed/throwing consent, client self-assertion, wrong role/department/AAL/revoked/expired, wrong team/city, replay (denies before Core/consent reads), forged/stale conversation, no provider send, no I/O in the module, SQL block intact, AB7F-admin vs Staff actor disjointness.

## Manifest
No SQL file changed, so the 7+23 source fingerprint and `VOX-AB7K-REVIEWED-SOURCE-FINGERPRINT.json` are unchanged and still valid as pinned in RC2. New files are outside the pinned set. Not re-verified by execution.

## Conditions to actually enable (all required)
1. Written Owner/Legal sign-off on role+department above and on consent scope/identity rule.
2. A reviewed SQL function (security definer, service_role execute only) that, in one transaction, locks the conversation row, re-checks revision, staff membership/capability/object grant, and consent against the **real** `communication_suppressions`/`communication_preferences` with PG17 tests proving equivalence to D2-C — or a reviewed design where D2-C's decision is bound to the transaction by a signed, one-use, short-TTL receipt verified in SQL. Either needs independent DBA/AppSec review; neither is written here.
3. A reviewed Core resolver for conversation → subject team/city.
4. A native Staff conversation writer (distinct from the Owner AB7F RPC) that inserts the source row in that same transaction.
5. Forward migration dropping `vox_ab7b_core_conversation_blocked`, flipping `signedOff` in code, regenerated fingerprint, PG17 + Staging evidence.

## Residuals
- Tests not run. `ab7ConversationPauseGate.mjs` / `validate-voxAB7-final-conversation.test.mjs` still use `client_success_agent` (read-only, fail-closed; untouched per scope) and should be reconciled with decision 1 above.
- Identity-attestation overlay and recovery files untouched.
