# QuickFurno — Identity & Security Foundation (Phase 5A)

> **Foundation-only.** Phase 5A establishes canonical identity contracts and
> secure persistence readiness for later Phase 5 auth-security work **without
> changing any Phase 1–4 runtime behaviour** and **without activating** any OTP
> transport, login workflow, WhatsApp/Twilio/Gupshup provider, Google Maps,
> geocoding, or n8n auth path. Those belong to later Phase 5 subphases.

Migration: [`supabase/migrations/20260708000160_identity_security_foundation.sql`](../supabase/migrations/20260708000160_identity_security_foundation.sql)
· Contracts: [`lib/identity/`](../lib/identity) · Harness:
[`scripts/phase5a-identity-security-harness.mjs`](../scripts/phase5a-identity-security-harness.mjs)
(`npm run test:phase5a`).

---

## Responsibility separation (do not merge)

| Layer | Owns |
|---|---|
| **Supabase Auth** | Authentication **session** authority (login state, `auth.uid()`) |
| **QuickFurno identity layer** (`lib/identity`) | Principal **type**, business identity & ownership mapping |
| **Phase 4 policy engine** | Business **authorization** authority |
| **Future auth-security layer** (Phase 5B+) | Verification challenge + password-reset authorization |
| **Future communication service** | Provider-neutral message **transport** gateway |
| **n8n** | External **orchestration support only** — never auth authority |

Phase 5A adds only the first-and-second-column foundations; it does not build a
custom session framework and does not touch the working `currentUser()` /
`requireAdmin()` / `requireSuperadmin()` / `requireVendorOwner()` guards in
`app/actions.ts`.

## Security invariants (encoded + enforced)

1. Supabase Auth owns authentication sessions.
2. QuickFurno owns business identity mapping.
3. Phase 4 policy engine owns business authorization.
4. Authentication challenge verification stays inside QuickFurno backend services.
5. n8n is never an authentication authority.
6. n8n never generates or verifies OTPs.
7. n8n never resets passwords.
8. OTP plaintext is never persisted — only `otp_hash` / `destination_hash`.
9. Reset tokens are never persisted in plaintext — only `grant_token_hash`.
10. Verification purposes are not interchangeable (`challengePurposeMatches`).
11. Sensitive security tables are server-only (RLS deny-all + service_role grants).
12. Anonymous enquiry submission remains supported (unchanged).
13. Login state and WhatsApp verification state are separate fields/tables.
14. Communication transport is added later via a provider-neutral service.
15. Phase 5A activates no real communication provider.

## 1. Canonical principal model & Phase 4 integration

`lib/identity/principal.ts` introduces one identity vocabulary:
`PrincipalType` = `anonymous | client | vendor | admin | integration | system`,
plus an immutable `PrincipalRef { type, id, userId, role }`.

- It is a **reference** contract, not a new session framework: `userId` maps to
  the Supabase Auth identity for `client`/`vendor`/`admin` (session-backed), and
  is `null` for `anonymous`/`integration`/`system`.
- It composes with the existing guards rather than replacing them: `admin`
  mirrors `profiles.role='admin'` + `admin_role`; `vendor` mirrors
  `vendors.user_id`; `client` mirrors the new `client_accounts.user_id`.
- **Phase 4 integration:** the Phase 4 policy engine remains the business
  authorization authority and continues to consume PII-free facts. Its facts
  already carry `policyKey`, `workflowType`, etc.; there is no `Actor`/`Principal`
  in Phase 4 to collide with, so this is the single canonical identity vocabulary
  future authorization contexts (authenticated users, vendors, clients, admins,
  integrations, system jobs, AI-agent system contexts) will reference.
- **AI agents get no independent authentication authority:** an AI agent acts
  only through a `system` (or authorized `integration`) principal with `userId:
  null` — there is deliberately no `ai_agent` principal type.

## 2. Why client Supabase OTP is not stored in `verification_challenges`

Client OTP **login** remains **Supabase Auth session-controlled** — Supabase
issues, delivers, and verifies that OTP and owns the resulting session. Storing a
parallel QuickFurno OTP for client login would (a) duplicate/fork session
authority, (b) risk it drifting from Supabase's own verification, and (c) put OTP
material in a QuickFurno table for a flow Supabase already secures. Therefore
`verification_challenges` is scoped to **QuickFurno-managed vendor challenges only**
(`vendor_whatsapp_verify`, `vendor_password_reset`). The purpose CHECK constraint
does not even include a client-login purpose. Client identity still gets a durable
business record (`client_accounts`), but its login remains Supabase's job.

## 3. How vendor verification purposes stay isolated

Purposes are a closed set with a CHECK constraint at the DB layer and an exhaustive
enum at the TS layer. Matching goes through `challengePurposeMatches(challenge,
required)`, which returns `true` **only** when both sides are known purposes and are
exactly equal. A `vendor_whatsapp_verify` challenge can therefore never satisfy a
`vendor_password_reset` check (and vice-versa), and unknown/blank purposes match
nothing. Purpose is also part of the challenge lookup index, so future services
select challenges *by purpose*.

## 4. How password-reset grants are protected

`password_reset_grants` stores **only** `grant_token_hash` (never the plaintext
token), is **single-use** (`consumed_at`) and **expiring** (`expires_at`), has a
unique constraint on the token hash, and is a **server-only** table (RLS deny-all
for anon/authenticated, `service_role` grants only). Browsers cannot read it.
Phase 5A performs no password updates and exposes no public reset endpoint.

## 5. How RLS protects sensitive tables

- **`verification_challenges`, `password_reset_grants`, `auth_security_events`** —
  the established fully-sensitive pattern (as used for `lead_scores` and the
  workflow-kernel tables): `enable row level security` with **no** anon/authenticated
  policies (deny-all for the PostgREST API roles), `revoke all` from `anon` and
  `authenticated`, and least-privilege `service_role` grants. `auth_security_events`
  is append-oriented (`grant select, insert` only — no update/delete).
- **`client_accounts`** — owner-scoped + admin-managed, consistent with the
  Supabase SSR/session architecture: `revoke all from anon`; an owner-read policy
  `for select to authenticated using (auth.uid() = user_id or public.is_admin())`;
  and an admin-manage policy via `public.is_admin()`. Writes flow through the
  server/service layer (`service_role`). This future-proofs client self-service
  reads without exposing other clients' rows and without conflicting with SSR.

## 6. Anonymous enquiry safety & no lead relinking

`client_accounts` adds identity storage only. Phase 5A adds **no** historical-lead
relinking and does **not** change public enquiry submission — anonymous lead
capture continues exactly as before. Normalized phone uniqueness is a *partial*
unique index (`where phone_e164 is not null`) so identity rows can exist before a
phone is captured, and it never claims historical leads by matching phone text.

## 7. How this prepares Phase 5B (without implementing it)

Phase 5B and later can now build on stable contracts + persistence: issue/verify
vendor WhatsApp challenges and password-reset grants through backend services that
write these tables via `service_role`; emit `auth_security_events` using
`sanitizeAuthSecurityMetadata` (which strips any OTP/password/token/secret key
before persistence); and reference actors uniformly via `PrincipalRef`. None of
that transport, verification, or reset logic exists yet — Phase 5A ships only the
secure contracts and schema.
