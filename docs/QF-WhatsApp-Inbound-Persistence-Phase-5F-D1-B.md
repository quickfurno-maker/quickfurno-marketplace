# QuickFurno — Phase 5F-D1-B

## Verified WhatsApp Inbound Persistence Wiring + Per-Message Idempotency + Fail-Safe Identity Persistence

**Status: the verified `INBOUND_MESSAGE` path now durably CAPTURES inbound messages. Meta
remains disabled; nothing replies, mutates consent, emits events, or calls n8n.**

D1-B wires the already-verified Meta `INBOUND_MESSAGE` classification into durable persistence
using the live D1-A table `public.communication_inbound_messages`. It adds one service
(`services/inboundWhatsAppMessageService.ts`) and one narrow branch in the webhook orchestration.

---

## The existing webhook verification order is preserved

The webhook service still runs, in order: require signature header → resolve server-only
signature config → **verify HMAC-SHA256 over the exact raw body (before any parse)** → require
`webhook_processing_enabled` → parse JSON → classify → dispatch. D1-B rebuilds none of it, adds
no second route, no second verifier, and no second raw-body reader. This service **verifies
nothing** — its caller is the verified Meta webhook orchestration boundary.

## Only `INBOUND_MESSAGE` changes behavior

`DELIVERY_STATUS` stays on `CommunicationService.processWebhook`; `UNKNOWN` stays
`ignored_unknown`; `TEMPLATE_STATUS`/`ACCOUNT_STATUS` stay `ignored_non_delivery`. **Only**
`INBOUND_MESSAGE` is newly wired — it no longer falls through to `recordIgnoredReceipt`; it calls
the D1-B service. New webhook outcomes: `inbound_processed`, `inbound_duplicate`,
`inbound_acknowledged_rejected`, and (on real failure) `500 inbound_processing_failed`.

## Receipt dedupe and per-message dedupe have different responsibilities

Two de-duplication authorities, different jobs:

- **Whole-payload webhook receipt** (`communication_webhook_receipts`) is **replay/monitoring
  metadata**. A duplicate receipt is **reused** (its diagnostic `duplicate_count` bumped
  best-effort) and its id links the inbound rows.
- **Per-message unique fence** `uq_comm_inbound_provider_message (provider, provider_message_id)`
  is the **final correctness authority**. A conflict on it is an **idempotent duplicate success**
  (no second row); any *other* DB error is a real failure.

## Whole-receipt duplicates do NOT blindly short-circuit inbound processing

A blind "duplicate receipt → return immediately → skip all messages" pattern is **forbidden**: a
single webhook may carry several messages, and a first attempt may create the receipt + persist
message A but fail on message B. If a redelivery then short-circuits on the duplicate receipt,
**message B is lost forever**. So D1-B **does not short-circuit** — a duplicate receipt still
evaluates every message; the per-message fence makes re-processing idempotent.

## Exact `wamid` is the message identity — partial-batch retry model

The message identity is the provider's own message id (Meta `wamid`). D1-B has no cross-table
transaction and no new RPC; its retry safety comes only from: durable receipt identity + the exact
`wamid` + the unique fence + deterministic normalization + idempotent unique-conflict handling.

```
first attempt:  A inserted, B db-error   → receipt failed  → webhook 500
retry (same):   A conflicts (duplicate), B inserts → receipt processed → webhook 200
```

No message is ever permanently lost, and a duplicate row is never created. The whole batch is
re-evaluated on each attempt; already-persisted messages resolve to idempotent duplicates.

## Identity mapping

Per valid message, the D1-A resolver returns EXACT / AMBIGUOUS / UNKNOWN and the row is mapped:

| Identity | `identity_confidence` | principal | `processing_status` |
|---|---|---|---|
| EXACT | `exact` | type + id | `identity_resolved` |
| AMBIGUOUS | `ambiguous` | **null** | `identity_ambiguous` |
| UNKNOWN | `unknown` | **null** | `identity_unknown` |

`buildInboundRow` carries a principal **only** on an EXACT identity — a resolver bug that returned
a principal on a non-exact result would still be stripped to null (and the live schema CHECK would
reject it anyway).

### UNKNOWN vs IDENTITY_LOOKUP_FAILED (reliability)

The resolver returns a discriminated **outcome**, and D1-B treats the two cases very differently:

- **UNKNOWN** (`ok:true`, `confidence:"unknown"`) — a **successful** lookup found no provable
  candidate. This is a valid durable result: the row is persisted as `identity_unknown`, the receipt
  is `processed`, and the webhook returns **200**.
- **IDENTITY_LOOKUP_FAILED** (`ok:false`) — the identity truth **could not be evaluated** because the
  lookup **infrastructure failed** (a candidate-source query error, a thrown dependency, an
  unavailable database). This is **never** persisted as `identity_unknown` and **never** fabricates a
  principal. The message is **not** persisted; the batch becomes a **retryable** processing failure;
  the receipt is finalized `failed` with a stable sanitized reason (`identity_lookup_failed` — never
  a raw DB error); the service returns `ok:false`; and the webhook returns a generic **500** so Meta
  retries. A temporary database failure must never become durable UNKNOWN identity truth.

This preserves the partial-batch retry model: if A persists and B's identity lookup fails, A is
**not** rolled back, the batch returns 500, and a retry idempotently makes A a per-`wamid` duplicate
while B's lookup (now succeeding) persists — receipt `processed`, webhook 200. A resolver throw is
treated as the same operational failure (fail closed, retryable).

## Content minimization; no plaintext sender persistence

Rows store only the D1-A-minimized `content_minimized` (never the raw payload) and the sender as
`sender_hash` (SHA-256 of the canonical E.164) + optional `sender_masked`. The request-memory-only
`senderPhoneE164` from the normalizer is used **only** for the identity lookup and is **never**
written to a row or logged. No `phone_e164` / `wa_id` / plaintext phone / profile object / contacts
array / location coordinates / access token / app secret / signature / raw provider error is
persisted.

## Boundaries

D1-B captures only. It contains **no reply / send**, **no consent** read or write, **no command
handling** (STOP/START/HELP text is stored only as ordinary minimized message content — deterministic
command governance is D3, after D2), **no domain event / no outbox** command, **no n8n**, **no
AI / no Jarvis**, and **no conversation / no 24h-window** logic (D4). No new API route, no
migration, no env change, and no Meta activation — the code path is wired while runtime stays
disabled. **Meta remains disabled.**

## Tests

`npm run test:phase5f:d1b` — webhook-order regression, normalization handoff, identity persistence,
row privacy, per-message idempotency (orchestration + the real DB adapter with a fake client),
receipt retry safety (partial failure → 500 → retry → 200, no message lost), receipt-status
finalization, race/duplicate + equality-filter safety, and boundary checks — plus mutations A–L
(duplicate-receipt short-circuit, fatal per-message conflict, swallow-all-errors, plaintext phone
in the row, ambiguous/unknown principal leak, INBOUND fall-through, send/event/consent injection,
loop-skip, fabricated id).
