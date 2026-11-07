# F16 — controlled RED-quality vendor WhatsApp OTP canary

**7 November 2026 · Draft only · NO DEPLOY · NO SEND · Production HOLD.**

The Owner requested removal of QuickFurno's internal GREEN-only requirement for Anisha. Meta rated the vendor phone **CONNECTED / RED** in a direct read-only Graph check; the status does not guarantee delivery or bypass Meta's quotas/restrictions. The separate Riya/client phone was **CONNECTED / GREEN**. Other prerequisites remain unresolved: six missing Staging runtime environment variables, callback registration and signed hook verification, disabled Staging OTP database mappings and automation, protected F1/F5/F6 historical CI drift, and current managed recovery proof.

## Implemented narrow exception

The existing GREEN path is unchanged. RED is allowed in the vendor-only configuration preflight **only for a tightly bounded test** when all of the following independent checks hold:

- All original signed shared Supabase Hook, Staging, vendor provider and explicit live OTP canary approval flags remain equal to `staging`.
- `QF_VENDOR_META_QUALITY_RATING=RED`, `QF_VENDOR_META_PHONE_STATUS=CONNECTED` and `QF_VENDOR_RED_CANARY_APPROVED=staging`.
- `QF_VENDOR_RED_CANARY_PHONE_SHA256` is a lowercase 64-character SHA-256 hex digest of the *one approved recipient's exact E164 phone number*. The actual vendor transport verifies this recipient **before** database/provider calls.
- `QF_VENDOR_RED_CANARY_UTC_EXPIRES_AT` is strict `YYYY-MM-DDTHH:MM:SSZ` format and falls in a **maximum 15-minute** future window. Expired, missing, malformed, ambiguous or far-future value denies.
- Riya WABA/phone/token must remain distinct from Anisha's exact WABA/phone/token; approved Meta Auth Copy Code binding and provider-account ID, signed OTP purpose, Core runtime consent and durable provider receipt must still authorize each send. No SMS/client fallback, automatic retry or altered Meta quality reporting.

**Important limitation:** This is *single-recipient and short-lived*, **not a cryptographically guaranteed single-message counter**. Repeated properly signed requests during the window remain subject to existing OTP throttles and Meta provider limits. The separate provider's real-time refusal is authoritative. Never use these flags for unrestricted rollout or Production.

## Verification

On isolated JARVIS F16 worktree, `node --import ./scripts/mvp/loader/register.mjs --test` ran original F7 dedicated OTP tests plus 12 new F16 tests: **79/79 PASS**. The original F7 verifier also returned `F7_TWO_SENDER_SCOPE_PASS []`. Tested RED default denial, explicit staging authorization, expiry and status negatives, exact recipient hash denial before sends, independent tokens, DB/Hook gate denial and provider rejection. No real Meta send, external callback change, Supabase write, live Staging restart or production deployment performed.

## Next gated actions

Review and merge this F16 patch through proper CI only after source security approval. Confirm Meta vendor app callback and Supabase Staging Authentication → Hooks → Send SMS registered URL/enabled state, provision distinct Staging secrets, clear protected CI and managed recovery. Only then run an Owner-approved consented, hashed-single-recipient test within its 15-minute authorization and monitor actual signed Meta delivery receipts. **ClamAV remains deferred; scan-dependent vendor approval/lead assignment/credits remain fail-closed.**
