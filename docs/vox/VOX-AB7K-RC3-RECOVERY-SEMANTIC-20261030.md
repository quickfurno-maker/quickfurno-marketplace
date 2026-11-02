# VOX AB7K RC3 — Recovery semantic adjudication packet (30 Oct 2026)

## Operator-executed verification, 30 October 2026 — newest release-candidate evidence

- **SOURCE PIN CHANGED intentionally** for one additional UNINSTALLED SQL candidate: `20261016020000_vox08j_staff_team_chat_candidate.sql` writes `length(body)>=1 AND length(body)<=500` rather than semantically equivalent `BETWEEN 1 AND 500`, to eliminate pg_dump/pg_restore parse-tree churn. 30-file 7+23 digest **`3ae02af58c07e256507532b866594486d2785e768fd4092a1b1aa8db572f8f60`**; pin verification PASS. This SQL edit does not grant or enable any role, feature, provider or live migration.
- New isolated Node semantic/negative-control suite: **35/35 PASS** after fixing (a) 8.3 short vs long Windows TEMP path identity with `realpathSync.native`, (b) ACL narrowing test expectation, and (c) creating the complete report. Combined release source tests and Next build separately verified.
- **REAL DISPOSABLE** network-isolated `postgres:17-alpine` on JARVIS: **30/30 SQL migration source files installed**, standalone **identity-attestation overlay verified**; full source dump and roles restored into disposable target. Strict raw comparison remains **`RAW_DIVERGENCE`** at exactly TWO unwaived paths: `vox_ab7j_staff_suspend_intents_candidate_v1.acl` and `.acl_is_default` (explicit owner-only vs default/null). The independent semantic expanded-ACL/privileges/constraints/owner/RLS/function/role/trigger/index comparator reported **`PROVISIONAL_SEMANTIC_PARITY`**, **0 semantic findings, 0 probe expectation failures, both remaining raw ACL paths proven**, but **requiresDbaInterpretation=true**.
- Controlled **negative security mutation** (widen grants, weaken RLS, alter CHECK and permissions) correctly flagged **`SEMANTIC_DIVERGENCE` / 25 semantic findings**, `NEGATIVE_CONTROL=DETECTED`. Deliberate `--no-owner --no-acl` lossy restore still divergent. Evidence artifacts/checksums recorded on JARVIS at `C:\\Users\\KESHAV SHARMA\\AppData\\Local\\Temp\\ab7k-rc3-evidence-6d57fe4a7c984be8a9e2cb82538367a1`. No secret output.
- **EXIT POLICY:** a provisional semantic parity is a nonzero harness gate (4), **not exact byte-identical recovery**, not independent qualified human DBA approval, and **never managed Staging restore certification**. Managed Staging, Production, Auth identities, provider sends and feature flags remained untouched.

The original authoring-time notes below are historical; the executed evidence above supersedes only the original unexecuted test status. The real Owner/Team Leader AAL2, managed backup with owner+ACL+roles, semantic migration ledger and independent DBA/AppSec gates still require human signoff. **Release HOLD / issue #444 OPEN.**

**Status: HOLD / NO-GO / canApply=false.** Source base RC2 `35765ea7` on branch `fix/vox-ab7k-rc3-recovery-semantic-20261030`. Candidate SQL (7 quarantined + 23 candidate files) and the pinned fingerprint are **untouched**.

> **Execution status: NOT EXECUTED.** Every file below was authored in a Read/Edit-only session with no shell, Docker, Node, git, network or database access. No test, harness run, restore or comparison result is claimed here. The only executed evidence is what the RC2 packet already records (30/30 SQL installs, identity overlay SQL verification, and the red raw comparison with three paths).

## Problem being addressed

The RC2 disposable PG17 harness reported exit 3 from the strict full-fidelity raw comparison, with exactly three differing paths:

| Raw path | RC2 observation | Candidate explanation to be **proven or refuted** |
|---|---|---|
| `$.relations.vox_ab7j_staff_suspend_intents_candidate_v1.acl` and `.acl_is_default` | source: explicit owner-only ACL; restored: NULL/default ACL | `pg_dump` does not emit a grant that equals the hard-wired owner default, so `relacl` becomes NULL after `pg_restore`. Equivalent only if the *expanded* effective ACL is identical. |
| `$.relations.vox_staff_team_messages_candidate_v1.constraints` | `pg_get_constraintdef` text differs by redundant parentheses | The dump re-parses and re-deparses the expression. Equivalent only if the parsed expression tree is identical. |

