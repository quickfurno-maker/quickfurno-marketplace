# QF-MVP-20.3B1G — Lineage Append-Only Grant Repair

**Status: `APPLIED_AND_VERIFIED_ON_STAGING` (QF-MVP-20.3B1G-A).**

> **MIGRATION_G_APPLIED_VERIFIED_ON_STAGING_READY_FOR_COMMIT_REVIEW.** Migration G was applied to staging on **2026-07-23T15:12:59Z-15:13:09Z UTC** (exit 0), is recorded remotely exactly once, and the locked 62-row phase verifier returns **62 PASS / 0 FAIL**. The append-only application-role boundary is now in force. See section 10.

**Type:** offline SQL authoring review and correction (§1–§8), plus the staging preflight (§9).

**Sections 1–8 — authoring phase (QF-MVP-20.3B1G):** no staging access, no production access, no SQL executed, no `db push` of any kind, and Migration G was not copied to the apply workspace by that phase.

**Section 9 — preflight phase (QF-MVP-20.3B1GP):** staging was inspected read-only and exactly one `db push --linked --dry-run` was run. **Migration G was still not applied**, and no remote history row was created. Migration G was found *already present* in the apply workspace from an earlier attempt, so it was verified byte-identical rather than copied again.

Closes the single failure from QF-MVP-20.3B1A2: `R03_lineage_append_only_grants` found **4** UPDATE/DELETE grants on `public.lead_assignment_events` where the declared append-only contract requires none.

---

## 1. Repository baseline

| Item | Value |
|---|---|
| Branch | `mvp/qf-mvp-20-marketplace-engine-v1` |
| Starting HEAD | `7ec9bd3cfce110e27ab97e1e228c40def87b0de9` |
| Subject | `docs(mvp): record corrected authority staging failure` |
| Applied + immutable | A `b6307094…` · A2 `9d77f446…` · B1 `46ce7377…` — all re-verified **unchanged** |
| Baseline artifacts | `920a4aa0…` / `7ba9792f…` — **unchanged** |

## 2. What the repair does

`Migration G` (`20260723000400_qf_mvp_lineage_append_only_grants.sql`) is **forward-only and REVOKE-only**:

```
revoke all privileges on table public.lead_assignment_events
  from public, anon, authenticated;

revoke update, delete, truncate, references, trigger, maintain
  on table public.lead_assignment_events from service_role;
```

`MAINTAIN` is included because Supabase's default ACL is `arwdDxtm` — the trailing `m` is `MAINTAIN`, a PostgreSQL 17 table privilege. Omitting it would leave part of the default grant in place.

**Resulting application-role contract:** PUBLIC / anon / authenticated hold nothing; `service_role` holds **SELECT and INSERT only**.

**Owner boundary.** The table owner and superusers retain implicit break-glass authority and are deliberately *not* revoked. That is documented in the migration header and surfaced as an explicitly informational verifier row, never as an application-role control.

## 3. Independent review findings

The implementation was inspected line by line rather than trusted because the validator reported green. **Four defects were found and corrected.**

### Finding 1 — Migration G carried an explicit `begin;` / `commit;` (CORRECTED)

G was the **only** migration among all 69 in the repository with a transaction wrapper; A, A2 and B1 have none. The Supabase CLI already wraps each migration file *and* its `supabase_migrations.schema_migrations` insert in one transaction. A nested `BEGIN` merely warns, but the inner `COMMIT` would **end the CLI's transaction early**, breaking atomicity between the migration's effects and its own history row — precisely the guarantee that made the B1 rollback clean.

**Fix:** wrapper removed; a `TRANSACTION BOUNDARY` header section records why. The validator now rejects explicit transaction control in any migration.

### Finding 2 — PUBLIC could never be detected (CORRECTED)

Both Migration G's post-check and verifier row 44 asserted PUBLIC held nothing by querying:

```sql
from information_schema.role_table_grants where grantee in ('PUBLIC', …)
```

PostgreSQL documents that `role_table_grants` **"omits tables that have been made accessible to the current user by way of a grant to PUBLIC."** A `grantee = 'PUBLIC'` predicate against that view can therefore *never match*. The check was structurally incapable of detecting the very thing it claimed to prove, and would have silently passed.

