# QF-MVP-50.2D — Signed Attempt-Completion Callback

**Status:** SOURCE CANDIDATE
**Base:** `bbf134bb31aae1032983a49697cdf6796853e353`
**Target:** source + offline tests only
**Staging apply:** NONE — the new migration is LOCAL PENDING
**Workflow activation:** NONE
**Provider / Meta / WhatsApp:** NONE
**Supabase credential in n8n:** NONE

## 1. What this phase is

The closing boundary of the automation lifecycle, built *before* execution exists so that when QF-MVP-50.2E turns execution on, no executed job can strand.

```
Core-authorized job
  -> n8n signed claim                      (50.1C / 50.2B, shipped)
  -> n8n orchestrates the client workflow
  -> signed Core client execution request  (50.2E, NOT STARTED)
  -> Core executes via its own communication subsystem + provider adapter
  -> n8n receives a sanitized Core execution outcome
  -> n8n calls THIS completion route       (50.2D)
  -> Core re-proves evidence and finalizes the attempt/job
  -> n8n stops
```

50.2D performs no provider send, resolves no recipient/template/provider/consent, routes no workflow family, and implements nothing from QF-MVP-50.5 (stale lease, reclaim, recovery).

## 2. Authority

n8n is **not** completion authority. The request body carries **no** classification, **no** safe code and **no** retry timestamp — those fields do not exist in the schema at all, which is stronger than accepting and ignoring them. A body offering any of them is rejected with `AUTOMATION_TRANSPORT_BODY_FIELDS_INVALID`.

```json
{
  "transportVersion": 1,
  "requestId": "<uuid>",
  "workerId": "<bounded worker id>",
  "jobId": "<uuid>",
  "attemptId": "<uuid>",
  "executorReference": "<uuid>"
}
```

Exactly six keys, all required, unknown keys rejected.

`executorReference` is **evidence to check, never a pointer to follow**. Core resolves the communication row by its own derived key `qf_auto_v1:{jobId}:{attemptId}` first, then requires `row.id === executorReference`. An arbitrary reference cannot select a row.

## 3. Core evidence mapping

Every ruling is justified by the exact Core writer that can produce the state. Routing, a claim, an internal HTTP 200 or an n8n workflow finishing are never inputs.

| `communication_messages.status` | Automation classification | Why |
|---|---|---|
| `accepted` | `success` | Written only by `recordDispatchSuccess`, reached only when `effectiveOutcomeCertainty(result) === "accepted"` (requires `result.accepted === true`). Proven provider acceptance — `queued` is the internal-queue state, not this. |
| `sent` | `success` | `recordDispatchSuccess` with a synchronous provider "sent", or a verified forward webhook. |
| `delivered` | `success` | Verified forward webhook. |
| `read` | `success` | Verified forward webhook. |
| `retry_scheduled` | **not completable** | The communication lane owns a pending provider retry for that exact row — see §3a. |
| `failed` | `definitive_failure` | Non-retryable provider failure, or `markMessageFailed` for a terminal pre-provider failure. |
| `dead_letter` | `definitive_failure` | Retryable errors exhausted. A fresh automation attempt would mint a new idempotency key and therefore a new message — amplifying a send the communication lane already gave up on. |
| `cancelled` | `definitive_failure` | Administratively terminal. |
| `outcome_unknown` | `uncertain` | `effectiveOutcomeCertainty === "unknown_outcome"` — the provider may have accepted and Core can neither prove nor disprove it. Terminal, never resent. |
| `queued` | **not completable** | No dispatch has begun. |
| `dispatching` | **not completable** | A provider call is still in flight; the outcome is genuinely unresolved. |

The table is total over the closed 11-value vocabulary. An unrecognised status returns `AUTOMATION_COMPLETION_EVIDENCE_UNKNOWN_STATE` rather than inheriting a neighbour's meaning.

### 3a. Why `retry_scheduled` is refused (the two-retry-mechanism fence)

`recordDispatchFailure` writes `retry_scheduled` together with `next_retry_at`, and `dispatchPersistedMessage` accepts precisely `queued` and `retry_scheduled` and re-dispatches **the same row under the same idempotency key**. That status therefore means *the communication lane owns a pending provider retry for this exact message*.

An automation `retryable_failure` is a **different lifecycle**: it opens a new attempt, which yields a new `qf_auto_v1:{jobId}:{attemptId}` key and therefore a **second** communication row and a **second** provider send. Mapping `retry_scheduled` to `retryable_failure` would stand up two independent retry mechanisms over one logical send and deliver the client duplicate WhatsApp messages — immediately in the form of an abandoned row still marked "retry pending", and visibly the moment the communication due-sweep is wired to its existing entry point.

So the attempt is treated as **not yet resolved** — the same ruling as `queued`/`dispatching` — and the callback is refused with `AUTOMATION_COMPLETION_COMMUNICATION_RETRY_PENDING` until the communication lane reaches a terminal state. Nothing here cancels, consumes or mutates the pending communication retry; that is not this phase's authority.

