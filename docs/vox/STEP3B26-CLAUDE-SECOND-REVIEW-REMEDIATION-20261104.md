# 3B26 — Read-only Claude second AI review and verified remediation

**Date:** 4 November 2026
**Release decision:** **HOLD** — this is a technical peer AI assessment, not a qualified independent DBA/AppSec approval, managed Supabase recovery certificate, or permission to delete protected live history.

## Provenance

On authorized JARVIS, `claude` (Claude Code 2.1.312) ran in **read-only review mode**, `--allowedTools Read Glob Grep --permission-mode plan`, against exactly eight pre-existing versioned cleanup/release-control files on the Draft PR #414 branch. It was directed not to read private SQL archives/secrets, connect to managed databases, write code, self-sign, or approve live deletion. Its response explicitly concluded **HOLD** and granted no qualified reviewer status.

Review findings and our independent verification:

| Claude observation | Verified result / disposition |
| --- | --- |
| Signed reviewer envelope does not hash the exact executable procedure | **Confirmed; fixed in source.** An exact `procedureSha256` is required and must match the independently supplied hash of actual managed execution bytes at check time, not only the claim in the signed envelope. Missing/altered signatures or artifact drift HOLD. |
| Production source SHA pins are incompatible with Staging pins | **Not reproduced; original claim contradicted by an actual successful Production generation/execution** with the same four private byte-for-byte pinned SQL sources containing both environment-specific guarded cases. Existing source pinning remains. |
| No Production freeze verifier | **Confirmed; fixed in source.** Existing pure `checkMaintenanceFreeze` now requires Production project identity, complete separately evidenced Production writer scope and fresh container inventory in addition to the eight common external-stop classes, DB counters and maintenance window; all-green still `executable:false`. |
| Postflight omitted system-internal foreign-key triggers | **Confirmed; fixed in source.** Both Staging and Production offline generators now reject disabled internal constraint triggers as well as user triggers, invalid FK metadata and residual original-UUID references. |
| Scratch DB name guard cannot prove managed-host identity | **Accepted limitation.** The SQL generator remains deliberately non-live-deployable; a separately reviewed managed-specific live procedure and explicit host/project identity verification are still required. |
| Scope is city-based rather than an exact deployment allowlist; evidence attestations are partly self-reported | **Accepted blockers for live release.** The actual private archived root source verifies both sorted-ID MD5 fingerprints and cardinalities, but a future managed procedure must require the independently signed exact-ID allowlist and current fresh readback; external evidence must be independently sourced. |
| Auth, Storage, event custody, cross-schema references and retention remain uncertain | **Unresolved operational release gates.** No raw `auth.users` delete; Auth Admin API, owner exclusion, backups and providers need separately reviewed steps. |

## Regression and genuine offline execution

- **102/102** focused Node source tests PASS. Includes three original-frozen reviewer roles and signed envelope tests, plus new SQL-hash and Production writer-inventory positive and negative tests.
- **8/8** Staging Python and **9/9** Production Python tests PASS. Total **119/119 local source tests PASS**. Tests are non-deploying.
- The same authentic November 3 Production four-schema logical backup was restored again into a fresh isolated Supabase PG17.6 container, `--network none`, **no published ports**, original backup mounted read-only, owners/ACLs preserved, and source database locally cloned.
- Updated private `3B26` SQL from the four original SHA-256 pinned private sources ran as **one atomic transaction, COMMIT exit 0**, with **0 vendors, 0 leads, 0 immutable assignment events**, **10 unchanged Auth users**, **zero disabled internal constraint triggers** and **zero invalid FK metadata**. Prior full ROLLBACK and wrong-database negative rehearsals remain PASS from 3B25.
- Updated SQL private evidence SHA256 `1DD753CA38D454E259B48BD25810D4A5A333D9E1CB24FEB64AB8DF567E7400A3`, new positive COMMIT log SHA256 `9FBD3C3E0901AE1ECD36B8C2A77198F4B0FD36233656A3B311446FDC3369B865`. Both stored on restricted JARVIS Artifacts drive. The disposable container has been removed.

## Exact release gate still not achieved

1. **Qualified independent DBA, AppSec and SRE reviewers** (not Claude, GPT, self-generated keys, owner-only GitHub review or a passed CI workflow) must verify **the actual managed SQL procedure hash**, legally valid one-time immutable history disposition, signed exact UUID allowlist, retention and recovery evidence. Existing [issue #413](https://github.com/quickfurno-maker/quickfurno-marketplace/issues/413) remains OPEN.
2. A **real managed Supabase recovery point** must be examined (Database > Backups or PITR in the relevant project), and if available a safe **restore to a separate project** demonstrated, including roles, RLS, Auth, Storage object bytes, external service configuration and recovery time. The local PG archive/ACL restore is valuable but not a managed backup/PITR recovery certificate. Supabase documentation notes physical backups and PITR must be examined per project; Pro plan alone does not prove a particular point exists.
3. Staging **external** writers remain running: `qf-core-staging` and `qf-vox-20261102-mfa-ui-test`. Jarvis/AGNI/WhatsApp provider, cron and cloud callbacks also need independent writer-scope checks; quiet DB outboxes alone are insufficient.
4. **Staging first:** separately approved review of fresh exact-ID allowlist/fingerprint, real freeze, exact managed transaction, preserved one unrelated canary/two Auth accounts, zero residual scoped references and signed postflight.
5. **Production later and independently:** fresh permitted Production census, real Production write-freeze, new production signed procedure hash, managed rollback, protected unrelated Owner account, 9 dedicated TEST identities through supported Supabase Auth Admin API and provider/archive data retention disposition.

**No live managed Supabase SQL DELETE/DDL/TRUNCATE, Auth deprovision, webhook/provider toggle, VPS container stop or immutable-trigger override was performed in this work.** No final launch certification. Source fixes close some genuine engineering gaps but do not substitute for the outstanding external approvals.
