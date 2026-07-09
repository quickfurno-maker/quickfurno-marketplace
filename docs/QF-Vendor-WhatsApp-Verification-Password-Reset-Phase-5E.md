# QuickFurno — Vendor WhatsApp Verification + Password Reset (Phase 5E)

Phase 5E is a **backend security foundation**, not a UI change. It adds two
QuickFurno-managed vendor auth flows on top of the existing Phase 5A–5D
infrastructure and ships them **mock-safe and operationally disabled**: the
migration is **not applied**, both automations stay `mock_ready` /
`is_operationally_enabled = false` / `provider_required = mock`, no real WhatsApp
provider is connected, and no Auth hook or `.env` is touched. Nothing becomes
production-operational by implementing this phase.

## The three vendor security concerns stay distinct

| Concern | Authority |
| --- | --- |
| Vendor **login** | Supabase Auth **+** `vendor_dashboard_users` mapping (Phase 5C) |
| Vendor **WhatsApp verification** | Purpose-bound challenge **+** `phone_e164` binding |
| Vendor **password reset** | Purpose-bound challenge **+** single-use `password_reset_grant` |

Vendor dashboard access continues to depend on **exactly three things** — an
authentic Supabase user, a valid mapping, and an active membership. It never
begins depending on `phone_verified`, `whatsapp_otp_enabled`, package/paid status,
credits, business verification, `accepting_leads`, or `vendors.is_active`. Phase 5C
behaviour is unchanged.

A verification is not a login. A reset grant is not a session. OTP verification
authorizes a reset; it does **not** sign anyone in — a completed reset requires a
fresh, ordinary vendor login.

## Canonical vendor auth phone

`vendor_dashboard_users.phone` holds **legacy, non-canonical** contact values (the
live table has 3 such rows). It is left exactly as it is. Phase 5E adds a **new,
separate** column:

- `phone_e164 text` — the canonical authentication/WhatsApp **security** phone.
  Null until the vendor explicitly submits an international number and proves
  possession via a WhatsApp OTP. Guarded by
  `check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$')`, which mirrors
  `lib/communication/phone.ts` exactly.
- `whatsapp_verified_at timestamptz` — set only on a successful consume.

**No backfill, no country guessing.** The migration writes `phone_e164` nowhere;
every existing row stays `phone_e164 = NULL`. There is no `+91` (or any dialling
code) literal in the migration or the Phase 5E source. `vendors.phone` and
`vendors.whatsapp_number` are never read or written. A partial unique index
(`uq_vendor_dashboard_users_phone_e164 WHERE phone_e164 IS NOT NULL`) makes a
verified number belong to exactly one dashboard identity.

## Challenge identity lineage

`verification_challenges` gains explicit lineage: `vendor_dashboard_user_id`,
`user_id`, `vendor_id`, `last_sent_at`, `last_attempt_at`, `delivery_provider`,
`communication_message_id`. A challenge is bound to the dashboard membership, the
Auth user, the vendor business, the purpose, and the destination hash. Ownership is
**never** inferred from a browser-supplied `vendor_id`: a challenge only verifies
when its stored lineage matches the resolved `VendorAccessContext` on all three
axes. A partial unique index allows **at most one pending challenge per (identity,
purpose)**, so a resend must cancel the previous one. FK deletes cascade from the
identity chain; `communication_message_id` uses `ON DELETE RESTRICT` so the
delivery proof cannot vanish under a live challenge. `verification_challenges`
remains vendor-only; no client purpose is added.

## Reset grant lineage

`password_reset_grants` gains `vendor_dashboard_user_id`, `challenge_id`, and
`revoked_at`. A grant traces membership → vendor → Auth user → reset challenge.
Only the **SHA-256 hash** of the token is stored (Phase 5A already had no plaintext
column). A partial unique index (`uq_password_reset_grants_one_open WHERE
consumed_at IS NULL AND revoked_at IS NULL`) allows **at most one open grant per
Auth user**; issuance revokes older open grants first.

## Cryptography

**OTP** — `crypto.randomInt`, six digits, **leading zeros preserved**, request
memory only. Never `Math.random`, never persisted in plaintext. The stored hash is
**HMAC-SHA-256 under a server-only pepper**, not a plain SHA-256 (a six-digit code
has a 10⁶ search space and plain hashing is brute-forceable if the DB leaks). The
HMAC message binds the challenge context:

