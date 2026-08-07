# QF-MVP-50.2E — Signed Core Client Execution + Inactive n8n Wiring

**Source status:** MERGED / MAIN-SYNCED / POST-MERGE-PROVEN
**Base:** `4bb2ce1d4e0581aa76802ac7408062f4b43987be`
**Staging migration:** **APPLIED / VERIFIED** — `20260805000000`, staging history now **22**
**Workflow activation:** NONE — the new n8n candidate is inactive and unpublished
**Provider / Meta / WhatsApp:** NONE — no real send has ever been made
**Supabase credential in n8n:** NONE
**Jarvis:** NOT TOUCHED — no Jarvis repository, path, project or file was read or written

> **Top-level QF-MVP-50.2 is NOT COMPLETE.** The schema is in place on staging and the source is merged, but no client action is live-provider-ready, no job producer exists, and n8n has never been activated. See §14.

## 1. What this phase is

The execution boundary that QF-MVP-50.2D was built in advance of. n8n asks Core to execute the
client work for the exact attempt it already owns; Core re-proves every business fact from its own
ledgers, executes through its **own** communication subsystem, and answers with a sanitized
orchestration state.

```
Core-authorized job
  -> n8n signed claim                      (50.1C / 50.2B, shipped)
  -> n8n routes ONLY on Core workflowFamily
  -> signed Core client execution request  (THIS PHASE)
  -> Core re-proves job/attempt/action, resolves recipient/template/variables/consent/
     provider mapping/account, and dispatches through CommunicationService
  -> Core stores communication truth
  -> n8n receives a sanitized orchestration result
  -> when evidence is completable, n8n calls the 50.2D completion route
  -> Core re-proves evidence and finalizes
```

## 2. Authority

Jarvis recommends. **QuickFurno Core authorizes.** n8n orchestrates Core-authorized workflow work
only. Core remains the business authority **and** the provider-execution locus.

n8n supplies five identity fields and nothing else:

```json
{
  "transportVersion": 1,
  "requestId": "<uuid>",
  "workerId": "<bounded worker id>",
  "jobId": "<uuid>",
  "attemptId": "<uuid>"
}
```

Exactly five keys, all required, unknown keys rejected. There is no `actionType`, `workflowFamily`,
`entityType`, `entityId`, recipient, destination, phone, email, `templateKey`, `variables`,
`provider`, `providerAccount`, consent, `idempotencyKey`, `classification`, `safeCode`,
`executorReference`, `nextRetryAt` or provider-payload field **in the schema at all** — which is
stronger than accepting and ignoring them. A body carrying one is refused by two independent
fences: the shared automation forbidden-token scan, then exact key-set equality.

`executorReference` is deliberately **output-only** here. This is the exact inverse of 50.2D, which
accepts it as evidence to check. 50.2E **mints** it, and only ever from a real
`communication_messages.id`.

## 3. Core revalidation chain

Before anything is reserved or executed, Core proves, from its own rows:

| Fact | Source |
|---|---|
| job exists, `status='processing'`, `locked_by = workerId` | `proveCurrentAutomationAttemptOwnership` |
| attempt belongs to the job, is the **current** attempt (`attempt_number = job.attempt_count`), worker matches, `status='started'` | same |
| authorized action request exists and is `authorized` | `getClaimedAutomationJobEnvelope` → `toCoreAuthorizedAction` |
| `workflowFamily` is Core-derived and equals `client_whatsapp` | `buildAutomationJobEnvelope` → action registry |
| action is exactly one of the six client actions | `getClientDispatchDefinition` (returns `null`, never a fallback) |
| entity type is `lead` | `isAllowedClientDispatchEntityType` |
| dispatch definition (lane, consent scope, recipient strategy, template key) | `CLIENT_DISPATCH_REGISTRY` |
| variable builder | `CLIENT_ACTION_VARIABLE_BUILDERS` |
| idempotency key is exactly `qf_auto_v1:{jobId}:{attemptId}` | `buildAutomationCommunicationIdempotencyKey` |