**Consequence:** no communication status currently maps to `retryable_failure`. The automation retry schedule below is still Core-owned, exercised and correct — it is simply unreachable from the mapping today. It becomes reachable when 50.2E introduces a genuine automation-level retryable failure (a pre-execution refusal that creates no communication row, so there is nothing for the communication lane to retry). Adding a retryable mapping without first proving no communication-lane retry is pending would reintroduce the duplicate-send defect.

The three terminal failure states are safe by the same test: `dead_letter` and `cancelled` are absorbing states with `next_retry_at = null`, and `outcome_unknown` is explicitly parked with no retry and no dead-letter — none of them carries a pending communication retry.

**No evidence, no completion.** If no communication row exists for the derived key, the callback fails closed with `AUTOMATION_COMPLETION_EVIDENCE_NOT_FOUND` and the attempt stays owned and open. This is the expected state until 50.2E exists; no evidence is invented to make the route look useful sooner.

## 4. Retry ownership

n8n never supplies `next_retry_at`. Core computes it from a fixed, automation-owned schedule:

| `attempt_count` | Delay |
|---|---|
| 1 | 60 s |
| 2 | 300 s |
| 3 | 900 s |
| >= 4 | 3600 s (cap) |

No environment variable, no admin setting, no provider or n8n input, no jitter, and no clock read inside the pure delay function — the caller supplies the canonical `now`.

`lib/aos/workflow/retryPolicy.ts` is deliberately **not** reused. It dead-letters at `attemptCount + 1 >= maxAttempts`; the automation RPC's boundary is `attempt_count >= max_attempts`, one attempt later. Consuming the AOS decision would send `next_retry_at = null` on the final still-retryable attempt, which `qf_complete_automation_attempt_v1` rejects with `AUTOMATION_NEXT_RETRY_AT_INVALID`. The boundary therefore stays in exactly one place: the RPC. When the budget is spent, Core passes `null` and lets the RPC apply its own dead-letter rule.

## 5. Transport and replay

The existing QF-MVP-50.1C directional HMAC is reused unchanged — no second crypto system. The exact path is a canonical signing field, so a claim signature cannot authenticate here and vice versa. Unauthenticated failures are answered **unsigned**, so the route is never a signing oracle; authenticated failures are signed and sanitized.

`automation_transport_requests` was structurally `claim_v1`-only on four levels (route CHECK, state CHECK, insert trigger, shape CHECK) plus a global `unique(job_id)` the claim row already occupies. Migration `20260804000000` replaces each fence with an equally closed route-specific rule:

- `route_key in ('claim_v1', 'complete_v1')` — closed, exactly two routes.
- `state in ('processing', 'claimed', 'empty', 'completed')` — `completed` is the only addition.
- Shape check binds every terminal state to exactly one route.
- `unique(job_id) where route_key='claim_v1'` preserves the claim rule verbatim; `unique(attempt_id) where route_key='complete_v1'` anchors completion replay to the **exact attempt**, because one job legally has several attempts across retry scheduling.

`qf_complete_automation_attempt_transport_v1` performs the attempt completion and the ledger finalization in **one transaction**. If completion is refused, the pristine ledger insert rolls back with it — a refused request identity is never burned and no attempt side effect exists. A duplicate request id returns `is_replay = true` with evidence re-read from the durable attempt/job rows, so a replay can never disagree with truth and never completes twice. Every ownership rule (job `processing`, worker lock, attempt linkage, current attempt, attempt `started`, retry legality, dead-letter boundary) belongs to `qf_complete_automation_attempt_v1` and is not duplicated.

## 6. Response

```json
{
  "ok": true,
  "transportVersion": 1,
  "requestId": "<uuid>",
  "route": "complete_v1",
  "state": "completed",
  "replayed": false,
  "jobStatus": "succeeded",
  "attemptStatus": "completed",
  "classification": "success",
  "safeCode": "QF_COMM_ACCEPTED",
  "executorReference": "<uuid>"
}
```

Never returned: recipient, destination, phone/email, template key, provider account, **provider message id**, raw provider status/body/error, consent state, lead data, variables, SQL, stack, secret.

## 7. Governance

The new migration required moving the QF-MVP-50.2C-S2-G1 freeze. It was **re-pinned, not loosened** — see `QF-MVP-50-2C-S2-STAGING-HISTORY-GOVERNANCE.md` §4/§4a. `20260803000000` is the frozen APPLIED anchor; exactly one hash-pinned post-anchor migration (`20260804000000`, `043f1e3bbe261aef516ca35b54eb3e1c339d21d6b0c55c77f1d138eb502fa2c2`) may exist and remains PENDING until its own separately authorized staging deployment gate. No generic future-migration allowance was granted.

## 8. This phase does not

Apply any migration · link/query/push Supabase · touch staging or production · access the VPS or n8n · claim or complete a real job · touch the parked 50.2B evidence row · call Meta · send WhatsApp · submit or activate templates · deploy · access Jarvis · modify any n8n workflow JSON · modify provider send behaviour · edit any historical migration.
