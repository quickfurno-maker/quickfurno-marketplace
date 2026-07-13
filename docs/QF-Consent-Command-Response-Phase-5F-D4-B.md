# QuickFurno — Phase 5F-D4-B

## Evidence-Bound Consent-Command Acknowledgements (STOP / START / HELP)

D4-B lets QuickFurno answer a user's own inbound consent command with **one** short, fixed, reviewed
acknowledgement — **after** the authoritative consent write has already succeeded, and **without** creating
any reusable way to bypass a suppression.

**QuickFurno Core remains authoritative.** D2-D remains the sole STOP/START writer. D2-C remains the sole
consent/suppression decision authority. D2-E remains the sole inbound command integrator. This phase writes
no consent state, reads no consent table, and interprets no suppression or preference row.

---

## Founder rulings implemented

1. **Separate evidence-bound path.** The three acknowledgement types are **not** in the ordinary D3-B
   registry, so `authorizeOutboundConsent` denies them as `UNCLASSIFIED_MESSAGE_TYPE`.
2. **Persisted lane:** `authentication` / template category `authentication` / channel `whatsapp` /
   ephemeral authentication destination — **storage compatibility only**. Internally classified as
   **`consent_command_response`**.
3. **Identity is always** `identityConfidence: unknown`, `principal: null`. Never upgraded from an inbound
   principal id.
4. **Eligibility** (below) is closed and exact.
5. **Replay produces zero new sends.** A genuinely new STOP returning `stop_already_effective` **may** be
   acknowledged, subject to the rate limit.
6. **Acknowledgement failure never rolls back, repeats, weakens or alters the consent command.**

---

## Why an ordinary transactional message cannot send a STOP acknowledgement

D2-D's locked policy **P1** makes a STOP write suppressions on **`marketing` *and* `transactional`**. D2-C
then blocks every ordinary transactional send to that destination, and D3-B cancels the message before the
dispatch claim.

So an acknowledgement sent as ordinary transactional traffic would be **cancelled by the very STOP it is
confirming**. The acknowledgement is not ordinary outbound traffic — it is a one-shot, **user-solicited**
response to the user's own explicit command. It is therefore authorized by **proof of that command**, never
by a flag.

## Why the acknowledgement types stay outside D3-B

Registering them in `lib/communication/outboundConsentScope.ts` would make them sendable by *any* caller,
gated only by global suppression — **a reusable suppression bypass**. Leaving them out means the ordinary
path returns `UNCLASSIFIED_MESSAGE_TYPE` → **deny**, and the *only* authorizer that can pass one is the
private, one-shot, evidence-bound enforcer. **The bypass is not un-exposed; it is unreachable.**

## Why the authentication lane is borrowed

The live database dictates it:

- `communication_messages.lane` is only `('authentication','business')` — there is no consent-response lane.
- `chk_comm_message_ephemeral_is_authentication` fences an **ephemeral** (caller-supplied) destination to
  the authentication lane — and a STOP from an unknown sender has **no recipient reference**, only a hash.
- D2-C evaluates the `authentication` scope against **`global` suppression alone**
  (`exactSuppressionScope('authentication') → null`), which is exactly the rule a command response needs.

**This does not make these messages authentication semantically.** Their internal classification is
`consent_command_response`, and they carry no OTP and no variables.

---

## Command eligibility (closed)

| Command | Acknowledged when the authoritative result is | Never acknowledged |
|---|---|---|
| **STOP** | `stop_applied`, `stop_already_effective` | any writer failure |
| **START** | `start_applied`, `start_partially_applied`, `start_no_reversible_stop` | **`start_blocked_by_stronger_suppression`** — we never tell a user they are resumed when a complaint/legal/provider block still silences them |
| **HELP** | `help_acknowledged` (D2-D writes nothing for HELP) | — |
| unsupported text · non-text · writer failure · integrity failure · unsupported policy version | — | **always zero sends** |

## Evidence contract

An acknowledgement is authorized only by a binding that carries **all** of: inbound message id · webhook
receipt id (when available) · provider · **canonical** provider message id (the sha256 digest D2-E gives
D2-D — never the raw wamid) · channel · destination hash · normalized command · command disposition · replay
status · derived acknowledgement type · derived template key · persisted inbound `received_at`.

