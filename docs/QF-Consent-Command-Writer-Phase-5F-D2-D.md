# QuickFurno — Phase 5F-D2-D

## Controlled Transactional Communication Consent Writer

**Status: one server-only, transactional consent-command WRITER for inbound STOP / START / HELP.
It appends immutable evidence and mutates the authoritative suppression projection atomically inside
ONE database RPC. It SENDS nothing, authorizes no final delivery, writes NO
`communication_preferences`, is NOT wired into Meta / n8n / providers / routes / webhooks, and enables
no Meta. Meta remains disabled.**

Files: `lib/communication/consentCommand.ts`, `services/communicationConsentWriterService.ts`,
`supabase/migrations/20260712000300_communication_consent_command_writer_rpc.sql`.
Test: `npm run test:phase5f:d2d`.

---

## Authority ownership

Consent decisions belong to **QuickFurno Core** (Jarvis recommends, QuickFurno authorizes, n8n
executes, providers deliver, results return to Core). This writer reuses
`communication_consent_events`, `communication_suppressions`, `CONSENT_POLICY_VERSION` and the D2-C
decision semantics. It creates **no parallel consent truth** and it never decides final send
authorization — consent ≠ delivery.

## Locked policy (P1 / P2 / P3)

- **P1 — STOP scope.** STOP/START apply INDEPENDENTLY to the `marketing` and `transactional`
  suppression scopes **only**. They never create/clear a `global` suppression and never touch
  `authentication`. **OTP stays available** unless a SEPARATE existing global suppression
  independently blocks it.
- **P2 — Suppression-only.** STOP/START never create/block/allow/withdraw/modify
  `communication_preferences` — **even for an exact principal**. START never creates marketing
  consent. Explicit marketing opt-in is a separate authority.
- **P3 — HELP evidence.** HELP causes no consent-state transition, so it writes **no**
  `communication_consent_events` row and no projection; its audit trail is the separately-persisted
  inbound-message record. The successful result is **`help_acknowledged`**. HELP sends nothing.

## Command normalizer (`lib/communication/consentCommand.ts`)

A **pure** module (no I/O, no logging, no clock). It maps raw inbound text → a closed vocabulary
`"stop" | "start" | "help" | "unsupported"` via an explicit, documented, case-insensitive allowlist
after `trim` + Unicode **NFKC** + upper-case, matching the **complete** token only (no substring
matching, no sentence interpretation — "please stop texting" is `unsupported`). Raw text is never
retained, returned, or logged. Vocabulary: STOP/STOPALL/UNSUBSCRIBE/CANCEL/END/QUIT → `stop`;
START/UNSTOP/SUBSCRIBE → `start`; HELP/INFO → `help`; everything else → `unsupported` (fail-safe).
The writer receives the **already-normalized** enum — never raw text.

## Input contract (`services/communicationConsentWriterService.ts`)

`channel`, `command` (normalized enum), `destinationHash` (sha256 hex64), `identityConfidence`,
`principal` (exact only; **audit linkage only, never a preference write**), `provider` (closed
allowlist), `providerMessageId`, `sourceEventType`, `inboundMessageId | null`, `occurredAt` (strict
timezone-qualified RFC3339), optional bounded `correlationId` / `causationId`. **`policyVersion` is
never an input** (always `CONSENT_POLICY_VERSION` from code). **`receivedAt` is never a caller value** —
it comes from the injected server clock. It accepts no plaintext phone / `wa_id` / raw message body /
normalized message text / webhook payload / provider token / browser actor / arbitrary
reason/state/policy version / caller-supplied idempotency key.

## Output contract (sanitized discriminated union, multi-scope aware)

```ts
type ConsentScopeWriteResult = { scope: "marketing"|"transactional";
  outcome: "suppression_created"|"user_stop_already_active"|"stronger_suppression_preserved"
         | "user_stop_reversed"|"no_reversible_user_stop"; eventId: string|null; suppressionId: string|null };
type ConsentWriteSuccess = { ok: true;
  result: "stop_applied"|"stop_already_effective"|"start_applied"|"start_partially_applied"
        | "start_no_reversible_stop"|"start_blocked_by_stronger_suppression"|"help_acknowledged"|"unsupported_command";
  replayed: boolean; scopeResults: ConsentScopeWriteResult[]; eventIds: string[]; suppressionIds: string[] };
type ConsentWriteFailure = { ok: false;
  code: "INVALID_WRITER_INPUT"|"WRITER_INTEGRITY_VIOLATION"|"WRITER_TRANSACTION_FAILED"|"WRITER_CONFLICT"|"UNSUPPORTED_POLICY_VERSION" };
```

