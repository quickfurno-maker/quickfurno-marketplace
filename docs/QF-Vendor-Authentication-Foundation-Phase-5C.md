# QuickFurno — Vendor Authentication Foundation (Phase 5C)

Foundation only. Phase 5C establishes *who a vendor is* and *which vendor business
they may reach*. It ships no UI, wires no route, and activates no communication
automation.

---

## 1. Identity model

| Layer | Responsibility | Never |
| --- | --- | --- |
| Supabase Auth | Authentication + session authority | — |
| `vendor_dashboard_users` | Auth principal → vendor business access mapping | Credential storage |
| `vendors` | The business entity | Identity authority |
| Phase 4 policy engine | Business authorization authority | Authentication authority |
| Phase 5A `auth_security_events` | Authentication/security audit log | Mutable |
| Phase 5B communication core | Transport foundation | Authentication authority |

There is **no custom JWT**, **no custom session**, and **no second session cookie**.
`supabase.auth.getUser()` on the request-scoped SSR client is the only session check.

---

## 2. The five states that must never merge

```
vendor login authentication
  ≠ vendor WhatsApp verification   (vendor_dashboard_users.phone_verified, whatsapp_otp_enabled)
  ≠ vendor business verification   (vendors.verification_status)
  ≠ vendor subscription/paid state (vendors.paid_status, package status)
  ≠ vendor lead eligibility        (remaining_credits, accepting_leads)
```

A vendor authenticates successfully while **all** of the right-hand states are
pending, unpaid, zero, or false. Those states restrict *business functions* in
other layers. None of them is an authentication credential.

`lib/identity/vendorAccess.ts` exports
`BUSINESS_STATE_FIELDS_EXCLUDED_FROM_AUTHENTICATION` as the machine-checkable
contract; the harness asserts `services/vendorAccessService.ts` references none of
them, and that the resolver reads only `vendors.id` (existence).

Authentication access depends on exactly three things:

1. an authentic Supabase user,
2. a valid `user_id → vendor_id` mapping,
3. an **active** dashboard membership (`status = 'active'`, trimmed/case-tolerant).

Anything else — including an unrecognised `status` value — fails closed.

---

## 3. `VendorAccessContext`

```ts
interface VendorAccessContext {
  authUserId: string;            // Supabase auth.users.id
  vendorDashboardUserId: string; // vendor_dashboard_users.id
  vendorId: string;              // THE canonical vendor identity for the request
  role: string;
  membershipStatus: string;
}
```

Resolved **only** along:

```
Supabase Auth user → vendor_dashboard_users.user_id
                   → vendor_dashboard_users.vendor_id
                   → vendors.id
```

A `vendor_id` from a form body, query string, URL segment, hidden input,
localStorage, or an application-created cookie is **untrusted input**. It may be
compared (`requireVendorScope(requestedVendorId)`) but never becomes identity
authority — the guard always returns `context.vendorId`.

### Resolver outcomes

`not_authenticated` · `no_vendor_mapping` · `membership_not_active` ·
`malformed_mapping` · `vendor_not_found` · `lookup_failed`

All are internal. Callers receive a generic `UNAUTHORIZED`.

---

## 4. Public surface

| Export | Module | Purpose |
| --- | --- | --- |
| `resolveVendorAccess(authUserId)` | `services/vendorAccessService.ts` | Canonical mapping resolver |
| `resolveCurrentVendorAccess()` | ” | Validates the session, then resolves |
| `requireVendorAccess()` | ” | The one guard for protected vendor routes |
| `requireVendorScope(requestedVendorId)` | ” | Validates an untrusted id, returns the canonical context |
| `linkVendorAuthUser(input)` | ” | Idempotent, admin-authorized provisioning |
| `vendorPasswordLogin(input)` | `services/vendorAuthService.ts` | Supabase Auth password login |
| `recordAuthSecurityEvent(input)` | `services/authSecurityEventService.ts` | The only `auth_security_events` writer |

