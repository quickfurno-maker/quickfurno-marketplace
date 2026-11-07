# F17 — actual operational Staging release reconciliation (A, B, C parallel)

**Date:** 7 November 2026. **Actual connected systems:** JARVIS Desktop Commander + authorized `qf-staging` SSH, GitHub PR/Actions, Supabase Staging `uckafzuochmbvtiodmcl`, Meta Graph read-only with two independently stored tokens, Notion.

## Track A — GitHub protected integration

- F16 [PR #518](https://github.com/quickfurno-maker/quickfurno-marketplace/pull/518) at `9290e1b2625e3ca0f8284a80aeb906389defd666`: **79/79** F7+F16 tests and independent [F16 CI](https://github.com/quickfurno-maker/quickfurno-marketplace/actions/runs/42347125823) **SUCCESS**. RED is now a *short-lived, one-recipient Staging-only exception*, with the original signed Hook, exact distinct vendor credentials and provider account unchanged.
- JARVIS direct F10 cross-phase recert `valid:true`, F11 and F12 verifiers both PASS. F11+F12+F13 tests **73/73 PASS**. Original protected F1 run 42213054624 failed pinned source diff; F5 run 42213054292 failed exact original source contract; F6 run 42213054355 and F7 run 42347125699 failed exact original branch diff checks. Those checks remain FAILED, not waived.
- This new F17 no-deploy CI executes the existing F7/F10/F11/F12/F13/F14/F16 source security suites, F17 release evaluator and full TS typecheck, without altering historical source hashes, workflows or migration SQL. **An authorized review is still needed to reconcile protected historical checks.**

## Track B — Provider/runtime integration

- Meta actual Graph: Riya exact WABA `27861262223494153`, phone `1333595106493545`, CONNECTED/GREEN; Anisha exact WABA `1569174604351612`, phone `1088396637681784`, CONNECTED/RED. Both identities independently authorized by their specific read-only tokens. F16 permits a tightly constrained RED Staging canary, not unrestricted sending or Meta quota bypass.
- **Critical Riya callback:** Meta client WABA subscribed-app override observed `https://quickfurno.in/api/webhooks/whatsapp/meta`. This is a non-Staging origin, so **do not edit it** without checking existing live traffic. Vendor's subscribed app exists, but no effective callback URL is exposed in the connected Meta API; app dashboard registration is **not independently proven**.
- Supabase Staging Authentication → Hooks → Send SMS registered URL and Enabled status **not exposed by the connected Supabase tools**; a direct GET `405` to the Staging Core route does **not** verify Auth Hook registration or signed messages.
- VPS actual Core is still image `qf-core-staging:09b9d7a4`, default sender stale vendor WABA + Anisha phone; no isolated vendor token/WABA/phone env, Meta App signing and verification secrets, or `SEND_SMS_HOOK_SECRETS`. **Do not hot-edit this old deployed image or activate delivery.**
- **Credential handling incident:** During one F17 names-only runtime inspection, shell quoting unexpectedly emitted the values of the Staging Supabase service-role credential and existing WhatsApp access token in the diagnostic execution output. Neither value was committed or added to this document, but both must be treated as exposed to operational logs: **rotate and revoke/invalidates old tokens using a planned secure cutover before deployment.** Avoid displaying the old values or repeating that command. Treat this as a new P0 release blocker.

## Track C — real recovery + staging candidate

- Existing VPS old Core image archived at `/root/qf-rollbacks/f15-staging-hold-20261107/core-staging-09b9d7a4.tar`, **743,237,632 bytes**, SHA256 `c82cfbb9853b08ac96321bd67790877d34703497c042146419c62b946020294c`. Compose snapshot SHA256 `f1da02994c5103442942e439d4207e018449638fca2964b88838dc136c517f12`; protected runtime.env snapshot SHA256 `09fcf469236acdb19b813590b729af7ecec42935bc44a26fd3f6ff3822a23dfa`. Root-only permissions; archive verified readable. **This is a genuine old-runtime rollback bundle**, not proof of managed database/Storage recovery.
- JARVIS F15 offline, `--network none` logical restore of Nov 5 Staging database dump and 10 subsequent SQL migrations passed, with six private tables RLS, no anonymous/authenticated access and all provider accounts dormant. **Not current managed DB/Auth/Storage object-byte backup**. The current database lists exactly 10 expected migration versions; neither full exact content/checksum parity nor PITR has yet been certified.
- Public HTTPS GET-only Core boundary still: `/livez` 200, Meta webhook 403 without challenge, Supabase Send SMS hook 405 on GET, new VOX Owner readiness 404 on old image. TLS verified, no redirects. **Not signed E2E proof.**
- Local Docker image from F14 archived on JARVIS. F17 exact-head candidate must be rebuilt and verified after F17 CI; do not assert signed or deployed before evidence.

## Mandatory GO gates before Staging image change

1. Rotate exposed Staging Supabase service-role key and the old Meta WhatsApp token securely; prove old versions revoked, update encrypted secret store and server env only in coordinated deployment.
2. Reconcile original protected F1/F5/F6/F7 failures by reviewed integrated release policy, no disabling or silent CI waiver; pin reviewed source SHA and exact Docker digest/signature.
3. Verify Staging Supabase Send SMS Auth Hook **exact URL/enabled state** and matching signing secret; verify vendor Meta app actual callback URI; preserve separate client Riya production callback and vendor account isolation.
4. Prove fresh managed Staging DB/Auth/Storage backup, object bytes/restore drill, and exact ten SQL migration source parity. Preserve old Core image+Compose+runtime-env rollback with clear owner operator.
5. Staging-only code deployment can be approved **with outbound/signed callbacks/OTP canary OFF** only after release reviews and backup; do not send or process provider callbacks prematurely. Require separate consented test recipient, signed receipt and explicit 15-minute F16 canary owner GO later.
6. ClamAV upgrade intentionally deferred; scan-dependent vendor approval, lead assignments, lead-credit consumption must continue to fail closed. Production never changed without its own release.

**F17 evidence evaluator is deliberately NO DEPLOY:** unlike a test fixture it never issues GO or external actions, even if its facts are all marked true. No actual Staging deployment under this draft while blockers remain.
