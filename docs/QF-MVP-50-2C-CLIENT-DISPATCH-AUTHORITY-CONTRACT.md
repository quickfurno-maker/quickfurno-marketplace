# QF-MVP-50.2C — Client Dispatch Authority Contract

**Status:** IMPLEMENTATION CANDIDATE
**Base:** `main` @ `8ff9c58c65a318c771f2dd0ff73ef21b7e2afffe`
**Subphase of:** top-level QF-MVP-50.2 (Client workflows)
**Sends anything:** NO
**Meta / provider call:** NONE
**Migration applied:** NO
**Staging proof:** NONE

## 1. Objective

Freeze the smallest Core-owned, provider-neutral authority that deterministically maps every
roadmap-50.2 client automation action to its workflow family, entity semantics, recipient
strategy, communication lane, consent scope, intended template key, canonical variable
contract and communication idempotency identity — plus the minimum durable recipient
foundation for lead-scoped business messages.

This phase adds no execution endpoint, completes no attempt and schedules no retry.

## 2. Relationship to the locked roadmap

The roadmap numbering is unchanged: 50.2 Client workflows · 50.3 Vendor workflows ·
50.4 CRM campaign workflow · 50.5 Failure handling. 50.2A, 50.2B, 50.2C-P0 and 50.2C are
subphases inside 50.2. Vendor workflows are not begun.

## 3. Core is the provider execution locus

The eventual shape is: authorized Core job → n8n claims and orchestrates → signed narrow Core
execution request → Core re-proves job/attempt ownership and dispatch-time gates → the Core
communication subsystem resolves destination/template/provider → the **Core** provider adapter
sends → Core persists provider truth → n8n receives a sanitized orchestration result.

n8n never holds Meta credentials, never calls a provider, and never receives a destination,
template variable set or provider account. `CommunicationService` already performs the provider
call inside Core (`communicationService.ts`, `sendTemplateMessage`) with Meta configuration read
from Core's own environment; 50.2C changes none of that.

## 4. The six client actions

| actionType | family | entity | recipient | lane | scope | intended templateKey |
|---|---|---|---|---|---|---|
| `client.lead_confirmation` | `client_whatsapp` | `lead` | `lead_direct` | business | transactional | `lead_received` |
| `client.requirement_collection` | `client_whatsapp` | `lead` | `lead_direct` | business | transactional | `clarification_request` |
| `client.missing_information_reminder` | `client_whatsapp` | `lead` | `lead_direct` | business | transactional | `clarification_reminder` |
| `client.matching_update` | `client_whatsapp` | `lead` | `lead_direct` | business | transactional | `client_matching_update` |
| `client.lead_status_update` | `client_whatsapp` | `lead` | `lead_direct` | business | transactional | `client_lead_status_update` |
| `client.transactional_followup` | `client_whatsapp` | `lead` | `lead_direct` | business | transactional | `client_transactional_followup` |

`lib/automation/clientDispatchRegistry.ts` is total over exactly these six, frozen, with no
default entry and no prefix parser. An unregistered action resolves to `null` and fails closed.

`actionRegistry.ts` remains the **requestability** authority (who may ask). The dispatch
registry is a separate object on purpose: merging them would let a change to one silently widen
the other.

## 5. workflowFamily

`AutomationJobEnvelope` now carries `workflowFamily`, derived inside
`buildAutomationJobEnvelope` from `getWorkflowFamilyForAction(actionType)` — the single source
of truth. There is no caller argument, no `safeContext` override and no database column, and an
unregistered action cannot produce an envelope at all. n8n receives the family; it never asserts
one and never parses the actionType prefix itself.

## 6. Recipient: `lead`

`CommunicationRecipientType` gains `lead`: a durable communication **reference** pointing at
`public.leads.id`.

It explicitly does **not** mean the lead is an authenticated client principal, that phone
equality proves account ownership, or that a lead id may be used as a `client_account` id.
`public.leads` still carries no `client_account_id` / `user_id` / `created_by`, and 50.2C adds
none.

Resolution (`SupabaseCommunicationRecipientResolver.resolveLead`): read `leads.phone` by id,
canonicalise with the existing `normalizePhoneE164` path at read, return E.164 in request memory
only. `leads.phone` is raw contact text captured at enquiry time and is never written back. There
is no phone→`client_accounts` lookup, no ownership inference, no fuzzy matching, no vendor
fallback and no durable plaintext copy. Missing row, blank or unnormalisable phone all fail
closed on the existing resolver error vocabulary.

## 7. Consent

`CONSENT_PRINCIPAL_TYPES` stays `('client','vendor','admin')` — **`lead` is deliberately not
added**. A lead-referenced send therefore derives an `unknown` consent identity, which the
consent authority documents as the safe branch: suppression is destination-hash scoped so STOP
still applies in full, and marketing default-denies for an unknown identity. 50.2C introduces no
consent or suppression bypass, and asserts no principal for a lead.

Lane is `business`; consent scope is `transactional`. `client_nurture_followup` remains
MARKETING-scoped and is never used for `client.transactional_followup`.

## 8. Variable contracts — two deliberately separate paths

**Approved provider bindings** — `client.lead_confirmation`, `client.matching_update` and
`client.lead_status_update` **delegate** to the QF-MVP-40.12-R1 authority in
`lib/communication/businessTemplateVariables.ts` (`buildLeadReceivedVariables`,
`buildClientMatchingUpdateVariables`, `buildClientLeadStatusUpdateVariables`). Their source-key
semantics are owned there and are not restated.

**Draft / not-yet-existing templates** — `clarification_request`, `clarification_reminder` and
`client_transactional_followup` declare their intended source keys in
`lib/automation/clientDispatchVariables.ts` instead:

