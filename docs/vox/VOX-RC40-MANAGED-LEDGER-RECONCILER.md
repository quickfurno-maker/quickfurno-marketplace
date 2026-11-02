# VOX RC40 managed-ledger reconciler

Offline reconciler between the RC40 source-only digest evidence (107 files,
`docs/vox/VOX-RC40-SOURCE-SQL-DIGESTS-20261101.json`) and an **independently captured** managed-Staging
migration ledger (the 31 managed-only versions, which currently have no applied statements in the repo).

Script: `scripts/mvp/vox/rc40-managed-ledger-reconciler.mjs`
Tests: `scripts/mvp/vox/rc40-managed-ledger-reconciler.test.mjs`

```
node scripts/mvp/vox/rc40-managed-ledger-reconciler.mjs --candidate-sha <40hex> \
  --out <report.json> --missing-out <missing.json> [--evidence <rc40-evidence.json>] \
  [--capture <ledger-capture.json>] [--require-complete]
```

Exit 0 = `RECONCILED_COMPLETE`; 2 = `INCOMPLETE` (report and missing list written); 1 = rejection/usage.
Outputs are created exclusively; a rejected run leaves no file. No DB, network, env, or SQL execution.

## Current state (actual drift)

No managed capture exists in the repo, so a run without `--capture` reports `INCOMPLETE`:
31 managed versions missing, 107 source-only files unmatched. `missing.json`
(`qf.vox.rc40.missing-original-sql.v1`) has exactly one template per missing managed version, with
`statements`, `statementsSha256`, `bytes` and `aliasOf` set to `null`. Nothing is invented.

## Capture input (`qf.vox.rc40.managed-ledger-capture.v1`)

`{schema, candidateSha, capturedBy, captureMethod, readOnly:true, entries:[{version,name,statements[],statementsSha256,bytes,aliasOf?}]}`

- `candidateSha` must equal `--candidate-sha` (pin); `captureMethod` must be one of the allowed read-only exports.
- Statements are rendered (trimmed, `;`-terminated, `\n`-joined) and the reconciler recomputes the canonical
  digest and byte count; a declared value that differs is `CAPTURE_DIGEST_FORGED` / `CAPTURE_BYTES_MISMATCH`.
- **Exact** match: the managed canonical digest equals a source-only canonical digest.
- **Alias** match: `aliasOf:[{file,canonicalSha256}]` names source-only files the managed migration consolidates;
  every file and digest is verified against the evidence.

## Rejections

Forged digest/bytes, duplicate version or digest, unknown version or name mismatch, wrong candidate sha,
non-read-only or unlisted capture method, missing `capturedBy`, secrets, exact-and-alias on one entry,
one source file claimed by two managed entries (`AMBIGUOUS_SOURCE_CLAIM`), alias to a non-source-only or
mis-digested file, captured entry that matches nothing, and tampered/inconsistent source evidence.
Missing captures are not rejections; they are the actionable `INCOMPLETE` state.

## Predeploy gate

`rc38-staging-predeploy-gate.mjs --source-sql-reconciliation <report.json>` is optional. When supplied, an
incomplete, tampered, unsafe-flag or differently pinned report adds `SOURCE_SQL_RECONCILIATION_*` blockers and
its digest is bound into the signed `bindingSha256`. When omitted, gate behavior is unchanged. A complete report
never approves: DBA/AppSec/Owner signatures and recovery evidence are still required.

## Limits

Digests prove byte identity, not that the capture is authentic; independence rests on the DBA/AppSec review
and signatures in the gate. `releaseGo` and `approvalClaimed` are always `false`.

Run tests: `node --test scripts/mvp/vox/rc40-managed-ledger-reconciler.test.mjs`
