# QuickFurno — Phase 5F-D2-E

## Inbound WhatsApp Consent-Command Integration

D2-E is the **wiring phase**. It adds no new consent policy, no new database object and no new authority.
It connects three things that already exist and were already reviewed:

```
Meta webhook (verified, thin)
  └─ D1-B  persists the inbound message FIRST (durable row + per-message unique fence)
      └─ D2-E orchestrator   evaluates the text command   ← THIS PHASE
          └─ D2-D writer     owns ALL STOP/START mutation (single atomic RPC)
```

**QuickFurno Core remains the sole consent authority.** Jarvis may recommend, n8n may execute an approved
instruction, Meta and other providers merely deliver. D2-E decides nothing about consent — it *adapts* a
verified inbound fact into the frozen D2-D contract and lets D2-D decide.

---

## Authority ownership

| Concern | Owner | D2-E's role |
|---|---|---|
| Verify + classify the webhook | Meta webhook service | untouched |
| Durably persist the inbound message | **D1-B** | extended to return sanitized per-message context |
| Interpret the command token | **D2-D normalizer** (pure allowlist) | reused as-is |
| Mutate STOP/START state | **D2-D writer + RPC** | called exactly once; never bypassed |
| Decide "may we send?" | **D2-C** | **never called** — see below |

### Why D2-C is never called

D2-C is a **send-authorization** authority ("may we send to this destination?"), not a command-processing
one. Calling it in this path would be wrong three times over:

1. **It would be a stale read.** The D2-D RPC re-reads suppression state *inside* its own locked
   transaction. Anything D2-C reported beforehand is a TOCTOU snapshot D2-D re-derives correctly anyway.
2. **It would add failure modes that block a STOP.** D2-C can return `AUTHORITY_LOOKUP_FAILED`. Letting a
   *consent read* stand between a user typing STOP and the suppression being written is a regression in
   user protection. **A STOP must never be gated on a read.**
3. **D2-E sends nothing**, so there is no send to authorize.

D2-C's moment arrives only if a future phase adds an outbound acknowledgement. That is not this phase.

---

## The integration seam

Exactly one seam, in `services/metaWhatsAppWebhookService.ts`, inside the `INBOUND_MESSAGE` branch:

```ts
const inbound = await handleInboundWhatsAppMessages({ rawBody: input.rawBody, payload });
if (!inbound.ok) return { status: 500, code: "inbound_processing_failed" };   // persistence FIRST

const commands = await processInboundConsentCommands(inbound.result.processed); // then commands
if (!commands.ok) return { status: 500, code: "inbound_command_processing_failed" };
```

The webhook stays **thin**. It imports **only** the D2-E orchestrator. It does **not** import the D2-D
writer, does **not** call the RPC, does **not** normalize commands, does **not** touch
`communication_preferences` / `communication_suppressions`, does **not** re-read the raw body, and
**sends nothing**. It knows no D2-D implementation detail.

---

## Persistence-before-command ordering

Persistence **strictly precedes** command processing, and this is load-bearing rather than stylistic:

- the durable inbound row is the **provider-event record of record**. If command processing then fails
  deterministically, the message is still durably captured and auditable;
- the row's UUID is what links the D2-D consent receipt back to the **original wamid** (see below);
- a retry re-runs the *whole* verified path, and both layers are idempotent, so a retry converges.

D1-B emits per-message context **only after** a row is durably present.

---

## Persistence receipt contract (D1-B → D2-E)

`handleInboundWhatsAppMessages` now returns `result.processed: InboundProcessedMessage[]`, one entry per
durably-stored message (never a rejected one), each pairing the minimized message with:

| Field | Meaning |
|---|---|
| `inboundMessageId` | the **durable row UUID** — the same id on the insert path and the duplicate path |
| `provider` / `providerMessageId` | the adapter key + the **original** wamid |
| `duplicate` | `false` = freshly inserted, `true` = the row already existed |
| `destinationHash` | `sha256(canonical E.164)` — **never** a plaintext phone |
| `identityConfidence` | `exact` / `ambiguous` / `unknown` |
| `principalType` / `principalId` | populated **only** when the identity is `exact`, else `null` |
| `receivedAt` | server receive time |
| `providerOccurredAt` | the provider instant, or `null` |