| template | source keys |
|---|---|
| `clarification_request` | `client_name`, `outstanding_item` |
| `clarification_reminder` | `client_name`, `outstanding_item` |
| `client_transactional_followup` | `client_name`, `lead_reference` |

Validation matches 40.12 exactly: strings only, required, trimmed, non-empty, ≤ 200 characters,
no CR/LF/TAB, no silent default, no object coercion, and the emitted key set must equal the
declared contract — so no extra source value can leak.

**`BUSINESS_TEMPLATE_CONTRACTS` remains exactly five.** Knowing what authoritative Core data an
action needs is not the same as an approved provider binding, and must never be mistaken for it.
Promoting a draft into provider binding authority is a separately governed 40.x act.

## 9. Provider catalogue remains closed

The provider manifest still holds exactly **25** templates. `client_transactional_followup` was
**not** added, and no `qf_client_transactional_followup_v1` candidate exists. Consequently:

- there is no provider contract for that template;
- a provider mapping for it is impossible;
- real execution must fail closed until a separately governed provider-readiness task creates,
  reviews, submits and maps it.

`clarification_request` and `clarification_reminder` remain `draft` / `DRAFT_NOT_SUBMITTED` /
`PENDING_OWNER_REVIEW` / `NOT_AUTHORIZED`. Their manifest `binding_readiness` stays
**unresolved**: the staging seed treats `resolved` as a precondition for deriving a canonical
`variables_schema` and additionally demands a code contract drawn from
`BUSINESS_TEMPLATE_CONTRACTS` — which 50.2C must not extend. Flipping the flag would assert a
readiness the seed cannot honour. 50.2C therefore holds **action-variable authority only**;
provider-binding authority remains pending.

## 10. Communication idempotency

```
qf_auto_v1:{jobId}:{attemptId}
```

Derived by Core from re-proven job/attempt identity — n8n can neither supply nor override it.
Deterministic, 84 characters, well inside the ledger column. It carries no destination,
recipient, template or provider information, so it is safe to surface as an opaque reference.
`actionType` is deliberately absent: `jobId` already determines it. Invalid ids return `null`.

## 11. Migration

`supabase/migrations/20260803000000_qf_mvp_50_2c_lead_communication_recipient.sql` widens
`communication_messages.recipient_type` to accept `lead`, preserving `client`, `vendor`,
`admin`, `integration` and `system`.

The prior contract comes from `20260708000170_unified_communication_core.sql`, which declared
the CHECK inline — so its name is server-generated and cannot be assumed. The migration
therefore **resolves the `recipient_type` column structurally from the PostgreSQL catalogues
(relation OID plus the exact single-column `conkey`) and requires exactly one matching CHECK
constraint. Missing or ambiguous schema aborts fail-closed before any replacement**, with the
deterministic codes `QF_MVP_50_2C_RECIPIENT_TYPE_CONSTRAINT_MISSING` and
`QF_MVP_50_2C_RECIPIENT_TYPE_CONSTRAINT_AMBIGUOUS`. Identifying by catalogue relationship rather
than by text inside `pg_get_constraintdef`, and never with `LIMIT 1`, removes two silent-wrong
states: a reworded expression the text search would miss (leaving an incompatible CHECK that
still rejects `lead`), and an arbitrary pick among several that could drop the wrong one. No
exception handler swallows a failure, so the transaction aborts with nothing partially applied.

Four further hardenings close the remaining silent-wrong paths. The relation is locked
`ACCESS EXCLUSIVE` **before** the proof, so the exact-one result is serialized against the swap
that depends on it rather than being merely advisory. The constraint name is fetched
`INTO STRICT`, so the fetch itself raises instead of silently taking a first row. Catalogue reads
are schema-qualified (`pg_catalog.*`) so the proof cannot be swayed by the caller's `search_path`.
And because step 4 matches only *single-column* CHECKs, a **multi-column** CHECK that also gates
`recipient_type` would have survived untouched and could still reject `lead` while the migration
reported success — so a post-condition proves, via `conkey` overlap, that the constraint just
added is the only CHECK constraining that column, raising
`QF_MVP_50_2C_RECIPIENT_TYPE_RESIDUAL_CONSTRAINT` otherwise.

Forward-only: no historical migration is edited, no data is written, no backfill, no phone
normalisation, no seed, no ownership column, and automation persistence, the 50.1C replay ledger
and every provider mapping are untouched. `public.whatsapp_logs.recipient_type` is a legacy table
the unified core does not write and is deliberately unchanged.

**The migration is a source candidate only — it has not been applied to any database.**

## 12. Out of scope

No provider call · no n8n workflow change · no attempt completion · no retry scheduling · no
stale-processing reclaim · no live staging proof · no automation job claimed · the parked 50.2B
staging evidence untouched.

## 13. What later phases still need

- **Execution endpoint** (later subphase): a signed `{transportVersion, requestId, workerId,
  jobId, attemptId}` request; Core re-proves processing ownership, rebuilds the authorized
  envelope, reads this dispatch policy, resolves the recipient, re-checks consent/suppression,
  builds variables from Core truth, resolves an active approved template/provider mapping,
  gets-or-creates the idempotent communication message, sends via the Core adapter, records the
  outcome, and returns only sanitized orchestration data.
- **Provider readiness**: `client_transactional_followup` must exist, be approved and be mapped;
  the two clarification drafts must be submitted, approved and mapped.
- **QF-MVP-50.2D**: signed attempt-completion callback. Truthfulness rules stand — `success`
  only after verified execution success, `definitive_failure` only for a real definitive
  failure, `uncertain` only for genuine external uncertainty, retry policy Core-owned, and
  routing proof alone is never success.
- **QF-MVP-50.5**: stale/uncertain processing recovery, through an uncertainty-aware path and
  never a blind resend.