A **replay** returns the ORIGINAL stable `result` with `replayed: true` (there is no
`replayed_existing_result` business result). The output never contains the destination hash, a
plaintext destination, raw message text, a raw SQL error, SQLSTATE, a stack, raw rows, a provider
payload, or credentials.

## STOP behaviour (deterministic scope order: marketing → transactional)

Per scope: **no active suppression** → append `suppress` evidence + insert an active `user_stop`
suppression → `suppression_created`. **Active `user_stop`** → `user_stop_already_active` (no new
evidence, no mutation; idempotent). **Active stronger suppression** (`provider_block` / `hard_bounce`
/ `complaint` / `admin` / `legal` / `abuse` / `unspecified`) → **preserved exactly** (reason, expiry,
provenance unchanged) → `stronger_suppression_preserved`. Aggregate: any scope created → `stop_applied`;
otherwise `stop_already_effective`. STOP never modifies `authentication`/`global` and does not depend
on an exact principal identity (destination hash + channel are sufficient).

## START behaviour (marketing and transactional independent)

Per scope: **active `user_stop`** → append `unsuppress` evidence + deactivate (`is_active=false`,
`deactivated_at` set, `last_event_id` updated) → `user_stop_reversed`. **Active stronger** → no
mutation, no evidence → `stronger_suppression_preserved`. **No active suppression** → no mutation, no
evidence → `no_reversible_user_stop`. Aggregate: reversed & no stronger remains → `start_applied`;
reversed & a stronger remains → `start_partially_applied`; nothing reversed & a stronger exists →
`start_blocked_by_stronger_suppression`; otherwise → `start_no_reversible_stop`. START **never** clears
`provider_block` / `hard_bounce` / `complaint` / `admin` / `legal` / `abuse` / `unspecified`, **never**
creates marketing consent, and **never** modifies `communication_preferences`.

## HELP and unsupported

**HELP** → `help_acknowledged`; no RPC, no `communication_consent_events` row, no preference/suppression
mutation; empty `scopeResults`/`eventIds`/`suppressionIds`; sends nothing (P3). **unsupported** →
`unsupported_command`; no RPC, no evidence, no mutation, empty arrays. Neither is ever silently mapped
to STOP/START/HELP.

## Idempotency, replay & conflict (command receipt)

An additive, **service-role-only** processing/idempotency **receipt** table
`public.communication_consent_command_receipts` binds one provider event —
**unique `(provider, provider_message_id, channel)`** — to its ORIGINAL sanitized `scope_results`
(exact event + suppression ids), plus `destination_hash`, `normalized_command` and `policy_version`. It
is **NOT consent truth** and is **not** read by any consent decision; consent truth remains
`communication_consent_events` + `communication_suppressions`. Written evidence rows also carry the
D2-B opaque sha256 `idempotency_key` as a structural defense-in-depth.

### The replay binding (all six fields, or it is not a replay)

A redelivery is only replayed when the stored receipt matches the incoming command on **every** bound
field:

| Bound field | Mismatch → |
|---|---|
| `provider` + `provider_message_id` + `channel` | (the lookup key — no row means "fresh") |
| `destination_hash` | `WRITER_CONFLICT` |
| `normalized_command` | `WRITER_CONFLICT` |
| `policy_version` | `WRITER_CONFLICT` |

Before applying, the RPC reads the receipt for `(provider, provider_message_id, channel)`: **no receipt**
→ process fresh (and write one); **exact binding match** → stable **replay** returning the **exact stored
`scope_results` verbatim** with `replayed: true` (the current/latest suppression row is **never**
re-queried to reconstruct historical ids — even no-op STOP/START replays return their original outcome);
a **different command, destination OR policy version** → `WRITER_CONFLICT` (the same provider event is
never accepted first as STOP and later as START, against a second destination, or **re-served under a
policy version other than the one that produced it** — a stored outcome was derived by the rules of its
own policy version, so replaying it under another would silently launder a stale policy); a **missing/null
stored policy version, or a structurally invalid stored `scope_results`** → `WRITER_INTEGRITY_VIOLATION`.
A caller-supplied idempotency key is never trusted. Because a receipt is written for **every** accepted
command (including a full no-op), replay and conflict detection cover no-op commands too.

