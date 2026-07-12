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

Before applying, the RPC reads the receipt for `(provider, provider_message_id, channel)`: **no receipt**
→ process fresh (and write one); **same command AND same destination** → stable **replay** returning the
**exact stored `scope_results` verbatim** with `replayed: true` (the current/latest suppression row is
**never** re-queried to reconstruct historical ids — even no-op STOP/START replays return their original
outcome); **different command OR different destination** → `WRITER_CONFLICT` (the same provider event is
never accepted first as STOP and later as START, or against a second destination); an **invalid or
incomplete stored receipt** → `WRITER_INTEGRITY_VIOLATION`. A caller-supplied idempotency key is never
trusted. Because a receipt is written for **every** accepted command (including a full no-op), replay
and conflict detection cover no-op commands too.

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

## Migration-history drift (review-only migration)

The live consent schema was applied **manually** and recent migration files are not registered in
`supabase_migrations.schema_migrations` (known drift). The D2-D migration is **additive** (one
`create or replace function` + grants; no table/column/enum/index change, no DELETE/TRUNCATE, no
history rewrite) and is prepared for **review only** — it is **not auto-applied**. D2-D does **not**
run `supabase db push` / `migration up` / `migration repair` / `db reset` and does **not apply** the
migration; eventual application is a reviewed, manual, single-transaction step with an explicit
migration-history reconciliation plan.
