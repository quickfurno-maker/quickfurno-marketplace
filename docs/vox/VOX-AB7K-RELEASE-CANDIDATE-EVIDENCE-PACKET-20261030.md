# VOX AB-7K — Release candidate security/recovery evidence packet (30 Oct 2026)

## Operator verification update — 30 Oct 2026 (after authoring)

- Executed `node --test scripts/mvp/vox/ab7k-readonly-evidence.test.mjs`: **10/10 PASS**, 0 failures.
- Ran disposable `--network none` PostgreSQL 17 recovery harness: **all 30 historical SQL files installed**, but **full-fidelity raw security catalog comparison FAILED (exit 3)**. This is a real unresolved discrepancy, not a certified recovery. No managed database was accessed or changed.
- Exact differing catalog paths: `$.relations.vox_ab7j_staff_suspend_intents_candidate_v1.acl` and `.acl_is_default` (source has explicit postgres owner-only ACL; restored has null/default ACL), plus `$.relations.vox_staff_team_messages_candidate_v1.constraints` (PostgreSQL deparser rearranged redundant parentheses). The effective non-owner privileges and constraints require separate semantic comparison and qualified DBA adjudication; never silently whitelist these paths.
- The deliberately lossy `--no-owner --no-acl` restore also differs materially. Artifacts and checksums exist only in the JARVIS disposable evidence directory `C:\\Users\\KESHAV SHARMA\\AppData\\Local\\Temp\\ab7k-evidence-4055b9aeaa844174b48af259cd17b4e6` (operator machine, **not** an authorized managed backup).
- This report's original sections below describe the unexecuted authored state. The operator verification above supersedes their test-status assertions only. **Release remains HOLD.**

## Status: **HOLD** — issue #444 is **NOT resolved**

| Item | State |
|---|---|
| Source (30 SQL files, 7+23, order, bytes) | Pinned (`VOX-AB7K-REVIEWED-SOURCE-FINGERPRINT.json`, digest `8e85cd55…bacb7`); unchanged by this packet |
| Managed Staging restoration | **BLOCKED** (no current managed backup bytes + ACL + role dump restore-tested by a qualified DBA) |
| Managed Staging catalog/ACL/RLS/EXECUTE snapshot | **NOT COLLECTED** — tooling delivered, operator must run it |
| Required consent relation | **BLOCKER** — see below |
| Real AAL2 (Owner / first Team Leader) | **NOT PROVIDED** (18 Oct read: 0 verified MFA factors; nothing newer is recorded here) |
| PITR evidence | **NOT PROVIDED** |
| Ed25519 attestation | **NOT PROVIDED** |
| Independent DBA sign-off | **NOT PROVIDED** |
| Independent AppSec sign-off | **NOT PROVIDED** |

Nothing in this packet was executed against any database, and the author ran no scripts or tests. Everything under "Delivered" is **authored, unexecuted**. No restore PASS, AAL2, PITR or Ed25519 claim is made anywhere here.

## What this packet found by reading source (no execution)

1. **Missing consent relation.** `ops/vox/sql-candidates/20261018020000_vox_ab7b_nonwork_native_source_candidate.sql:57-61` makes the `CORE_CONVERSATION` insert guard require a row in `public.vox_ab7b_current_consent_candidate_v1` (`status='ALLOWED'`, `current_revision>=1`, `revoked_at is null`). **None of the 30 files creates this relation.** Only test fixtures (`validate-voxAB7B-*.ps1`) create it, as a synthetic *table*. `VOX-AB7C-FINAL-CONVERSATION-PAUSE-HOLD-20261018.md` already says it is not consent truth.
   - Why the earlier "30/30 PASS" cannot cover it: a PL/pgSQL body is not resolved at `CREATE` time, so the 30 files install cleanly without the relation. `validate-voxAB7K-full-schema-pg17.ps1` never exercises the guard.
   - Effect if deployed as-is: at runtime the guard raises "relation does not exist", so `CORE_CONVERSATION` source writes fail. This is fail-closed but leaves the path inoperable. If someone later "fixes" it with a plain table, consent becomes self-asserted. Either needs a DBA/AppSec decision, and **no SQL was changed here**.
   - The seed in the full-schema validator creates `communication_preferences`, `communication_suppressions`, `communication_consent_events` as `id`-only stubs. No VOX SQL references them, so they prove nothing about consent.
2. **Existing PASS used no Supabase-style default privileges.** The synthetic cluster grants nothing by default, so "0 anon/authenticated DML" is easier to satisfy than on Supabase, where `public` objects default-grant to `anon`/`authenticated`/`service_role`. The new harness enables that by default (`-NoSupabaseDefaultPrivileges` reproduces the old baseline). **A FAIL there is a real finding to triage, not a harness bug.**
3. **The 27 Oct backup cannot certify this release.** Per the task statement it is a 5-schema logical dump restored with `--no-owner --no-acl`. That method drops owners, ACLs and default privileges, which are the exact properties under review. I found no 27 Oct restore document in this tree (`docs/vox/VOX-REAL-STAGING-FIVE-SCHEMA-RESTORE-20261029.md` does not exist here), so those facts are **unverified by me**. The harness quantifies the effect on a synthetic fixture only.
4. **Migration lineage is unresolved** (31 Staging-only IDs, 107 repo-only IDs; 18 Oct). Counts may have drifted; the evaluator reports ledger drift as REVIEW.

