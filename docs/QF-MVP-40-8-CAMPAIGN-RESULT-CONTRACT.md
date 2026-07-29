# QF-MVP-40.8 — Campaign Result Reconciliation Contract

The Core-owned boundary that lets QF-MVP-50 execute a campaign intent and have Core decide the
result, plus the CRM projection built on it. Also records the locked QF-MVP-40.9 no-voice closure.

**No migration. No API route. No dispatcher. No provider call. No database write performed by this
task.**

Artefacts: [`campaignResultContract.ts`](../lib/communication/campaignResultContract.ts) ·
[`campaignCommunicationResultService.ts`](../services/campaignCommunicationResultService.ts) ·
[`validate-qf-mvp-40-8.mjs`](../scripts/mvp/communication/validate-qf-mvp-40-8.mjs)

---

## 1. Authority boundary

**Core is the sole authority on outcome.** The contract takes **identifiers only**. There is no
parameter for a desired status, provider message id, delivery claim, recipient, destination, template
substitution, consent/suppression/frequency result, provider account or retryability. An orchestrator
can say *"reconcile intent X"*; it can never say *"intent X succeeded"*. Core re-reads the canonical
message and derives the answer.

| Owner | Scope |
|---|---|
| **QF-MVP-40** | Meta transport, provider-account binding, mapping resolution, dispatch-time validation, normalized outcomes, message lifecycle, delivery callbacks, **this** reconciliation/projection |
| **QF-MVP-50** | n8n action/job contracts, claiming, batching, execution attempts, retries/dead-letter, pause/resume, the per-recipient loop, result transport into Core, aggregation workflow |
| **QF-MVP-70** | Operations dashboards, manual safe retry UI, broad controls, failure queues, metrics |

## 2. Intent-to-message linkage — **no migration required**

`communication_intents` has **no** `communication_message_id` column, so linkage lives on the message
side. Verified against the committed schema: `communication_messages.entity_type` is `text` with **no
CHECK constraint**, `entity_id` is `uuid`, `correlation_id` is `text`, and `idempotency_key` is
`text NOT NULL UNIQUE`.

| Field | Value |
|---|---|
| `entity_type` | `communication_intent` |
| `entity_id` | `communication_intents.id` |
| `correlation_id` | `qf_campaign:<campaign_id>` |
| `idempotency_key` | `qf_mvp_40_8_campaign_intent_v1:<intent_id>` |

**The unique index on `idempotency_key` is the exactly-once guarantee.** The key is a pure function of
the intent id, so two orchestrator attempts for the same intent necessarily collide on the same row —
the second resolves the existing message instead of sending again. No second convention is
introduced, and no hidden JSON-only magic is used.

`aggregate_type = 'vendor_campaign'` is valid because migration `20260728001500` widened
`communication_intents_aggregate_type_check` to include it.

## 3. Closed status mapping

Every one of the eleven canonical message statuses is mapped explicitly — no default branch, so
adding a status without deciding its projection is a compile error, not a silent "probably failed".

| Message status | Intent status |
|---|---|
| `queued` | `pending` |
| `dispatching`, `retry_scheduled` | `claimed` |
| `accepted`, `sent` | `dispatched` |
| `delivered`, `read` | `delivered` |
| `failed`, `dead_letter`, `cancelled` | `failed` |
| `outcome_unknown` | **`uncertain`** |

`retry_scheduled` is explicitly **not** a success — still in flight. `read` projects to `delivered`
because the intent vocabulary has no `read`; the finer message status stays visible through
`canonicalMessageStatus` and the projection's `readCount`, so read is never *lost*, only never
*claimed* as a distinct intent state.

### Forward-only progression

Ranks: `pending 0 < claimed 1 < dispatched 2 < uncertain 3 < {delivered, failed} 4`.

A move is legal only when it increases rank, or is the same status (a no-op). **Equal-rank but
different statuses are refused**, so `delivered ↔ failed` can never overwrite each other. `uncertain`
sits *below* the terminal pair deliberately — that is what allows a later verified webhook to resolve
`uncertain → delivered` or `uncertain → failed`, while a confirmed delivery can never decay back into
uncertainty.

## 4. Uncertainty and later-webhook resolution

`outcome_unknown` means provider acceptance could be neither proven nor disproven. It projects to
`uncertain`, **never** to `failed`, and **never** triggers a resend. Resolution happens through the
existing verified path only: a later Meta webhook moves the canonical message forward
(`outcome_unknown → sent/delivered/read/failed`, already enforced by `ALLOWED_TRANSITIONS`), and a
subsequent reconciliation then resolves the intent. This contract adds no retry, no timer and no
escalation.