**No action-type prefix is ever parsed**, in Core or in n8n. The family is derived from the registry
and cannot be overridden from `safeContext`.

The one genuinely new piece is the **read-side** current-attempt proof. The identical rule already
existed as the authoritative **write-side** guard inside `qf_complete_automation_attempt_v1`, but
that guard is reached only when Core is already finalizing — an execution boundary that must decide
*before* doing anything had no way to ask the same question.

## 4. Communication execution locus — reuse, never rewrite

Execution composes exactly one existing entry point:

```
createRuntimeCommunicationService()   ->   CommunicationService.send(intent)
```

`createRuntimeCommunicationService()` is **the** production construction boundary: it binds the
consent enforcer and the provider-account attribution identity. A direct `new CommunicationService`
would bypass the consent layer and is never used here.

Everything inside `send()` is consumed as-is and is **unmodified by this phase**: recipient
resolution from `public.leads`, the one authoritative consent gate, template lookup and readiness
checks, the approved-mapping preflight and the final network-boundary fence, provider-account
ownership proof and durable binding, the single provider call site, and the normalized outcome
writers. `services/communicationService.ts`, `communicationRecipientResolver.ts`,
`outboundConsentEnforcementService.ts`, `runtimeCommunicationService.ts`,
`lib/communication/providers/**`, `clientDispatchRegistry.ts`, `clientDispatchVariables.ts` and
`businessTemplateVariables.ts` are all byte-unchanged.

Variables are built **only** from Core-owned rows (`leads.name`, `leads.status`, a count over
`lead_assignments`, and a deterministic non-PII `QF-XXXXXXXX` lead reference). `safeContext` is
deliberately **not** a variable source: a request source — including a future agent — must never be
able to choose message content. `outstandingItem` has no proven Core source today, so the two
clarification actions resolve to nothing and fail closed rather than putting unproven text in front
of a client.

## 5. The execute ledger is IDENTITY ONLY

Migration `20260805000000` adds a third route to the existing `automation_transport_requests`
ledger. It records **exactly one fact**: a signed execution request identity was durably reserved
for this exact attempt.

- `route_key in ('claim_v1', 'complete_v1', 'execute_v1')` — closed, exactly three routes.
- `state in ('processing', 'claimed', 'empty', 'completed', 'recorded')` — `recorded` is the only addition.
- The shape check binds `recorded` to `execute_v1`, and the `claim_v1` / `complete_v1` shapes are preserved verbatim.
- `unique(attempt_id) where route_key='execute_v1'` — attempt-scoped, mirroring completion. Both 50.2D uniqueness rules are left untouched.

It stores **no** provider outcome, communication status, classification, safe code, executor
reference, recipient, template, provider, consent or business payload. The table has never had
columns for any of those and this migration adds none — a post-condition in the migration proves the
ledger still carries no outcome column, so a future phase cannot quietly inherit this promise.

Consequently **every replay re-reads Core truth** — the communication ledger and the attempt/job
rows — rather than trusting a stored verdict.

**No cross-system atomicity is claimed.** Reserving the identity and performing the provider
execution are not one transaction and cannot be: the provider call is an external network action
made by the application layer after the reservation commits. Crash-safety comes from re-reading
truth on replay, not from a transaction that does not exist.

Replay behaviour:

| Case | Result |
|---|---|
| same `requestId`, same body | replay — the recorded identity is returned |
| same `requestId`, changed body | `AUTOMATION_TRANSPORT_REQUEST_REPLAY_CONFLICT` (worker + body hash must match) |
| different `requestId`, same attempt | replay — the same attempt-scoped reservation is returned; no second reservation |
| a `requestId` bound to another route | conflict, never a reservation |
| old attempt after a newer attempt exists | refused by the currency proof; no execution |