**Fix:** every lineage privilege proof now uses `has_table_privilege()`, which returns the **effective** privilege, with `'public'` included as a role name — PostgreSQL resolves it to the PUBLIC pseudo-role. Verifier rows 44, 45 and 46 were all converted, so an inherited privilege cannot hide either. The validator now rejects any Migration-G PUBLIC proof that relies on `role_table_grants`.

### Finding 3 — validator fixtures A–H were vacuous (CORRECTED)

The fixtures exercised `grantPosturePass(servicePrivileges, untrustedPrivileges, sql)` — a private helper that took **hand-written privilege arrays** and was **never applied to Migration G**. Its only caller was its own fixture loop. Deleting it would have changed nothing about the validation of the migration, so the fixtures proved nothing.

**Fix:** replaced with `evaluateGrantMigration(sqlText)`, which encodes the real rule set and is applied to **the real Migration G** as a recorded check. Fixtures A–H are now synthetic migrations that each differ from a *passing* migration by exactly one defect, and they run through the identical code path:

| Fixture | Scenario | Expected | Actual |
|---|---|---|---|
| **A** | compliant migration — `TRUNCATE` **privilege** in a REVOKE list is not a TRUNCATE **statement** | compliant | **0 findings** ✓ |
| **B** | a `GRANT` is present | rejected | `contains GRANT` ✓ |
| **C** | service_role forbidden REVOKE missing | rejected | `missing service_role forbidden REVOKE` ✓ |
| **D** | untrusted `REVOKE ALL` missing | rejected | `missing untrusted REVOKE ALL` ✓ |
| **E** | `ALTER DEFAULT PRIVILEGES` present | rejected | `contains GRANT; ALTER DEFAULT PRIVILEGES` ✓ |
| **F** | revokes from the owner | rejected | `owner privilege mutation` ✓ |
| **G** | explicit `begin;`/`commit;` wrapper | rejected | `explicit transaction control` ✓ |
| **H** | a real `TRUNCATE TABLE` statement | rejected | `TRUNCATE statement` ✓ |
| **I** | executable lineage `UPDATE` inside a function body | rejected | `mutation detected` ✓ |
| **J** | mutation words in comments only | compliant | `comments excluded` ✓ |

**A and H together are the discriminator the review required:** A proves the `TRUNCATE` *privilege* in a REVOKE list is not mistaken for a statement, H proves a real `TRUNCATE` statement is still caught.

**Mutation-tested.** Injecting `grant update … to service_role;` into the real Migration G makes `3B1G:real Migration G satisfies every grant-posture rule` fail. Reverting restores green. The link is load-bearing, not decorative.

### Finding 4 — the as-authored artifacts did **not** actually pass (CORRECTED)

The premise that "the offline validator passes" did not hold. Migration G's verifier rows introduced sequence number **46**, which collided with the pre-existing guard `verifier:no production-specific count as a universal expectation` (`/\b46\b/`). That guard exists to stop the production count of *46 assignments* being used as a universal expectation; it had no way to tell an expectation value from a **row ordinal**.

**Fix:** the guard now strips the `select <n>,` ordinal prefix before testing, so only genuine expectation values are considered. Its original purpose is preserved.

## 4. Verified review checklist

| Requirement | Result |
|---|---|
| Migration G is forward-only and REVOKE-only | ✓ 0 GRANT statements in executable SQL |
| No GRANT exists | ✓ |
| No data, table, function, trigger, policy, view or default-privilege mutation | ✓ REVOKE + two verification blocks only |
| PUBLIC, anon, authenticated retain no lineage privilege | ✓ now proven by **effective** privilege across all 8 privileges |
| service_role retains SELECT and INSERT | ✓ pre-check and post-check, effective |
| service_role loses UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN | ✓ all six revoked and re-asserted |
| owner/postgres is documented break-glass, not an application role | ✓ untouched; informational verifier row 47 |
| verifier remains SELECT-only | ✓ no mutating keyword outside comments/strings |
| verifier history expects baseline + A + A2 + B1 + G | ✓ five versions, count = 5 |
| verifier all-PASS count | ✓ **62** rows, no duplicate sequence, paren-balanced |
| validator distinguishes TRUNCATE privilege from TRUNCATE statement | ✓ fixtures A and H |
| fixtures A–J load-bearing and non-vacuous | ✓ rebuilt and mutation-tested |
| B1 executable routines contain no lineage UPDATE/DELETE/TRUNCATE | ✓ checked on the tokenized executable view |
| A, A2, B1 hashes exact | ✓ unchanged |