`linkVendorAuthUser` accepts **no authorization argument**. A plain TypeScript
object is forgeable by any caller, so a value like `{ adminUserId: "…" }` would be
an authorization *claim*, never a *proof*. Authority is derived internally by the
private `requireAdminSession()` — Supabase-validated session, then
`profiles.role = 'admin'` — and only then does the private
`performVendorAuthUserLink()` touch the service-role client. `input.vendorId` names
the operation's **target** and confers no authority whatsoever.

---

## 5. Login architecture

```
identifier + password
  → normalizeVendorLoginIdentifier()      email → trim+lowercase
                                          phone → Phase 5B canonical E.164
                                          bare national number → REJECTED
  → serverClient().auth.signInWithPassword()   ← request-scoped SSR client
  → resolveVendorAccess(user.id)
      ├─ active mapping  → stamp last_login_at / last_login_method='password'
      │                    record vendor.login_success
      └─ anything else   → signOut({ scope: "local" })   (same auth context)
                           inspect the returned { error }; retry once
                           record sanitized vendor.login_failed
                           return the generic failure
```

### Session invalidation

`scope: "local"` is explicit and deliberate. The **default scope is global**, which
would revoke every refresh token the user holds — signing them out of every other
device because one login attempt hit a vendor with no active mapping. Only the
current session is torn down.

The `{ error }` Supabase returns is **inspected**, with one bounded retry. We never
report an invalidation we did not observe: the audit row carries
`session_invalidated: boolean`, `session_invalidation_failure`
(`sign_out_rejected` | `sign_out_threw` | `null`) and `session_invalidation_attempts`.

