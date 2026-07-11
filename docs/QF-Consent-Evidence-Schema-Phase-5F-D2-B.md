# QuickFurno — Phase 5F-D2-B

## Consent Evidence Schema + Preference-State Hardening + Suppression-State Hardening

**Status: SCHEMA ONLY. This migration is prepared for review and is NOT applied here. It adds
one immutable evidence ledger and hardens two dormant current-state tables. Nothing decides,
writes, sends, replies, mutates consent at runtime, emits an event, calls n8n, invokes AI, or
activates Meta. Meta remains disabled.**

Migration: `supabase/migrations/20260711000200_communication_consent_evidence_and_state_hardening.sql`
Harness: `npm run test:phase5f:d2b`

---

## D2-A findings this implements

D2-A audited the live schema and repository and concluded:

- `communication_preferences` and `communication_suppressions` were created by Phase 5F-A
  (`20260709000100`) and are **dormant foundations** — **zero** application readers, **zero**
  application writers, **zero** RPC readers/writers, no admin interface, no campaign integration,
  no authentication integration. The only runtime reference is a *negative* mutation test.
- Gaps: no immutable evidence/history table; `communication_preferences` had a **NULL-principal
  uniqueness bypass** (Postgres treats NULLs as distinct in a UNIQUE key); no state/timestamp
  consistency; no policy version; suppressions had **no `deactivated_at`**, **no destination-hash
  format fence**, and an **expired-but-still-`is_active`** ambiguity.

D2-B closes the schema gaps. It does **not** build the decision service (D2-C) or the writer (D2-D).

## Dormant live state and why the migration aborts if rows appear

Both current-state tables currently hold **0 rows**. D2-B applies stronger invariants (`principal_id
NOT NULL`, allowed/blocked-only state, allowed/blocked timestamp consistency, destination-hash
format, mandatory `policy_version` + `last_event_id`). Applying those to pre-existing rows could
**silently reinterpret or invalidate real consent truth**, so **SECTION 0** aborts with a sanitized
exception if either table is non-empty, and requires a **separate reviewed backfill migration**. The
migration **never truncates, deletes, or auto-backfills** consent data. It also fails loud if the
prerequisite tables (5F-A preferences/suppressions, D1-A inbound) are missing.

## Race-safe guard (fixed-order ACCESS EXCLUSIVE locking)

A plain "count rows, then alter" guard has a **time-of-check/time-of-use (TOCTOU) race**: a
`SELECT count(*)` takes only an `ACCESS SHARE` lock, which does **not** block a concurrent `INSERT`
(`ROW EXCLUSIVE`), so a writer could slip a row in between the emptiness check and the hardening
`ALTER`s. To close this, SECTION 0 — **after** the prerequisite existence checks and **before** any
`count`/`EXISTS`/`CREATE`/`ALTER` — acquires, in a **fixed order that is never reversed**:

```
lock table public.communication_preferences in access exclusive mode;
lock table public.communication_suppressions in access exclusive mode;
```

`ACCESS EXCLUSIVE` conflicts with every other lock, including the `ROW EXCLUSIVE` a concurrent
`INSERT/UPDATE/DELETE` takes, so no writer can act on either table for the duration. Because a `LOCK`
is **held until the transaction COMMITs** (a `DO` block runs inside the current transaction), the
locks cover the counts and **all** subsequent DDL. The fixed `preferences → suppressions` order
prevents deadlock with any future concurrent locker. `ACCESS EXCLUSIVE` is the approved level for this
dormant, manually-applied migration.

The migration is **transaction-compatible**: it contains **no `CREATE INDEX CONCURRENTLY`** and no
other non-transactional statement, so it runs as **one atomic transaction** under the ordinary
Supabase migration runner (no explicit `BEGIN/COMMIT` is added, to avoid conflicting with that
runner). If applied manually, run the **entire file as one transaction** — never copy or execute
selected blocks statement-by-statement, or the guard locks would release early and the empty-table
guarantee would be lost.

## Evidence / current-state ownership split

- **`communication_consent_events`** — the immutable, append-only **evidence/history** ledger. One
  row per consent/suppression state transition.
- **`communication_preferences`** — the **current materialized principal-preference** projection.
- **`communication_suppressions`** — the **current materialized destination-prohibition** projection.

The future **D2-D controlled writer** will, in one transaction, **append evidence** and **update the
one current-state projection**, or return an **idempotent replay**. D2-B creates only the schema.