## Delivered (all new; no candidate SQL or app code touched)

| File | Purpose |
|---|---|
| `scripts/mvp/vox/ab7k-evidence-lib.mjs` | Pure library: project-identity binding, 7+23 hash/order check, static dependency scan, read-only SQL builder, evaluator |
| `scripts/mvp/vox/ab7k-readonly-evidence.mjs` | CLI (`manifest`, `deps`, `sql`, `identity`, `digest`, `compare`, `evaluate`). Never connects, never reads credentials |
| `scripts/mvp/vox/invoke-ab7k-readonly-snapshot.ps1` | Operator wrapper: validates endpoint/ref **before connecting**, runs only `BEGIN READ ONLY … ROLLBACK`, writes SHA-256 sums |
| `scripts/mvp/vox/validate-voxAB7K-recovery-harness-pg17.ps1` | Disposable `--network none` PG17: install 30 → full-fidelity dump+roles → restore → compare security catalog; also shows `--no-owner --no-acl` effect |
| `scripts/mvp/vox/ab7k-readonly-evidence.test.mjs` | Node tests for the above (authored, not run) |

Snapshot content (deterministic: `collate "C"` ordering, no OIDs, identity excluded from the restore digest): roles and memberships; `public` USAGE/CREATE; `pg_default_acl`; per relation: owner, RLS, **FORCE RLS**, raw ACL, **effective** privileges for `anon`/`authenticated`/`service_role`, columns, column ACLs, constraints, policies, triggers, indexes, view definitions; per function: owner, SECURITY DEFINER, `search_path` config, body md5, ACL, `public_execute`, and **EXECUTE for anon/authenticated/service_role**; presence of Core consent relations and the missing consent relation.

Evaluator verdicts are only `FAIL` or `HOLD`. `goEligible` is hard-coded `false`; the tool cannot emit GO.

## How to run (author did not run any of this)

Repo root, any shell with Node:
```powershell
node --test scripts/mvp/vox/ab7k-readonly-evidence.test.mjs scripts/mvp/vox/validate-voxAB7K-manifest.test.mjs
node scripts/mvp/vox/ab7k-readonly-evidence.mjs manifest
node scripts/mvp/vox/ab7k-readonly-evidence.mjs deps        # confirms the consent relation finding
```
Local disposable recovery harness (Docker, no network; touches only its own containers):
```powershell
.\scripts\mvp\vox\validate-voxAB7K-recovery-harness-pg17.ps1
# optional old-baseline comparison:
.\scripts\mvp\vox\validate-voxAB7K-recovery-harness-pg17.ps1 -NoSupabaseDefaultPrivileges
```
Exit codes: `0` parity + HOLD, `2` security invariant FAIL, `3` full-fidelity restore catalog mismatch. Expected even on success: consent checks stay `BLOCKED`, so the evaluator reports HOLD.

If any test fails, treat it as a defect in this packet. Do not edit expectations to match without review (the `deps` regex scan is a heuristic).

## Managed restoration: BLOCKED — exact operator checklist

Run by an authorized operator in **their own** session. Never paste credentials into files or chat; set them interactively. These commands only read Staging.

1. **Fresh read-only snapshot** (rejects any host/ref other than `uckafzuochmbvtiodmcl` before connecting):
   ```powershell
   $env:PGHOST  = '<db.uckafzuochmbvtiodmcl.supabase.co | pooler host>'
   $env:PGUSER  = '<postgres | postgres.uckafzuochmbvtiodmcl for pooler>'
   $env:PGPASSWORD = Read-Host -MaskInput 'staging db password'   # session only
   $env:PGSSLMODE = 'verify-full'
   .\scripts\mvp\vox\invoke-ab7k-readonly-snapshot.ps1 -ProjectRef uckafzuochmbvtiodmcl -OutDir D:\evidence\ab7k-staging-<UTC-stamp>
   ```
   Expect `PROJECT_IDENTITY_ENDPOINT PASS`, `STAGING_ONLY_VERSIONS_PRESENT PASS`, `NO_VOX_RELATIONS_INSTALLED PASS`. Record the Supabase dashboard project ref alongside it; endpoint binding is necessary but not cryptographic proof of identity.
2. **Full-fidelity logical backup** (do **not** pass `--no-owner` or `--no-acl`; include every schema the DBA lists as in scope, not only five):
   ```powershell
   pg_dump --format=custom --schema=public --schema=auth --schema=supabase_migrations --file D:\evidence\ab7k-staging-<stamp>\staging-full.dump
   supabase db dump --db-url $env:STAGING_DB_URL --role-only -f D:\evidence\ab7k-staging-<stamp>\roles.sql   # confirm flags with `supabase db dump --help`
   Get-FileHash -Algorithm SHA256 D:\evidence\ab7k-staging-<stamp>\* | Format-Table Hash,Path
   ```
   `$env:STAGING_DB_URL` is operator-supplied, session-only. Managed Supabase may block `pg_dumpall` and some owners (`supabase_admin`); the DBA must document any schema or ACL that cannot be captured. Do not claim PITR from this step.
