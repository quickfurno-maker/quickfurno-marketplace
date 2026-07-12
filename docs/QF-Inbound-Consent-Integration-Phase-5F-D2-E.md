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

## Persistence contract (D1-B → D2-E): **the persisted row is the authority**

`handleInboundWhatsAppMessages` returns `result.processed: InboundProcessedMessage[]`, one entry per
durably-stored message (never a rejected one). **Every field in it is read back from the persisted
`communication_inbound_messages` row** — for the insert path *and* the duplicate path alike.

### Why a redelivery can never override the durable row

The unique fence means the **original** row wins. A redelivered envelope is only a *signal to look the row
up* — it is not a fresh source of truth. If D2-E built its command context from the redelivery's freshly
normalized message and freshly resolved identity, then a redelivery whose body or identity differed (a
provider replay quirk, a re-resolved principal, a changed payload) could silently contradict what was
durably captured. The stored row records what actually arrived; the retry does not get to rewrite it.

So after `persistInboundRow` reports `created` **or** `duplicate`, D1-B re-reads the row through the fence
`(provider, provider_message_id)` and derives everything downstream from it.

**The two objects it returns are deliberately different in kind:**

| | `message` (`PersistedInboundMessage`) | `receipt` (`InboundPersistenceReceipt`) |
|---|---|---|
| Purpose | the **internal, synchronous command candidate** | the sanitized persistence context |
| Contains the body? | **Yes** — `contentMinimized` carries the stored minimized text, because the command layer must read the token | **No** — body-free |
| Ever logged / returned to a caller / put in an error? | **Never** | Never |

That distinction matters: the *receipt* is body-free, but the *paired command candidate* does carry the
minimized text. Both are internal and synchronous. **Public and error outcomes expose neither** — they
carry only counts, opaque ids and stable sanitized codes.

`receipt` fields (all from the persisted row):

| Field | Meaning |
|---|---|
| `inboundMessageId` | the **durable row UUID** — the same id on the insert and duplicate paths |
| `provider` / `providerMessageId` | the stored adapter key + the stored **original** wamid |
| `duplicate` | `false` = freshly inserted, `true` = the row already existed |
| `destinationHash` | the stored `sender_hash` = `sha256(canonical E.164)` — **never** a plaintext phone |
| `identityConfidence` | the **stored** `exact` / `ambiguous` / `unknown` |
| `principalType` / `principalId` | the **stored** principal — only when `exact`, else `null` |
| `receivedAt` | the stored `received_at` — the durable capture time, **not** this request's clock |
| `providerOccurredAt` | the stored provider instant, or `null` |

### Resolver rules

The resolver (`resolvePersistedInboundContextViaDb`) uses **equality filters only** on the unique fence,
**preserves cardinality** (no `.single()`, no `.maybeSingle()`, no `.limit()` — an impossible multi-row
result must be *visible*, not silently collapsed), and **validates the row before trusting it**: UUID
shape, fence match, lowercase `HEX64` sender hash, closed identity confidence, the complete
exact⟺principal invariant, a usable `message_type`, a non-array object `content_minimized`, and
string-or-null timestamps.

**Nothing is ever invented.** Zero rows, multiple rows, a malformed row, or a database error all yield
`null` → `inbound_persisted_row_unresolved` → a **retryable** 500. A malformed durable row is *not
evidence* and is never repaired, partially accepted, or substituted with the in-flight values.

**D1-B stays consent-agnostic** — no consent import, no writer/orchestrator import, no STOP/START/HELP
literal, no command interpretation. It captures and reports; it does not interpret.

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

## Timestamp handling: strict, calendar-valid RFC3339

`providerOccurredAt` is nullable (Meta may omit or garble `timestamp`), but D2-D **requires** a strict
timezone-qualified RFC3339 instant.

```
occurredAt = valid persisted provider occurrence instant
          ?? valid persisted received-at instant
```

Both candidates come from the **persisted row**. Output is always strict RFC3339 via ISO formatting. If
**both** are unusable the build fails closed with the existing sanitized deterministic outcome
(`input_not_buildable`) — an instant is never fabricated.

### Why `Date.parse` alone is not enough

`Date.parse` is lenient and will happily **roll an impossible date over into a different real one**:

- `2026-02-31T10:30:00Z` → silently becomes **3 March**
- `2026-01-01T24:00:00Z` → silently becomes the **next midnight**

Normalizing such a value would **silently rewrite when a consent command occurred**. So validation is a
strict, calendar-valid, timezone-qualified check equivalent to the frozen D2-D contract: explicit month /
day-in-month (leap-year aware) / hour / minute / second / UTC-offset range checks, **plus** a `setUTC*`
**round-trip** proving no rollover happened. These two fences are **defence in depth** — either alone
still rejects an impossible value, so no single edit can re-open the hole (the mutation suite proves both
the pair *and* each fence individually).

Rejected → **falls back** to received-at, exactly as if the value had been absent. It is **never**
normalized into another date.

Rejected forms include: `2026-02-31T10:30:00Z`, `2027-02-29T00:00:00Z`, `2026-01-01T24:00:00Z`,
`10:60:00`, `:60` seconds, `+25:00` / `+05:99` offsets, timezone-less values, date-only values, and locale
formats.

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

Re-processing is safe by construction, and now safe in a second way too:

1. **The command context comes from the stored row**, so a redelivery re-processes *the original message's
   facts* — the stored command token, message type, destination hash, identity and principal — never the
   redelivery's own. See "the persisted row is the authority" above.