```
challenge_id | purpose | vendor_dashboard_user_id | destination_hash | otp
```

so a captured hash can never be replayed across challenges, purposes, identities,
or numbers. Comparison uses `crypto.timingSafeEqual`.

**Pepper rotation** — `VENDOR_AUTH_OTP_PEPPERS` (documented only; no `.env` is
written). Format `current_pepper|previous_pepper` (pipe-delimited; newline also
accepted; **comma is never a separator** — a pepper is opaque secret material). The
**first** pepper creates new hashes; **all** configured peppers may verify a pending
challenge during a controlled rotation. An empty/absent value fails closed. The
pepper never reaches logs, metadata, errors, the database, a communication intent,
or an audit event.

**Reset grant token** — `crypto.randomBytes(32)`, base64url (43 chars). Its 256
bits of entropy make a **plain SHA-256** sufficient for the stored hash. Returned
to the caller **exactly once**, right after OTP verification; never logged,
audited, placed in metadata/correlation ids, sent over WhatsApp, or stored plain.

## Operational gate

One canonical evaluator (`services/vendorAuthAutomationService.ts` over
`lib/identity/vendorAuthAutomation.ts`) governs both automations. It requires: the
catalog row exists; exact automation key; lane `authentication`; channel
`whatsapp`; the expected template; `is_operationally_enabled = true`;
`readiness_status = active`; a non-empty `provider_required` equal to the **active
provider adapter key**. Any uncertainty fails closed. The shipped/live state
(`mock_ready`, disabled, `mock`) always blocks; the harness injects an active test
state for deterministic mock delivery without touching live rows.

## Flows

**WhatsApp verification — request** requires an authenticated, actively-mapped
vendor; accepts only explicit canonical E.164 (never guesses a country); checks the
gate and the pepper; generates a challenge id, then a CSPRNG OTP bound to it in
memory; then hands everything to the **atomic issuance authority** (see below) which
serializes the rate-limit evaluation, prior-pending cancel, and insert under a
per-identity lock. Only the winner continues: it dispatches one immediate
authentication-lane message to `ephemeralAuthDestination(phoneE164)` with
`recipient_id` = the canonical `context.vendorId`, `entity_id` = the challenge id,
and the OTP only in `variables`; on delivery failure — or on a **delivery-linkage
write failure** — it cancels the challenge and never resends; on success it records
`communication_message_id` + `delivery_provider`.

### Atomic challenge issuance (pre-commit hardening, Fix 1)

Issuance is NOT a sequence of separate application-level steps (check cooldown →
count hourly → count daily → cancel pending → insert) — that is race-prone: two
concurrent requests could both pass a stale rate-limit read, both insert, and both
send an OTP (one for a challenge the other just cancelled). Instead there is one
database authority, `vendor_auth_issue_challenge`, for BOTH purposes. In a single
transaction it: takes a **`SELECT … FOR UPDATE` lock on the vendor's
`vendor_dashboard_users` row** (serializing issuance per identity); re-validates the
caller-supplied `(user_id, vendor_id)` lineage and the purpose against the locked
row; evaluates the persisted cooldown/hour/day limits over ALL prior rows (history
is monotonic); and only if allowed, cancels the prior pending challenge and inserts
exactly one new pending challenge. A rate-limited or lineage/purpose-invalid call
inserts nothing, cancels nothing, and sends nothing; it returns a closed-vocabulary
`result_code` and no OTP. Concurrent requests therefore cannot exceed the persisted
limits, cannot leave two pending challenges, and cannot send a stale OTP for a
cancelled challenge.

### The database owns the security policy (authority hardening)

`vendor_auth_issue_challenge` takes **NO caller-supplied policy parameter**. Its
signature is exactly the seven identity/challenge fields — there is no
`p_expires_at`, `p_max_attempts`, `p_cooldown_seconds`, `p_max_per_hour`, or
`p_max_per_day`. The OTP TTL (10 min), attempt limit (5), cooldown (60 s), and
hourly/daily ceilings (5 / 12) are `constant` values inside the function, and the
`expires_at` it writes is `now() + interval '10 minutes'` from the **database
clock**. A caller — even the service-role application — therefore cannot weaken the
TTL, attempt limit, cooldown, or rate limits, and cannot pass a far-future expiry.

