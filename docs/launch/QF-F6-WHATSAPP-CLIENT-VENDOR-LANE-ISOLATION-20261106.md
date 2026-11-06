# QuickFurno F6 — Strict client/vendor WhatsApp isolation (source-only)

**Owner decision 6 Nov 2026: two separate existing numbers for everything.**

| Lane | Agent | Sender | WABA | Provider Phone Number ID | Meta OTP template |
|---|---|---|---|---|---|
| Client | Riya | +91 77091 72106 | `27861262223494153` | `1333595106493545` | `qf_client_auth_otp` **not yet created** |
| Vendor | Anisha | +91 93596 68469 | `1569174604351612` | `1088396637681784` | `qf_vendor_auth_otp`, Meta ID `1640977640737783`, **APPROVED** |

**Other Meta object**: An earlier `qf_vendor_auth_otp` Meta ID `1461908172056162` was created on the **client** WABA before the two-number decision. It must remain **UNUSED** for vendor OTP. Account-scoped Meta template names can repeat on two WABAs; provider-account mapping must include WABA plus phone ID and never infer the sender from template name alone.

## Provider facts verified live, read only

- Meta verified Vendor WABA exact ID and its dedicated connected sender; Template Creation `META_CREATE_ACCEPTED`, ID `1640977640737783`, returned category `AUTHENTICATION`, status `APPROVED` (no send, sender changes or activation).
- Vendor Phone ID Meta status `CONNECTED` and quality `RED`; treat delivery at scale as an operational HOLD until quality and messaging limits are evaluated. Never send bulk/unconsented campaign traffic as a recovery tactic.
- Client number has a high rating in owner screenshots and existing Riya flows should remain unmodified.
- Existing managed Staging `communication_provider_accounts` includes a row with vendor Phone ID `1088396637681784` but old/different WABA ID `2920988211610262`; its readiness status is disabled and webhook pending. **Do not mutate this row blindly**; reconcile data provenance, scoped RPC/migration and rollback before activation.
- Signed Supabase Send SMS Auth Hook is shared at the provider level. That does **not** authorize mixing sender identities. Vendor OTP request functions reserve private `vendor_login` purpose and require independent Meta, signed Hook and Staging approvals.

## Source changes in F6

1. `lib/identity/whatsappAuthLaneIsolation.ts`: pinned pairs and intended templates; pure exact-match identity guard. Missing/unknown signed OTP purpose is never default client. Mixed IDs and swapped WABAs always reject.
2. `services/supabaseSendSmsHookService.ts`: existing Client/Riya delivery stays untouched by default. **If** any vendor shared-Hook staging certification flag is switched on, immediately require a real, private HMAC/reservation-backed `claimSignedAuthOtpPurpose`, and require a true `client_login` purpose plus the pinned *client* WABA and sender before legacy client dispatcher. A `vendor_login` claim is explicitly held as `SERVICE_UNAVAILABLE`, with no provider send, no retry header, no SMS fallback, and no automatic client redirection.
3. `scripts/mvp/vendor/vendor-whatsapp-lane-isolation.test.mjs`: 20 pure/structural tests for positive identity pairs, mixed and swapped identities, purpose forgery, client versus vendor template name, no-purpose hold, and actual signed-Hook enforcement ordered before client dispatch.
4. Dedicated source-only CI exercises exact branch scope and complete Marketplace typecheck/Next build; no managed service changes.

**Why the vendor send is still held**: The current Send SMS Hook has a single CLIENT delivery orchestrator. Even with an approved vendor template, the source lacks an independently certified vendor adapter, provider-account mapping, actual signed provider receipt and policy-safe quality condition. The only safe way to proceed is to reject vendor-purpose OTP attempts (before sending) until those are genuinely implemented and tested. This F6 change avoids a serious implicit cross-lane send without falsely marking complete vendor registration.

## Remaining release gates

- Create/approve `qf_client_auth_otp` on the **client** WABA, without using the wrong-name older template. Preserve existing Riya messaging and client signup path.
- Build a separate verified vendor Auth Hook delivery adapter with pinned Vendor WABA and Phone Number ID, vendor-only token/secret, signed `vendor_login` purpose and durable provider delivery receipt. Hook must never use client fallback or client messaging.
- Reconcile **only after review** the old Staging provider-account WABA/phone pairing, private Storage, purpose-claim ledger and Meta template mapping. Keep each lane's RLS, webhook routing, audit identity and operator toggles independent.
- Real Staging device E2E: request OTP, one Meta-approved vendor message to an opted-in handset, verify Auth phone, atomic Pending vendor enrollment, Google Place ID, private evidence/scanning, Owner MFA verification, returning login, revoke/replay/cross-vendor denial. Then only explicit Owner GO.
- **ClamAV/scan-dependent approval remains deferred at owner's request**, therefore approval/activation stays fail-closed until scan receipts exist. RED vendor quality remains a separate operational gate.

**NO DEPLOY, NO META SEND, NO SOURCE-ONLY CLAIM OF LIVE SIGN-IN.**