### Stored `scope_results` are validated **in SQL**, not only in TypeScript

The receipt's `scope_results` are the sole source of a replayed outcome, so their structure is a security
boundary. Two pure **`IMMUTABLE`** validator functions
(`communication_consent_receipt_results_valid` / `..._scope_result_valid`) are the single SQL definition of
a well-formed result, enforced in **both** directions:

* as a table **CHECK constraint** (`ck_consent_command_receipt_scope_results`), so a malformed receipt row
  can never be **inserted**; and
* **defensively inside the RPC before any replay**, so a row that is malformed anyway (written before the
  constraint existed, or by any out-of-band path) can never be **replayed**.

A valid stored result is: a **JSON array of exactly two items**; **item 0 scope = `marketing`, item 1 scope
= `transactional`** (so a duplicate or transactional-first result is rejected); each item an **object**;
`outcome` in the **closed vocabulary**; `event_id` / `suppression_id` each a **valid UUID string or JSON
null** (key present); and **outcome ⟷ id consistency** —

| outcome | `event_id` | `suppression_id` |
|---|---|---|
| `suppression_created` | required | required |
| `user_stop_reversed` | required | required |
| `user_stop_already_active` | null | required |
| `stronger_suppression_preserved` | null | required |
| `no_reversible_user_stop` | null | null |

Anything duplicated, out of order, malformed or contradictory → `WRITER_INTEGRITY_VIOLATION`, and the
command is **not** re-applied. The validators `coalesce` to **false, never NULL** (a NULL is not false —
`if not NULL` would fall through and let a malformed receipt replay).

**Fail-closed type guard.** `jsonb_array_length` **raises** on a non-array, and SQL does **not** guarantee
that `and` short-circuits left to right (the planner may hoist a cheap clause ahead of the `jsonb_typeof`
test). Both validators therefore lead with an explicit **`CASE jsonb_typeof(...)`** — never boolean
evaluation order — so `jsonb_array_length` is reachable *only* from inside the `'array'` branch. SQL NULL
and every non-conforming JSON type (`null`, object, string, number, boolean) and any array whose length is
not exactly two **return false rather than raising**.

**The TypeScript boundary is an independent fence, not a mirror.** `normalizeRpcResult` additionally
requires each scope result to carry its id fields **explicitly present** (`event_id`/`eventId` and
`suppression_id`/`suppressionId`): an **absent key is never silently coerced to `null`**, because a
truncated row would otherwise masquerade as a legitimate "no id for this outcome" result and slip through
the outcome⟷id consistency check. An **explicit `null` remains valid** where the outcome permits it, a
present value must be a UUID, and if **both aliases are present they must carry the same value** — a row
that disagrees with itself is not trustworthy evidence. Output stays sanitized: only `scope`, `outcome`,
`eventId` and `suppressionId` are copied, so no raw row or unexpected property ever passes through.
**Neither layer relies on the other.**

## Effective-activity expiry

Suppression activity is **effective**, not merely physical:
`is_active AND (expires_at IS NULL OR expires_at > evaluatedAt)` (evaluatedAt = the server receipt time).
When a locked row is physically active but **expired**, the RPC first **appends an immutable
system-action deactivation event** (`evidence_type = system_action`, `reason = system`) and **deactivates
the projection** (`is_active = false`, `deactivated_at` set) — it **never silently mutates an expired
row without evidence** — then processes STOP/START against the resulting effective state. So **STOP after
expiry creates a fresh effective `user_stop` suppression**, and **START after expiry does not treat the
expired row as a reversible active STOP** (→ `start_no_reversible_stop`).

## Transaction / RPC design

One additive **SECURITY DEFINER** RPC `public.apply_communication_consent_command(...)` (plpgsql, fixed
`search_path = pg_catalog, public`, schema-qualified tables, no dynamic SQL, no raw exception text
returned, execute granted to `service_role` only) owns the whole transaction: validate fixed policy →
validate inputs (provider allowlist + bounded-identifier regex, matching TypeScript exactly) → acquire
locks in fixed order → receipt replay/conflict → lock suppression rows `FOR UPDATE`, expire+deactivate
any expired row (with evidence) → decide both scopes → insert evidence FIRST → insert/update projection
referencing it → **write the receipt** → return sanitized JSON. **Receipt, evidence and projection commit
in one transaction or all roll back** — never evidence without projection, projection without evidence, or
one scope without the other; a `unique_violation` from a raced duplicate surfaces as a sanitized
`WRITER_CONFLICT`. HELP/unsupported never reach the RPC.

