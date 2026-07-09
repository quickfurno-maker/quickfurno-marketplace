# QuickFurno — Client WhatsApp OTP Login Readiness (Phase 5D)

Phase 5D is **readiness + a mock-safe integration foundation** for logging a
client (homeowner) in with a WhatsApp‑delivered OTP. Nothing becomes
production‑operational by this phase alone: the automation ships operationally
**disabled**, the provider stays **mock**, the migration is **not applied**, and
the Supabase Auth Hook is **not configured**.

## Authoritative architecture

| Concern | Owner |
| --- | --- |
| OTP generation, validity, verification, session | **Supabase Auth** |
| Transport of the Supabase‑generated OTP over WhatsApp | **Phase 5B communication core** |
| Client business identity mapping | **`client_accounts`** |
| Security audit | **`auth_security_events`** (Phase 5A) |
| Vendor‑owned QuickFurno challenges | **`verification_challenges`** (never used for client login) |

QuickFurno deliberately uses the provider‑neutral **Send SMS Hook** path to
reroute the Supabase‑generated phone OTP through its own WhatsApp
CommunicationService. It never calls
`signInWithOtp({ phone, options: { channel: "whatsapp" } })`, so the login system
is not coupled to a Twilio‑specific WhatsApp channel.

The client login OTP **never** creates a row in `public.verification_challenges`
and is **never** persisted anywhere in QuickFurno. It lives only in:

```
Supabase Auth
  → signed Send SMS Hook request memory
  → QuickFurno hook handler request memory
  → CommunicationService authentication‑lane request memory
  → provider call memory
  → client input back to Supabase verifyOtp
```

## Flow

### A. Request — `services/clientOtpAuthService.ts#requestClientWhatsappOtp`
1. Normalize the phone to canonical E.164 (`lib/communication/phone.ts`); a bare
   local number is rejected, never country‑guessed.
2. Check the operational gate (`services/clientOtpAutomationService.ts`). If the
   `client_login_otp` automation is not operationally enabled, **do not** call
   `signInWithOtp`.
3. `serverClient().auth.signInWithOtp({ phone })` — request‑scoped, **no**
   `channel`, **no** admin auth, **no** `generateLink`. First‑time numbers follow
   the Supabase user‑creation path.
4. Record a sanitized `client.otp_requested` / `client.otp_request_failed` event
   (destination hash only). Return a **non‑enumerating** response.

### B. Delivery hook — `app/api/auth/hooks/supabase-send-sms/route.ts` → `services/supabaseSendSmsHookService.ts`
1. Read the raw body **once**; enforce a 16 KiB ceiling.
2. Collect `webhook-id` / `webhook-timestamp` / `webhook-signature`.
3. Load the server‑only secret(s) (see env var below).
4. **Verify the Standard Webhooks signature against the raw body** using the
   official `standardwebhooks` library (`lib/auth/supabaseSendSmsHook.ts`) —
   crypto is never hand‑rolled.
5. Only after verification: parse/validate `user.id` (UUID), `user.phone`
   (canonical E.164), `sms.otp` (opaque, request‑memory only).
6. Check the operational gate. Disabled → safe `service_unavailable`, provider
   invoked **zero** times.
7. Build an authentication‑lane `CommunicationIntent`
   (`ephemeralAuthDestination`, `recipient_type: client`, `recipient_id: null`,
   `entity_type: auth_user`, `entity_id: user.id`,
   `idempotency_key: client_login_otp:<webhook-id>` — **never** from the OTP) and
   dispatch it once.
8. Map the message **status** (not merely `Result.ok`) to the hook outcome.

### C. Verify — `services/clientOtpAuthService.ts#verifyClientWhatsappOtp`
1. Normalize phone; reject an empty/malformed token (never logged/persisted).
2. `serverClient().auth.verifyOtp({ phone, token, type: "sms" })`.
3. Require an authenticated user id and that the Auth user's verified phone
   normalizes to the same canonical phone.
4. Require an operationally acceptable automation/provider relationship, then a
   **fresh, successful QuickFurno WhatsApp communication attestation** in
   `communication_messages` (accepted/sent/delivered/read) that is **bound to the
   provider the gate authorized** (`provider = gate.provider_required`). The
   provider is both filtered in the query and re-validated in code, so neither a
   stale `mock` row after a real adapter is switched on, nor a real row while the
   mock adapter is active, can ever attest a login.