## 5. Idempotency and conflict rules

- Repeating a reconciliation is a no-op: the derived status is a pure function of the message, and a
  same-status result returns `unchanged: true` **without writing**, so `dispatched_at` is never
  rewritten.
- The update is **compare-and-set** on the status that was observed (`.eq("status", current)`). A
  concurrent writer that moved the row first makes the update match zero rows, reported as
  `CONCURRENT_MODIFICATION` rather than silently overwritten.
- `dispatched_at` is stamped only on the **first** dispatch, checked against the row just read.
- A message bound to another intent, another channel or another template is refused
  (`MESSAGE_LINKAGE_MISMATCH` / `MESSAGE_CHANNEL_MISMATCH` / `MESSAGE_TEMPLATE_MISMATCH`).
- The template comes from the intent's **committed** `payload_ref` and must equal `template_purpose`,
  so campaign/template/snapshot evidence cannot be silently substituted.
- Every refusal is a closed reason code — no destination, provider payload, SQLSTATE or stack.

## 6. Ingestion vs projection

**Ingestion** — Core derives and records the intent status from its canonical message. No raw Meta
payload enters through this contract; Meta webhooks already update
`communication_messages`/`communication_delivery_events` through the existing verified path.

**Projection** — `getCampaignResultProjection(campaignId)` returns aggregates only: totals, counts by
intent status, counts by canonical message status, linked/unlinked, dispatched, delivered, read,
failed, uncertain, pending-or-claimed, reconciliation anomalies, and latest safe timestamps. It
exposes **no** `recipient_ref`, destination, phone, email, body or provider payload, and there is no
status-override, retry or send action. Exposed read-only via `campaignResultProjection` alongside the
existing `campaignIntentSummary`. A *reconciliation anomaly* is a linked intent whose stored status
disagrees with what its message projects to — surfaced, never auto-corrected here.

## 7. QF-MVP-50 integration instructions

1. Call `buildCampaignExecutionPlan({ intentId, campaignId? })` → Core validates the intent and
   returns the derived plan (channel, template key, entity linkage, correlation id, idempotency key).
2. Create/dispatch the canonical message through the **existing** CommunicationService outbound path
   using that plan's linkage fields. Consent, suppression, frequency, mapping, provider-account and
   runtime gates all remain unchanged and are re-checked at the network boundary.
3. Call `reconcileCampaignIntent({ intentId, campaignId? })` after dispatch, and again after any
   later delivery callback. It is safe to call repeatedly.
4. Read `getCampaignIntentResult` per intent or `getCampaignResultProjection` per campaign.

QF-MVP-50 still owns claiming, batching, scheduling, retries, dead-letter, pause/resume and the
per-recipient loop. None of that exists here.

## 8. QF-MVP-40.9 — no-voice closure

The locked roadmap defines 40.9 as an **exclusion**, not a pause-switch phase. No new switch was
invented: Meta infrastructure pause already exists via the provider runtime gates, n8n workflow pause
belongs to QF-MVP-50, and unified operations controls belong to QF-MVP-70. No 40.8 correctness or
safety invariant required an additional switch.

Audited **active executable paths only** (`app/`, `lib/`, `services/`, `supabase/migrations/`) so that
documentation legitimately *discussing* voice as excluded does not create a false positive. Zero
matches for voice calling, voice agents, call initiation, call recording, call media, transcription,
text-to-speech, voice campaigns, voice routes and voice runtime credentials.

**Verdict: `QF_MVP_40_NO_VOICE_PATH_PROVED`** (rules H1–H4, enforced on every run).

## 9. QF-MVP-40 status

**QF-MVP-40 CODE IMPLEMENTATION COMPLETE.** Not activated, not production-complete.

External blockers remaining:

- Meta template submission and approval;
- staging provider account configuration;
- staging runtime policy creation in a **disabled** state;
- approved provider mapping seed;
- webhook verification;
- controlled canary send/callback lifecycle.

## 10. Explicit non-actions

No database write · no migration created, edited or applied · no new table, column, index or RPC · no
Meta access, submission, send or webhook verification · no provider account, policy, mapping or canary
seeded · no runtime gate enabled · no API route or n8n workflow · no campaign dispatcher, claim loop,
scheduler or retry worker · no `vendor_campaigns` status mutation · no VPS access · no deployment · no
Jarvis · no voice.
