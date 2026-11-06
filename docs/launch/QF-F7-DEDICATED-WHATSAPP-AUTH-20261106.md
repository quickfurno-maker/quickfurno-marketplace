# QuickFurno F7 — Dedicated Riya / Anisha WhatsApp Auth integration

**Date:** 2026-11-06. **Delivery:** Draft PR, Staging inactive database records only; no deployment, no outbound send, no Production mutation.

## Owner decision (locked)

- Riya **CLIENT ONLY** — +91 77091 72106, WABA `27861262223494153`, Meta Phone ID `1333595106493545`, approved Meta Authentication Copy Code `qf_client_auth_otp`, Meta template ID `1793889608370870`.
- Anisha **VENDOR ONLY** — +91 93596 68469, WABA `1569174604351612`, Meta Phone ID `1088396637681784`, approved Meta Authentication Copy Code `qf_vendor_auth_otp`, Meta template ID `1640977640737783`.
- These are independent WABAs/phone IDs and separate Meta credentials. No provider, sender, template, OTP, conversation, credits or client/vendor fallback may be shared. An old same-name `qf_vendor_auth_otp` template `1461908172056162` exists on the *client* WABA; it must **NEVER** be sent for vendors.
- Meta currently rates the vendor **8469** sender **RED/Low**, so quality recovery, limits and a consented canary are hard launch gates. Nothing in this source batch bypasses those gates.

## Actual F7 implementation

1. `lib/communication/vendorWhatsappOtpTransport.ts` pins both WABAs, both Meta phone IDs, provider-account identity, separate token, distinct internal vendor template, exact approved Meta vendor template ID, production-denied Staging canary flag and **GREEN-only explicit quality release gate**. The Meta Authentication Copy Code v2 mapping must duplicate the SAME `otp` variable to BODY position 1 and BUTTON URL index 0. Missing, conflicting or malformed sender/mapping/quality/credential → no send.
2. `services/anishaWhatsappOtpDeliveryService.ts` performs three independent, exact DB gates (owned vendor account, approved active binding, enabled vendor-only automation), then reuses existing Core `createRuntimeCommunicationService` for Meta abortable transport, runtime policy, consent, account attribution, durable single-shot ledger and provider delivery result. It never constructs a direct Meta request or SMS fallback.
3. `services/supabaseSendSmsHookService.ts` retains the signed Supabase Auth Hook identity boundary. After signature validation and server-HMAC purpose claim, `vendor_login` may enter ONLY the dedicated Anisha adapter, while `client_login` continues the distinct Riya client dispatcher. Unknown/missing purpose is rejected, and no unqualified client fallback is permitted.
4. `services/vendorOtpEvidenceReadService.ts` now binds successful vendor OTP ledger proof to the EXACT Anisha `communication_provider_accounts.id`, not merely the shared provider key `meta_whatsapp_cloud`. Signed phone digest, Supabase auth-user ID, webhook correlation ID and real provider account must all agree. This stops a forged/stale Riya account receipt from being accepted as vendor OTP proof.
5. Vendor registration and returning-login verified provider identity was updated from old `meta_whatsapp` alias to the actual Core ledger adapter key `meta_whatsapp_cloud`; old source-only registration gates remain OFF.
6. Dedicated 104+ hostile and returning-vendor tests cover real code call order, sender-swapping, template mismatch, unknown purpose, no SMS, no retry, provider-account mismatch, RED quality, malformed Copy Code bindings, stale account read and disabled transport. Full TS + Next optimized build required.
7. Staging-only two applied migrations (mirrored under their EXACT remote migration ledger versions):
   - `20261106113825_qf_f7_dormant_riya_anisha_auth_template_catalog.sql`: create separate CLIENT and VENDOR internal templates, Meta-approved mappings and automation entries, all **inactive**.
   - `20261106114301_qf_f7_client_vendor_auth_copy_code_v2_inactive_bindings.sql`: pin correct renderer v2 `AUTH_OTP_COPY_CODE` body+button binding on both approved but still **inactive** mappings.
   - The earlier single-row guarded Staging WABA repair of provider account `9e589e8b-d96d-4de7-b97b-e4cf49211067` corrected its WABA to `1569174604351612` but retained `readiness_status=disabled`, `health_status=unknown`, `webhook_status=pending`. This is recorded separately; it was not re-applied in F7.
   - Independent real DB readback: **0 active templates, 0 active mappings, 0 operationally enabled OTP automations, outbound_enabled=false**, provider webhook_processing_enabled=false.

## Required next gates before any real send

- Recheck Meta **quality and messaging limit** for vendor sender; RED currently fails GREEN release gate.
- Distinct secure Core Staging environment credential storage (existing JARVIS vendor token must not be pasted into code, Notion, chat, PR or logs); exact WABA and Phone ID live-readback.
- Verify the standalone signed Supabase Send SMS Auth Hook is deployed in Staging, both client and vendor OTP reservations are consumed exactly once; no SMS fallback.
- Reconcile per-account webhooks, approved sender/account metadata, sender-specific provider policy and consent; healthy vendor account row + approved bindings + enabled canary ONLY after external checks.
- Single user-consented handset test: vendor OTP initiated once, correct Anisha sender, delivered copy-code message, Supabase verifyOtp, HMAC purpose and exact provider_account_id evidence, Pending vendor registration, protected document intake and Owner MFA; returning vendor login. Ensure replay/duplicate/foreign account denial.
- ClamAV on hold by Owner; scan-dependent approval/activation cannot be bypassed.
- No Production deployment/traffic until GitHub checks, Staging E2E, quality/recovery and Owner GO.

**Do not confuse Meta template APPROVED or successful source CI with operational OTP delivery.**
