# F13 — Protected Staging upgrade reconciliation (NO DEPLOY)
**Date:** 6 November 2026. **Owner decision:** finish safe internal work in parallel; DO NOT enable live OTP, ClamAV or Production.
## Actual evidence
- Existing running Core: image `qf-core-staging:09b9d7a4` (Git revision `09b9d7a484c07fdc60009cbde1332dd4834ae3af`).
- Reviewed F12 head: `56aa7959285f4f2b19fbf3e3c90a0fa38bb2ba50`; Git compare: **40 commits ahead**, ~233 changed paths. This is NOT a safe single hot patch.
- Live Supabase project `uckafzuochmbvtiodmcl`: its migration history lists **all 10 exact application migration versions** introduced after running Core (seven Nov 4 + three Nov 6). Registry presence does NOT demonstrate SQL checksum parity, complete storage/Auth recovery, or live endpoint functionality.
- F12 test CI at [run 42254641744](https://github.com/quickfurno-maker/quickfurno-marketplace/actions/runs/42254641744) passed all 19 steps. Historical F1/F5/F6 protected checks remain unresolved despite supplementary F10 tests.
- Traefik Core ingress is `staging-core.quickfurno.in`; Meta GET = 403, Auth Hook GET = 405. Neither proves the URL configured in Meta/Supabase dashboards. The VM runs stale vendor WABA+Anisha phone identity; separate sender environment names are missing.
- Connected Supabase management tool exposes migrations and project health but not the configured Authentication Send SMS Hook URL. Browser context for Meta UI is unavailable in this conversation. Do not guess either URL.
## Parallel delivery lanes
| Lane | Work now | Exit |
| --- | --- | --- |
| A: Protected Git | Review original F1/F5/F6 failures versus F10 pinned source; get explicit integrated release decision, without modifying/disabling historical checks | Original checks fixed or formally resolved under branch protection; exact reviewed release SHA |
| B: Provider control plane | Operator opens Meta App WhatsApp Configuration and Supabase Staging Auth Hooks; records **origin/path, enabled status only** | Both URLs resolve to the intended Core endpoints; no VOX-wide Access bypass |
| C: Image/DB/rollback | Source SHA + image digest + signature and SBOM, ten migration SQL SHA comparisons and post-migration Auth/Storage backup/restore, then inert rollback drill | Versioned immutable Staging candidate and recovery evidence |
| D: Security/E2E | Verify dedicated independent tokens by scoped Graph read, separate WABA/phone sender mapping, signed callback receipts, quality GREEN, Owner-approved device canary | Per-lane signed receipt and Supabase verifyOTP/registration/returning-login proof |
## Deployment preflight and rollback
1. Do not change running `qf-core-staging`. Record current Docker image ID/digest, compose/Traefik, non-secret env **NAMES**, and health/callback HTTP baselines.
2. Complete protected Git source review; do not inherit all 40 commits blindly without reviewing changed SQL, Core routes and VOX/Staff implications.
3. Verify migrations by version and SQL checksum. **No migration reapply** for versions already registered. Reconcile any checksum drift explicitly.
4. Create fresh managed Staging DB/Auth/Storage object-byte backup and test restore. Preserve previous image and config in a rollback manifest before any service change.
5. Verify exact immutable signed image digest, provenance, review approval, and independent credentials. Riya is client default WABA `27861262223494153` phone `1333595106493545`; Anisha is vendor WABA `1569174604351612` phone `1088396637681784`. Never fall back across roles.
6. Only after all formal gates, deploy to **Staging only** with outbound/webhook processing/OTP canary still OFF. No production action.
7. Fail health, signed route verification, unexpected sender identity, cross-role evidence, or rollback drill -> restore previous pinned image/config; no retry/sends as part of rollback.
8. Confirm real Meta and Supabase callback registrations; then signed E2E with invalid-signature denial and account-bound receipts; vendor quality GREEN and explicit approved handset before OTP.
9. ClamAV Owner-deferred: private scan-dependent vendor approval, lead assignment and credit consumption must remain blocked.
## Reproducible offline advisory evaluator
```bash
node scripts/mvp/launch/f13-release-reconciliation.mjs --stdin < docs/launch/qf-f13-release-reconciliation-20261106.json
node --test scripts/mvp/launch/f13-release-reconciliation.test.mjs
```
The F13 machine verdict is **always HOLD**, even if given synthetic all-true JSON. This script is an evidence inventory, not a deployment approval mechanism. No token values, secrets, OTPs, real sends, POSTs, SQL mutations or SSH collectors are included.