The type and template are **derived from the command** — never supplied. There is no `bypassConsent`, no
`ignoreSuppression`, no `forceSend`, no caller-selected scope, no caller-selected identity confidence, no
arbitrary acknowledgement type and no arbitrary template key. Any absent, invalid or mismatched binding is a
rejection.

The plaintext destination is **re-derived in request memory** from the already-verified payload (via the same
pure normalizer D1-B uses), and its hash **must equal the persisted hash**. It is never persisted, never
logged and never returned.

---

## Processing order

```
verified webhook
 → D1-B persist inbound message
 → D2-E process STOP/START/HELP  (→ D2-D authoritative write for STOP/START)
 → THEN acknowledgement
```

The acknowledgement service is reached only once the command flow returned `ok`, so for STOP/START **the
writer result already exists**. An acknowledgement can never precede the authoritative write.

## The one-shot enforcer

Private to `services/consentCommandResponseService.ts` and **never exported**. It:

1. **is one-use** — a second authorization attempt fails closed, so a single validated command can never
   authorize a stream of sends;
2. compares **every** enforcement field to the approved plan — channel, message type, template key, lane,
   destination hash, destination source, neutral recipient shape (`system` / `null`); any mismatch is a
   closed `invalid`;
3. **only then** consults **D2-C** with `channel: whatsapp`, `scope: authentication`,
   `identityConfidence: unknown`, `principal: null`.

**D2-C mapping (fail-closed):** `no_consent_objection` → allow · `blocked` → deny · lookup failure or thrown
dependency → unavailable · integrity violation, invalid input, unknown disposition or anything unexpected →
invalid.

**A global suppression still blocks the acknowledgement** — a hard bounce, complaint, legal or provider block
means we send nothing at all.

## HELP behaviour

HELP **writes no consent state** (D2-D P3 already guarantees the writer is never called). It **may** be
answered after an ordinary STOP, is still **blocked by a global suppression**, **never opts the user in**,
never removes or changes consent, and **does not create a support conversation**. Free-form support
messaging is out of scope.

---

## Replay, idempotency and rate limiting

- **Replay guard.** A duplicate webhook or replayed command produces **zero new acknowledgements**.
- **Idempotency / rate-limit key:** `ack:{ackType}:{destinationHash}:{bucket}`, where `bucket` is floored
  from the **persisted** inbound `received_at`. It contains **no plaintext destination**.
  - **Windows:** STOP **15 minutes** · START **15 minutes** · HELP **24 hours**.
  - A webhook replay carries the same persisted timestamp ⇒ the **same bucket** ⇒ the ledger's
    `idempotency_key UNIQUE` makes a second send impossible.
  - Repeated identical commands inside the window collapse to **at most one** acknowledgement.
  - STOP, START and HELP have **distinct keys**, so a STOP ack never suppresses a later HELP response.
- The **exact provider-message identity** remains in the validated evidence and in the sanitized metadata,
  even though the rate-limit key is destination-and-bucket based.

## Non-blocking failure

Acknowledgement is **best-effort and non-authoritative**. A suppression, a rate limit, a missing template, an
absent provider, a rejection, a timeout, an unknown outcome or a throw all end in zero further effect. The
webhook returns exactly the outcome the inbound command flow produced — **an acknowledgement failure never
turns a successful consent command into an HTTP 500**, and no acknowledgement internals appear in the
provider-facing response.

All provider, runtime, approved-template, mapping and canary gates remain active.

---

## ACTIVATION BLOCKER — inline acknowledgement latency

**The three acknowledgement templates MUST NOT be activated until this is resolved.**

`processConsentCommandResponses` is **awaited inside the Meta webhook request**. It runs after the inbound
message is persisted and after the D2-D consent write has already committed, so it is **convergent and safe**:
the authoritative STOP/START write is never delayed by it, never rolled back by it, and never endangered by it.
An acknowledgement failure is swallowed and cannot change the webhook's outcome.

