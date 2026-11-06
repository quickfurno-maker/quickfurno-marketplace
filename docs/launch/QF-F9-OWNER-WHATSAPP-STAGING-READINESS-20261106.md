# QuickFurno F9 — VOX Owner two-WABA readiness + reproducible Staging no-send audit

**Owner's two-number decision (locked):** Client/Riya +91 77091 72106, WABA `27861262223494153`, Phone Number ID `1333595106493545`, Meta-approved `qf_client_auth_otp` template ID `1793889608370870`. Vendor/Anisha +91 93596 68469, WABA `1569174604351612`, Phone Number ID `1088396637681784`, Meta-approved `qf_vendor_auth_otp` ID `1640977640737783`. No cross-sender fallback or provider-token reuse. ClamAV remains Owner-deferred, so scan-dependent vendor approval remains HOLD.

## Actual read-only managed Staging preflight — completed 6 Nov 2026

Ran **the exact source** `scripts/mvp/launch/qf-f9-staging-whatsapp-readonly.sql` against Supabase Staging `uckafzuochmbvtiodmcl` using a read-only SQL operation. It returned `evidence_schema=qf.f9.whatsapp.staging-no-send.v1`, **`dormant_preflight_pass=true`**, with:
- Exactly **1** disabled client and **1** disabled vendor account, **2** total WABA/phone records; each matches locked Meta IDs.
- Exactly 1 disabled Meta runtime-policy row: outbound_enabled=false, webhook_processing_enabled=false, activation_status=disabled.
- 2 exact, Meta-approved and **inactive** OTP template mappings (correct account-specific template IDs), 2 disabled OTP automations, 0 active internal templates, 0 OTP messages.
- Exactly **four** security-definer private OTP-purpose RPCs with EXECUTE privilege for service_role **only**; `anon` and `authenticated` have NO execute grant.
- Three source-tracked F7/F8 Staging migrations recorded applied.
- Explicit evidence outputs: `actual_live_otp_e2e_certified=false`, `meta_vendor_quality_green_independently_verified=false`, and `owner_production_go=false`.

**This is a DB-inventory/passive-safety result only; it does NOT prove deployed Staging runtime secrets, signer, Auth Hook registration, webhook subscriptions, consent or real Meta delivery.** No Supabase/Auth configuration, Meta setting, DB record, Production runtime or customer data was modified by F9.

## F9 actual source changes

1. `lib/communication/whatsappStagingReadiness.ts` — pure exact-client/vendor identity assessment. Distinguishes `twoSenderInventoryValid` and `dormantConfigValid` from **releaseVerdict=HOLD**, `canSendOtp=false`, `canApproveVendor=false` **for every input**. Detects missing, swapped, duplicate, active or wrong template/provider records and fails closed. Green-looking DB health or operator flags never substitute for independent Meta quality, signed Hook and handset E2E evidence.
2. `app/api/vox/v1/owner-whatsapp-launch-readiness/route.ts` — **NEW source-only** VOX Owner AAL2 read-only GET; disabled by default via `VOX_OWNER_WHATSAPP_READINESS_ENABLED=staging`. Reuses existing `verifyVoxOwnerBearer` twice (before and after privileged DB reads), selects minimal provider/mapping/automation fields, returns only sanitized status and safety blockers. `POST/PUT/PATCH/DELETE=405`, no caching, no sender or provider call. Does not grant enablement authority. **Not deployed.**
3. Reproducible read-only SQL, hostile snapshot and route-security tests, compiled localhost HTTP smoke with all external credential variables removed, exact no-deploy eight-path diff guard and dedicated CI.

## Earlier protected PR provenance

- F5 [Draft #508](https://github.com/quickfurno-maker/quickfurno-marketplace/pull/508) head `7f2f595db8d407ba6b25f4783691a2f4d0748922`: dedicated F5 workflow SUCCESS.
- F6 [Draft #509](https://github.com/quickfurno-maker/quickfurno-marketplace/pull/509) head `0d0aa496b97359feea10c3bd946e729eb71231b4`: dedicated F6 workflow SUCCESS.
- F7 [Draft #510](https://github.com/quickfurno-maker/quickfurno-marketplace/pull/510) head `61bb1ce1e06cf138fe65ed10fe03c0c15557d931`: dedicated F7 workflow SUCCESS; inherited F1/F5/F6 exact-scope checks FAILED against legitimate stacked F7 files. These failures were NOT masked, retried into unrelated branches, overridden or waived.
- F8 [Draft #511](https://github.com/quickfurno-maker/quickfurno-marketplace/pull/511) head `c2a5443e3eeae78882f1822d7be6626bada15aa1`: dedicated F8 workflow 13/13 SUCCESS.
- F9 is stacked on F8 with its own strict no-deploy scope. It does not modify the previous protected source-scope workflows.

## Still blocked before live OTP / Production

Vendor Meta phone is **CONNECTED but quality RED** in latest independently verified read-only Meta check; do not infer a GREEN rating from an env flag. The two distinct access credentials are not yet independently certified **in the deployed Staging application**. Signed Supabase Send SMS Auth Hook subscription/timeout, webhook verification, actual Meta provider-account receipt and quality limit need a supported canary with a genuinely opted-in handset, then Supabase phone verification, Pending vendor registration, returning login and VOX Owner MFA. Existing scan-dependent approval remains HOLD under ClamAV deferral. Final owner GO and staged rollback are mandatory. **No live sends, no merge and no Production changes in this F9 batch.**