2. **The provider-event identity is deterministic** (`sha256(wamid)`), so D2-D's receipt returns the
   **original stored outcome** with `replayed: true` and applies **no second effect**.

The worked case the tests pin: the stored row holds **STOP** with identity **A**; a redelivery of the same
wamid arrives carrying **START** and resolves to identity **B**. The downstream candidate still carries
**STOP and identity A**, and that is what D2-D is asked to apply. Identity B never leaves D1-B.

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

## Correction tests

The correctness corrections above are pinned by functional **and** load-bearing mutation tests:

**Persisted-row authority**
- the insert path resolves its context from the stored row (not the in-flight object);
- the duplicate path returns the **same** durable UUID;
- **stored STOP + identity A beats a redelivered START + identity B** — content, message type, destination
  hash, identity, principal and both timestamps all come from the stored row, and what D2-D is asked to
  apply is the stored `stop`;
- a mutation that **restores the pre-correction behaviour** — rebuilding duplicate context from the
  transient redelivery — makes the suite fail;
- zero rows / multiple rows / a malformed row / a database error stay **retryable** and never reach D2-D;
- a mutation that lets the resolver *guess* a row on a violated fence fails;
- a mutation that *swallows* an unresolvable row instead of failing closed fails.

**Strict timestamps**
- every impossible calendar / range / offset value is rejected and **falls back** to received-at, and is
  never normalized into another date (the `2026-02-31 → 3 March` rollover is asserted explicitly);
- a mutation degrading the validator to `Date.parse` fails;
- mutations removing **both** the explicit range check and the round-trip fail, *and* mutations removing
  either fence alone prove the other still holds.

## Historical range — FROZEN (post-audit)

> **This freeze step is tests-and-docs only.** It changes **no production code** — not the input builder,
> not the orchestrator, not D1-B, not the webhook, not `package.json`, not any D2-D authority. It touches
> **exactly two files**: this document and the D2-E harness. No SQL, no migration, no route, no environment,
> no Meta, no provider and no n8n change.

D2-E is implemented, corrected and audited, so its phase scope is now a **fixed slice of history**:

| Anchor | Commit |
|---|---|
| **Audited base** (`D2E_BASE`) | `94b8c1522269635cdbbe53fb6d11ea2bf91b05a9` |
| **Audited corrected implementation head** (`D2E_HEAD`) | `56e8f5193eb1be5d24ece3ec00822608b7f50057` |
| **Frozen range** | `D2E_BASE..D2E_HEAD` |

The historical audit inspects **only** that range. It **never** uses the current `HEAD` as the end of the
file or commit range.

### The two ancestry proofs

1. **`D2E_BASE` is an ancestor of `D2E_HEAD`** — the audited range is real and measurable.
2. **`D2E_HEAD` is an ancestor of the current `HEAD`** — this checkout genuinely *contains* the complete
   audited D2-E phase, so the audit cannot be quietly evaluated against a tree that lacks it.

**A failure of either proof is a scope violation, not a warning.**

### The frozen seven-file historical scope

`D2E_BASE..D2E_HEAD` must be exactly:

1. `docs/QF-Inbound-Consent-Integration-Phase-5F-D2-E.md`
2. `lib/communication/inboundConsentCommandInput.ts`
3. `package.json`
4. `scripts/phase5f-d2e-inbound-consent-integration-harness.mjs`
5. `services/inboundConsentCommandService.ts`
6. `services/inboundWhatsAppMessageService.ts`
7. `services/metaWhatsAppWebhookService.ts`

### Implementation-only subject validation

Every **non-merge implementation commit inside the frozen range** must carry a `Phase 5F-D2-E:` subject
(enforced via `rev-list --no-merges`).

**Why merge commits and future phases are excluded.** A HEAD-relative boundary is self-invalidating the
moment anything is appended to history:

- **this freeze commit** is a harness/docs maintenance commit, not a D2-E implementation commit;
- a future **PR merge commit** carries a merge subject;
- every **later phase** legitimately adds its own commits and files.

None of those may re-open a frozen audit, so they lie outside the range by construction and are never
subject-checked. (This is exactly the defect the D2-D post-merge stabilization fixed; D2-E is frozen the
same way, deliberately.)

## Current-worktree protection (separate from the frozen scope)

Dirty files are **never** unioned into the frozen historical delta. Worktree safety is its own check.

**Protected — an uncommitted edit to either FAILS D2-E.** These are D2-E's own consent-integration
authority surface (the provider map, the SHA-256 event identity, the timestamp rules, the HELP/unsupported
short-circuit, the retryable/deterministic split):

- `lib/communication/inboundConsentCommandInput.ts`
- `services/inboundConsentCommandService.ts`

**Deliberately released — a dirty one of these is *not* a D2-E violation:**

| Released | Why |
|---|---|
| `services/inboundWhatsAppMessageService.ts` (D1-B) | a shared **future integration seam** |
| `services/metaWhatsAppWebhookService.ts` | a shared **future integration seam** |
| `package.json` | future phases must be able to add their own scripts |
| the D2-E harness + this document | this maintenance surface itself |
| any new future-phase file | a later phase must not re-open the frozen D2-E audit |

**Releasing these from dirty-file protection removes no functional or boundary coverage.** The D1-B and
webhook behaviour is still fully asserted by this harness's functional checks — persistence-before-command
ordering, persisted-row authority, duplicate/replay, the webhook's import boundary (it may import only the
orchestrator, never the D2-D writer, never D2-C), and D1-B's consent-agnosticism — and by their own phase
harnesses. Only the *dirty-file* rule was narrowed; every behavioural assertion stands.

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
