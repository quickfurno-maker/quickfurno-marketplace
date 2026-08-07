# QF-MVP-50.2 — Final Closure Contract

**Status:** SOURCE CLOSURE CANDIDATE
**Base:** `d0bead498845b52d1aff6e3babaae4d31e829fe9`
**Migration:** `20260806000000_qf_mvp_50_2_atomic_client_automation_producer.sql` — **SOURCE-PENDING, not applied**
**Top-level QF-MVP-50.2:** **NOT COMPLETE** — operational staging certification still remains

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

One combined package: technical review → push → exact-head CI → PR → merge → exact-one staging apply of `20260806000000` → source-truth import → controlled staging n8n activation → synthetic six-action end-to-end proof → replay/idempotency/pending-state checks → then, and only then, mark 50.2 COMPLETE.

**Vendor accept/reject is permanently removed** and must not appear in any future package.