The application keeps **matching advisory constants** in
`lib/identity/vendorVerification.ts` (`VENDOR_OTP_TTL_MS`, `VENDOR_OTP_MAX_ATTEMPTS`,
`VENDOR_CHALLENGE_COOLDOWN_MS`, `VENDOR_CHALLENGES_PER_HOUR` / `_PER_DAY`) used ONLY
for UI countdown display, documentation, tests, and user messaging. They are not the
security authority and never reach the function; the harness asserts they equal the
SQL constants but proves enforcement is independent of them.

The same rule applies to the **reset-grant TTL** (post-push correction).
`vendor_auth_consume_reset_challenge_and_issue_grant` takes **no `p_expires_at`**: it
computes `expires_at = now() + interval '10 minutes'` from the database clock, inserts
the grant with it, and **returns** it. The wrapper passes no expiry, and the reset
service surfaces the DB-generated `expires_at` unchanged — the application never
computes the authoritative grant expiry. `RESET_GRANT_TTL_MS` remains an advisory
value for UI/docs/tests only.

### `last_sent_at` means an actual send (post-push correction)

`vendor_auth_issue_challenge` inserts a new challenge with `last_sent_at`,
`delivery_channel`, `delivery_provider`, and `communication_message_id` all **NULL** —
issuance has sent nothing yet. Those four fields are stamped **only** by
`recordChallengeDelivery`, and only after the provider accepted the OTP and the
challenge→ledger link was written (`last_sent_at` = the linkage timestamp,
`delivery_channel` = `whatsapp`, `delivery_provider` = the authorized provider,
`communication_message_id` = the exact ledger row). A dispatch failure or a linkage
failure cancels the challenge and leaves `last_sent_at` NULL; a zero-row linkage (the
challenge was concurrently terminalized) never revives it and never fabricates send
metadata. This prevents false send history for a provider failure, a request failure
after issuance, or a challenge that was never delivered.

### Delivery-linkage failure fails closed (Fix 3)

After the provider accepts the OTP, the challenge is linked to the ledger row via a
compare-and-set update on `status = 'pending'`. `recordChallengeDelivery` returns
`true` ONLY when exactly one pending row was linked. A DB error or a zero-row result
(the challenge was concurrently terminalized) returns `false`, and the caller then
**fails closed**: it cancels the challenge (a lifecycle update that never revives a
terminal row), records a sanitized `linkage_failed`, does not resend, and does not
create a second challenge. The public password-reset response stays non-enumerating;
authenticated WhatsApp verification returns its generic service failure. An unlinked,
cancelled challenge can never pass communication attestation.

**WhatsApp verification — verify** requires the authenticated vendor, matches the
challenge lineage on all three axes, enforces purpose/pending/expiry/lock/
destination, verifies the contextual HMAC (over all configured peppers), atomically
increments + locks on a wrong OTP, requires a **fresh provider-bound communication
attestation**, then atomically consumes the challenge and binds `phone_e164`,
`phone_verified = true`, `whatsapp_otp_enabled = true`, `whatsapp_verified_at`. A
phone already verified by another identity aborts the transaction (no ownership
theft, no partial consume). `vendors.phone` / `vendors.whatsapp_number` are never
touched.

**Password reset — request** is **public and non-enumerating**: unknown identifier,
inactive membership, unverified phone, disabled OTP capability, rate limit, closed
gate, provider refusal, and success **all** return
`{ ok: true, status: "request_received", reference: <uuid> }`. `reference` is the
real challenge id for an eligible request and an unpersisted uuid otherwise, so the
two are indistinguishable. Identity is resolved server-side (email canonical form;
phone via `phone_e164` only, never the legacy column); ambiguity fails closed. The
OTP goes **only** to the stored, previously verified `phone_e164` — a caller can
never supply or redirect the destination.