## 5. Artifact hashes

| Artifact | SHA256 |
|---|---|
| `20260723000400_qf_mvp_lineage_append_only_grants.sql` | `91544524c27ca26020b648f13f462d2613ca407366c8de0f258ea4f04d8c553b` |
| `verify_qf_mvp_20_3b1.sql` | `e1d9edb85008c8f157016cb04f09ec127aba850d1980ca86ebb8e6721aab7483` |
| `validate-qf-mvp-20-3b1.mjs` | `e27d62d09f38e599c34b1084019777b0147df68bba1c91389b52d1df6577a6c8` |

**Unchanged and re-verified:** A `b6307094…` · A2 `9d77f446…` · B1 `46ce7377…` · baseline `920a4aa0…` · baseline verifier `7ba9792f…` · external schema `269c9265…`.

## 6. Gate results

| Gate | Result |
|---|---|
| Offline phase validator | **PASS — 165/165** |
| Fixtures A–J | **10/10 with expected outcomes** |
| Real-Migration-G rule check | **PASS — 0 findings** |
| Mutation test of the fixture link | **PASS — injected GRANT fails the real check** |
| Baseline validator (locked external schema) | **PASS** |
| `git diff --check` | clean |
| `npm run verify:mvp` | **PASS — 40/40** |
| Immutable hash checks | **PASS** |

## 7. Application prerequisites (QF-MVP-20.3B1G-A)

1. Re-verify the immutable hashes and the three B1G artifact hashes above.
2. Run the phase validator → **165/165**, fixtures A–J correct.
3. Run the baseline validator → PASS.
4. Prove the target: `linked=true` for `uckafzuochmbvtiodmcl` only.
5. **Copy Migration G into the apply workspace** — it is deliberately *not* there yet, so the workspace still holds exactly four files.
6. `migration list --linked` → 5 local / 4 remote / **exactly one pending** (`20260723000400`).
7. `db push --linked --dry-run` → exit 0, proposing exactly that one migration.
8. `db push --linked` once. No `--include-all`, no `--include-seed`.
9. Run the corrected verifier (`e1d9edb8…`) → require **62 PASS / 0 FAIL**.
10. Only then read staging-only advisors.

**Prohibited throughout:** `migration repair`, `db reset`, editing A/A2/B1, re-applying any applied migration, hand-executing G.

## 9. QF-MVP-20.3B1GP — staging preflight

**Status: `PREFLIGHT_COMPLETE_READY_FOR_APPLICATION_REVIEW`.** Executed at repository HEAD `5b51241bec813be66f47e50c08395e56ada8f63b`, branch `mvp/qf-mvp-20-marketplace-engine-v1`, worktree clean and synchronized with `origin`.

**Migration G was NOT applied.** Exactly one `db push --linked --dry-run` was run; no `db push` without `--dry-run`, no `migration up`, no `migration repair`, no `db reset`, no remote history change, no DDL, no DML, no auth user, no provider activation.

### Tooling deviation — prior wrapper attempts

Earlier QF-MVP-20.3B1GP attempts used a generated PowerShell wrapper that failed on wrapper portability and argument handling. Those failures were **local tooling defects only**: they never authorized or performed an application. This preflight was executed with direct, individually reviewed shell commands instead of any wrapper.

### Offline gates

| Gate | Result |
|---|---|
| Locked artifact hashes (9, incl. external evidence) | **all verified** |
| Grants manifest `scripts/mvp/staging/staging-baseline-grants.json` | `11a3ad402ef910d7fbcbe207c0694a64ad90857353fbf9ee5c3e22e86d291dd2` |
| Phase validator | **165 passed, 0 failed — PASS** |
| `npm run verify:mvp` | **2 suites / 40 cases passed**, exit 0 |
| `git diff --check` | exit 0 |
| Baseline validator (real interface, external source) | **PASS**, exit 0 |

