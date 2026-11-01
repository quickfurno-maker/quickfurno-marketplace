# VOX RC38 Staging pre-deployment gate (offline, fail-closed)

`scripts/mvp/vox/rc38-staging-predeploy-gate.mjs` turns the RC38 staged dry-run into an executable
readiness gate. It reads local files only. It opens no connection, runs no SQL, reads no environment or
secrets, touches no payment path and **never deploys** (`deploys:false` in every output). Approval is a
readiness verdict for a human to act on.

## Verdicts and exit codes

| Verdict | Exit | Meaning |
|---|---|---|
| `APPROVED_FOR_STAGING_PREDEPLOY` | 0 | every check below passed, `blockedReasons` is empty |
| `NO_GO_BLOCKED` | 2 | JSON with `blockedReasons[]` and `externalInputsRequired[]` |
| (usage/I-O error) | 1 | bad or forbidden flag, unreadable file, `--out` exists / not `.json` / under `supabase`,`ops`,`contracts`,`db` |

Each blocked reason is `{code, subject, detail, requiredExternalInput}`. All failures are collected (no
short-circuit), so one run lists everything outstanding.

## What must be true for approval

1. **RC38 plan ready.** The plan is recomputed (`buildStagedDryRun`) from `--managed`, `--source-dir`,
   `--aliases`, `--rollbacks`. It must be `CANDIDATE_READY_FOR_INDEPENDENT_DBA_DECISION` with zero blocked
   reasons, a consistent state chain and a full reviewed rollback back to base. RC38 blockers are surfaced as
   `PLAN_BLOCKER_*`.
2. **Correct SHA.** `--expected-sha` (40-hex) must equal the worktree HEAD. HEAD is read from `.git` files,
   not from a flag (`--head-sha` is a forbidden flag). Limitation: a dirty working tree is not detected
   offline. Review `git status` before signing.
3. **Migration digests.** `--migration-digests` (`qf.vox.rc38.migration-digests.v1`,
   `{migrations:[{version,forwardSha256,rollbackSha256}]}`, produced by the independent DBA) must equal the
   recomputed forward/rollback digests exactly. Drift gives `MIGRATION_DIGEST_NOT_ATTESTED` or
   `MIGRATION_DIGEST_UNEXPECTED`.
4. **Auth / Vault / Storage recovery.** `--recovery` (`qf.vox.rc38.recovery-evidence.v1`) needs, for each of
   `components.auth|vault|storage`: `projectRef` equal to the pinned Staging ref; `capturedAt` and
   `backup.takenAt` within 72h; `readOnly:true`; backup artifacts with sha256 and bytes; an executed restore
   drill into an isolated project (not Staging, Production or Jarvis) with no errors and
   `sourceDigest == restoredDigest`. Extra, per component:
   - vault: `keyRecoveryVerified:true`, `secretValuesIncluded:false`
   - storage: equal `objectManifestSourceSha256` / `objectManifestRestoredSha256`
   - auth: `usersRowsExported:false` (catalog digests only)
   Evidence is digests only. Secret-shaped content in an input gives `SECRET_IN_INPUT`.
5. **Independent signed approvals.** `--approvals` (`qf.vox.rc38.predeploy-approvals.v1`) must hold exactly
   one valid Ed25519 approval per role: `dba` (`APPROVE`), `appsec` (`APPROVE`), `owner` (`GO`).
   - Public keys come from `--trusted-keys` (`qf.vox.rc38.trusted-approver-keys.v1`, ed25519 public PEM,
     role- and reviewer-bound). The registry's sha256 must be pinned out-of-band via `--trusted-keys-sha256`.
     Without a matching pin nothing verifies.
   - The signed message is `qf.vox.rc38.predeploy-approval.v1\n` + canonical JSON of
     `{role,reviewerId,keyId,decision,issuedAt,expiresAt,bindingSha256}` (`approvalMessage` in the module).
   - `bindingSha256` covers expected sha, head sha, plan sha, evidence package sha, migration digests and the
     whole recovery document. Changing any of them invalidates every approval. The gate prints the binding in
     every run, even a blocked one.
   - Rejected: unknown or untrusted key, key/role/reviewer mismatch, wrong decision, forged signature, expired,
     future-dated, validity over 72h, issued before the evidence was captured, duplicate role, one reviewer or
     key covering two roles, and any reviewer listed in `--operators` or equal to `recovery.capturedBy`
     (self-approval).

## Usage

```
node scripts/mvp/vox/rc38-staging-predeploy-gate.mjs \
  --managed <ledger.json> --source-dir <dir> [--aliases f] --rollbacks f --expected-sha <40hex> \
  --migration-digests f --recovery f --approvals f \
  --trusted-keys f --trusted-keys-sha256 <64hex> --operators id1,id2 [--out gate.json]
```

Workflow: run once without `--approvals` to get `bindingSha256` and the blocked list; each reviewer reviews
independently and signs the binding with their own key; re-run with `--approvals`. A real DBA/AppSec/Owner
signature is required: this tool cannot create approvals, and tests use throwaway in-memory keys only.

## Tests

`node --test scripts/mvp/vox/rc38-staging-predeploy-gate.test.mjs` (22 tests): happy path, empty input,
each plan/SHA/digest/recovery failure per component, each approval failure mode, independence,
key-registry pinning, secret refusal, offline source guard, CLI exit codes and `--out` no-overwrite, local HEAD
resolution.

## Not covered

The tool trusts the recovery evidence as supplied (it cannot prove a restore happened) and trusts the pinned
key registry. Both rest on the humans who produce them. It does not check a clean working tree, run CI, or
deploy.