It carries **no** plaintext phone, **no** access token, **no** raw webhook payload and **no** message body.

**Duplicate path.** The existing row is resolved through the per-message unique fence
(`uq_comm_inbound_provider_message`) and its **real** UUID is returned. A UUID is **never invented**: zero
rows, more than one row (a violated fence), or a database error all resolve to `null`, which becomes a
**retryable** failure so the webhook returns 500 and a retry can resolve it correctly.

**D1-B stays consent-agnostic** — no consent import, no writer import, no STOP/START/HELP literal, no
command decision logic. It captures; it does not interpret.

---

## Provider mapping

D1-A/D1-B persist the **adapter** key; D2-D's TypeScript allowlist *and* its already-applied SQL `CHECK`
accept only the **consent-domain** key. One explicit, closed map bridges them:

```
meta_whatsapp_cloud   →   meta_whatsapp
```

It is a closed allowlist, never a prefix trim. An unmapped provider is **rejected**, never passed through.
**The D2-D provider allowlist is not widened**, and no migration is needed.

---

## Provider event identity: SHA-256 of the wamid

A Meta `wamid` is `wamid.` + **base64**, whose alphabet includes `+`, `/` and `=`. The frozen D2-D
identifier fence — in TypeScript **and** in the applied SQL — is `^[A-Za-z0-9._:-]{1,200}$`, which
**excludes all three**. A raw wamid carrying one would be rejected as `INVALID_WRITER_INPUT` — a
*deterministic* failure, acknowledged with 200, meaning **a real STOP would be silently dropped**.

So the durable D2-D provider-event identity is:

```
providerMessageId = sha256(original wamid)   → lowercase hex, exactly 64 characters
```

- **Total and deterministic (1:1)** — the same wamid always yields the same identity, so D2-D's receipt
  idempotency, replay and conflict detection are preserved *exactly*.
- **Always inside the fence** — a wamid containing `+`, `/` or `=` is carried safely **without weakening
  D2-D validation** and **without a migration**.
- **The raw wamid never reaches the consent receipt.** It stays on the D1-B inbound row, which the receipt
  reaches through `inboundMessageId` — so full auditability back to the literal wamid is preserved.

> **Contract note.** D2-D derives its `sourceEventId` internally from `providerMessageId`; `ConsentWriterInput`
> exposes no `sourceEventId` field, and the D2-D writer is frozen. The persisted inbound row UUID is therefore
> carried in **`inboundMessageId`** (which the RPC stores as `inbound_message_id`). The row UUID does reach the
> database — it simply lands in that column rather than in `source_event_id`. Changing that would require
> editing the frozen D2-D writer, which is out of scope.

---

## Timestamp fallback

`providerOccurredAt` is nullable (Meta may omit or garble `timestamp`), but D2-D **requires** a strict
timezone-qualified RFC3339 instant.

```
occurredAt = valid provider instant   ?? server receivedAt
```

Output is always strict RFC3339 via ISO formatting. If **both** are unusable the build fails closed — an
instant is never fabricated.

Dropping a STOP is far worse than an approximate occurrence time, so the fallback is deliberate. It is
also **replay-safe**: D2-D's replay/conflict binding is
`(provider, provider_message_id, channel) → destination_hash + command + policy_version`, and `occurred_at`
is **not** part of that comparison — so a retry that derives a different fallback instant still replays
cleanly and returns the **original stored** outcome.

---

## Command eligibility

**Only `text` messages are command-eligible.** A button reply whose `replyId` literally says `STOP` is
**not** a typed command and is never interpreted — consistent with D2-D's refusal to do substring or
sentence inference. Everything non-text is skipped without reaching the writer.

The token is normalized by the **pure D2-D normalizer** (whole-token allowlist). Raw text never reaches the
writer, the RPC, or any projection table.

| Command | Effect |
|---|---|
| STOP family | D2-D writer called **exactly once** |
| START family | D2-D writer called **exactly once** |
| **HELP** | sanitized internal acknowledgement. **No writer call, no RPC, and NO outbound reply** — no outbound acknowledgement is approved in D2-E |
| Unsupported text | sanitized internal ignore. No writer call, no RPC |
| Non-text | skipped entirely |