**Validator load-bearing evidence.** All ten fixtures **A–J** ran and passed. `3B1G:real Migration G satisfies every grant-posture rule` reported **0 findings**, and the validator tokenized and hashed `20260723000400`, echoing `91544524…` — so G was not silently skipped. The link is structural, not decorative: `evaluateGrantMigration()` is invoked at one site on `G.raw` (read from the locked repository path) and at a second site by every fixture, so fixture B — which injects `grant update … to service_role` — exercises the identical code path that grades the real migration.

`npm run verify:mvp` emitted one stderr warning (`Using edge runtime on a page currently disables static generation for that page`). The process exited 0; this is recorded as a warning, not a failure.

### External apply workspace

`Desktop\qf-staging-apply` — **not a Git repository** (no `.git`, and `git rev-parse --show-toplevel` resolves to nothing), so nothing in it can be committed. No `seed.sql` anywhere, no Edge Function directory, and `config.toml` declares no `[functions]` block and names neither prohibited project.

**Inventory before this phase — Migration G was already present**, not absent. It was therefore **not copied again**; it was verified instead:

| File | SHA256 | Verdict |
|---|---|---|
| `20260722000100_qf_mvp_staging_baseline_269c9265.sql` | `920a4aa0…` | OK |
| `20260723000100_qf_mvp_marketplace_authority_foundation.sql` | `b6307094…` | OK |
| `20260723000200_qf_mvp_assignment_lineage_backfill.sql` | `9d77f446…` | OK |
| `20260723000300_qf_mvp_canonical_assignment_authority.sql` | `46ce7377…` | OK |
| `20260723000400_qf_mvp_lineage_append_only_grants.sql` | `91544524…` | OK, `cmp` vs repository → **IDENTICAL** |

Exactly five `.sql` migrations, zero non-SQL files in the migrations directory. Inventory after the phase is unchanged — nothing was copied, deleted, renamed or repaired.

The `_evidence/` folder holds transcripts from earlier phases. The files named `01-migration-list-pre` … `04-migration-list-post` were inspected and belong to **QF-MVP-20.2C2**, the authorized baseline application of `20260722000100` on 22 July — they are **not** B1GP wrapper output and record no unauthorized application of Migration G.

### Linked target

**Authoritative:** `supabase/.temp/project-ref` = `uckafzuochmbvtiodmcl`, and `linked-project.json` resolves to *QuickFurno Staging*. A scan of every `.temp` file found **3** staging references, **0** production, **0** QF-Jarvis. **Supporting only:** `projects list` shows `linked=True` for staging and `linked=False` for both `yqpgcsduqbxulrlzwzap` and `coilipywdvxklewquqvv`. Neither prohibited project was connected to.

### Migration history — before the dry run

Parsed structurally from the CLI's JSON rather than by counting lines:

| Version | Local | Remote |
|---|---|---|
| `20260722000100` | ✓ | ✓ |
| `20260723000100` | ✓ | ✓ |
| `20260723000200` | ✓ | ✓ |
| `20260723000300` | ✓ | ✓ |
| `20260723000400` | ✓ | — **pending** |

**5 local / 4 remote / exactly one pending**, the pending version being G alone, with no unexpected local or remote version.

### The dry run

```
npx supabase db push --linked --dry-run
```

**Exit code 0.** The CLI printed `DRY RUN: migrations will *not* be pushed to the database.` and proposed **exactly one** migration, by complete filename:

```
20260723000400_qf_mvp_lineage_append_only_grants.sql
```

The baseline, A, A2 and B1 were **not** proposed. No seed, repair, reset, config-deploy or Edge Function step appeared, and the output makes no claim of successful application.

### Proof the dry run wrote nothing

The linked migration list was re-read immediately afterwards: remote still holds exactly baseline + A + A2 + B1 (**4 rows**), G remains **local-only**, local count remains 5, and **no remote history row was created**. No DDL or data query was needed for this proof.

### Transcript