## Append-only guarantees

`communication_consent_events` has **no `updated_at`** and `service_role` is granted **SELECT/INSERT
only** — deliberately **no UPDATE, no DELETE, no TRUNCATE**. A committed evidence row can never be
altered or removed **by the application roles**. RLS is enabled with **no browser policy**; privileges
are explicitly **revoked from `PUBLIC`** (defense in depth against altered database default
privileges) and from `anon`/`authenticated` before granting `service_role` `SELECT`/`INSERT`. This is
an application-role guarantee: the **table owner / superuser** (e.g. `postgres`) inherently retains
full administrative power over any table and is **not** claimed to be constrained by these grants.

## Subject invariants

- **Complete principal pair** — `principal_type` and `principal_id` are both present or both null
  (never a partial pair).
- **Subject presence** — a complete principal pair **or** a `destination_hash` must be present; a
  subjectless event is impossible.
- **Target shape** — `target_type = 'preference'` requires a complete principal pair, **`destination_hash`
  IS NULL** (a preference is strictly principal-scoped — destination-level truth belongs to suppression
  evidence, so a preference event can never double as a destination record), and a scope in
  `authentication/transactional/marketing`. `target_type = 'suppression'` requires a `destination_hash`,
  a scope in `transactional/marketing/global`, and **may optionally** carry a complete principal pair as
  additional linkage. `principal_type` is independently limited to `client/vendor/admin`, so **no
  anonymous/system preference row is possible**. Unknown/ambiguous senders are represented through
  **destination-hash suppression evidence**, never an invented principal.
- **Action ⟷ target ⟷ state** — `grant/reaffirm → preference/allowed`; `withdraw/admin_block →
  preference/blocked`; `suppress/provider_block → suppression/active`;
  `unsuppress/provider_unblock/admin_unblock → suppression/inactive`. Nonsensical cross-target
  combinations are rejected.
- **Actor is admin-only** — `actor_id` is permitted **only when `actor_type = 'admin'`** (one complete
  CHECK: `admin ⟹ actor_id present`; `system/user/provider ⟹ actor_id NULL`). A bare `actor_id` would
  be polymorphically ambiguous between a client and a vendor, so non-admin actions record **no**
  `actor_id`; the affected principal is the typed `(principal_type, principal_id)` pair, and
  unknown-user actions stay attributable through `destination_hash` + `source_event_id` + the provider
  pair + `inbound_message_id`. (A typed actor may be added in a later phase if operationally required;
  D2-B does **not** add `actor_principal_type`.)
- **Provider pair** — `provider` and `provider_message_id` are both present or both absent; and an
  `inbound_command` event must carry the provider pair.

## Privacy model

Service-role-only writes; RLS on; no browser policy; no browser writer; no unsafe `SECURITY DEFINER`
RPC in D2-B. Destinations are stored **only** as a `sha256(canonical E.164)` lowercase-hex hash
(`lib/communication/phone.ts` `hashPhoneE164`), fenced by `^[0-9a-f]{64}$`. The tables have **no**
column for a plaintext phone / `phone_e164` / `wa_id` / raw destination, raw WhatsApp message, raw
webhook payload, raw provider error, SQL error, access token, app secret, signature, authorization
header, OTP, password, session token, or arbitrary free-form note. `metadata_sanitized` is a bounded
(**≤ 4096 bytes**) JSON **object**; future writers **must** use an allowlist.

## Server-generated hashed idempotency

`idempotency_key` is required, **unique**, server-generated, opaque, and a `sha256` lowercase-hex
(`^[0-9a-f]{64}$`). A future writer derives it from a canonical namespaced tuple such as
`qf-consent-v1 | target_type | provider | provider_message_id | action | channel | scope`; the **raw
tuple is never persisted**. A redelivered inbound STOP webhook produces the **same** key → an
idempotent replay, never a duplicate suppression or duplicate event, never conflicting timestamps.
The exact provider `wamid` is the stable inbound action identity — **never** message text, phone,
timestamp, or payload hash. A defense-in-depth partial unique index on
`(provider, provider_message_id, target_type, action, channel, scope) WHERE provider IS NOT NULL AND
provider_message_id IS NOT NULL` lets one inbound command create separate preference and suppression
evidence while rejecting a duplicate for the same target/action.

## Policy version