These are hypotheses from reading the source. Until the harness below is run, the status stays **RAW_DIVERGENCE with no interpretation**.

## What RC3 adds

| File | Purpose |
|---|---|
| `scripts/mvp/vox/ab7k-semantic-lib.mjs` | Pure second comparator: semantic catalog SQL, rolled-back behavior-probe SQL, `compareSemantic`, `compareProbes`, `evaluateProbeExpectations`, `adjudicateRecovery`, temp-confined `assertSafeOutFile`. No network, process, or DB access. |
| `scripts/mvp/vox/ab7k-semantic-evidence.mjs` | CLI: `sql`, `probe-sql`, `parse-probes`, `expect-probes`, `compare-semantic`, `adjudicate`. Its only write is `--out`, temp-confined, create-only. |
| `scripts/mvp/vox/validate-voxAB7K-recovery-semantic-pg17.ps1` | Disposable harness: install 30 → dump/roles → restore → strict raw diff → semantic snapshots → SET ROLE behavior probes on **both** databases → adjudication → negative control. |
| `scripts/mvp/vox/ab7k-semantic-evidence.test.mjs` | Node tests (authored, not run). |
| `scripts/mvp/vox/validate-voxAB7K-recovery-harness-pg17.ps1` | **Edited** for safety only (see audit). Strict raw behavior unchanged. |
| `scripts/mvp/vox/ab7k-evidence-lib.mjs`, `ab7k-readonly-evidence.mjs` | Unchanged. The original strict raw diff is reused verbatim (`diffPaths`, with the limit raised in the new CLI so no raw path can be truncated away). |

### Independence of the second comparator

The raw snapshot compares deparsed text and raw `relacl`. The semantic snapshot compares different things, taken by different queries:

- **Effective ACL**: `aclexplode(coalesce(acl, acldefault(type, owner)))` for relations, columns, functions and the `public` schema, including grantor and grant option; plus `has_table_privilege` / `has_function_privilege` (with `WITH GRANT OPTION`) for `anon`, `authenticated`, `service_role`. A NULL ACL is *expanded*, never trusted or ignored.
- **Owner**, ENABLE and FORCE row security, `pg_default_acl` (expanded), role attributes and memberships.
- **Constraints**: type, columns by name, referenced table/columns, FK actions, deferrability, validated flag, backing index, and a digest of the **parse tree** (`conbin`) with only these presentation-only fields removed: `location`, `funcformat`, `relabelformat`, `coerceformat`, `convertformat`, `varnosyn`, `varattnosyn`. Operators, constants, columns and structure are kept, so `500 → 5000` or `<=` → `<` changes the digest. Trees referencing non-built-in OIDs are flagged `EXPR_NONPORTABLE_NEEDS_BEHAVIOR_PROOF` and block parity.
- **Policies** (roles, command, USING/WITH CHECK trees), **triggers** (enabled state, function, events, WHEN tree), **indexes** (method, uniqueness, key columns/opclass/collation/options, expression and predicate trees), column defaults, rewrite rules.
- **Functions**: owner, SECURITY DEFINER, `search_path` config, volatility, body digest, effective ACL, EXECUTE per browser role.

### Behavior proof on both databases

The probe script runs as the bootstrap superuser of the **disposable** cluster, switches with `SET LOCAL ROLE` to non-superuser `anon` / `authenticated` / `service_role`, and always ends with `ROLLBACK`:

- SELECT / INSERT / UPDATE / DELETE / TRUNCATE on both tables per role (outcome class: OK, permission-denied, RLS, other SQLSTATE).
- Constraint probes with `session_replication_role=replica` (FK triggers off, CHECK/UNIQUE/NOT NULL still enforced): body 500 vs 501 chars, empty, NULL, leading/trailing space, TAB, newline, DEL, duplicate nonce; AB7J distinct-approver rule in all three pairings, digest length 63/65, uppercase, non-hex, NULL.
- Append-only trigger probes (UPDATE/DELETE blocked) under `origin` mode.
- EXECUTE probes: every `vox` function called with NULL arguments as each browser role; only the permission-denied outcome is classified as a denial.