5. Resolve/provision `client_accounts` safely; set `whatsapp_verified_at` **only
   after** every condition passes. A provisioning success is only ever returned
   through one canonical validator that requires the verified auth user, the
   verified phone (never null), an `active` status, and a non-null
   `whatsapp_verified_at` — every concurrency path included.
6. Any denial after a session was established invalidates **only** that local
   session (`signOut({ scope: "local" })`, bounded retry, never global) and
   returns one generic public failure.

## Security invariants

- **No OTP persistence.** The authentication lane persists no variables; the OTP
  never reaches the ledger, metadata, idempotency key, correlation id, security
  events, or `verification_challenges`.
- **No second authority.** No custom JWT, no custom session, no second auth
  cookie, no second OTP store, no n8n OTP path.
- **Mock‑safety.** The mock provider returning `accepted` can never be treated as
  real delivery: `is_operationally_enabled = false` blocks dispatch, and the gate
  additionally requires the automation's `provider_required` to equal the active
  provider.
- **Idempotency.** The verified `webhook-id` keys communication idempotency; a
  replay or concurrent duplicate cannot invoke the provider twice, and a failed
  auth OTP is never blindly resent.
- **No lead impact.** No historical lead relinking, no `leads` ownership
  mutation, and anonymous lead submission is unchanged.

## Migration — `supabase/migrations/20260708000190_client_whatsapp_otp_login_readiness.sql`

Additive, idempotent, **not applied by this phase**:
1. Guarded UPDATE moves the `client_login_otp` automation
   `wiring_pending → mock_ready` **only** in the exact safe state; it never sets
   `is_operationally_enabled = true` or `readiness_status = 'active'`, never
   changes `provider_required` (stays `mock`), and never touches another row.
   Every structural guard uses **`IS DISTINCT FROM`**, never `<>`:
   `communication_automation_catalog.template_key` is nullable, and in PostgreSQL
   `NULL <> 'client_login_otp'` evaluates to `NULL` — not `TRUE` — so a `<>` guard
   would not fire and a malformed row could slip past instead of raising.
2. `client_accounts` privilege hardening: **REVOKE ALL then GRANT** so that
   `anon` has no privileges, `authenticated` has `SELECT` only, and
   `service_role` has exactly `SELECT, INSERT, UPDATE` (no DELETE / TRUNCATE /
   REFERENCES / TRIGGER). RLS stays enabled and the Phase 5A owner/admin policies
   are preserved.
3. A partial index on `communication_messages (entity_id, destination_hash,
   provider, status, created_at desc)` for the provider-bound attestation lookup
   — indexing only hashes/ids/provider-key/status/time, never plaintext.

## Environment variable (documented only — not created here)

```
SEND_SMS_HOOK_SECRETS   # server-only; the Standard Webhooks secret(s) for the
                        # Supabase Send SMS Hook. Each secret is the versioned
                        # Supabase form `v1,whsec_<base64>`, and MULTIPLE secrets
                        # are separated by a PIPE `|`.
                        #
                        # The COMMA is NEVER A SEPARATOR: it belongs to the
                        # `v1,` version marker inside each secret, and splitting
                        # on it would shred every secret in half.
                        #
                        # A newline is additionally accepted as an operator-
                        # friendly separator. Empty segments are ignored, each
                        # complete secret is trimmed, exact duplicates collapse,
                        # and order is preserved (current first, previous next).
                        # Verification succeeds if ANY configured secret validates.
                        # An empty final configuration FAILS CLOSED.
```

Examples:

- single: `SEND_SMS_HOOK_SECRETS='v1,whsec_SECRET_A'`
- rotation (documented format):
  `SEND_SMS_HOOK_SECRETS='v1,whsec_SECRET_A|v1,whsec_SECRET_B'`
- rotation (newline compatibility):
  `SEND_SMS_HOOK_SECRETS=$'v1,whsec_SECRET_A\nv1,whsec_SECRET_B'`

Phase 5D does **not** create or modify `.env` / `.env.local`.

## HTTP response contract (Supabase Send SMS Hook)