When invalidation cannot be confirmed we do **not** escalate to a global sign-out
(that would punish the user's other devices for our failure) and we do **not**
invent a second cookie. The cookie may survive, but every protected surface still
fails closed — `requireVendorAccess()` resolves no active mapping for that
principal. The one thing Phase 5C must not do is claim success it did not observe.
The raw `AuthError` is discarded (its message can embed a token or a request URL);
only the closed, identifier-shaped vocabulary above reaches the ledger.

**Never**: `adminClient().auth.signInWithPassword()` — signing a user in with the
service-role key bypasses the request's auth context and leaves no browser
session. The harness asserts `adminClient().auth` appears nowhere.

`vendorPasswordLogin` must be called from a **Server Action or Route Handler**:
`signInWithPassword` writes the Supabase auth cookies, and Next.js only permits
cookie writes there.

### Generic failure

Every rejection returns exactly `VENDOR_LOGIN_FAILED` / `"Invalid login
credentials."` — wrong password, unknown email, unknown phone, no mapping,
suspended membership, missing vendor. Nothing distinguishes them. The specific
cause is retained **only** in the audit log's `failure_classification`.

### No country guessing

`+91 98765-43210`, `0091 98765 43210`, and `+91 (98765) 43210` all canonicalize to
`+919876543210`. A bare `9876543210` is `LOGIN_IDENTIFIER_AMBIGUOUS_LOCAL_PHONE`
and Supabase Auth is never called — a slipped digit must not authenticate a
different country's user.

---

## 6. Security-event integration

`services/authSecurityEventService.ts` is the single persistence path. It reuses
Phase 5A `AuthSecurityEventType.VENDOR_LOGIN_SUCCESS` / `VENDOR_LOGIN_FAILED` and
Phase 5A `sanitizeAuthSecurityMetadata` — no duplicate table, no weaker sanitizer.

Persisted: event type, principal type, principal id (vendor) where known, actor
user id where known, correlation id, **hashed** login identifier, login method,
failure classification, timestamp.

Never persisted: password, raw login identifier, OTP, access/refresh/session
token, authorization header, provider secret, raw provider payload.

Three enforced guards, not conventions:

1. `destination_hash` must match `^[a-f0-9]{64}$` — passing a raw email/phone is
   rejected with `AUTH_SECURITY_EVENT_DESTINATION_NOT_HASHED`.
2. After Phase 5A key-sanitization, any metadata **value** shaped like an email or
   an E.164 number is rejected with
   `AUTH_SECURITY_EVENT_RAW_IDENTIFIER_FORBIDDEN`. Key filtering alone would not
   catch `{ typed_value: "vendor@example.com" }`.
3. The table grants `service_role` SELECT + INSERT only; this module never updates
   or deletes.

### Identifier hashing

`sha256(canonical)`. Email canonical = trimmed + lowercased (dots and `+tags` are
**not** folded — that is Gmail-specific and would merge distinct identities
elsewhere). Phone canonical = Phase 5B E.164, so a phone identifier hash is
byte-identical to the Phase 5B `destination_hash` for the same number and audit
rows correlate across phases for free.

---

## 7. Migration `20260708000180_vendor_authentication_foundation.sql`

Additive, idempotent, non-destructive. **Not applied.**

1. `create table if not exists public.vendor_dashboard_users` — the table exists in
   the linked database but was never captured in a local migration file (the known
   CLI history drift). No-op where it exists; authoritative for fresh environments.
2. `user_id → auth.users(id) ON DELETE SET NULL`. Existence of *a* foreign key is not
   the contract — the **delete action** is. The `DO` block reads
   `pg_constraint.confdeltype` for the single-column `user_id` FK and branches:
   absent → add it; `'n'` (SET NULL) → idempotent no-op; **anything else**
   (`CASCADE`, `RESTRICT`, `NO ACTION`, `SET DEFAULT`) → `RAISE`, refusing to accept
   silently-wrong semantics. It never removes a constraint it did not create — that
   is a destructive act belonging to a human. Deleting an authentication account must
   never delete the vendor business. The existing `vendor_id` FK (`ON DELETE CASCADE`)
   is untouched.
3. `create unique index if not exists uq_vendor_dashboard_users_user_id ... where user_id is not null`
   — one auth principal can never resolve to two vendor businesses. Partial, so
   many unclaimed (`user_id IS NULL`) rows may coexist.
4. **Backfill** — see §8.
5. **RLS** — see §9.

Deliberately absent: any credential/token/session column; any
`SECURITY DEFINER` helper (no policy here needs one, and the server-side resolver
is the canonical path — adding `public.current_vendor_id()` would widen the trusted
surface for nothing); any change to a Phase 5A or Phase 5B object.

---

## 8. Backfill behaviour

Creates a mapping for vendors that already carry `vendors.user_id`, **only** where
unambiguous:

* the vendor has no dashboard mapping yet, **and**
* that auth principal is not already mapped to some vendor, **and**
* exactly one vendor claims that auth principal.

Written values: `role='owner'`, `status='active'`, `phone_verified=false`,
`whatsapp_otp_enabled=false`, `last_login_method=null`, `last_login_at=null`.

* Never `UPDATE public.vendors` — existing `vendors.user_id` links are preserved
  byte-for-byte and remain the source the backfill reads.
* Never overwrites an existing mapping row (even a mismatched one).
* Never infers WhatsApp verification from a phone number being present.
* Never infers paid or business-verification state.
* Two vendors sharing one auth principal → **both skipped**, no winner arbitrated.
* `ON CONFLICT DO NOTHING` makes a racing insert fail safely.
* Re-running inserts nothing.

---

## 9. RLS + privilege summary

RLS was already enabled with **zero policies** (effective deny-all) while broad
grants remained. This replaces that with an explicit model.

**A `GRANT` only adds privileges — it removes nothing.** The linked database carries
historical privileges on this table, including `DELETE`, `TRUNCATE`, `REFERENCES` and
`TRIGGER`. Every role is therefore `REVOKE ALL`-ed to zero *first*, then granted
exactly what it needs. The revoke must precede the grant, and the harness applies the
migration's real `GRANT`/`REVOKE` statements in order against a simulated
over-privileged starting state to prove the end state is exactly:

| Role | Privileges after migration | Policies |
| --- | --- | --- |
| `anon` | *none* | none |
| `authenticated` | `SELECT` | `self read`: `auth.uid() IS NOT NULL AND auth.uid() = user_id`<br>`admin read`: `public.is_admin()` |
| `service_role` | `SELECT, INSERT, UPDATE` | (bypasses RLS) |

No role retains `DELETE`, `TRUNCATE`, `REFERENCES`, or `TRIGGER`. Removing a vendor
business still cascades through the `vendor_id` FK: PostgreSQL's referential-action
triggers run with the table owner's privileges and bypass both the grant check and
RLS, so no `DELETE` grant is required for that.

No `INSERT` / `UPDATE` / `DELETE` grant or policy exists for `authenticated`, so a
vendor can never modify `vendor_id`, `user_id`, `role`, `status`, `phone_verified`,
or `whatsapp_otp_enabled` from the browser. Login metadata is written server-side
through `service_role`. Access is revoked by setting `status`, never by deleting a
row. No broad `using (true)` policy exists.

---

## 10. Out of scope

Phase 5D — client WhatsApp OTP login transport wiring.
Phase 5E — vendor WhatsApp verification, vendor password reset challenge, OTP
generation/verification, reset-grant consumption.

Phase 5C exposes the interfaces those phases will need (`VendorAccessContext`, the
identifier canonicalizer, the security-event writer) and implements none of them.
No Phase 5B automation is activated: all 16 rows remain `wiring_pending` +
`is_operationally_enabled = false`, and vendor password login requires no WhatsApp
transport at all.

---

## 11. Known limitations

* **Not wired.** No route, page, middleware, or server action calls
  `requireVendorAccess()` yet. `app/actions.ts` still resolves the vendor via
  `vendors.user_id` (`requireVendorOwner`, `getMyVendor`). Both paths agree for the
  three currently-linked vendors, and the backfill keeps them agreeing. Switching
  the call sites is a follow-up, deliberately excluded here because Phase 3B/4A/4B1
  scope guards forbid touching `app/`, `components/`, and `public/`.
* **Audit writes are advisory.** A failed `auth_security_events` insert does not
  block a login; `VendorPasswordLoginSuccess.auditRecorded` reports it. Blocking
  login on an audit-write failure would be an availability hazard.
* **Phone login requires Supabase phone auth enabled.** `signInWithPassword({phone})`
  fails otherwise — and, correctly, fails as the generic login error.
* **`status` has no CHECK constraint.** The live table predates this phase and may
  hold values we have not seen. The resolver fails closed on anything that is not
  exactly `active`, which is safe but means a typo silently locks a vendor out.
* **The identifier hash is unsalted SHA-256**, matching the existing Phase 5A/5B
  `destination_hash` convention. It is brute-forceable for a known phone-number
  space; it exists for audit correlation, not secrecy.
* **Unconfirmed session invalidation leaves the cookie standing.** When
  `signOut({scope:"local"})` fails twice, we record `session_invalidated: false` and
  return the generic denial. We do not escalate to a global sign-out and do not
  clear cookies out-of-band. Protected surfaces still fail closed through
  `VendorAccessContext`, but the raw Supabase session remains until it expires. An
  operator should alert on `session_invalidation_failure` in `auth_security_events`.
* **The FK and privilege checks are modelled, not executed.** There is no in-process
  PostgreSQL, so the harness applies the migration's real `GRANT`/`REVOKE` statements
  to a simulated privilege state, and models the `DO` block's branch after reading its
  accepted `confdeltype` code out of the SQL. Both are coupled to the migration text;
  neither is a live `psql` run. Behaviour against the real catalog is verified on apply.