`Desktop\qf-staging-workspace\QF-MVP-20.3B1GP-PREFLIGHT-20260723T132554Z.txt` — outside Git and untracked.

### Remaining step

QF-MVP-20.3B1G-A: apply Migration G once, then run the 62-row phase verifier requiring all-PASS, then read staging-only advisors. The pre-G live verifier result of 57 PASS / 1 FAIL is the expected historical position and is **not** a new blocker.

## 10. QF-MVP-20.3B1G-A - staging application and verification

**Status: `MIGRATION_G_APPLIED_VERIFIED_ON_STAGING_READY_FOR_COMMIT_REVIEW`.**

Executed at repository HEAD `7d483a355711a53fb69c90d5a4591ecaa601ede8`, branch synchronized with `origin` at **0/0**, worktree clean.

### Application

| Item | Value |
|---|---|
| Command | `npx supabase db push --linked` (from the external apply workspace) |
| Start / end (UTC) | `2026-07-23T15:12:59Z` -> `2026-07-23T15:13:09Z` |
| **Exit code** | **0** |
| Migrations identified by the CLI | **exactly one** - `20260723000400_qf_mvp_lineage_append_only_grants.sql` |
| Baseline / A / A2 / B1 | **not proposed, not re-applied** |
| Real-push budget | **one** command, run once, never repeated |

Migration G SHA-256 `91544524c27ca26020b648f13f462d2613ca407366c8de0f258ea4f04d8c553b`, byte-identical between repository and apply workspace.

A post-commit CLI warning appeared (`failed to cache migrations catalog`, missing local pgdelta certificate / edge-runtime container). This is the same known **local** catalog-caching convenience step seen in QF-MVP-20.3B1A2. It runs *after* the migration commits, changed nothing in the database, and the command still exited 0.

### Migration history

| | Before | After |
|---|---|---|
| local | 5 | 5 |
| remote | 4 | **5** |
| pending | G only | **none** |

Remote now holds exactly `20260722000100`, `20260723000100`, `20260723000200`, `20260723000300`, `20260723000400` - G recorded **exactly once**, no unexpected version, no history falsification. No `migration repair`, `db reset` or `migration up` was run.

### Phase verifier - 62 PASS / 0 FAIL

Executed verbatim from the locked file, re-hashed to `e1d9edb85008c8f157016cb04f09ec127aba850d1980ca86ebb8e6721aab7483` immediately before execution, SELECT-only, against staging only. **All 62 rows PASS. Zero FAIL. No skipped row, no altered expectation.**

The rows that prove the locked boundary:

| Row | Check | Expected | Actual | Status |
|---|---|---|---|---|
| 44 | `R03_lineage_untrusted_table_privileges` | 0 | **0** | PASS |
| 45 | `R04_lineage_service_role_forbidden_privileges` | 0 | **0** | PASS |
| 46 | `R05_lineage_service_role_required_privileges` | 2 | **2** | PASS |
| 47 | `R06_lineage_owner_break_glass_information` | INFORMATIONAL | `postgres` | PASS |
| 48 | `R07_no_lineage_mutation_trigger_yet` | 0 | **0** | PASS |

Row 47 reports the owner as informational break-glass and is **not** an application-role failure, exactly as the governance correction requires.

### Application-role boundary - live proof

Live `information_schema.role_table_grants` for `public.lead_assignment_events`:

| Principal | Privileges held | Verdict |
|---|---|---|
| `PUBLIC` | *(absent)* | none |
| `anon` | *(absent)* | none |
| `authenticated` | *(absent)* | none |
| **`service_role`** | **INSERT, SELECT** | exactly the locked set |
| `postgres` (owner) | SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER | break-glass, informational only |

`service_role` holds **no** `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER` or `MAINTAIN` - confirmed by row 45's **effective** `has_table_privilege` check, which also catches inheritance. The QF-MVP-20.3B1A2 failure (`4 update/delete grants`) is closed.

### Post-application staging state

67 public tables, **0 rows across every table**, `auth.users` **0**, provider accounts **0**, template mappings **0**, no active/canary provider policy, 45 public functions, 67 policies, 67 RLS-enabled tables, **0** public-table triggers, **0** views/matviews, **0** `auth.users` trigger. No B2, C or D work appeared.