Deterministic, and never carries the OTP, phone, secret, signature, raw provider
error, raw payload, or any token. Every response sets an explicit `Content-Type`,
and every JSON body is `application/json`:

| Condition | Status | Body | `Retry-After` |
| --- | --- | --- | --- |
| accepted / sent / delivered / read (incl. accepted idempotent replay) | `200` | *empty* | — |
| queued / dispatching (in progress duplicate) | `503` | `{ ok:false, code:"in_progress" }` | **`true`** |
| automation not operationally enabled | `503` | `{ ok:false, code:"service_unavailable" }` | — |
| provider failed / cancelled / dead_letter | `502` | `{ ok:false, code:"delivery_failed" }` | — |
| missing headers / invalid signature | `401` | `{ ok:false, code:"unauthorized" }` | — |
| oversized body | `413` | `{ ok:false, code:"oversized_body" }` | — |
| unreadable body | `400` | `{ ok:false, code:"read_failed" }` | — |
| malformed verified payload | `400` | `{ ok:false, code:"malformed_payload" }` | — |
| secret not configured | `500` | `{ ok:false, code:"configuration_error" }` | — |

**Why `Retry-After` on `in_progress` only.** Supabase retries a `429`/`503` hook
response only when a **non-empty `Retry-After` header** is present. The in-progress
case is the one genuinely transient state: the first delivery is still dispatching
and this request is its idempotent duplicate. Retrying lets Supabase observe the
`accepted` row and return `200` — the provider is still invoked exactly once, and
no OTP is resent, no auth retry is scheduled, no new webhook id or message row is
created. A disabled automation and a terminal delivery failure deliberately carry
**no** `Retry-After`: neither can change inside a hook budget, and retrying a
single-shot auth failure would risk a duplicate OTP send.

The route reads the body through a **bounded streaming reader** (Content-Length
pre-check + a per-chunk byte cap at 16 KiB), so an oversized or missing-length
body is rejected before unbounded buffering. The exact accepted bytes are used
for Standard Webhooks verification; JSON is parsed only after verification. No
n8n / cron / queue / async retry is involved — the hook is synchronous.

## Hook time budget (and why there is no `Promise.race`)

Supabase gives an HTTP Auth Hook a bounded time to respond. Phase 5D deliberately
does **not** wrap the provider send in a `Promise.race` timeout: a race *rejects the
waiter* but does **not cancel** the underlying request. The provider call would keep
running, Supabase would see a timeout and retry, and the original request could
still succeed afterwards — a duplicate-OTP hazard. For mock-only readiness the send
is effectively instantaneous, so the behaviour stays synchronous.

**Prerequisite for activating a real provider:** the provider adapter itself must
enforce an **abortable** network timeout (an `AbortController`/`AbortSignal` on its
outbound HTTP call, or the SDK's own cancellation), set comfortably inside the
Supabase hook budget, so a timed-out send is genuinely cancelled rather than merely
abandoned. Do not connect a real provider before that adapter-level timeout exists.

## Live activation checklist (documented, NOT performed here)

1. Deploy the verified hook endpoint.
2. Install the runtime `SEND_SMS_HOOK_SECRETS` secret.
3. Configure an approved real WhatsApp provider adapter.
4. Register/map the approved authentication template.
5. Advance template + provider readiness.
6. Update the catalog `provider_required` from `mock` to the real provider key.
7. Enable `client_login_otp` operationally in a controlled rollout.
8. Enable/configure Supabase phone auth.
9. Configure the Supabase Send SMS HTTP Hook (URL + secret).
10. Smoke‑test: request → WhatsApp receive → verify → session → client account.
11. Monitor `auth_security_events` and communication delivery failures.
12. Maintain a rollback switch (`is_operationally_enabled = false`).

## Test harness

`npm run test:phase5d` — deterministic; models the real DB constraints, uses the
real `standardwebhooks` library for signature tests, and **mutation‑tests** the
security‑critical guarantees (skipping verification, allowing a disabled send,
persisting the OTP, random idempotency, accepting failed/stale attestations,
skipping the identity/phone conflict check, setting `whatsapp_verified_at`
without attestation, global signout, and grant‑only privilege migrations),
restoring every source file afterwards.