The problem is **not** correctness — it is **wall-clock time on the provider's request**. Today the send path
fails closed almost immediately (`TEMPLATE_NOT_FOUND_OR_INACTIVE`, zero network calls), so the added latency is
negligible. **The moment the three templates are seeded and approved, that same inline call becomes a real
outbound HTTP call to Meta**, inside the webhook Meta is itself waiting on. If that call is slow or hangs, the
webhook response can exceed Meta's tolerance, and **Meta will redeliver the webhook**. Redelivery is not a
consent-integrity risk — D2-E is replay-safe and the acknowledgement is idempotency-keyed — but it is an
availability and duplicate-processing risk that must not be introduced silently.

**Required before activation** — one of:

1. A **durable asynchronous job / outbox**: the webhook records the acknowledgement intent and returns; a
   separate worker performs the send. (**Not implemented in D4-B. Do not build it as part of this phase.**)
2. Any other **reviewed, bounded-latency design** that keeps the webhook response inside the provider's
   timeout under worst-case provider behaviour.

Constraints on whatever design is chosen:

- It **must never delay, block, weaken or endanger the authoritative STOP/START write.** Consent remains
  first and remains transactional.
- It is **not deferred to Jarvis or n8n.** Jarvis recommends only; n8n executes only. Neither may own,
  authorize, retry or schedule an acknowledgement.
- **QuickFurno Core remains the sole authority** for consent state, acknowledgement authorization and send
  eligibility.

Until then the current inline call is deliberately retained: with the templates unseeded it is inert, and it
keeps the acknowledgement path fully exercised, audited and mutation-tested ahead of activation.

---

## Live database state (verified)

The live Supabase database has been **independently verified** to contain the outbound and inbound
communication ledger:

`communication_messages`, `communication_templates`, `communication_delivery_events`,
`communication_webhook_receipts`, `communication_inbound_messages`, `communication_consent_command_receipts`.

**The outbound ledger is applied and present — it is not missing and not unapplied.** D4-B therefore needs no
schema change of any kind.

The **only** outstanding database dependency for D4-B is that three **rows** do not yet exist in
`communication_templates`: `consent_stop_acknowledgement`, `consent_start_acknowledgement`,
`consent_help_response`. That is a **Phase 7 template-readiness item, not a schema item.**
**D4-B does not add or seed those rows** (see the activation blocker above — they must not be seeded until the
latency design is resolved).

---

## Fixed approved copy

No links, offers, pricing, promotions, phone variables, dynamic free text or opt-in CTA.

**STOP** — “Your STOP request has been processed. QuickFurno marketing and service-update WhatsApp messages
are now stopped. Authentication messages you request may still be sent. Reply START to request resumption.”

**START** — “Your START request has been processed. Messages previously stopped by your QuickFurno STOP
request may resume. Other safety, legal, provider, or account restrictions remain in effect.”

**HELP** — “QuickFurno messaging help: Reply STOP to stop marketing and service-update WhatsApp messages.
Reply START to request resumption. HELP does not change your messaging preferences. Authentication messages
may still be sent when you request them.”

---

## What D4-B does not do

- **No SQL, no migration, and no template rows are created.** The three templates
  (`consent_stop_acknowledgement`, `consent_start_acknowledgement`, `consent_help_response`,
  category `authentication`, channel `whatsapp`) are a **Phase 7C template-readiness dependency**.
  **Until they are seeded, the send fails closed** with `TEMPLATE_NOT_FOUND_OR_INACTIVE` — zero provider
  calls, and the consent command is entirely unaffected. That is the intended, safe pre-seed behaviour.
  They must not be seeded until the inline-latency **activation blocker** above is resolved. The outbound
  ledger tables themselves are already applied live; only these three rows are outstanding.
- **No provider activation.** Meta, WhatsApp, SMS, RCS all remain exactly as they were.
- **No n8n, no Jarvis.** Neither can authorize or invoke this path.
- **No direct provider call.** Sending goes through the existing runtime factory and the ordinary
  `CommunicationService` path.
- **No frozen authority changed** — D2-C, D2-D, D2-E, the D3-B coordinator, the D3-B registry,
  `CommunicationService` and the runtime factory are all untouched.

## Rollback

Plain code revert. No migration, no schema change, no seeded data, no provider or environment change.
Reverting removes the acknowledgement call from the webhook; the inbound consent flow is unchanged.