**Password reset — verify OTP** (public) enforces purpose/pending/expiry, verifies
the HMAC, requires a provider-bound attestation, then atomically consumes the
challenge, revokes older open grants, and issues one grant — returning the
plaintext token **once**. No session is created. It is **non-enumerating** (Fix 2):
every failure — malformed/synthetic/unknown reference, wrong/expired/locked/
cancelled/consumed challenge, wrong purpose, malformed lineage, inactive membership,
missing Auth user, destination mismatch, missing/stale/wrong-provider attestation,
DB lookup failure, and grant-issuance loss — returns ONE identical public failure
(one code, one message, one body). They differ only in the sanitized audit
classification recorded server-side. Nothing about account/challenge existence,
lifecycle status, remaining attempts, phone verification, WhatsApp enablement, or
delivery success is ever revealed, and no artificial delay is added. Only SUCCESS is
distinguishable (it returns the grant token).

**Password reset — complete** (public) validates token/password shape (a narrow
preflight; Supabase Auth remains the real authority), **atomically claims (burns)**
the grant, then calls the server-only `adminClient().auth.admin.updateUserById`.
The grant is burned **before** the mutation: if Supabase Auth then rejects the
update, the grant stays consumed and the vendor must restart — safer than leaving a
reusable grant after an uncertain password change. On success no session and no
cookie are created; a normal vendor login is required. Raw Auth errors, passwords,
tokens, and hashes never reach logs, audit metadata, or responses.

## Communication attestation (channel + provider bound)

Both verify paths require a matching `communication_messages` row: `message_type`
= the purpose template, `lane = authentication`, `entity_type =
verification_challenge`, `entity_id` = challenge id, `destination_hash` = the
challenge's, `channel` = the binding's authorized channel (**`whatsapp`**),
`provider` = the gate's authorized provider (and both the channel and provider
recorded on the challenge), status in `accepted|sent|delivered|read`, and fresh.
Both `channel` and `provider` are filtered in the query AND re-validated in code,
and the verify path additionally rechecks the challenge's own recorded
`delivery_channel` / `delivery_provider`. The OTP proves possession of the code; the
ledger proves QuickFurno's authorized channel+provider carried it — both are
required.

### Channel-aware delivery (whatsapp active; sms vocabulary readiness only)

`verification_challenges.delivery_channel` records the channel that carried each
challenge (set at delivery time from the dispatched message), constrained by a CHECK
to the vocabulary `('whatsapp', 'sms')`. Phase 5E delivers on and attests **exactly
`whatsapp`**: the binding channel is `whatsapp`, the application only ever writes
`whatsapp`, and attestation only accepts `whatsapp`. `sms` exists as **forward
vocabulary readiness** so a future SMS phase is a configuration change, not a schema
change — there is **no** SMS send path, adapter, template, provider, or attestation,
and **RCS is not in the vocabulary at all**. The code vocabulary lives in
`lib/identity/vendorAuthAutomation.ts` (`VendorAuthDeliveryChannel`,
`ACTIVE_VENDOR_AUTH_DELIVERY_CHANNEL = whatsapp`).

## Rate limiting, expiry, events

Persisted server-side history only (never a browser counter): OTP TTL 10 min, 5 max
attempts, 60 s resend cooldown, 5 challenges/hour and 12/day per (identity,
purpose), reset grant TTL 10 min. A rate-limit breach generates no OTP, no send, no
grant, and records `auth.rate_limit_triggered`. Every read/verify/consume path
checks `expires_at` independently (the atomic functions carry `expires_at > now()`
in their `WHERE`), so authentication safety never depends on a cleanup job; an
expired pending challenge is transitioned to `expired` (never revived) and records
`auth.challenge_expired`.

Phase 5E adds exactly two event types —
`vendor.whatsapp_verification_failed` and `vendor.password_reset_failed` — and
reuses the existing vendor/reset/rate-limit/expiry events. Audit metadata carries
only non-secrets (purpose, sanitized classification, destination hash, challenge
id, role, transport, provider key, attempt count, actor user id). It never carries
an OTP, OTP hash, password, grant token (or its hash), pepper, raw phone, email,
raw Auth error, or any session token.

## Atomic security functions

Five `SECURITY DEFINER` functions (pinned `search_path`, EXECUTE granted only to
`service_role`) each perform their decision and mutation atomically, so PostgreSQL
row locking — not application code — serializes concurrent callers:

