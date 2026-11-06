# QuickFurno F12 — Actual deployed Staging Core drift, two-number preflight and upgrade gate

**Status: ACTUAL remote read-only operations completed. Production unchanged. NO SEND, NO DEPLOY, NO CLOUD CONFIG CHANGE.**

## What we proved on JARVIS and the REAL Staging host (6 Nov 2026)

- SSH alias `qf-staging` reached hostname `srv1873796`. The running private Docker service `qf-core-staging` reported image `qf-core-staging:09b9d7a4` and start time **2026-10-30T04:01:15Z**.
- The image tag resolves to Git commit `09b9d7a484c07fdc60009cbde1332dd4834ae3af` (30 October 2026; original VOX safe-workqueue merge #437). Latest F11 reviewed code is commit `73c2c822bb04d1953d8c5155b75372964cbacd9a`. Old image commit is an ancestor. The upgrade span contains **39 commits, 227 changed paths, 10 changed SQL migration files**, 14 Core service files and 14 API route files. This is a significant integration release; do NOT blindly restart or rebuild existing live Staging Core from all Draft PRs without proper checks.
- Traefik's **actual Docker routing** uses `Host(`staging-core.quickfurno.in`)` through the private `qf-core-staging` container at port 3000. Unlike VOX `vox.quickfurno.in`, this Core host did NOT redirect unauthenticated GET requests to Cloudflare Access.
- **TLS-valid public no-token GET only:** `https://staging-core.quickfurno.in/api/webhooks/whatsapp/meta` returned **403** (private verification required); `/api/auth/hooks/supabase-send-sms` returned **405** (POST-only); `/api/vox/v1/owner-whatsapp-launch-readiness` returned **404** (new F9 endpoint absent from October image). These are application routing proofs, NOT signed callback receipts, auth-hook activation or a live OTP.
- **Live Staging environment NAME inspection, not token-value inspection:** `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_WABA_ID`, `WHATSAPP_PHONE_NUMBER_ID` exist and `WHATSAPP_PROVIDER_MODE=meta_cloud`; required `WHATSAPP_VENDOR_ACCESS_TOKEN`, `WHATSAPP_VENDOR_WABA_ID`, `WHATSAPP_VENDOR_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, and `SEND_SMS_HOOK_SECRETS` are absent from running `qf-core-staging` environment. No token or secret was printed.
- More critically, in-memory comparisons (no raw env values logged) prove the deployed **default sender pair uses the obsolete vendor WABA `2920988211610262` with Anisha's phone ID `1088396637681784`**. The correct vendor WABA is `1569174604351612`. The configured pair is mismatched: do NOT enable outbound OTP. Correct it as part of the reviewed, separate-client-and-vendor Staging release, NOT as an isolated hot edit to a running 30 October container.
- Read-only Meta Graph check of Anisha WABA `1569174604351612` found **exactly one subscribed app**, app ID `1034375632334278` QuickFurno Cloud API. App default callback URL was **not** exposed by that WABA subscription response, and a separate app-subscription GET was not authorized (HTTP 400). The Supabase Staging Send SMS Auth Hook URI is also not available from connected management actions; neither has been guessed or changed.
- Independently previously verified Supabase Staging DB: both Riya and Anisha provider-account identities correctly registered but disabled, global Meta outbound/webhook processing OFF, zero active OTP automations and mappings, and zero OTP messages. Runtime config lags behind the DB; database correctness alone is NOT live integration.

## Machine-readable, non-secret attestation

The versioned snapshot `docs/launch/qf-f12-staging-core-attestation-20261106.json` captures only source image, environment-variable NAMES (not values), lane enum, callback HTTP/TLS result and unverified release gates. No customer records, OTPs, tokens, WABA secret keys or live callback signatures appear.

Run:

```bash
node scripts/mvp/launch/f12-core-runtime-release-gate.mjs --stdin < docs/launch/qf-f12-staging-core-attestation-20261106.json
node --test scripts/mvp/launch/f12-core-runtime-release-gate.test.mjs
```

It always returns `releaseVerdict: HOLD`, even for fabricated all-green values: there is no software shortcut to a real Owner signoff.

## Exact ordered Staging remediation (fastest safe path)

1. **Reconcile protected F1/F5/F6 GitHub release checks** with the supplemental F10 source recertification through normal reviewed branch-protection/integration process. No bypass or manual fail override.
2. **Confirm real external callback URLs**, via the Meta App WhatsApp Configuration UI and Supabase Staging Authentication → Hooks → Send SMS UI. Record URL origin + path and enabled state ONLY, never signing secrets. If using `staging-core.quickfurno.in`, direct ingress already reaches Core application; **do not create an unnecessary Cloudflare Access bypass on VOX**. If different host, independently verify exact routing and signature policy.
3. **Stage client/Riya and vendor/Anisha as separate, independently verified Staging configurations:** client default `WHATSAPP_WABA_ID=27861262223494153`, `WHATSAPP_PHONE_NUMBER_ID=1333595106493545`; vendor-specific `WHATSAPP_VENDOR_WABA_ID=1569174604351612`, `WHATSAPP_VENDOR_PHONE_NUMBER_ID=1088396637681784`. Use distinct client/vendor tokens, correct Meta app signature and verification secret, and Supabase signed hook secret. Source all credentials from approved secure secret stores; NEVER write them to Git, Notion, issue bodies, stdout, telemetry or CI logs. Verify token authority for exact WABA, not just presence.
4. **Controlled preview/deployment to Staging ONLY:** capture current Docker image, compose config and rollback manifest; build exact merged/reviewed head; compare required 10 migration statuses and signatures to managed Staging, with **no destructive reset**, applying only missing reviewed migrations after backup. Enforce outbound=false, webhook-processing=false, automation OFF, actual OTP canary OFF throughout. Recheck route, Owner AAL2, account isolation and GET/POST forbidden behavior; rollback on any regression.
5. **Signed callback E2E:** verify real registered Meta challenge and subscribed callbacks, Standard Webhooks Auth Hook signing on the deployed Core, exact Meta WABA/phone attribution to Riya vs Anisha. Controlled invalid-signature tests must produce no writes; no fallback to client sender.
6. **Quality-and-consent-gated device test ONLY after RED resolves:** independent vendor Meta quality GREEN, limits and registered device consent; explicit Owner-approved single canary; WhatsApp OTP provider receipt bound to Anisha account, Supabase `verifyOtp`, Pending-only vendor registration, returning login, private docs and VOX Owner review. No automatic resend or real SMS fallback.
7. **Final activation:** preserve ClamAV as Owner-deferred; scan-dependent vendor verification/assignment/credits must remain blocked until trusted clean-file receipts. Only after final review and Owner GO should Production be considered.

**F12 runtime observation and policy QA do NOT deploy, modify Cloudflare, enable Meta/Supabase hooks or send.** Historical screenshots should not be treated as evidence of live Auth Hook settings. To unblock external configuration review, the Owner only needs to verify the *actual two configured callback URLs and enabled states* in provider dashboards, without sharing secrets.