The job row is locked `FOR UPDATE` first, so two concurrent execution requests for one job serialize
rather than racing into two reservations.

## 6. The authoritative split — B1 only when NO communication row exists

The split is **durable evidence**, never a failure-category guess. Core resolves its own key
`qf_auto_v1:{jobId}:{attemptId}` against `communication_messages`:

- **A row EXISTS** → the persisted communication status is the **sole** authority. Core
  **never uses B1** here: it never classifies and never finalizes the attempt itself. Completion, if
  any, belongs to 50.2D. This includes consent, provider-account and final-preparation failures that
  occur *after* row creation: those are communication-evidence paths, not pre-communication ones.
- **NO row exists** → and only then may Core directly finalize a safely classifiable
  pre-communication failure through the existing attempt-completion authority.

This is a property of the control flow, not a convention: the pre-communication ruling table is
unreachable from any branch in which a communication row was observed. **No communication row is
ever fabricated** — the execution service performs no insert, update, upsert or delete.

Pre-communication rulings are a closed table. `definitive_failure` covers standing
configuration/readiness/business facts (missing or draft template, absent approved mapping, refused
runtime gate, unresolvable recipient, consent **refusal**, untrustworthy consent authority) —
retrying cannot change any of them without a human or provider act, so none is auto-retried.
`retryable_failure` covers genuine bounded infrastructure transients proven by the existing source
(recipient **lookup** failure, consent authority **unavailable**, provider runtime unresolvable,
ledger write or claim race). Every consent refusal collapses to one generic safe code
(`QF_EXEC_DISPATCH_NOT_AUTHORIZED`) so consent state is never inferable from the callback surface.

Anything not in the table is **unclassifiable**: Core does not guess, answers `rejected`, and leaves
the attempt **owned and open** for QF-MVP-50.5 recovery.

This is the first genuinely reachable automation-level `retryable_failure`, exactly as 50.2D
predicted: it is safe only because no communication row exists, so there is nothing for the
communication lane to retry and a new attempt cannot duplicate a send. Retry timing remains
Core-owned and unchanged: 60 / 300 / 900 / 3600 s, with `null` past the budget so the RPC applies its
own dead-letter rule.

## 7. Communication status partition

| Status | Partition | Orchestration state |
|---|---|---|
| `accepted`, `sent`, `delivered`, `read`, `failed`, `dead_letter`, `cancelled`, `outcome_unknown` | completion-ready | `execution_recorded` |
| `queued`, `dispatching`, `retry_scheduled` | pending | `communication_pending` |
| anything unrecognised | — | `rejected`, fail closed |

The partition is total over the closed 11-value vocabulary and **agrees exactly** with the 50.2D
completion rulings — everything 50.2D can complete is completion-ready, everything it refuses is
pending. The two must never disagree, because a completion-ready verdict here is precisely an
instruction to call 50.2D.

### 7a. `retry_scheduled` and the absent due sweep

`recordDispatchFailure` writes `retry_scheduled` together with `next_retry_at`, and
`dispatchPersistedMessage` accepts precisely `queued` and `retry_scheduled` and re-dispatches **the
same row under the same idempotency key**. That status means the communication lane owns a pending
provider retry for that exact message.

50.2E therefore **never** opens a new automation attempt for a pending row. A new attempt would mint
a new `qf_auto_v1:{jobId}:{attemptId}` key, therefore a second communication row and a second
provider send — two independent retry mechanisms over one logical send.

`executorReference` is **withheld** on `communication_pending`, so a state-blind orchestrator cannot
even construct a 50.2D completion body for a row the completion route would refuse.

**Honest limit:** there is **no communication due sweep** in this repository —
`dispatchPersistedMessage` has no production caller; every reference outside the service itself is a
test harness. A pending row is therefore not reconcilable by 50.2E and is **not made reconcilable**
by 50.2E. That belongs to QF-MVP-50.5 and to a separately governed communication retry sweep.
50.2E does not build it, and does not pretend to.