- `vendor_auth_issue_challenge` — the serialized issuance authority: `FOR UPDATE`
  lock + lineage/purpose validation + cooldown/hour/day evaluation + cancel-prior +
  insert, all in one transaction (Fix 1).
- `vendor_auth_register_failed_attempt` — atomic increment + lock at max; never
  decrements or revives a terminal challenge.
- `vendor_auth_consume_whatsapp_challenge` — CAS the challenge to `consumed`, then
  bind the verified identity; a phone conflict (23505) aborts the whole
  transaction.
- `vendor_auth_consume_reset_challenge_and_issue_grant` — CAS the challenge, revoke
  older open grants, insert one new grant hash with a **database-owned** expiry
  (`now() + interval '10 minutes'`; no caller `p_expires_at`), and return that expiry.
- `vendor_auth_claim_reset_grant` — a single conditional update; exactly one
  concurrent completion can claim (burn) a grant.

## Privileges

`REVOKE ALL` then exact `GRANT` on both sensitive tables, from an over-privileged
initial state: `anon` and `authenticated` end with **no** direct privileges;
`service_role` gets exactly `SELECT, INSERT, UPDATE` (no DELETE/TRUNCATE/REFERENCES/
TRIGGER). RLS stays enabled with zero browser policies. Challenge and grant history
is lifecycle-updated (cancelled/expired/consumed/revoked), never physically
deleted.

## Environment variable (documented only — not created here)

```
VENDOR_AUTH_OTP_PEPPERS   # server-only; the vendor OTP pepper(s).
                          # Format: current_pepper|previous_pepper  (PIPE-delimited).
                          # A newline is also accepted. A COMMA is NEVER a separator
                          # (a pepper is opaque secret material). The FIRST pepper
                          # creates new hashes; all configured peppers may verify a
                          # pending challenge during a controlled rotation. Empty or
                          # absent → fail closed. Never logged or persisted.
```

Phase 5E does **not** create or modify `.env` / `.env.local`.

## Routes (thin transport adapters — no UI)

```
POST /api/vendor/auth/whatsapp/request          (authenticated)
POST /api/vendor/auth/whatsapp/verify           (authenticated)
POST /api/vendor/auth/password-reset/request    (public, non-enumerating, always 200)
POST /api/vendor/auth/password-reset/verify     (public)
POST /api/vendor/auth/password-reset/complete   (public)
```

## Live activation checklist (documented, NOT performed here)

1. Review, commit, push, GitHub-audit the migration.
2. Apply it manually via the SQL Editor; verify both automations are `mock_ready`,
   disabled, `mock`, and every existing `phone_e164` is `NULL`.
3. Install `VENDOR_AUTH_OTP_PEPPERS` as a runtime secret.
4. Configure an approved real WhatsApp provider adapter (with an abortable network
   timeout).
5. Advance template + provider readiness; set both `provider_required` to the real
   provider key.
6. Enable each automation operationally in a controlled rollout.
7. Smoke-test verify → bind; request → verify → complete → normal login.
8. Monitor `auth_security_events`.
9. Keep a rollback switch (`is_operationally_enabled = false`).

## Test harness

`npm run test:phase5e` — deterministic. It parses the real unique indexes and the
`phone_e164` CHECK constraint out of the migrations and models the four atomic SQL
functions with guards derived from their bodies, so deleting an index or a guard
from the SQL genuinely changes the model. Application code runs against a mock query
builder that yields between statements (a read-then-write really interleaves) while
`rpc()` critical sections run without an await (as a single locked statement does).
It then **mutation-tests** every security-critical invariant by editing the real TS
and SQL — `Math.random`, plain-SHA-256, purpose-free HMAC, gate bypass, local-phone
acceptance, ownership/purpose/attestation/provider removal, read-then-write
counters, consumed-challenge reuse, caller-supplied reset destination, plaintext
grant storage, two active grants, non-atomic claim, reusable-after-failure grants,
phone-conflict bypass, verified-flags-before-consume, NULL-unsafe migration guards,
and grant-only privileges — asserting each turns the suite red, and restoring every
file byte-identically.