3. **Write `backup-manifest.json`** with: `project_ref`, `taken_at` (UTC ISO), `schemas`, `includes_owner`, `includes_acl`, `includes_roles` (all must truthfully be `true`), and `artifacts[] = {name, sha256, bytes}`. Re-run step 1 with `-BackupManifest <path>`. A complete manifest yields only `REVIEW`; it never yields PASS.
4. **Restore-test on a disposable local PG17** (never on Supabase):
   ```powershell
   docker run --rm --network none -d --name qf-staging-restore-check -e POSTGRES_PASSWORD=<throwaway> postgres:17-alpine
   Get-Content roles.sql | docker exec -i qf-staging-restore-check psql -X -U postgres -d postgres   # DBA reviews any role errors
   docker cp staging-full.dump qf-staging-restore-check:/tmp/s.dump
   docker exec qf-staging-restore-check createdb -U postgres -T template0 ab7k_restore
   docker exec qf-staging-restore-check pg_restore -U postgres -d ab7k_restore --exit-on-error /tmp/s.dump
   node scripts/mvp/vox/ab7k-readonly-evidence.mjs sql --part catalog | docker exec -i qf-staging-restore-check psql -X -q -A -t -U postgres -d ab7k_restore -v ON_ERROR_STOP=1 > restored.snapshot.json
   node scripts/mvp/vox/ab7k-readonly-evidence.mjs compare --a snapshot.json --b restored.snapshot.json
   docker rm -f qf-staging-restore-check
   ```
   The DBA adjudicates every differing path (Supabase-managed roles legitimately differ locally). Unexplained differences keep restoration BLOCKED.
5. Attach: snapshot, ledger, report, `SHA256SUMS.txt`, backup manifest, restore compare output, plus the DBA's written reconciliation of the 31/107 version sets (Gate G1).

## Objective GO / HOLD criteria

GO requires **all** of the following. Today the answer is **HOLD**.

| # | Criterion | Today |
|---|---|---|
| 1 | Manifest check PASS (7+23, order, bytes = pinned fingerprint) at the release commit | Verifiable offline; rerun |
| 2 | Managed snapshot evaluator: **no FAIL**; identity/ledger PASS; zero unreviewed `REVIEW` | Not collected |
| 3 | `vox_ab7b_current_consent_candidate_v1` resolved: a reviewed object derived from genuine Core consent/suppression, installed and exercised end to end | **Open (BLOCKER)** |
| 4 | Full-fidelity managed backup (owners, ACLs, roles) restore-tested by DBA with explained compare | **BLOCKED** |
| 5 | Local harness exit `0` with default privileges on; any FAIL triaged | Not run |
| 6 | Migration lineage reconciliation (Gate G1) signed | Not provided |
| 7 | Real AAL2 for Owner and first TL; PITR evidence if claimed; Ed25519 attestation if claimed | **Not provided** |
| 8 | Independent DBA and AppSec signatures (independent of Owner) | **Not provided** |

## What qualified signers would attest

**DBA** — "I personally verified that: (a) the snapshot/report hashes listed were taken read-only from project `uckafzuochmbvtiodmcl`; (b) the 86+ applied versions were mapped by SQL semantics to the repo, with disposition of every Staging-only and repo-only ID; (c) every Core relation and column the 30 files depend on exists with compatible types, including the consent source; (d) the backup artifacts, with SHA-256s listed, contain owners, ACLs, default privileges and roles, and a disposable restore reproduced the catalog except for these explained differences: …; (e) the exact forward SQL and rollback plan for only the missing VOX objects."

**AppSec** — "I reviewed the 30 files at digest `8e85cd55…bacb7`: every SECURITY DEFINER function has a pinned `search_path`; no `PUBLIC`/`anon` EXECUTE or table privilege; authenticated EXECUTE is limited to the listed RPCs; every VOX table has ENABLE+FORCE RLS; the consent guard reads genuine consent truth; two-person suspension and TL review enforce current AAL2 and membership; and no bootstrap bypass exists."

Neither statement may be signed from this document alone. They need the executed evidence above.

## Known limits of the tooling

- Dependency scan is a regex heuristic; it detects missing relations, not semantic or column compatibility. PL/pgSQL bodies are not semantically analyzed (only hashed).
- Presence of a Core relation is `REVIEW` at best; column-level parity is left to the DBA using the captured column lists.
- Endpoint/ref binding blocks wrong projects but does not cryptographically prove project identity.
- The harness uses a synthetic Core fixture parsed from the existing validator; it is not Staging.
- Local-disposable results are never evidence of managed restoration.
- Project-ref constants duplicate `scripts/mvp/build/stagingBuildGate.mjs`; update both together.