## Concurrency (fixed-order locks)

Two `pg_advisory_xact_lock`s are acquired in a **fixed order** to prevent deadlock and races:
**(1) provider-event identity** (`provider + provider_message_id + channel`) then
**(2) destination** (`destination_hash + channel`). The provider-event lock first ensures concurrent
calls sharing one provider event serialize **even when they carry a different destination or command**
(the second sees the receipt → replay or `WRITER_CONFLICT`). `SELECT … FOR UPDATE` locks the affected
suppression rows; the receipt unique key and the partial-unique active-suppression index are the
structural safety net. Concurrent identical STOP/START produce one authoritative transition and a
deterministic replay for the duplicate — no duplicate active suppression, no duplicate evidence effect.

## Timestamp validation (strict, timezone-qualified RFC3339)

`occurredAt` is validated with the SAME strict, calendar-valid, timezone-qualified RFC3339 contract as
Phase 5F-D2-C (mandatory `T` + `HH:MM:SS`, explicit `Z`/`±HH:MM`, 1–6 fractional digits; real calendar
validation; rejects invalid leap days, hour 24, minute/second 60, invalid offsets, date-only/locale/
timezone-less, and leading/trailing text). D2-C's parser is **private** and D2-C **must remain
unchanged**, so this is an **intentional repeated contract** (documented here), not an import. The RPC
**independently re-validates** the same contract (range regex + calendar-valid cast) so a direct RPC
caller cannot bypass the TypeScript validation via a lenient `timestamptz` cast.

## Privacy

The writer input carries a **hash + enums only** — never a plaintext phone, raw/normalized message
body, payload, or token. Evidence/suppression tables store the hash only; `metadata_sanitized` is a
small allowlisted bounded object (`nc`, `so`, `corr`, `caus`, `rcv`) ≤ 4096 bytes — no raw text/error/
token. The output exposes only `ok`, a bounded `result`/`code`, per-scope outcomes and internal UUIDs —
never the destination hash, SQLSTATE, stack, rows, payload, or credentials. A thrown DB/transport error
becomes a sanitized `WRITER_TRANSACTION_FAILED`.

## Read-only D2-C; no integration yet

D2-C stays **read-only and unchanged** (the writer does not modify it and it retains no writes). This
writer is **not** called from `metaWhatsAppWebhookService`, `inboundWhatsAppMessageService`,
`CommunicationService`, authentication transport, campaign code, an n8n bridge, or any API route or
webhook. Integration happens only after the **D2-E** checkpoint. Meta remains disabled.

## Migration application status and migration-history drift

The live consent schema was applied **manually** and recent migration files are not registered in
`supabase_migrations.schema_migrations` (known drift).

The D2-D migration `20260712000300_communication_consent_command_writer_rpc.sql` is **strictly additive**.
It adds exactly:

| # | Object | Kind |
|---|---|---|
| 1 | `public.communication_consent_command_receipts` | **one new** processing/idempotency **receipt table** (service-role only, RLS enabled, `select`/`insert` only) |
| 2 | `public.communication_consent_receipt_scope_result_valid(jsonb, text)` and `public.communication_consent_receipt_results_valid(jsonb)` | **two new IMMUTABLE** receipt-result **validator functions** (pure; no table access) |
| 3 | `public.apply_communication_consent_command(...)` | **one new SECURITY DEFINER** transactional **writer RPC** |

plus the receipt's `ck_consent_command_receipt_scope_results` CHECK constraint, its unique idempotency
key, and the grants/revokes for the above.

It **does not alter any pre-existing consent table, column, enum or index** — `communication_consent_events`,
`communication_suppressions` and `communication_preferences` are untouched by DDL. There is no
`DELETE`/`TRUNCATE`, no evidence `UPDATE`/`DELETE`, no trigger, no dynamic SQL, and no history rewrite.
(`create table if not exists` + `create or replace function` make it idempotent and non-destructive.)

