# QF-MVP-50.2 — Final Closure Contract

**Status:** SOURCE SHIPPED + DATABASE/ATOMIC PRODUCER CERTIFIED — **ORCHESTRATION UNCERTIFIED**
**Base:** `d0bead498845b52d1aff6e3babaae4d31e829fe9`
**Migration:** `20260806000000_qf_mvp_50_2_atomic_client_automation_producer.sql` — **APPLIED to QuickFurno staging**
**Top-level QF-MVP-50.2:** **NOT COMPLETE** — orchestration certification still remains

## 0. Staging truth (imported)

The producer migration has been applied to QuickFurno staging (`uckafzuochmbvtiodmcl`) exactly once by an external owner-reviewed execution. This document imports that record; no phase documented here performs a database mutation.

| Migration | Status | Remote history after apply |
|---|---|---|
| `20260804000000` (50.2D) | APPLIED | 21 |
| `20260805000000` (50.2E) | APPLIED | 22 |
| `20260806000000` (producer) | APPLIED | 23 |

| `20260807000000` (execute_v1 repair) | **PENDING** | — |

Pending post-anchor migrations: **1**. Post-anchor migration count: **4**. Local migration count: **91**.

### 0.1 The execute_v1 reservation defect

Driving the exact merged n8n executor workflow through a real n8n runtime against staging revealed that `public.qf_record_automation_execution_transport_v1` — shipped by the applied migration `20260805000000` — raises `42702 column reference "route_key" is ambiguous` on **every** call.

Every name in its `returns table (…)` is a PL/pgSQL OUT parameter that stays in scope for the whole body, so the attempt-scoped replay lookup's bare `route_key` and `attempt_id` resolved to the output variables rather than to the columns of `automation_transport_requests`. Staging corroborated this: `select count(*) … where route_key = 'execute_v1'` was **0** — the reservation had never once succeeded. `claim_v1` and `complete_v1` are unaffected.

The consequence was total: no client automation action could ever be executed, so execution-time eligibility reproof, intent building, the communication partition and `communication_pending` were all unreachable.

The fix is the successor migration `20260807000000`, which `CREATE OR REPLACE`s the function with an identical signature, return shape, security posture, grants and replay/ownership semantics, changing **only** column references to be explicitly alias-qualified. The historical `20260805000000` is byte-frozen and is never rewritten, and no `#variable_conflict` pragma is used — a pragma would hide the next collision instead of failing on it.

**Earned evidence markers**

- `QF_MVP_50_2_FINAL_R2_STAGING_MIGRATION_APPLIED_AND_VERIFIED` — the producer migration is applied exactly once at remote history 23, hash `ce947a6f8d7dd42d2851f6c99eba4bf2ef39308b8d85ff876260d575185a3cfb`.
- `QF_MVP_50_2_ATOMIC_PRODUCER_STAGING_CERTIFIED` — the DB-native producer was observed against QuickFurno staging: lead INSERT plus automation request and job in one transaction; rollback removing all three; helper replay yielding one request and one job; clarification producing an immediate action and a +24 h reminder; the matching transition and its same-match suppression; the status transition and its same-status suppression; the +48 h Quotation Sent follow-up including leave-and-re-enter behaviour; invalid-authority rejection; and zero residual certification fixtures.

**Not earned.** `QF_MVP_50_2_CLIENT_N8N_STAGING_CERTIFIED` and `QF_MVP_50_2_STAGING_CERTIFICATION_COMPLETE` are **not** claimed. No n8n runtime has yet executed the merged workflow against QuickFurno staging, so the signed claim/execute orchestration boundary remains unproven. Until that is earned, QF-MVP-50.2 is **NOT COMPLETE**.

## 1. Already done before this package

| Phase | Delivered |
|---|---|
| 50.2A | n8n dispatcher scaffold, inactive |
| 50.2B | signed claim handshake |
| 50.2C | client dispatch authority contract (six frozen actions, `lead` recipient) |
| 50.2D | signed attempt completion |
| 50.2E | signed Core client execution + inactive executor workflow |
| 50.2E-S2 / S2-G1 | staging migration applied (history 22) and source governance re-pinned |

## 2. What this package adds

A **database-native, same-transaction client automation producer**, the six owner-approved trigger policies, execution-time business eligibility reproof, and the two frozen phase boundaries.

## 3. Why a database trigger, and not a TypeScript producer

The application writes business rows through PostgREST. There is **no transaction-aware seam** in the TypeScript layer — no `withTransaction`, no `BEGIN`, no RPC that inserts a lead. The old AOS workflow kernel (`outbox_events` / `domain_events`) is deliberately **not installed**, and the applied QF-MVP-50.1B migration **aborts** if it ever appears, because two automation authorities must never coexist.

A sequential TypeScript producer after the business write would therefore be best-effort fire-and-forget, with two real failure modes:

- business row commits → producer crashes → automation silently lost;
- automation job commits → business mutation rolls back → ghost job.

A trigger runs inside the business statement's own transaction, so business truth and automation intent **commit together or roll back together**. This is not a second queue and not a second authority: it writes exclusively through the already-adopted QF-MVP-50.1B tables and RPCs.

**Schema impact is nil.** No table, column, type or index is created or altered. `uq_automation_action_requests_idempotency` already provides durable dedupe, `uq_automation_jobs_action_request` already provides one-job-per-request, and `automation_jobs.available_at` already provides business scheduling.

## 4. The six trigger policies

| Action | Source event | Schedule | Dedupe identity | Suppression |
|---|---|---|---|---|
| `client.lead_confirmation` | `leads` INSERT | immediate | lead id | — |
| `client.requirement_collection` | `lead_clarification_requests` INSERT with `status = 'preview_prepared'` | immediate | clarification request id | non-prepared status, or no lead |
| `client.missing_information_reminder` | same clarification request | **+24 h**, exactly one | clarification request id (`clarrem` token) | at execution: `clarification_required` false, or status left `preview_prepared` |
| `client.matching_update` | `lead_matching_runs.run_status` transition **into** `matched` | immediate | matching run id | any non-`matched` outcome; re-write of an already-matched run |
| `client.lead_status_update` | `leads.status` where `OLD IS DISTINCT FROM NEW` | immediate | md5(lead, old, new, txid) | same-value rewrite fires nothing |
| `client.transactional_followup` | transition **into** exact status `Quotation Sent` | **+48 h**, one per transition | md5(lead, old, new, txid) (`qsfu` token) | at execution: status is no longer `Quotation Sent` |

Leaving and legitimately re-entering `Quotation Sent` is a **new real transition** and may schedule one new follow-up. There is no repeating follow-up loop and no reminder loop in 50.2.

## 5. Business scheduled action ≠ communication retry

The +24 h reminder and +48 h follow-up are **business scheduled actions**, expressed with the existing `automation_jobs.available_at`. They are not delivery retries. No new retry or due-sweep framework is introduced.

## 6. Execution-time eligibility reproof

A delayed action must not rely on producer-time truth. Before any communication is attempted, Core re-reads the live row:

- **reminder** — proceeds only while `clarification_required` is true and `clarification_status` is still `preview_prepared`;
- **follow-up** — proceeds only while `leads.status` is still exactly `Quotation Sent`.

An ineligible action is a **pre-communication non-send**: no communication row, no provider contact, and the attempt is finalized as `definitive_failure` with the dedicated safe code `QF_EXEC_BUSINESS_NO_LONGER_ELIGIBLE`. That is the same shape the codebase already uses for an outbound consent refusal — a deliberate terminal non-send, never reported as a provider failure and never fabricating evidence. n8n never sees lead state and never decides suppression.

## 7. QF-MVP-50.5 boundary (frozen)

`queued` / `dispatching` / `retry_scheduled` → `communication_pending`. 50.2 stops there: no completion call, no redispatch, no second attempt, no due sweep.

**QF-MVP-50.5 owns** the due sweep, `retry_scheduled` recovery, stranded `queued`/`dispatching` reconciliation, stale leases, uncertain-outcome handling, dead-letter operational recovery and manual review. None of it is implemented here.

## 8. QF-MVP-40 / QF-MVP-80 boundary (frozen)

**Structural/synthetic readiness** is a 50.2 concern. **Channel live readiness** is not.

All six actions are structurally supported and exercisable against Core-owned mock execution. Missing live template, mapping or provider-account readiness still fails closed at the existing runtime gates. **Zero of the six is live-provider-ready**, and this package changes no provider state — no template submitted, no mapping created, no account bound, no approval altered, no real send.

> Production send for an action remains disabled until QF-MVP-40 / QF-MVP-80 provider readiness is satisfied.

## 9. What remains before QF-MVP-50.2 can be called COMPLETE

Source is shipped, the migration is applied at remote history 23, and the atomic producer is certified against staging. What is **still outstanding** is orchestration certification:

- the exact merged n8n executor workflow executed by a real n8n runtime;
- the signed Core claim and execute boundaries exercised across all six client actions;
- delayed-action eligibility suppression (stale reminder, stale follow-up) exercised end to end;
- replay, changed-body conflict and stale-attempt behaviour exercised;
- `communication_pending` proven to stop the workflow with no completion and no redispatch.

`QF_MVP_50_2_CLIENT_N8N_STAGING_CERTIFIED` and `QF_MVP_50_2_STAGING_CERTIFICATION_COMPLETE` are **not** earned until every item above is proven, and 50.2 is **not** COMPLETE before then. The only configured n8n is production-bound and must not be used for this; certification requires an isolated runtime.

**Vendor accept/reject is permanently removed** and must not appear in any future package.