**Only two things changed in this phase:** the ACL on `public.lead_assignment_events`, and one migration-history row. No application data, auth user, provider configuration or unrelated schema was touched.

### Advisors (read-only, after 62/62)

**Security - 44 lints, none blocking.**

| Count | Level | Lint | Disposition |
|---|---|---|---|
| 37 | INFO | `rls_enabled_no_policy` | **Expected and correct** - RLS-on/no-policy is the deliberate fail-closed posture for service_role-only tables. 32 at baseline plus 5 from Migration A's new tables, including `lead_assignment_events`. Pre-existing design, not introduced by G. |
| 1 | WARN | `rls_policy_always_true` on `leads` | Pre-existing; **Migration C** closes it. Unrelated to G. |
| 2 | WARN | `anon_security_definer_function_executable` (`get_public_eligible_vendors`, `rls_auto_enable`) | Pre-existing; evidence-backed public listing plus Supabase-managed function. Unrelated to G. |
| 4 | WARN | `authenticated_security_definer_function_executable` (`get_public_eligible_vendors`, `is_admin`, `owns_vendor`, `rls_auto_enable`) | Pre-existing; RLS predicates must be executable by the evaluating role. Unrelated to G. |

**Performance - 233 lints, none blocking.**

| Count | Level | Lint | Disposition |
|---|---|---|---|
| 156 | INFO | `unused_index` | Artifact of an **empty** database with no traffic. **Not removal candidates** without workload evidence. |
| 36 | WARN | `multiple_permissive_policies` | Pre-existing; QF-MVP-70. |
| 30 | INFO | `unindexed_foreign_keys` | Pre-existing pattern; 10 relate to Migration A's new tables (2 on the lineage table). Non-blocking; QF-MVP-70. |
| 7 | WARN | `auth_rls_initplan` | Pre-existing; QF-MVP-70. |
| 3 | WARN | `duplicate_index` | Pre-existing; Migration C scope. |
| 1 | INFO | `auth_db_connections_absolute` | Platform-managed. |

**No advisor finding is attributable to Migration G.** G only revokes privileges; it cannot create or resolve an index or policy lint. None proves G failed to establish the boundary, none indicates an unexpected schema change, and none identifies a critical safety issue introduced by this application. Nothing was auto-fixed and nothing was changed in response.

### Safety confirmations

Production `yqpgcsduqbxulrlzwzap` and QF-Jarvis `coilipywdvxklewquqvv` were **never accessed**. No second real `db push`. No `migration up`, `migration repair` or `db reset`. No hand-executed SQL from G. No application data, auth user, provider activation, seed, Edge Function deploy or application deploy. No PR, no push.

**Transcript:** `qf-staging-workspace\QF-MVP-20.3B1G-A-APPLICATION-20260723T151214Z.txt` - outside Git.

### Remaining next phase

The lineage append-only boundary is now enforced at the **privilege** layer. **Migration B2** remains outstanding and will add `trg_lead_assignment_events_immutable`, extending immutability beyond application roles to every writer including the owner - the defence-in-depth layer for staging test **T70**. B2 comes after the **R1** runtime consumer release.

## 8. Residual observations (not defects, recorded for the founder)

- **Other new tables retain default `UPDATE`/`DELETE` for `postgres` and `service_role`** — `assignment_operations`, `replacement_requests`, `credit_restoration_approvals`, `communication_intents`. None of them declares an append-only contract, so no stated invariant is violated and G deliberately leaves them alone. Tightening them is a separate decision.
- **Verifier rows 45 and 46 scope to `service_role` by name.** A future non-owner role granted lineage mutation would not be caught by those rows, though row 44 covers the untrusted three. A catch-all "no non-owner grantee holds mutation" assertion would be stronger; it is not added here because it is beyond the reviewed contract.
- **Defence in depth is still pending.** Until Migration B2 adds `trg_lead_assignment_events_immutable`, append-only rests solely on the privilege boundary that G establishes. `service_role` bypasses RLS, so RLS can never substitute. Staging test **T70** covers this.