---

## Duplicate and replay behaviour

Duplicate inbound messages are **deliberately re-processed**. A first attempt may have persisted the row
and *then* failed the command write; skipping duplicates would lose that command forever.

Re-processing is safe by construction: the provider-event identity is deterministic, so D2-D's receipt
returns the **original stored outcome** with `replayed: true` and applies **no second effect**.

---

## Failure semantics

The split between **retryable** and **deterministic** is the safety core of this phase.

| Condition | Webhook | Why |
|---|---|---|
| D1-B persistence fails | **500** retryable | Meta retries; the unique fence makes it converge |
| Duplicate row cannot be resolved | **500** retryable | never invent a UUID |
| `WRITER_TRANSACTION_FAILED` | **500** retryable | the D2-D receipt makes the retry a replay |
| Unexpected dependency/db error | **500** retryable | sanitized; no raw error escapes |
| STOP/START applied | 200 | |
| STOP/START **replayed** | 200 | original outcome returned |
| HELP | 200 | no writer, no reply |
| Unsupported text | 200 | |
| Non-text message | 200 | |
| `INVALID_WRITER_INPUT` | 200 | deterministic — retrying can never help |
| `WRITER_CONFLICT` | 200 | deterministic |
| `WRITER_INTEGRITY_VIOLATION` | 200 | deterministic |

**Batch rule.** Every candidate is attempted. **Any** retryable item makes the whole webhook retryable;
deterministic and no-op items never do. For deterministic failures the already-persisted inbound row **is**
the durable provider-event record, and only a sanitized internal outcome code is returned.

Deterministic failures are acknowledged rather than retried precisely to avoid an infinite retry storm —
retrying an input D2-D will always reject cannot succeed.

---

## Security and privacy boundaries

- **No raw wamid in the D2-D receipt** — the SHA-256 digest is used.
- **No plaintext phone** anywhere: only `destinationHash` (`sha256(E.164)`) and the masked display form.
- **No raw message body** in any returned outcome, log, or error.
- **No destination hash, SQL error, SQLSTATE or stack** in any returned outcome.
- No service-role/database/provider secret exposure.
- **No outbound message** of any kind — not even a HELP reply.
- No n8n. No Jarvis/AI. No Meta activation. Meta remains disabled.
- **No new migration, no SQL, no route change, no environment change.**
- No direct database consent mutation: D2-D's RPC is the only writer.

---

## Rollback strategy

D2-E is **pure application wiring** — there is no migration, no database object, no schema change and no
provider/environment change to unwind. Rollback is therefore a plain code revert:

1. **Full revert** — revert the D2-E commit. The webhook returns to persist-only behaviour (D1-B), the
   orchestrator and builder become unreferenced, and D2-D returns to being reviewed-but-uncalled. Inbound
   messages continue to be captured durably; no consent state is written.
2. **Data left behind is safe and additive.** Any consent evidence, suppression and receipt rows already
   written by D2-D remain valid — they were produced by the reviewed, unmodified D2-D authority. Nothing
   needs deleting, and re-enabling D2-E later replays cleanly against the existing receipts.
3. **No reapplication of SQL.** The D2-D migration is already applied and must not be reapplied; D2-E does
   not touch it.

Because the provider-event identity is deterministic, a revert followed by a later re-enable is **not** a
double-apply: the existing D2-D receipts turn every re-delivered command into a replay.

---

## Phase scope (exactly seven files)

**Modified**
- `services/inboundWhatsAppMessageService.ts` — returns sanitized per-message persistence context
- `services/metaWhatsAppWebhookService.ts` — the single seam
- `package.json` — the `test:phase5f:d2e` script

**Created**
- `lib/communication/inboundConsentCommandInput.ts` — the pure input builder
- `services/inboundConsentCommandService.ts` — the orchestrator
- `scripts/phase5f-d2e-inbound-consent-integration-harness.mjs`
- `docs/QF-Inbound-Consent-Integration-Phase-5F-D2-E.md`

**Untouched (frozen):** the D2-D writer, the D2-D command normalizer, the consent policy constant, D2-C,
the D2-D SQL migration, the webhook route, and every existing phase harness.
