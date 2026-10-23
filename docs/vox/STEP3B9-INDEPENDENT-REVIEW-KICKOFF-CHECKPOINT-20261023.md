# QuickFurno VOX — Phase 3B-9 A/B/C independent review and Owner approval kickoff

**Status:** Reviewer packets prepared; **human independent review and Owner Staging signature NOT COMPLETED**. All managed Staging, real Auth and Production releases remain HOLD.

## Source baseline
Previous exact-source CI-certified review batch: [draft PR #403](https://github.com/quickfurno-maker/quickfurno-marketplace/pull/403), commit `e52a30553225628a0f611933a313ab0337f92f62`; 7/7 GitHub workflows passed. This 3B-9 isolated branch adds only review evidence, a human authorization request and fail-closed source QA. The **final new immutable commit and CI** must be verified separately, and the new Owner form's exact SHA is deliberately blank rather than fabricated.

## 3B-9A — Independent DBA (pending reviewer engagement)
- `docs/vox/STEP3B9-DBA-INDEPENDENT-REVIEW-REQUEST-20261023.md`: scope, evidence and required human decision.
- `ops/vox/certification/STEP3B9-INDEPENDENT-REVIEW-HANDOFF-20261023.json`: individually mapped **104 unresolved migration rows**, with **72** showing no identified runnable SQL source in current repository and **32** with identifiable source. All per-item reviewers and independent signatures remain null.
- Global role/ACL and physical storage/Auth restoration, PITR, actual production compatibility and rollback are not certified. No source repo diff proves data safety.

## 3B-9B — Independent AppSec (pending reviewer engagement)
- `docs/vox/STEP3B9-APPSEC-INDEPENDENT-REVIEW-REQUEST-20261023.md`: independent test and decision requirements for **69 policies**; 37 write/ALL and 32 read policies. 59 admin, 22 vendor helper references and overlap of 12.
- Fresh managed Staging SELECT-only function-definition check: `public.is_admin()` omits inactive Admin guard and `public.owns_vendor(uuid)` omits suspended vendor guard, both SECURITY DEFINER. Review global compositional RLS, permissions, historical invoice/dispute read versus disallowed new work, JWT invalidation and tenant isolation before proposing managed policy change.
- Every effective Postgres proof and AppSec signature remains null; no SQL modified.

## 3B-9C — Owner Staging-only authorization (template prepared, no signature)
- `docs/vox/STEP3B9-OWNER-STAGING-AUTHORIZATION-REQUEST-20261023.md`: exact SHA, image digests, reviewed SQL digest, completed backup and independent signed approvals required before Owner can grant single Staging release.
- Real Owner MFA enrollment, initial scoped Team Leader setup, Production GO, public DNS and payments/outbound are **not authorized**. Do not ask Owner for TOTP, keys or passwords in Notion, GitHub or chat.

## Live read-only observation, 23-Oct-2026
QuickFurno Staging Supabase project `uckafzuochmbvtiodmcl` ACTIVE_HEALTHY, PostgreSQL 17.6; migrations **86**, public VOX tables **0**, public Finance V2 tables **0**, verified auth.mfa_factors **0**. No write performed. Most recent Core VOX overview probe HTTP **404**, public VOX still not an operational deployment.

## Continuous QA / release evidence
Generated reviewer packet with `node scripts/scale/step3b9-review-handoff.mjs`. Added independent review negative tests and release-HOLD audit guard; workflow `.github/workflows/finance-v2-pay3-hold.yml` now runs those steps on pull requests. Local Step3B9 tamper test **6/6 PASS**, new source HOLD checks **19/19 PASS**, inherited Step3B8 HOLD **22/22 PASS**. VOX 512/512 PASS, Finance 88/88 PASS, Owner 31/31 PASS, Web npm test exit 0, Web typecheck exit 0; Core typecheck exit 0 (verified). These source tests are not a substitute for human signed DBA/AppSec and actual Auth-enabled Staging.

## Required release exit conditions
1. DBA named independent reviewer supplies complete signed decisions, restore/ACL/PITR and exact runnable historical SQL provenance for 104 items.
2. AppSec named independent reviewer signs per-policy effective positive/negative SQL decisions for 69 items; resolves inactive Admin, suspended vendor and historical read model.
3. Final exact immutable SHA and images, verified current backup, full approval dossier and Staging-only written Owner approval completed through approved identity process.
4. **Only then** managed Staging migration and versioned Core/VOX/Jarvis/AGNI deploy, genuine Owner AAL2, scoped first Team Leader and authenticated E2E; separate Production GO later.

**Verdict: source-level review kickoff in progress, managed activation HOLD.**