### Applied status (current)

The reviewed SQL **has been manually applied to the production Supabase database, and verified.** The
verification confirmed: `communication_consent_command_receipts` exists with RLS enabled; both validator
functions exist and are `IMMUTABLE`; `apply_communication_consent_command` exists and is
`SECURITY DEFINER`; `service_role` holds `SELECT` + `INSERT` only; `anon` and `authenticated` have no
access; the receipt count was zero; and the fail-closed validator checks passed.

**The migration must not be reapplied.** It is already live. Re-running it is not a supported step of this
phase — no part of D2-D re-executes it.

**Migration-history drift remains unresolved, intentionally.** The migration registry was **not repaired
and not modified**: version `20260712000300` was deliberately **not** inserted into
`supabase_migrations.schema_migrations`, so the file remains unregistered while the objects exist live.
Reconciling that registry is a separate, explicitly-approved operation and is **not** part of this phase.

These commands remain **prohibited** in this phase — none of them is run, and none may be run to
"tidy up" the drift:

```
supabase db push
supabase migration up
supabase migration repair
supabase db reset
```

Any future registry reconciliation must be a reviewed, deliberate, single-transaction step — never an
incidental side effect of a build, a harness, or a deploy.

## Post-merge harness boundary: the frozen audited range

> **This section documents a tests-only change.** It **changes no production authority and no database
> object** — not the writer, not the command normalizer, not D2-C, not D1-B, not the SQL migration, and
> not the RPC. Only the D2-D harness's *phase-boundary* check and this document were touched.

### The frozen audited historical range

D2-D is merged and audited, so its phase scope is a **fixed, frozen slice of history** — not a moving one:

| Anchor | Commit |
|---|---|
| D2-D base (the D2-C parent) | `c05b123b5ffb9a25e2dee125ae2f77b9cbad6ada` |
| Audited **final** D2-D implementation commit | `ed7b68c6c7c5f77595b0ff6e590f7b2dd7b87bf8` |

The harness validates **only** the delta `c05b123..ed7b68c`, and proves three things about it:

1. the base **is an ancestor of** the audited head — so the audited range is real and measurable;
2. the audited head **is an ancestor of the current HEAD** — so this checkout genuinely *contains* the
   complete audited D2-D phase (the audit cannot be quietly evaluated against a tree that lacks it);
3. that frozen delta is **exactly the six approved D2-D files**, and every **implementation** commit
   inside it carries a `Phase 5F-D2-D:` subject.

### Why merge commits and later phases are outside D2-D's historical scope

The previous boundary validated `c05b123..HEAD` and demanded a `Phase 5F-D2-D:` subject on **every**
commit in that range. That was correct only while D2-D was the tip of its branch. Once PR #2 merged, the
rule became self-invalidating:

- the **merge commit** (`b7ab22b`) is not a D2-D implementation commit and carries a merge subject;
- every **later phase** (**D2-E** and beyond) legitimately adds commits and files *after* the audited head;
- a frozen historical audit must not re-open simply because unrelated future history was appended.

So the range now ends at the audited head, and the subject rule applies **only to implementation commits
inside it** (merge commits are excluded via `--no-merges`). The PR merge and all post-audit commits are
outside the range by construction and are never subject-checked. A regression back to a `..HEAD` boundary
is caught: a mutation asserts the merge commit is present in history, carries a non-D2-D subject, and is
nonetheless **excluded** from the frozen range.

### How current protected-file dirtiness is checked separately

Dropping the moving range must not drop *safety*. Worktree protection is therefore a **separate check**
(`37b`), independent of the frozen historical scope. It fails if there is an **uncommitted edit to any
protected production file**:

`consentCommand.ts`, `consentPolicy.ts`, `communicationConsentWriterService.ts`, the D2-D SQL migration,
`communicationConsentDecisionService.ts` (D2-C), `inboundWhatsAppMessageService.ts` (D1-B), and
`metaWhatsAppWebhookService.ts` (the thin webhook boundary).

It is a **closed list**, not "anything dirty" — that distinction is the whole point. A later phase editing
*its own new files* is not a D2-D violation, but a later phase quietly editing the *frozen writer or
migration* still is, and is still caught while D2-D runs. The approved maintenance surface for this branch
(this harness plus this document) is explicitly allowed.