## 8. Response

Four Core-authored orchestration states. n8n branches on this and on nothing else — **HTTP 200 alone
is never success.**

| State | Meaning | `executorReference` | n8n |
|---|---|---|---|
| `execution_recorded` | a real communication row exists and its status is completion-ready | present (the row id) | call 50.2D |
| `communication_pending` | a real row exists but the communication lane owns its next move | **absent by design** | stop |
| `attempt_finalized` | no communication row; Core finalized a safe pre-communication failure | absent | stop, **must not** call 50.2D |
| `rejected` | request, auth, ownership, currency or action-family authority not proven, or outcome unclassifiable | absent | stop, fail safe |

Each carries a `replayed` boolean. Never returned: recipient, destination, phone/email, destination
hash or mask, template key, variables, provider key, provider account, **provider message id**, raw
provider status/body/error, consent state, lead data, SQL, stack, secret or environment value.

An ownership, currency or action-family refusal **never silently consumes the attempt**: it is left
owned and open.

## 9. Transport

The existing QF-MVP-50.1C directional HMAC is reused unchanged — no second crypto system, no new
secret, no new environment variable. The exact path
`/api/internal/automation/n8n/execute-client` is a canonical signing field, declared once in
`transportTypes.ts`, so a claim or completion signature cannot authenticate here and an execution
signature cannot authenticate there. POST only, raw-body SHA-256, ±300 s skew, 2048-byte cap on both
`content-length` and actual bytes, `requestId` header/body equality, configured-worker equality,
mode `off` ⇒ 503. Unauthenticated failures are answered **unsigned**, so the route is never a signing
oracle; authenticated responses are signed and bound to the request id.

## 10. n8n wiring

One new file: `automation/n8n/QF-MVP-50-02-Client-Whatsapp-Executor.50.2E-selfhost-env.workflow.json`.
**Inactive, unpublished, env-reference secrets only, no credential node.** The two pre-existing
candidates are byte-frozen and were not modified — a new file was added rather than extending the
50.2B candidate, whose exact node shape its own gate pins.

```
inactive Schedule / Manual
  -> runtime preconditions (fail closed unless QF_N8N_TRANSPORT_ENABLED === 'true')
  -> signed claim -> verify signed Core response
  -> route ONLY on Core workflowFamily === 'client_whatsapp'
  -> signed execute-client with the five identity keys -> verify
  -> branch ONLY on the Core-authored orchestrationState
       execution_recorded    -> signed 50.2D completion, executorReference copied verbatim -> verify -> stop
       communication_pending -> stop (no completion, no re-execution, no new attempt)
       attempt_finalized     -> stop
       rejected / unknown    -> stop fail-safe
```

No Webhook, Wait, HTTP Request, Execute Workflow, Execute Command, SSH, Supabase or Postgres node.
No action-type prefix parsing. n8n owns no business authority: it chooses no recipient, template,
variable, provider, account, consent decision, idempotency key, classification, safe code or retry
time, and it never constructs an `executorReference`.

## 11. Provider readiness — ZERO of the six is live-ready

| Action | Template key | `communication_templates` row | Meta candidate state | Mapping |
|---|---|---|---|---|
| `client.lead_confirmation` | `lead_received` | present (`mock_ready`) | APPROVED / UTILITY | `APPROVED_UNMAPPED`, `mapping_authority: DENIED` |
| `client.matching_update` | `client_matching_update` | **absent** | APPROVED / UTILITY | DENIED |
| `client.lead_status_update` | `client_lead_status_update` | **absent** | APPROVED / UTILITY | DENIED |
| `client.requirement_collection` | `clarification_request` | present (`mock_ready`) | draft, never submitted | none |
| `client.missing_information_reminder` | `clarification_reminder` | present (`mock_ready`) | draft, never submitted | none |
| `client.transactional_followup` | `client_transactional_followup` | **absent** | **no candidate at all** | none |

