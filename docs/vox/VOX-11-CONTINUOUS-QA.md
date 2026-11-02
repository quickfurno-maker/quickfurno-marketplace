# VOX-11 continuous QA — source tests, release hold and integration evidence

This branch includes the merged-in **test-only** Core source composition: previously validated VOX-07 Core staff/desk/CRM/studio/atomic grants, plus the restricted Team Leader policy and real Core AOS V2 health reader. **It does not represent a reviewed merge to Core main.**

Local source-adversarial regression runner `scripts/mvp/vox/validate-vox-11-qa.mjs` drives the ten existing Core suites, verifies exact **232/232** totals, checks that all Core routes continue requiring owner/staff remote authorization, checks source feature-gates and ensures the release readiness manifest is **HOLD** until independently demonstrated.

GitHub CI triggers on changes to VOX Core APIs/contracts/migrations/tests, on pushes to the QA branch and (once the workflow is on default branch) daily at 02:17 UTC. Scheduled workflows on GitHub only execute from the default branch: **do not describe the daily job as active before it is merged**. CI also runs full root `npm run typecheck`.

`docs/vox/VOX-11-RELEASE-MANIFEST.json` enumerates live-gate failures honestly: real private Staging backup and migrations, MFA enrollment, positive ABAC/IDOR browser to Core, approved CRM/WhatsApp mutation flow, durable Jarvis replay, signed AGNI read, signed private VOX image, WAF/origin/rate, soak and rollback all remain NOT CERTIFIED. The source QA gate refuses any attempted switch to READY based only on code-level evidence.

Previously, the four Core staff DDL migrations passed disposable PostgreSQL 16/17 and synthetic adversarial cases, and the restricted Team Leader fifth migration passed synthetic PostgreSQL 17. **Those tests never altered Supabase Staging.** This PR does not apply migrations or access user credentials.

Security review and a separate verified Staging release are mandatory before enabling a staff API or `vox.quickfurno.in`. Native provider sends, vendor balance, KYC, acquisition conversion, agent writes and AOS/AGNI actions are NOT certified by this QA job.