Outcomes are compared across the two databases **and** checked against expectations derived from the candidate SQL (`anon`/`authenticated` denied everywhere; `service_role` denied on the AB7J table; `service_role` SELECT on chat works). FK behavior is covered by the structural constraint comparison only, because the probe disables FK triggers to isolate CHECK behavior.

### Verdicts (never GO, never managed recovery)

| Verdict | Meaning | Harness exit |
|---|---|---|
| `EXACT_LOCAL_RAW_PARITY` | raw identical and semantics identical (disposable only) | 0 |
| `candidate-semantic-parity-provisional` | **RAW_DIVERGENCE is preserved**; every divergent raw path is covered by an independent comparison with zero findings; probes identical and meet expectations. DBA interpretation still required. **Not** exact recovery. | 4 |
| `SEMANTIC_DIVERGENCE` | any privilege/constraint/RLS/owner/default-ACL/function/probe difference, or a probe expectation failure | 3 |
| `RAW_DIVERGENCE_UNEXPLAINED` | a raw path with no independent proof (e.g. owner, columns, role attributes) | 3 |
| `INCOMPLETE_EVIDENCE` | semantic snapshot or probes missing | 3 |

There is no allowlist of paths. A raw path counts as proven only when the semantic comparison covered that exact object and category and found nothing.

### Negative control (the comparator must reject real weakening)

After the primary comparison the harness restores a third database from the same dump and applies: `anon` SELECT on the AB7J table; `authenticated` INSERT on chat; NO FORCE RLS on AB7J; an `anon` SELECT policy on chat; dropping `ab7j_distinct_staff_approvers`; replacing the chat body CHECK with `length(body)<=5000`; EXECUTE for `anon` on a VOX function; chat owner changed to `service_role`. The adjudication must return `SEMANTIC_DIVERGENCE`, `securityRegression=true`, and include `ACL_WIDENED, PRIV_WIDENED, RLS_WEAKENED, POLICY_ADDED, CONSTRAINT_REMOVED, CONSTRAINT_EXPR_CHANGED, FUNCTION_EXECUTE_WIDENED, OWNER_CHANGED, PROBE_WIDENED, PROBE_WEAKENED`. Otherwise the harness exits **5** and the comparator is not trusted. The Node tests exercise the same classes on synthetic snapshots.

## Commands (all unexecuted)

Repo root, any shell with Node:
```powershell
node --test scripts/mvp/vox/ab7k-semantic-evidence.test.mjs scripts/mvp/vox/ab7k-readonly-evidence.test.mjs
node scripts/mvp/vox/ab7k-semantic-evidence.mjs sql        # review the read-only semantic catalog SQL
node scripts/mvp/vox/ab7k-semantic-evidence.mjs probe-sql  # review the behavior probe SQL (disposable only)
```
Disposable harness (Docker local engine, image must already be present locally; the harness never pulls):
```powershell
docker image inspect postgres:17-alpine --format '{{.Id}}'          # operator pre-pulls deliberately if absent
.\scripts\mvp\vox\validate-voxAB7K-recovery-semantic-pg17.ps1 -ApplyIdentityOverlay
.\scripts\mvp\vox\validate-voxAB7K-recovery-semantic-pg17.ps1                      # 30 files only
.\scripts\mvp\vox\validate-voxAB7K-recovery-semantic-pg17.ps1 -NoSupabaseDefaultPrivileges
```
Artifacts land only in a fresh `%TEMP%\ab7k-rc3-evidence-<guid>` directory: `compare-full-fidelity.json` (strict raw diff, unchanged semantics), `source/restored/mutant/lossy` raw+semantic snapshots, `probes-*.raw.txt/json`, `adjudication.json`, `adjudication-negative-control.json`, `adjudication-lossy-informational.json` (lossy `--no-owner --no-acl` restore, informational only), `SHA256SUMS.txt`, `manifest.json`, `environment.txt` (image id).