**ZERO of the six can execute for real today.** All three Meta-approved templates are
`APPROVED_UNMAPPED` with `send_authority: DENIED`, and two of those additionally have no
`communication_templates` row in either the local migrations or the staging baseline — they fail one
step *earlier* than the Meta gate.

50.2E supports all six **structurally** while every unready one fails closed at its exact existing
gate with zero Meta calls and zero ledger rows. This phase seeds no template row, submits no
template, creates no mapping, changes no Meta state, flips no `binding_readiness` or
`send_authority`, creates no provider account and does not extend `BUSINESS_TEMPLATE_CONTRACTS`
(still exactly five).

## 12. Governance

The new migration required moving the QF-MVP-50.2C-S2-G1 freeze. It was **re-pinned, not loosened** —
see `QF-MVP-50-2C-S2-STAGING-HISTORY-GOVERNANCE.md` §4a. `20260803000000` remains the frozen applied
anchor. `20260804000000` is recorded `APPLIED` with its imported owner-reviewed 50.2D-S2 marker and
remote history count `21`. **`20260805000000` is now also recorded `APPLIED`**, with its own imported
owner-reviewed marker `QF_MVP_50_2E_S2_STAGING_MIGRATION_APPLIED_AND_VERIFIED` and remote history
count `22`, applied exactly once and **not** by the source phase that recorded it.
`pendingPostAnchorMigrations` is now empty. Migration count is pinned at exactly `89`, post-anchor
count at exactly `2`.

The QF-MVP-50.2D validator was also **re-pinned, not loosened**: it hard-pinned migration count 88,
exactly-one-post-anchor, the two-route vocabulary, the G1 constants, and "no workflow may reference
the completion path". Each of those is now an exact assertion over the new truth — two post-anchor
migrations named in order, count 89, three route keys, the new G1 constants, and a
completion-path allowlist naming exactly one workflow while the two pre-existing candidates are
additionally byte-frozen and required to stay completion-path-free.

## 13. What this phase does NOT do

Apply any migration · link/query/push Supabase · touch staging or production · access the VPS ·
access or activate n8n · claim or complete a real job · touch the parked 50.2B evidence row · call
Meta · send WhatsApp · submit or activate templates · seed a template row · create a provider
mapping or account · deploy · access Jarvis · modify any existing n8n workflow JSON · modify provider
or communication send behaviour · edit any historical migration · implement QF-MVP-50.5 stale/lease/
reclaim recovery · start QF-MVP-50.3.

## 14. QF-MVP-50.2 is NOT complete after this phase

Remaining, each separately governed:

1. ~~Technical review, push, exact-head CI, PR, merge.~~ **DONE** — merged as `2249cb60`.
2. ~~A separate exact-one staging migration gate for `20260805000000`.~~ **DONE** — applied and verified under QF-MVP-50.2E-S2-R1, staging history `22`; marker imported into G1 by QF-MVP-50.2E-S2-G1.
3. **A client automation action/job producer.** Nothing in the application creates or authorizes client automation action requests today — `createAutomationActionRequest` / `createAutomationJob` have no callers outside their own module. Without it there is no job for n8n to claim.
4. **Six-action provider readiness**: an active non-draft template row, an approved candidate with `send_authority` granted, an ACTIVE approved mapping with a resolved `variables_schema`, and a ready bound provider account — for each of the six.
5. **A ruling on pending communication recovery**: either wire a communication due sweep or explicitly accept that a `retry_scheduled` row parks until QF-MVP-50.5.
6. **Synthetic / fake-provider integration proof**, then controlled n8n staging activation only when authorized.

Top-level QF-MVP-50.2 may be called COMPLETE only when all six actions have an end-to-end verified
staging send finalized through 50.2D, and items 3 and 5 are closed. **QF-MVP-50.3 remains NOT
STARTED.**
