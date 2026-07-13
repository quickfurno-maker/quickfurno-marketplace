# QuickFurno — Phase 5F-D4-C

## Durable Asynchronous Consent-Command Acknowledgement Delivery

D4-B built the evidence-bound STOP / START / HELP acknowledgement and sent it **inline, awaited inside the
Meta webhook request**. D4-C replaces that inline send with a **durable intent + a Core-owned worker**.
Nothing about the consent authority changes: D2-C still decides, D2-D still writes, D2-E still integrates.

---

## Why D4-B's inline delivery cannot be activated

`processConsentCommandResponses` was awaited inside the webhook. That is *correct* — the authoritative
STOP/START write has already committed, and an acknowledgement failure is swallowed — but it is not *safe to
activate*. Today the send fails closed almost instantly (`TEMPLATE_NOT_FOUND_OR_INACTIVE`, zero network
calls), so the added latency is nil. **The moment the three templates are seeded, that same inline call
becomes a real outbound HTTP call to Meta, inside the request Meta is itself waiting on.** A slow or hanging
provider then pushes the webhook response past Meta's tolerance and **Meta redelivers the webhook**.

Redelivery is not a consent-integrity risk — D2-E is replay-safe, the webhook receipt is idempotent, and the
acknowledgement is idempotency-keyed — but it is an availability and duplicate-processing risk, and it must
not be introduced silently. D4-C removes the inline provider call entirely, which is what unblocks template
activation.

---

## Why `communication_messages` cannot be the worker queue

An acknowledgement is forced by existing constraints into `lane = 'authentication'` +
`destination_source = 'ephemeral_auth_destination'`. Two things then make the ledger unusable as a queue:

- `chk_comm_message_ephemeral_never_scheduled` forbids an ephemeral row from carrying `scheduled_at` —
  "its plaintext lives only in request memory, so there would be nothing left to dispatch from later";
- `CommunicationService.dispatchPersistedMessage()` explicitly refuses **both** shapes:
  `AUTH_LANE_NOT_REDISPATCHABLE` and `EPHEMERAL_DESTINATION_NOT_REDISPATCHABLE`.

The ledger has already ruled this class of message undeliverable after the request ends. Reusing it would
have required editing `services/communicationService.ts` — a **frozen authority**. So the worker does **not**
call `dispatchPersistedMessage`; it calls the ordinary `CommunicationService.send()` with a
`preResolvedDestination`, exactly as the webhook used to, with the one-shot enforcer injected.

## Why not the workflow-kernel outbox

`public.outbox_events` has no expiry column, its `payload_json` is documented *"never store secrets"* so it
cannot carry a sealed destination, and it has no foreign key to the authoritative consent-command receipt.
Bending it to consent semantics would couple this path to a general kernel table for no gain.
**It is not used and it is not a dependency** — D4-C works whether or not the kernel migration is applied.

---

## The destination problem (the reason this phase needed a founder ruling)

D1-B stores **only** `sender_hash` — *"the plaintext sender phone is NEVER stored. There is deliberately no
`phone_e164` / `wa_id` / MSISDN column."* `communication_messages` likewise stores only a hash and a mask.
**So when the webhook returns, the number is gone.** An async worker cannot recover it from anything already
persisted, and a provider lookup by wamid does not exist.

**Ruling: a short-lived AES-256-GCM sealed destination, stored ONLY on the acknowledgement intent** — never
on the inbound row, so the D1-B privacy contract is untouched. Unknown senders (the common STOP case) stay
eligible for an acknowledgement.

### Encryption / key format

| | |
|---|---|
| Algorithm | AES-256-GCM, 32-byte key, random 12-byte nonce, 16-byte auth tag |
| Encoding | base64url for ciphertext, nonce and tag |
| Primary key id | `QF_CONSENT_ACK_DESTINATION_PRIMARY_KEY_ID` (e.g. `ack-key-v1`) |
| Key set | `QF_CONSENT_ACK_DESTINATION_KEYS` — a JSON object mapping key id → base64url 32-byte key |
| Encrypt | with the **primary** key id |
| Decrypt | with **any key in the active set** (so a rotation does not orphan live intents) |