`policy_version` is required, server-set, bounded (`^[A-Za-z0-9._:-]{1,64}$`), and never a mutable
browser-supplied value. **No database policy catalog** is added in D2-B — the future code constant is
introduced in D2-C/D2-D.

## Preference absence = unknown; exact preference timestamp rules

`communication_preferences` stores only the durable states **allowed** / **blocked**; **absence of a
row means unknown**. State/timestamp consistency is enforced completely:

- **allowed** → `consented_at` present, `withdrawn_at` null;
- **blocked** → `consented_at` null, `withdrawn_at` present.

`principal_id` is now **NOT NULL** (closing the NULL-uniqueness bypass on the retained unique key
`(principal_type, principal_id, channel, scope)`), `principal_type` is limited to `client/vendor/admin`,
and every row carries a `policy_version` and a `last_event_id` FK to its creating/latest evidence event.

## Suppression expiry handling and the active partial-unique interaction

Suppressions gain `deactivated_at` with a complete invariant (`is_active=true ⟺ deactivated_at null`;
`is_active=false ⟺ deactivated_at present`) plus deterministic ordering fences (`deactivated_at >=
suppressed_at`; `expires_at > suppressed_at`) — **no `now()` in any CHECK**. The reason vocabulary is
extended with `legal` and `abuse`. The active partial unique index
`(destination_hash, channel, scope) WHERE is_active` is retained: **one active suppression per tuple**.

**Effective-expiry read rule.** A row may remain physically `is_active = true` after `expires_at`
passes until the controlled writer or a future sweeper deactivates it. Readers **must** compute
effective activity as **`is_active AND (expires_at IS NULL OR expires_at > evaluatedAt)`** at read
time (with an injectable clock), never relying on `is_active` alone.

## Future controlled writer (D2-D)

A single transactional writer will append one evidence event and update one current-state projection
atomically, keyed on `idempotency_key`; a key conflict returns an idempotent replay. Recommended MVP:
one transactional PostgreSQL RPC. Not implemented in D2-B.

## Future read-only decision service (D2-C) — no-objection distinction

D2-B builds no decision semantics, but records this distinction for D2-C so defaults are never
mis-encoded as unconditional consent `allowed`:

- **marketing** — explicit `allowed` required; **unknown/absent is not permitted** (default-deny).
- **authentication** — absence does **not** mean consent-granted; it means **no consent objection**.
  Final authentication authorization remains owned by the user-initiated auth action and the
  provider/runtime policies. Authentication may be affected later only by an active **global**
  destination suppression or an explicit principal **authentication** preference block — there is
  deliberately **no `authentication` suppression scope**.
- **transactional** — absence does **not** mean final allowed-to-send; it means **no consent
  objection**. A separate transactional basis must pass.

D2-C should therefore use a type-safe separation (e.g. `allowed | blocked | unknown | not_required |
no_objection`) rather than one universal boolean, and must never return `allowed` because a row was
missing, a read failed, identity was ambiguous, or a lookup errored (infrastructure failure is a
distinct operational outcome, per the D1-B truth principle).

## Boundary (what D2-B does not do)

No STOP/START/HELP handling; no reply/send; no webhook consent read or mutation; no
`communication_preferences`/`communication_suppressions` application write; no `domain_events`/
`outbox_events`; no n8n; no AI/Jarvis; no conversation or 24-hour-window logic; no Meta activation;
no env change; no data backfill.

## Migration reversibility (rollback notes — not executed here)

Rollback is **safe only while both current-state tables and the evidence ledger are empty** (the
pre-application state). A reversal would, in order: drop the evidence FKs
(`fk_comm_preference_last_event`, `fk_comm_suppression_last_event`); drop the added CHECK constraints
(`chk_comm_preference_*`, `chk_comm_suppression_*`, `chk_consent_evt_*`); drop the added columns
(`communication_preferences.policy_version/last_event_id`;
`communication_suppressions.deactivated_at/policy_version/last_event_id`); restore the original
5F-A `communication_preferences` `state`/`principal_type` CHECKs and the `state` default; restore the
original suppression `reason` CHECK; and finally drop `communication_consent_events`. **Once
production consent events exist, the evidence ledger must never be casually dropped** — evidence is
immutable governance history. No destructive rollback statement is placed in the forward migration.

## Manual review and application

This migration is **not auto-applied**. It must be reviewed and applied manually against the live
database, after which D2-E verifies the live schema before any decision service (D2-C) or writer
(D2-D) is built.
