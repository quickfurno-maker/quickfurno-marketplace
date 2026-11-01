# VOX RC38 managed Staging pre-deployment gate (READ-ONLY)

Gate: `scripts/mvp/vox/rc38-staging-predeploy-gate.mjs`. Tests: `node --test scripts/mvp/vox/rc38-staging-predeploy-gate.test.mjs`.

Managed Staging (`uckafzuochmbvtiodmcl`) stays on **HOLD** until this gate exits `0`. The gate opens no DB
connection, runs no git or SQL, writes no file, and mints no approval. A deploy step must run it and abort on any
non-zero exit.

## Run

```
node scripts/mvp/vox/rc38-staging-predeploy-gate.mjs \
  --evidence <evidence.json> --head-sha "$(git rev-parse HEAD)" --now "$(date -u +%FT%TZ)"
```

Optional: `--source-dir` (default `supabase/migrations`), `--drift` (default
`docs/vox/VOX-MANAGED-STAGING-MIGRATION-DRIFT-READONLY-20261031.json`).

Exit codes: `0` PASS (all checks green), `2` HOLD (see `blockers[]`), `1` bad usage. Output is deterministic JSON
(`decision`, `deployAuthorized`, `checks[]`, `blockers[{check,code,subject,detail}]`, `bindingSha256`,
`reportSha256`). Secret-looking values are rejected and never echoed.

## What it checks (all must pass)

| Check | Fails closed on |
| --- | --- |
| `EVIDENCE_HYGIENE` | wrong schema, secrets, placeholder values (`TODO`, `TBD`, `fixture`, ...) |
| `EXACT_SHA` | `release.candidateSha` != `--head-sha`; target not Staging ref / `environment` != `staging` |
| `MIGRATION_DIGESTS_AND_ALIASES` | drift inventory not exactly 31 managed-only / 107 source-only; any of the 107 source-only SQL files missing, undigested, or digest != canonical SQL bytes; any of the 31 managed-only versions without a DBA alias (`ALIAS_GAP`) or alias whose source digest != disk |
| `ROLLBACK_AND_RECOVERY` | re-runs the real `rc38-migration-staged-dryrun.mjs` from the reviewed managed ledger export; holds unless planStatus is ready, full rollback returns to base, every failure injection leaves prior state |
| `RESTORE_PROOFS` | Backup, Auth, Vault, or Storage proof missing/not PASS/not isolated/stale (>30d)/wrong project/counts source != restored/integrity flag false |
| `INDEPENDENT_SIGNED_APPROVALS` | missing DBA, AppSec, or Owner Staging GO; approvers not three distinct principals or one is a declared author; no real AAL2 (`aal=aal2` and `amr` has totp/webauthn/phone, unexpired session); unsigned; older than 72h; SHA or `bindingSha256` mismatch |

## Evidence file (`schema: qf.vox.rc38.staging-predeploy-gate.v1.evidence`)

```
authors: [principalId...]                       # who built the candidate (independence)
release: {candidateSha, targetProjectRef, environment:"staging"}
migration: {
  sourceDigests: {"<source-only file>": "<canonical sha256>"}   # all 107
  aliases: [{managedVersion, sourceFile, sourceSha256, managedStatementsSha256, attestedBy}]  # all 31
  dryRun: {managedLedger, sourceDir, aliases, rollbacks, expectedPlanSha256?}  # paths relative to evidence file
}
restore: {backup|auth|vault|storage: {result:"PASS", projectRef, isolatedRestore:true, evidenceSha256,
  verifiedBy, restoredAt, counts:{<name>:{source,restored}}, <integrity flag>:true}}
approvals: {dba|appsec|owner: {role, decision (APPROVE|APPROVE|GO), principalId, aal:"aal2", amr, sessionExpiresAt,
  signedAt, signatureSha256, signatureRef, candidateSha, bindingSha256, scope:"VOX_MANAGED_STAGING" (owner)}}
```

Required counts/flags: backup `tables,rows,pitrOrSnapshotRestored,backupId`; auth `users,identities,mfaFactors,
mfaFactorsUsable`; vault `secrets,decryptSampleOk`; storage `buckets,objects,checksumSampleMatch`. Record counts
and booleans only, never secrets, tokens, or user data.

## Procedure

1. Produce evidence **without** `approvals` and run the gate; it prints `bindingSha256` (SHA + project + drift
   inventory + all SQL/alias digests + restore proof digests). Approvers independently review that exact binding.
2. DBA and AppSec each sign off, then Owner records the Staging GO, all under real AAL2, and each records
   `bindingSha256`. Any later change to evidence changes the binding and invalidates every approval.
3. Re-run the gate immediately before the deploy window; deploy only on exit `0`.

## Limits (be honest in review)

The gate cannot prove that a signature, AAL2 session, or restore test is genuine; it only enforces structure,
binding, freshness, and independence. `signatureRef` must point at an externally verifiable record that a human
checks. The gate output is an input to the deploy step, not a substitute for the independent DBA/AppSec/Owner decision.
