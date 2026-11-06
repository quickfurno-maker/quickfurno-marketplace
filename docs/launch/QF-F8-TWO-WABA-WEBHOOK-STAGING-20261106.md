# QuickFurno F8 — Two WABA webhook registry and Staging identity inventory

**Owner-locked, separate WhatsApp accounts:**

| Lane | Assistant | Number | WABA | Phone Number ID |
| --- | --- | --- | --- | --- |
| Client | Riya | +91 77091 72106 | `27861262223494153` | `1333595106493545` |
| Vendor | Anisha | +91 93596 68469 | `1569174604351612` | `1088396637681784` |

Existing code already verifies Meta signatures against raw bytes, validates callback identity, proves the owning provider account before processing inbound messages or delivery receipts, and denies mixed/suspect identities. **No new webhook handler was rebuilt.**

## Real Staging work completed

On **6 November 2026**, an exact guarded migration was **applied** to Supabase Staging project `uckafzuochmbvtiodmcl` and independently read back as `supabase_migrations.schema_migrations.version=20261106120124`, name `qf_f8_dormant_riya_client_provider_account`. Source file `supabase/migrations/20261106120124_qf_f8_dormant_riya_client_provider_account.sql` mirrors the recorded applied statements (SHA256 `ba56e0814611dd0e3b4df8164714328d70f33ab0bbc195f2976fcfaaf35a7566`).

It inserted the **missing Riya/client provider-account record only**, ID `83df84e6-a5e9-47b3-adbd-6bf73e313322`, alias `riya_client`, role `conversational`, correct client WABA and Phone ID. **Readiness remains DISABLED; config PENDING; webhook PENDING; billing and health UNKNOWN; not a default role; Jarvis access DENIED**.

The existing vendor/Anisha record ID `9e589e8b-d96d-4de7-b97b-e4cf49211067`, alias `core`, WABA `1569174604351612`, sender `1088396637681784`, remains **DISABLED**, config PARTIAL, webhook PENDING. We did not alter this row or its role/default values. **Staging Meta outbound policy remained DISABLED, outbound_enabled=false, webhook_processing_enabled=false, zero enabled OTP automations and zero active OTP mappings**. Production not touched; zero WhatsApp OTPs sent.

## F8 new source work

`lib/communication/providers/metaCloudWhatsAppConfig.ts` expands the preexisting optional callback identity registry (which supported the primary and a separate conversational/Aarohi pair) to also accept an **optional dedicated Anisha vendor pair**. When present, the vendor identity **must match the locked WABA and phone ID**, and the primary must match the locked Riya pair. Missing half-pairs, swapped or shared IDs deny registration before any callback is processed. The optional Aarohi pair preserves existing support for two phone numbers in one WABA, unless it conflicts with the dedicated vendor sender.

`scripts/mvp/vendor/vendor-dual-waba-webhook-registry.test.mjs` exercises client/vendor/optional Aarohi callback authorization; foreign and swapped Meta IDs; missing phone IDs; untrusted display numbers; mixed callback envelope fail-closed; partial configuration; same-WABA conversational legacy behavior; and static signed-owner-before-effects boundary checks. All callbacks are synthetic and deterministic; no Meta POST, SMS, provider API, secret access, or user message occurs.

**Deployment remains HOLD.** Neither callback subscription nor signed Meta webhook processing is enabled by this source work. A Meta Graph template being APPROVED is not proof that live signed callbacks, provider-account readiness, quality or delivery receipts are working.

## Next externally gated acceptance

1. Review Draft F8 on top of Draft F7 PR #510 and reconcile prior phase's exact-scope protected CI without weakening original guards.
2. Verify vendor quality recovery from RED and messaging limits. Only an explicit operator-managed, genuinely opted-in test should be used after quality/policy checks; never bulk-send or fall back to Riya.
3. Supply **different** vendor and client Meta access credentials to the actual Staging runtime, with secret-store ACLs; configure signed Supabase Auth Hook, and check each subscribed WABA and inbound callback.
4. Controlled real handset test of Anisha vendor signup OTP, signed purpose claim, Meta delivery receipt mapped to exact vendor provider-account UUID, Supabase verifyOtp, Pending registration and returning login, then private documents/VOX Owner MFA.
5. ClamAV remains Owner-deferred. Scan-dependent vendor approval/activation cannot proceed without safe scan receipts.

**NO LIVE MESSAGING, NO MERGE, NO PRODUCTION, NO STAFF/FINANCE SCOPE.**