Recording a result: copy exit code, the `AB7K_RC3_*` lines, and `SHA256SUMS.txt` into the review ticket. Do not edit expectations to match a red result without DBA review.

## Local-process audit of the RC2 harness (`validate-voxAB7K-recovery-harness-pg17.ps1`)

Findings read from source, fixed in this change:

1. **Foreign container deletion.** `finally` force-removed three fixed container names even when `Boot` had thrown `CONTAINER_CONFLICT_*`, so a pre-existing container with that name would be destroyed. Now only names added to `$created` after the conflict check are removed (`docker rm -f -v`).
2. **Unconfined `-OutDir`.** Any path, including UNC, `..` traversal, or an existing directory, was accepted and written with `-Force`. Now refused unless it is a not-yet-existing path under the OS temp directory (exit 7).
3. **Implicit image pull.** `docker run` would pull `postgres:17-alpine` over the network if absent. Now `--pull never`, with a preflight that the image exists locally; a non-local `DOCKER_HOST` is refused.
4. **No post-boot network assertion.** `--network none` is now verified with `docker inspect` (new harness additionally checks no published ports and no bind mounts).

Remaining by design (not defects, but review them): the harness executes `docker`, `node` and `psql` inside the disposable container; `pg_dumpall --roles-only` output (SCRAM hashes of throwaway fixture roles) is written to the temp artifact directory; the temp directory is not wiped automatically.

`ab7k-semantic-evidence.test.mjs` statically enforces: no HTTP/network/privileged/bind-mount/pull/git/npm tokens in either script, exactly one `docker run` with `--network none --pull never`, a single `docker rm` limited to self-created containers, temp-confined output, and that the new Node modules import no network/process modules and write only through `assertSafeOutFile`. These are text checks, not a sandbox.

## Observations a DBA/AppSec reviewer must weigh (from source reading, unexecuted)

- `20261016020000_vox08j_staff_team_chat_candidate.sql` revokes from `public, anon, authenticated` and grants only `SELECT` to `service_role`. With Supabase-style default privileges (`GRANT ALL … TO service_role`, as the harness simulates), `service_role` may retain INSERT/UPDATE/DELETE/TRUNCATE on that table. The AB7J table, by contrast, revokes from `service_role` explicitly. The harness cross-compares but deliberately does **not** assert service_role DML on chat. Candidate SQL was not rewritten; whether to tighten it is a DBA/AppSec decision.
- Behavior probes run against the 30-file install on a synthetic Core fixture, not Supabase. Roles, default privileges and `auth` differ on a managed project.

## Managed recovery: BLOCKED (unchanged)

- Managed restoration remains **BLOCKED**. No managed backup bytes with ACLs and a role dump exist in this tree, and none was read, created or restored.
- PITR evidence: **NOT PROVIDED**. Ed25519 attestation: **NOT PROVIDED**. Genuine Owner / Team Leader AAL2: **NOT PROVIDED**.
- There is no human or qualified DBA/AppSec signoff. AI-model review (including this one) is not independent signoff.
- Even `candidate-semantic-parity-provisional` on a disposable cluster is local evidence about a synthetic fixture. It cannot be promoted to exact managed recovery by any script in this repository.
- CORE_CONVERSATION, official EOD publication and signed Jarvis operator actions stay hard disabled. Issue #444 stays open.

## Next steps (human)

1. Run the unit tests and the disposable harness on a Docker host; attach artifacts and `SHA256SUMS.txt`.
2. If the verdict is `candidate-semantic-parity-provisional`, a qualified DBA reviews `adjudication.json` (each `rawDivergentPaths[].reason`), the probe matrices, and the parse-tree normalization assumption, then writes their own interpretation.
3. If `SEMANTIC_DIVERGENCE` or exit 5: treat as a defect (candidate SQL or comparator) and stop.
4. Collect a real managed backup with owners/ACLs/roles per the RC2 checklist, restore-test it locally, and repeat the adjudication on that restore. Only then can a DBA decide anything about managed recovery.
5. Wire the new test into CI (`.github/workflows/vox-ab8-integrated-release-hold.yml` only globs `validate-voxAB7K-*.test.mjs`; the new test is named `ab7k-semantic-evidence.test.mjs`). Not changed here.