There is **no hard-coded key, no fallback key and no test default in production code**. Malformed
configuration, a missing primary key, an unknown key id, or a wrong key length **all fail closed**. The key
material is never logged, never returned, never persisted, and never placed in an error.

### The canonical AAD

A **fixed-order, length-prefixed** serialization (`8:abcdefgh|3:xyz|…`) — deliberately *not* unordered object
serialization, and length-prefixed so no value can be smuggled across a field boundary. It binds:

`schema version · intent id · consent-command receipt id (or an explicit `-` HELP-null marker) ·
inbound-message id · canonical provider-message hash · destination hash · acknowledgement type · expiry`

**Change any one of those and the AEAD open fails.** A ciphertext is therefore non-transplantable: it cannot
be moved to another intent, another receipt, another inbound message, another destination or another expiry.

#### The expiry is bound as an INSTANT, never as text

The enqueue seals with a JavaScript `toISOString()` string (`2026-07-13T10:15:00.000Z`); the worker rebuilds
the AAD from what **Postgres** returns for a `timestamptz` (`2026-07-13T10:15:00+00:00`, sometimes with
microseconds). Those are the **same instant but different bytes**. Binding the raw text would have made every
legitimate acknowledgement fail to decrypt.

So the expiry is canonicalized **inside the shared AAD function** — never at a caller — to its **decimal Unix
epoch milliseconds** (`String(Date.parse(expiresAt))`). Consequences:

- **PostgreSQL timestamp formatting cannot affect decryption.** `…Z`, `+00:00` and `.000000+00:00` all
  produce byte-identical AAD.
- **Instant equality is required; raw-string equality is not.** A 1-millisecond difference still fails.
- An **unparseable** timestamp returns `null` — **fail closed**, and the offending value is never echoed.

### Destination validation after decryption

The worker opens the envelope, **canonicalizes to E.164, recomputes the QuickFurno SHA-256 phone hash, and
requires an exact (constant-time) match with the persisted `destination_hash`.** A substituted destination can
never be silently used. Every one of these terminalizes `failed` with **zero provider calls**: missing key,
unknown key id, malformed ciphertext/nonce/tag, AEAD failure, AAD mismatch, invalid phone, hash mismatch.
**No fallback destination. No recipient guessing. No canonical-profile substitution.**

### Retention, purge, rotation

The ciphertext lives only as long as the intent: **15 minutes** (STOP/START) or **24 hours** (HELP). **Every
terminal transition clears the ciphertext, nonce, auth tag and key id in the same SQL statement**, and a table
constraint (`ck_ack_intent_terminal_is_purged`) refuses to store a terminal row that still carries any of
them. An expiry sweep terminalizes anything left behind. **No terminal row retains recoverable destination
material.** An old key must not be retired while an unexpired non-terminal intent still references it —
because intents expire within 24 hours, retiring a key one day after it stops being primary is always safe.

---

## Architecture: webhook → worker

```
verified Meta webhook
  → D1-B persist inbound message
  → D2-E process consent command
  → D2-D authoritative STOP/START result
  → derive the eligible acknowledgement plan
  → generate the intent UUID
  → seal the destination (AAD-bound to that UUID)
  → INSERT one durable intent
  → return the webhook response            ← Meta is released here. No provider call has happened.
       ⋮
  → Core worker claims the intent
  → open + verify the destination
  → RE-EVALUATE D2-C
  → reserve THE single provider attempt
  → dispatch through the ordinary CommunicationService path
  → terminalize + purge the sealed fields
```

The webhook **may** await the durable insert. It **must not** await worker execution, provider invocation,
delivery results or retries — and it does not. Enqueue is **best-effort and non-authoritative**: a failed
insert, an absent key, a duplicate or a throw can never roll back or alter the completed consent command, and
never changes the provider-facing response.

