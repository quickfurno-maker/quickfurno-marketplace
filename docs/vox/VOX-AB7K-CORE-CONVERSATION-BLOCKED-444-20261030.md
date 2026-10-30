# VOX AB7K #444 — CORE_CONVERSATION source writer BLOCKED — 30 October 2026

SOURCE-ONLY / RELEASE HOLD. Issue #444 is **not closed**. No managed Staging or production change, no human review signoff, no tests executed by the author (tooling was file-read/write only).

## Finding
`20261018020000_vox_ab7b_nonwork_native_source_candidate.sql` (candidate order 21) had two P0 defects for `CORE_CONVERSATION`:
1. It read `public.vox_ab7b_current_consent_candidate_v1`, a relation that exists in no canonical migration; it appeared only as a table the PG17 fixtures fabricated, so tests could pass against a truth table that does not exist.
2. It required `staff_role='client_success_agent'`. The canonical `vox_staff_memberships_v1` CHECK (quarantined `20261014050000_vox_v1_team_leader_review_policy.sql`) allows only `operations_manager, acquisition_agent, vendor_success_agent, support_agent, auditor, team_leader`. No row could ever satisfy it.

## Why consent was NOT bound (no safe canonical source)
- `public.communication_conversations` carries `channel`, `destination_hash`, `subject_type/id`, `state`, `jarvis_enabled`, `human_takeover` and **no consent column**.
- Canonical consent is: `communication_suppressions` (destination_hash + channel + scope marketing/transactional/global, `is_active`, `expires_at`, `deactivated_at`) and `communication_preferences` (principal + channel + scope), with `communication_consent_events` as the immutable ledger.
- The decision logic (global-first precedence, expiry, duplicate/integrity checks, exact vs unknown identity, marketing default-deny) lives only in `services/communicationConsentDecisionService.ts` (D2-C), fronted by `services/outboundConsentEnforcementService.ts`, which states it is the sole authority and must never be duplicated. A SQL trigger re-implementing it would be a second truth, so none was written.
- Conversational replies use scope `transactional` (`authorizeConversationalWhatsAppConsent`), where a suppression blocks and absence is `no_consent_objection`. Marketing would need an exact principal preference. Which scope a staff conversation action requires is a product/legal decision not recorded in the repo.

## Why the role was NOT mapped
Existing conversation object scopes permit `vendor_success_agent, acquisition_agent, operations_manager, support_agent`; department packs are `client_success, vendor_success, acquisition, service_support`. No evidence ties the conversation lane to one role+department pair. `acquisition_agent` and `support_agent` are already consumed by the CRM_AAROHI and SUPPORT_DESK lanes, so reusing them would blur lane attribution. Not guessed.

## Change (in place; candidate is unreleased, `installedInStaging=false`)
- Guard function raises `AB7B_CORE_CONVERSATION_BLOCKED` for any source other than `CRM_AAROHI` / `SUPPORT_DESK`, before any staff lookup.
- Table CHECK `vox_ab7b_core_conversation_blocked` (`source<>'CORE_CONVERSATION'`) holds even if the trigger is disabled or replaced.
- Removed the nonexistent relation, `client_success_agent` and `client_success` mappings.
- Unchanged: forced RLS, `service_role`-only select/insert, revocation/expiry/team/city/object-grant/capability predicates, F1 + nonce same-transaction append.
- `CORE_CONVERSATION` stays in the source enum and in F1/nonce/EOD four-source contracts so a later reviewed forward migration can drop the CHECK. Until then the Core Conversation EOD source can never be certified from this writer: module **BLOCKED**.
- PG17 fixtures (`validate-voxAB7B-{native,nonwork,support-atomic,aarohi-atomic}-pg17.ps1`) no longer create the fake consent table or use `client_success_agent`; the CORE_CONVERSATION insert is now a required denial; expected counts drop accordingly (3→2, 4→3, 1:4:4:4→1:3:3:3).
- New `scripts/mvp/vox/validate-voxAB7K-core-conversation-blocked.test.mjs`: static, deterministic checks (no relation/role fabrication, roles ⊆ canonical CHECK, block precedes lookup, CHECK present, grants/RLS intact, fixtures honest, conversation row has no consent column, manifest order intact). The native PG17 script additionally covers revoked role, foreign team/city, malformed source/subject pairing, nonce replay, CHECK-with-trigger-bypassed, and missing relation.

## Manifest
File order and count (7+23) are unchanged. The SHA-256 of order 21 changed, so `docs/vox/VOX-AB7K-REVIEWED-SOURCE-FINGERPRINT.json` (`files[20]`, `manifestDigest`) is **stale and `validate-voxAB7K-manifest.test.mjs` "pins all 30 exact SQL bytes" will fail until regenerated** by someone able to run the inspector. Hashes were deliberately not hand-written. This fails closed.

## Accepted conditions (to unblock CORE_CONVERSATION)
1. Written decision on the required consent scope (transactional vs marketing) and identity rule for staff conversation actions, enforced through D2-C or a reviewed SQL function that is proven equivalent to it with PG17 tests against the real `communication_*` tables (no synthetic consent table).
2. Written decision on the exact `staff_role` + department (+ whether a canonical role/pack must be added by a reviewed foundation migration without weakening existing CHECK/RLS).
3. A real native conversation writer that binds `conversation.id`, `destination_hash`, channel and revision in the same transaction.
4. Forward migration dropping `vox_ab7b_core_conversation_blocked`, regenerated manifest pin, independent DBA/AppSec review.

## Blocking residuals
- Tests were **not executed** here (PG17 `.ps1` needs Docker; `.mjs` needs node).
- `contracts/vox/ab7ConversationPauseGate.mjs` and `validate-voxAB7-final-conversation.test.mjs` still use `client_success_agent` in the read-only AB7C pause preparation. It is fail-closed against real memberships but should be reconciled with decision 2; not touched here.
- Older docs (`VOX-AB7B-*`, `VOX-AB8-*`) still describe three-lane PASS results; superseded by this packet.
- Staging lineage, attestations, recovery, genuine AAL2 Team Leader, and Owner GO remain open on other branches.
