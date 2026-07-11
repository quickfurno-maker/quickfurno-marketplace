# QuickFurno — Phase 5F-D1-A

## WhatsApp Inbound Data Foundation + Pure Meta Inbound Normalization + Fail-Safe Identity Resolution

**Status: FOUNDATION ONLY. The live webhook behavior is UNCHANGED. Nothing here is wired in.
The migration is prepared but NOT applied.**

This subphase adds three isolated, testable pieces and one prepared migration. It does **not**
touch the running Meta webhook, does **not** reply, does **not** mutate consent, and does **not**
emit any event.

---

## Why inbound is separate from outbound `communication_messages`

`communication_messages` is **outbound-only by construction**: it requires a unique
`idempotency_key`, a `template_key` FK, a send-status lifecycle (`queued → sent → delivered →
read / failed`), and a masked/hashed **destination**. An inbound user message has none of those
semantics — it has a **sender**, a provider **message id**, and free-form content. Overloading the
outbound table would force its core invariants to become nullable and corrupt a clean outbound
authority. So inbound lives in a **separate** table, `public.communication_inbound_messages`, with
its own invariants. Outbound stays exactly as it is.

## Webhook verification is reused, unchanged

The existing Meta webhook verification (bounded raw-body read → require `x-hub-signature-256` →
HMAC-SHA256 over the exact raw body **before** any parse → `webhook_processing_enabled` gate →
parse → classify) is strong and is **reused as-is**. D1-A rebuilds none of it.

## Current webhook behavior remains ignored / acknowledged

In D1-A the `INBOUND_MESSAGE` classification continues to be recorded as an `ignored_non_delivery`
receipt and **acknowledged** with a 200 — exactly as before. The new normalizer and resolver are
**not imported** by `metaWhatsAppWebhookService.ts`. Wiring happens only in **D1-B**, after the
migration is reviewed, applied manually, and the live schema is verified read-only.

---

## Provider-message-id idempotency

The durable per-message fence is the provider's own message id (a Meta `wamid`), enforced by
`unique (provider, provider_message_id)`. Webhook-payload de-duplication alone is insufficient: a
single webhook may carry many messages, and a provider may redeliver the same message inside a
different envelope or in overlapping batches. The idempotency key is the **provider message id** —
**never** a phone, text body, or timestamp. A message lacking a usable id is rejected safely; an id
is never fabricated.

## Sender hashing (no plaintext phone)

The inbound table stores **no** plaintext sender phone. The sender enters only in request memory,
is canonicalized through the one canonical helper (`normalizePhoneE164`), and is stored solely as a
lowercase **`sender_hash`** (SHA-256 of the canonical E.164, `CHECK (~ '^[0-9a-f]{64}$')`) plus an
optional masked form (`+91******3210`). There is deliberately no `phone_e164` / `wa_id` / `MSISDN`
column. In the normalizer result, the plaintext canonical phone appears only as a **request-memory
sibling** field for the D1-B identity lookup — never inside the persistable message, never logged.

## Content minimization

The raw provider payload is **never** stored. The normalizer produces a small, per-type minimized
shape. Retained: **text** → the body only; **button_reply** → `replyId` + `title`; **list_reply** →
`replyId` + `title` + optional `description`; **image/document/audio/video** → a provider `mediaId`
operational reference + `mimeType` + (image/video) `caption` + (document) `filename`. **Dropped for
privacy in D1-A:** precise **location** coordinates/name/address (stored as `{received:true}` only)
and **contact** cards (stored as `{received:true, count}` only) — sensitive personal data is not
persisted merely because Meta supplies it. **reaction** → `emoji` + `targetMessageId`. Unknown types
→ `unsupported` with an allowlisted `providerType` only. Never stored: tokens, authorization
headers, credentialled URLs, whole payloads, or arbitrary provider error objects.

## Identity: EXACT / AMBIGUOUS / UNKNOWN

Sender identity resolves fail-safe. Every provable principal candidate is collected, de-duplicated
by provable identity equality, then: **zero → UNKNOWN**, **exactly one → EXACT**, **more than one →
AMBIGUOUS**. A same-phone client+vendor conflict, or two vendors, is **AMBIGUOUS**. There is no
`LIMIT 1`, no first-row-win, and no client-over-vendor (or vendor-over-client) priority. Ambiguous
and unknown carry **no principal id** — enforced both in code and by a **complete** schema CHECK
(`chk_comm_inbound_identity_confidence_principal`): EXACT ⟺ both principal fields present;
AMBIGUOUS/UNKNOWN ⟹ both NULL; a partially-populated pair is impossible. So a contradictory
identity state (e.g. `exact` with a null principal, or `unknown` carrying one) can never be
persisted, even by a service bug.

**Processing-status decision (deliberate).** No cross-constraint couples `processing_status` to
`identity_confidence`. `processing_status` is **pipeline progress** (captured → normalized → …),
a separate axis from the **durable identity truth** already fully enforced above; and the writer
state machine is not locked until D1-B, so coupling the two now would risk constraining a
legitimate future transition. The identity invariant stands on its own.

## Why a lead-phone match is not an authenticated client identity

`leads.phone` is non-unique — one phone can map to **many** leads — and a lead is not a verified
principal. A matching lead is **not** treated as an authenticated client. Leads are therefore not a
candidate source in the resolver. Only `client_accounts.phone_e164` (canonical E.164, UNIQUE)
yields a provable EXACT client match.

## No consent mutation, no reply, no n8n, no domain event, no outbox command

D1-A performs **no consent** read or write, sends **no reply**, calls **no n8n**, emits **no domain
event**, and enqueues **no outbox command**. It is pure normalization + read-only identity
resolution + a prepared schema.

## Migration prepared but not applied

`supabase/migrations/20260711000100_whatsapp_inbound_message_foundation.sql` is **prepared but not
applied**. It is additive (one `CREATE TABLE` + indexes + RLS/grants), changes no existing table,
adds no trigger, and enables nothing. RLS is on; anon/authenticated have no access; **service-role
only** with `SELECT/INSERT/UPDATE` (no DELETE, no TRUNCATE).

## D1-B dependency

**D1-B** wires the normalizer + resolver into the webhook service **only after**: (1) this migration
is reviewed; (2) the user applies the approved SQL manually in the Supabase SQL Editor; and (3) a
read-only **live schema verification** confirms the table, indexes, constraints, and grants. Until
then the webhook stays frozen and Meta stays disabled.

---

## Schema limitation discovered (documented, fail-safe)

There is **no canonical, phone-unique vendor identity column**. `vendors.phone` and
`vendor_dashboard_users.phone` are non-canonical, non-unique `text`. The vendor candidate finder
therefore matches only an **exact canonical string** on a **verified** vendor phone, which yields a
safe miss (never a false positive) when the stored value is not canonical. Reliable vendor inbound
identity requires adding a canonical `phone_e164` (or a phone-hash) column to the vendor identity in
a later phase. There is also **no authoritative admin/founder phone-identity table**; no admin match
is produced and no founder phone is hardcoded or read from env.

## Tests

`npm run test:phase5f:d1a` — normalization (types, idempotency, minimization, secrecy), normalizer
purity, identity EXACT/AMBIGUOUS/UNKNOWN (no first-row-win, no priority, lead exclusion, malformed
→ unknown), schema static checks (additive, unique key, RLS, service-role-only, no plaintext phone,
sha256 CHECK, no trigger/consent/n8n), phase-boundary freeze checks, and mutation tests A–G
(remove id requirement, fabricate id, add plaintext column, first-row-win, client priority, return
raw payload, wire the webhook in D1-A).