### Provider vocabulary bridge (a correctness fix D4-C had to make)

D1-B's receipt speaks the **adapter** vocabulary (`meta_whatsapp_cloud`, the **raw wamid**). D2-D's
authoritative receipt speaks the **consent** vocabulary (`meta_whatsapp`, the **sha256 of that wamid** — a raw
wamid is base64 and cannot satisfy D2-D's `^[A-Za-z0-9._:-]{1,200}$` fence). D4-B passed the adapter values
straight through, so its evidence never actually matched what D2-D wrote. D4-C translates both, using the
existing closed allowlist (`mapAdapterProviderToConsentProvider`, `deriveProviderEventId`). An unmapped
provider is rejected, never passed through. Without this, the receipt foreign key could never have resolved.

---

## The table

`public.communication_consent_ack_intents` — service-role only, RLS enabled, no anon/authenticated policy,
privileges revoked from `public` / `anon` / `authenticated`.

**Real foreign keys:** `consent_command_receipt_id → communication_consent_command_receipts(id)` and
`inbound_message_id → communication_inbound_messages(id)`, both `ON DELETE RESTRICT` — an intent may never
outlive the authoritative result it claims to acknowledge.

**HELP has no receipt.** D2-D policy P3 means HELP writes nothing, and the receipts table only accepts
`normalized_command in ('stop','start')`. So the receipt FK is **NULL for HELP and NOT NULL for STOP/START**,
enforced by `ck_ack_intent_receipt_binding`. A STOP/START whose authoritative receipt cannot be found is
**never enqueued**.

There is **no plaintext phone column, no raw payload, no message body, no provider credential, and no generic
JSON bag at all** — there is deliberately nothing to smuggle a secret into.

**The receipt lookup pins the command exactly.** The query filters on
`(provider, provider_message_id, channel, normalized_command)` — the first three are the receipt's unique key,
and the fourth means **a STOP acknowledgement can never bind to a START's authoritative receipt, or vice
versa**. A mismatch resolves to null and nothing is enqueued. There is no arbitrary first-row selection.

**`completed_at` is consistent with status.** `ck_ack_intent_completed_at_matches_status` requires a **terminal
row to have `completed_at` NOT NULL** and a **live row (`pending`/`claimed`/`dispatching`) to have it NULL**.
Together with `ck_ack_intent_live_is_sealed` (a live row must still carry a ciphertext, which a purged terminal
row does not), this is the second database-level reason a terminal row can never be revived.

### Status machine

`pending → claimed → dispatching → { sent | suppressed | expired | failed | uncertain }`

All five terminal statuses purge the sealed fields. Terminal rows are immutable.

### Claim contract — `qf_claim_consent_ack_intents(worker_id, limit ≤ 25, stale_lease ≈ 2 min)`

Atomic, `FOR UPDATE SKIP LOCKED`. Claims **pending** or **stale claimed** rows, and only while
`provider_attempt_count = 0` and `expires_at > now()`. It **never** claims a `dispatching` row, an attempted
row, a terminal row or an expired one. Batch bounded to 25; the stale lease is explicit and bounded to ≤ 1 hour.

### Provider-attempt reservation — `qf_reserve_consent_ack_provider_attempt(intent_id, worker_id)`

Compare-and-set: `claimed → dispatching` **and** `provider_attempt_count 0 → 1`, for the lease owner only, and
only while unexpired. **The provider is not called unless this returns true.** Exactly one worker can win; the
loser updates zero rows, reports `attempt_not_reserved`, and sends nothing. `provider_attempt_count` is
constrained to `in (0, 1)` — **at most one provider attempt, ever**.

### Worker maintenance (runs FIRST, every batch)

Each bounded worker run performs maintenance **before** it claims anything:

1. **Expiry sweep** (`qf_expire_consent_ack_intents`) — expired `pending`/`claimed` rows become terminal
   `expired`, sealed fields purged. It never touches a `dispatching` row.
2. **Stale-dispatch recovery** (`qf_recover_stale_dispatching_consent_ack_intents`) — see below.
3. …only then does it claim and deliver.

Neither maintenance step can cause a provider call. **A maintenance failure fails the batch closed** — nothing
is claimed and nothing is sent, because delivering from a table we could not sweep is exactly how a stale
acknowledgement escapes. Results are sanitized counts only.

### Stale-claim recovery vs an uncertain provider outcome

A worker that crashed **before** reserving leaves a `claimed` row with `provider_attempt_count = 0` — the lease
lapses and it is reclaimed normally.

A worker that crashed **after** reserving leaves a `dispatching` row whose provider outcome is **unknown**. It
must never be resent. Recovery moves it to **terminal `uncertain`** — never back to `pending` or `claimed` —
and purges the sealed fields. The RPC requires **`provider_attempt_count = 1` explicitly**, not merely the
`dispatching` status, so a row whose attempt was never reserved is not mistaken for an ambiguous send.

### Bounded provider attempt, and what "at-most-once" actually means

| | |
|---|---|
| Provider attempt timeout | **60 seconds** |
| Safety margin | **60 seconds** |
| Stale-dispatch recovery threshold | **180 seconds** |

The invariant is **strict**:

```
recovery threshold  >  provider timeout (60s) + safety margin (60s)   ⇒   > 120 seconds
```

**120 seconds is therefore NOT safe and is rejected** — at exactly the boundary, recovery could terminalize an
attempt a worker is still legitimately awaiting. The SQL floor is `p_stale_after <= interval '120 seconds' →
UNSAFE_RECOVERY_THRESHOLD` (note the `<=`, not `<`), the upper bound is one hour inclusive, and the invariant
is additionally asserted at module load. Boundary: **119s reject · 120s reject · 121s accept · 180s accept ·
3600s accept · 3601s reject.** Production always passes **180 seconds**; the internal route cannot select a
threshold at all.

After the attempt is reserved, a **timeout, a throw, or any ambiguous result becomes terminal `uncertain`**.
There is no automatic retry and no second provider attempt.

**Honest limitation.** The 60-second timeout does **not cancel** the underlying provider request — the existing
CommunicationService/provider path exposes no cancellation. **The HTTP call may still complete at Meta after we
have stopped waiting.** At-most-once does not mean "the message definitely was not delivered"; it means
**QuickFurno never attempts it again**: `provider_attempt_count` is already 1, the row is terminal, and the
claim RPC can never return it.

**Late settlement is handled explicitly.** The losing provider promise is always given a rejection observer, so
a late failure can never surface as an `unhandledRejection` and crash the worker. Whether it later resolves or
rejects, **its result is observed and discarded**: it cannot cause a retry, a second provider attempt, a second
terminal transition (the terminalize RPC only accepts `pending`/`claimed`/`dispatching`), an allow, or a leak
of provider error detail. A late *success* does **not** flip an `uncertain` row to `sent`.

### Expiry

15 minutes for STOP/START, 24 hours for HELP — derived from D1-B's **persisted** `received_at`, the same
windows the D4-B rate-limit bucket uses, so an intent can never outlive the bucket that deduplicates it. An
expired intent is **never sent**: telling a user "your STOP was processed" an hour later is worse than silence.

---

## The internal worker route

`POST /api/internal/process-consent-ack-intents`

Gated by the `x-qf-cron-secret` header against `QF_CRON_SECRET`, **timing-safe** comparison, POST-only. A
missing secret, a wrong secret, **or an unset server secret** are all rejected — an unset secret never means
"allow everyone". The secret is never logged and never echoed.

**It is a trigger, not an authority.** It contains no consent policy, decrypts nothing, calls no provider, and
exposes no intent row, ciphertext, key id or destination hash. It returns sanitized counts only. A caller —
including cron, and including anything else that ever learns the secret — **cannot select which intent runs,
who it goes to, what type is sent, which consent scope applies, or how many attempts occur.** The only
caller-influenceable input is the batch size, clamped to `[1, 25]`.

**n8n and Jarvis are not authorizers and never can be.** Triggering a bounded batch is not authorization: the
worker still asks D2-C, still honours global suppression, still enforces at-most-once. QuickFurno Core remains
authoritative.

---

## D4-B proofs replaced by D4-C

The code moved, so the proofs moved. Each is recorded here, as required.

| D4-B proof (inline send) | Replaced by |
|---|---|
| `processConsentCommandResponses` sends inline | **D4-B A1–A12** now prove the same eligibility, evidence, replay and privacy rules against `enqueueConsentCommandResponses` |
| the one-shot enforcer lives in `consentCommandResponseService` | **D4-C C16 + MUT 23** — it now lives, private and unexported, in `consentAckWorkerService` |
| D2-C is consulted at send time (A9, A10; MUT 13, MUT 14) | **D4-C C3, C4, C5 + MUT 7, MUT 8, MUT 9** — D2-C is **re-evaluated by the worker** immediately before dispatch, so a suppression created *after* enqueue still blocks |
| missing template / absent provider fails closed (A11) | **D4-C C13, C15** |
| provider rejection / timeout / unknown outcome (A12) | **D4-C C11** — terminal `uncertain`, never resent |
| the ack throws → webhook response unchanged (W-A, W-B; MUT 19, MUT 20) | **D4-B W-A, W-B + MUT 11** — the *enqueue* throws → response byte-identical |
| ack never invoked when the command fails (W-C) | **D4-B W-C** — the *enqueue* is never invoked |
| order: persist → write → ack (W-D) | **D4-B W-D** — order: persist → write → **enqueue** |
| the webhook calls a provider inline | **D4-C D1** — the inbound branch constructs no `CommunicationService`, calls no provider, and never runs the worker inline |

New in D4-C and previously unprovable: the sealed destination (B1–B8), claim/reservation atomicity (C8–C10),
at-most-once (C9, C11), terminal purge (C15), the migration's static fences (G1–G10), and the route (F1–F4).

---

## Deployment / activation order

**None of this has been performed. Do not perform it as part of this phase.**

1. Audit and merge the code.
2. **Separately review the migration SQL.**
3. Explicitly approve and apply the migration.
4. Configure the encryption keys (`QF_CONSENT_ACK_DESTINATION_PRIMARY_KEY_ID`, `QF_CONSENT_ACK_DESTINATION_KEYS`).
5. Verify the worker route in its inactive / template-missing mode (it must fail closed with zero provider calls).
6. Configure VPS cron.
7. Verify worker operation.
8. **Separately review and seed the three acknowledgement templates.**
9. Activate acknowledgement delivery.

The templates (`consent_stop_acknowledgement`, `consent_start_acknowledgement`, `consent_help_response`) remain
**unseeded**. Until they exist the send fails closed with `TEMPLATE_NOT_FOUND_OR_INACTIVE` — zero provider
calls, consent entirely unaffected. That is the intended, safe pre-seed behaviour.

## Rollback

Code revert. The migration is additive and the table is inert without the worker route and the keys; it may be
left in place or dropped separately. No existing migration is modified, no consent data is touched, no
template is seeded, no provider is activated.

## What D4-C does not do

- **No SQL is executed and no migration is applied.** The file is written, not run.
- **No template row is seeded.**
- **No encryption key is generated, stored or committed.**
- **No cron is configured. No deployment.**
- **No provider, n8n or Jarvis activation.**
- **No frozen authority changed** — D2-C, D2-D, D2-E, the D3-B coordinator and registry,
  `CommunicationService`, the runtime factory and the D2-E harness are all byte-unchanged.
