# F10 — Cross-phase F1/F5/F6 sender and OTP security recertification

**NO DEPLOY. NO REAL SEND. NO HISTORICAL CI BYPASS.**

## Why F10 exists

QuickFurno operates two **separate** Meta WhatsApp lanes and users mandated absolute separation:

| Lane | Assistant | Phone | Meta WABA | Meta Phone ID | Approved Auth template |
| --- | --- | --- | --- | --- | --- |
| Client | Riya | +91 77091 72106 | `27861262223494153` | `1333595106493545` | `qf_client_auth_otp` / `1793889608370870` |
| Vendor | Anisha | +91 93596 68469 | `1569174604351612` | `1088396637681784` | `qf_vendor_auth_otp` / `1640977640737783` |

All GitHub phase-specific workflows F5, F6, F7, F8, F9 succeeded on their OWN exact original heads. On the later stacked F7 PR #510, inherited **F1** and **F5** validations failed their original pinned-source security guards; **F6** failed its original narrow exact-diff scope. The old checks are **NOT** invalid and must **NOT** be altered/waived. The changed files need a superseding review and explicit release approval in their final integration context.

## Exact actual changes reverified, NO CODE CHANGES

`scripts/mvp/launch/verify-f10-cross-phase-whatsapp-recert.py` checks original historical F1/F5/F6 protected verifiers unchanged. It explicitly requires the old F1 verifier's failures to equal ONLY these 2 original-hash drifts and old F5's failures to equal ONLY its 1 source modification plus deprecated provider-contract expectation. Any extra unexpected old-check failure rejects.

All FOUR changed runtime source files are SHA256-pinned to the F9 exact review code and compared with historical immutable Git blobs; F10 does NOT edit any runtime file:

- `app/api/vendor/onboarding/complete/route.ts`: old `meta_whatsapp` provider name replaced in exactly one gated return statement with canonical `meta_whatsapp_cloud`. SHA256 `d29c83339fc0b7bd1cbc310b61e5adfc4d9a4fdf5189532642ced15ce3db1f4c`.
- `services/returningWhatsappVendorLoginService.ts`: exactly two guarded provider identifiers replaced; no unrelated code change. SHA256 `67393242afe83bc06e147d85571500310124cdd45ca4efb174e5710450c70847`.
- `services/vendorOtpEvidenceReadService.ts`: source recertifies positive single Anisha-owned provider-account identity proof, exactly bound Vendor Meta WABA/Phone ID, strict `provider_account_id` in the message query AND returned-row check, server-only claimed `vendor_login` purpose, private user/phone hash, real accepted status and signer correlation. A client/Riya message cannot satisfy vendor OTP merely by sharing the general provider type. SHA256 `412d7c221166e524881d35711b34d409701c46a92a72fd4fa34d966945ede235`.
- `services/supabaseSendSmsHookService.ts`: superseding F6 review verifies the signed private purpose claim precedes Anisha-specific dispatcher; verified webhook identity flows into vendor send; returned provider outcome is propagated; existing Riya delivery path remains guarded and preserved; no purpose sharing or SMS fallback. SHA256 `8ba6426c1dc25adbca4378e1dd9b493151323c25df1664dd643b52a34bd96d86`.

The **old F1/F5 source manifests and CI fail on this newer code exactly as designed**; they still represent original-phase approval and must not be rewritten. F10 is a NEW, independent supplementary contract requiring review, not a retroactive pass or a permission to disable branch protection.

## Attacks covered

New 29-case Python anti-regression suite mutates expected caller-provider names, a staging feature gate, signed OTP claim, verified webhook sender, vendor-account receipt query and returned-row binding, F6 dispatch, original client path and release flags. Source hashes and original-to-current controlled deltas fail on unauthorized changes. F9–F6 sender isolation and returning-login Node suites provide 162 more tests, plus 46 existing JARVIS WhatsApp regression checks. Full TypeScript, Next build and compiled localhost Owner HOLD smoke are required by dedicated CI.

## Managed Staging and runtime facts (read-only)

- Supabase Staging `uckafzuochmbvtiodmcl` F9 audit returned **`dormant_preflight_pass=true`**: two separately pinned WABA/phone account identities, 2 approved inactive OTP templates, 2 inactive automations, no OTP messages, outbound and webhook processing OFF, all 4 sensitive purpose RPCs restricted to service_role and 3 F7/F8 migrations applied.
- External **unauthenticated** HEAD check from JARVIS to `https://vox.quickfurno.in/api/vox/v1/owner-whatsapp-launch-readiness` returned **HTTP 302**, TLS verification 0 (success). This suggests an access redirect, **but neither proves which application version is deployed nor verifies any runtime Meta/Supabase credential, subscription, signed Hook or authenticating Owner session**. Do not use this unauthenticated GET/HEAD as proof of E2E.
- The currently available connected Supabase management actions do **not** expose a documented read-only Auth Hook secret/configuration inventory. We have NOT fetched or printed any Meta token and have NOT changed Auth Hook settings.
- Vendor Meta quality was last independently verified RED/Low; must be positively rechecked before controlled test and cannot be bypassed by an env string.

## Launch security disposition

**Source recertification evidence ≠ final merge permission.** Historical F1/F5/F6 protected checks remain visible red on stacked F7; a reviewed independent final integration policy with explicit allowed source changes and protected branch-check adjustment is still required before merging. Current DRAFT F9/F10 no-deploy checks intentionally remain source-only. No external Meta sends, vendor credit/lead grants, Riya fallback, Staging webhook enablement, Production runtime change, staff/finance mutation, or Owner approval.

**Next action once source recert passes:** controlled signed Staging Auth Hook and per-sender credential provenance verification by a trusted operator, review Meta vendor quality/messaging limits, then one genuinely opted-in handset test with receipt and Supabase verifyOtp; Pending-only vendor registration and returning login. ClamAV remains owner-deferred, so scan-dependent verification/activation stays HOLD. Only after E2E and explicit Owner GO may Production launch be considered.
