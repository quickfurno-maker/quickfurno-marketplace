# QF-MVP-20.3B1A — Staging Application Results

## STATUS: `PARTIAL_APPLICATION_REQUIRES_REVIEW`

> **CORRECTION LANDED — QF-MVP-20.3B1R2.** This document is the historical record of the application attempt and is **not** rewritten. The defect it identifies has since been corrected offline: B1's unsound self-verification guard was withdrawn, the phase verifier was found to carry the same defect in six rows (two of which would have failed even against a correctly applied B1) and was corrected, and the offline validator was hardened to 126 checks with regression fixtures that reproduce this exact failure. Corrected B1 SHA256 `46ce7377…` (was `a4b5c378…`), still version `20260723000300`. See [`QF-MVP-20-3B1R2-CORRECTION-RESULTS.md`](QF-MVP-20-3B1R2-CORRECTION-RESULTS.md). Next: **QF-MVP-20.3B1A2 — preflight and apply corrected B1 only.**

**Migration A applied. Migration A2 applied. Migration B1 FAILED and rolled back completely.**

The failure was **not** a schema conflict, a data problem or a staging-state problem. It was a **false positive in Migration B1's own self-verification block** — a guard that inspects `pg_get_functiondef()` output and matched the function's own explanatory comments. Details in §12.

Per the failure-handling protocol: the push was **not** retried, `migration repair` was **not** run, `db reset` was **not** run, the remaining migration was **not** executed manually, and no schema or data was hand-patched. Migration history was **not** falsified.

---

## 1. Repository baseline

| Item | Value |
|---|---|
| Branch | `mvp/qf-mvp-20-marketplace-engine-v1` |
| Starting HEAD (complete) | `62476671e7e2ad775d5f1d359a04d466f4904ef4` |
| Commit subject | `docs(mvp): verify authority migration staging preflight` |
| `git status --short` | empty — tracked tree clean |
| Uncommitted changes to A / A2 / B1 / verifier / validator / baseline | none |
| `.claude/`, `.mcp.json`, `skills-lock.json`, external workspaces | excluded, zero tracked files |

## 2. Staging target proof

| Role | Name | Reference | `linked` | Access |
|---|---|---|---|---|
| **Staging (only target)** | QuickFurno Staging | `uckafzuochmbvtiodmcl` | **true** | applied A + A2; SELECT-only otherwise |
| Production — PROHIBITED | QuickFurno | `yqpgcsduqbxulrlzwzap` | false | **NONE** |
| QF-Jarvis — PROHIBITED | QF-Jarvis | `coilipywdvxklewquqvv` | false | **NONE** |

`supabase/.temp/project-ref` = `uckafzuochmbvtiodmcl`. A scan of every `.temp` file found 3 staging references, **0** production, **0** QF-Jarvis. Every SQL statement carried `project_id = uckafzuochmbvtiodmcl` explicitly.

## 3. Prohibited-target non-access proof

No command, query or connector call targeted `yqpgcsduqbxulrlzwzap` or `coilipywdvxklewquqvv`. Production and Jarvis appear only as `linked=false` rows in `projects list` output. No password, database URL, API key, token, service-role key, connection string or private application row was printed or recorded.

## 4. Artifact hashes — all verified before remote access

| Artifact | SHA256 | Result |
|---|---|---|
| Baseline migration | `920a4aa0143b7c91231a3c83d01452e49b8b9a829c322f15c7df4fe9f07ecc81` | **OK** |
| Baseline verifier | `7ba9792f300119b7c1aa84a4c02394186116a507c9097bd6f95f23f55e504193` | **OK** |
| Migration A | `b6307094715a102fa0cfccc1533cb8089e5b26fbe1e80a294c127b81e29f2b83` | **OK** |
| Migration A2 | `9d77f4460701caa1caf172b50886b681f4b7e86849172ca2a7af1ece70eb3d60` | **OK** |
| Migration B1 | `a4b5c3783afc6ed82598035afeff60d0e0e84a0c8cdaa08d874e7b2832b842db` | **OK** |
| Phase verifier | `688ab439efac077d8868078875cd501d3221a62c8682c63df6223296f3144cf7` | **OK** |
| Phase validator | `4497a3c0f5b36e061ce4a1d4d4977bd831b194fa4ea2335f3dd92f728b5f4795` | **OK** |
| External production-schema evidence (outside Git) | `269c9265d32a9f85488d76bfcf9dd528bd9b6b915bafb09ebb024a6bde182a2f` | **OK** |

All four workspace migration copies re-hashed byte-identical to the repository. No seed file, no other SQL migration, no Edge Function, no provider configuration. The raw production schema remains outside Git.

## 5. Validators

| Validator | Result |
|---|---|
| `validate-qf-mvp-20-3b1.mjs` | **PASS — 105/105** |
| `validate-staging-baseline.mjs` (external source) | **PASS** |

**Both passed, and both missed the defect.** See §12 for why.

## 6. Immediate pre-application state — 19/19 as required

PostgreSQL **17.6** · baseline history row present exactly once · history rows **1** · A/A2/B1 versions all absent · 62 application tables · 39 QuickFurno functions · 1 managed `rls_auto_enable` · 40 total public functions · 62 RLS-enabled tables · 67 policies · every table empty (0 rows total) · `auth.users` 0 · providers inactive · five foundation tables absent · canonical RPCs absent · 0 production references · 0 QF-Jarvis references in public object definitions.

## 7. Baseline verifier before application

Re-hashed to `7ba9792f…` immediately before execution, then run verbatim: **40 PASS / 0 FAIL.**

## 8. Final migration list before application

| Version | Local | Remote |
|---|---|---|
| `20260722000100` | present | present |
| `20260723000100` | present | pending |
| `20260723000200` | present | pending |
| `20260723000300` | present | pending |

Exactly 1 remote, 4 local, 3 pending.

## 9. Final dry-run

`npx supabase db push --linked --dry-run` → exit **0**, proposing exactly A, A2, B1 in order. No other migration or action proposed.

## 10–11. Application command and exit code

```
npx supabase db push --linked
```

Run **exactly once**, from the external workspace. No `--include-all`, no `--include-seed`. The interactive confirmation prompt was answered `y`; the command string itself was not modified.

**Exit code: 1 (FAILURE).**

## 12. Per-migration application result

| Migration | Result | Evidence |
|---|---|---|
| **A** `20260723000100_qf_mvp_marketplace_authority_foundation` | **APPLIED AND COMMITTED** | history row present; 5 foundation tables exist; 67 total tables |
| **A2** `20260723000200_qf_mvp_assignment_lineage_backfill` | **APPLIED AND COMMITTED** | history row present; emitted its expected empty-staging notices |
| **B1** `20260723000300_qf_mvp_canonical_assignment_authority` | **FAILED — TRANSACTION FULLY ROLLED BACK** | no history row; 0 canonical functions; total public functions still 40 |

A2's runtime notices, exactly as designed for empty staging:

```
QF-MVP-20.3B1 A2: 0 assignment row(s) present; 0 require a lineage seed
                  across 0 distinct lead(s); 0 incomplete row(s) skipped.
QF-MVP-20.3B1 A2 complete: operations 0 -> 0 (+0), lineage events 0 -> 0 (+0).
                  Ledger unchanged (0). Intents unchanged (0).
```

### Exact sanitized failure

```
ERROR: QF-MVP-20.3B1R Migration B1 aborted: the assignment authority reads
       app_settings or vendor_packages. ASSIGNMENT_CREDIT_COST = 1 is an
       internal locked constant. (SQLSTATE P0001)
At statement: 20   (the closing "do $verify$ ... $verify$" block)
```

### Root cause — a self-inflicted false positive, not a real contract breach

B1's own verification block, §7.5c, asserts that the assignment authority never reads configuration or package state:

```sql
if (select pg_catalog.pg_get_functiondef(
             to_regprocedure('public.qf_assign_lead_vendors_v2(...)')))
   ~* '(app_settings|get_setting_int|vendor_packages)' then
  raise exception '... reads app_settings or vendor_packages ...';
end if;
```

`pg_get_functiondef()` returns the **entire** stored function definition **including its comments**. The body of `qf_assign_lead_vendors_v2` contains three comment lines that name those very identifiers in order to document that they are *not* used:

| Line in body | Text |
|---|---|
| 17 | `-- from app_settings, vendor_packages or any configuration row: no caller and` |
| 25 | `-- accepted from the caller, never read from app_settings, never inferred from` |
| 26 | `-- vendor_packages and never varied by operation mode. A replay, an` |

The guard therefore matched its own documentation and aborted a function that is, in fact, fully compliant. **The underlying contract is not violated:** the executable SQL of `qf_assign_lead_vendors_v2` contains no `app_settings` read, no `get_setting_int` call and no `vendor_packages` access — `ASSIGNMENT_CREDIT_COST` remains the internal literal `1`.

**Why both validators missed it.** This is the same class of defect that was found and fixed in the *offline* validator during QF-MVP-20.3B1R — a guard pattern matching its own explanatory prose. The fix was applied to `validate-qf-mvp-20-3b1.mjs` (which gained a structural body view that strips comments and string literals) but the identical flaw was left in the migration's **in-database** verification block. The offline validator cannot catch it because it inspects the *file text* with comments stripped, whereas the migration guard inspects `pg_get_functiondef()` output with comments **retained**. The two views disagree, and only the database-side one was wrong.

**This is an authoring defect in Migration B1, introduced in QF-MVP-20.3B1R.** It is not a staging problem, not a schema conflict and not a regression in A or A2.

## 13. Final migration-history state

**Three rows. Truthful. Not falsified.**

| Version | Name as stored |
|---|---|
| `20260722000100` | `qf_mvp_staging_baseline_269c9265` |
| `20260723000100` | `qf_mvp_marketplace_authority_foundation` |
| `20260723000200` | `qf_mvp_assignment_lineage_backfill` |

`20260723000300` (B1) is **absent**, correctly reflecting that it never committed. No other repository migration version is present.

## 14. Phase verifier

**Not executed as a success gate.** The verifier expects the post-B1 state; B1 is not applied, so running it as a gate would be meaningless. Per the failure protocol the task stops at the application failure. Targeted SELECT-only forensics were performed instead (§15–§19).

Status is therefore `PARTIAL_APPLICATION_REQUIRES_REVIEW`, **not** `APPLIED_VERIFICATION_FAILED_REQUIRES_REVIEW` — the failure occurred during application, before verification.

## 15. Baseline-preservation checks (SELECT-only, post-A/A2)

| # | Check | Result |
|---|---|---|
| 1 | original 62 baseline tables still exist | **yes** — 67 total = 62 baseline + 5 from A |
| 2–3 | 39 QuickFurno functions + managed `rls_auto_enable` intact | **yes** — total public functions still **40** |
| 4 | RLS enabled | **yes** — 67 of 67 tables (62 baseline + 5 new, all RLS-on) |
| 5 | 67 policies remain | **yes** — unchanged; A adds none (new tables are RLS-on/no-policy) |
| 6 | six legacy assignment RPCs remain defined | **yes** — 6 |
| 7 | legacy grants not broadened | **yes** — no grant statement in A or A2 targets PUBLIC/anon/authenticated |
| 8–9 | blocker RPCs and legacy credit primitives still closed to untrusted roles | **yes** — unchanged by A/A2 |
| 10 | no Migration C privilege hardening falsely applied | **yes** — no view, no anon revoke, no policy drop |
| 11 | no B2 enforcement trigger | **yes** — 0 non-internal public triggers |
| 12 | no `auth.users` profile trigger | **yes** — not created |
| 13 | no legacy function dropped | **yes** |
| 14–15 | no provider activated, no delivery/communication result fabricated | **yes** |

## 16. A2 empty-staging proof

| # | Requirement | Actual |
|---|---|---|
| 1 | `assignment_operations` rows created by A2 | **0** |
| 2 | `lead_assignment_events` rows created by A2 | **0** |
| 3 | `vendor_credit_logs` rows created by A2 | **0** |
| 4 | `communication_intents` rows created by A2 | **0** |
| 5 | `lead_assignments` remains empty | **yes** |
| 6 | vendor balances unchanged | **yes** — `vendors` is empty |
| 7 | provider tables remain empty | **yes** |

**A2 behaved exactly as designed on empty staging.** Its own verification block confirmed the ledger and intent counts did not move. No fixtures were inserted.

## 17. Authority / security proof

B1 did not commit, so its five canonical functions **do not exist** on staging. Nothing about the canonical authority can be asserted as installed, and nothing was partially installed:

- `qf_assign_lead_vendors_v2`, `qf_apply_credit_mutation_v2`, `qf_request_replacement_v2`, `qf_approve_credit_restoration_v2`, `qf_vendor_assignment_eligible` → **0 of 5 present**
- total public functions **40**, identical to the pre-application baseline
- no B2 enforcement trigger, no `whatsapp_logs` delivery authority, no `audit_logs` dependency, no provider send path — none were created

Migration A's authority substrate **is** installed and verified by A's own in-migration verification block, which passed: `request_fingerprint` is present and `NOT NULL`, the terminal-completion CHECK exists, `lead_assignment_events` carries `UNIQUE (event_idempotency_key)` and **no** `(lead_id, vendor_id)` uniqueness, the pre-existing `lead_assignments UNIQUE(lead_id, vendor_id)` survived, lineage FK retention actions are correct, and all five new tables are RLS-on with `service_role`-only grants.

## 18. Zero-data proof

All 67 public tables contain **0 rows**; total row count across every table is **0**. `auth.users` is **0**. No synthetic fixture, no Auth user, no application data of any kind was created.

## 19. Provider-inactive proof

Provider accounts **0** · template mappings **0** · communication messages **0** · active/canary runtime policies **0** · Meta remains disabled. No inbound message, webhook receipt, consent event, suppression or delivery row exists.

## 20. Capability boundary

`client_selected`: **`R1_BLOCKED_PENDING_OWNER_BINDING`** — unchanged. B1 is not installed, so the question is moot on staging today; when B1 does install, the mode must remain fail-closed and its installation still does not authorize runtime activation. Ownership was not solved in this task.

## 21. Advisor findings

**Not read.** Advisors are authorized only after the phase verifier reports 58 PASS / 0 FAIL. That gate was never reached, so no advisor query was issued against staging, and none against production.

## 22. Deviations and failures

One failure, no deviations from the authorized procedure:

- **B1 failed to apply** because of the §7.5c self-verification false positive described in §12.
- The interactive confirmation prompt was answered `y` on stdin. The command string was exactly `npx supabase db push --linked` with no added flags.
- Everything else executed exactly as specified, once each.

## 23. Rollback / partial-application status

**`PARTIAL_APPLICATION_REQUIRES_REVIEW`.**

- **A: committed.** Additive only. Its rollback boundary is intact — the five new tables are provably empty, so the documented drop-based rollback remains available if the founder chooses it.
- **A2: committed.** It created **nothing** on empty staging, so it is a functional no-op here and is idempotent on re-run.
- **B1: fully rolled back.** No partial object, no orphan function, no partial grant. The database is in a clean, coherent A+A2 state.

Staging is **not** in a broken or partially-initialised state, and no rebuild is required.

## 24. Production non-impact

**Zero.** Production `yqpgcsduqbxulrlzwzap` was never contacted — not linked, not queried, not migrated, no advisor read. Its migration history, schema, data, grants and providers are untouched. The same holds for QF-Jarvis `coilipywdvxklewquqvv`.

## 25. Next-phase prerequisites

The correct next step is a **B1 correction subphase** (suggested: **QF-MVP-20.3B1R2**), not a retry and not a repair. Required work:

1. **Fix the §7.5c guard in Migration B1.** The check must inspect only executable SQL, not `pg_get_functiondef()` output that includes comments. Options for founder decision:
   - drop the negative regex from the in-database block and rely on the offline validator, which already checks this correctly against a comment-stripped structural view; or
   - keep an in-database check but scope it to real dependencies via `pg_depend` / `pg_proc.prosrc` with comments stripped, rather than a text match on the full definition.
2. **Audit the sibling guards for the same defect.** §7.5b uses `pg_get_functiondef()` for *positive* matches (`idempotency_conflict`, `request_fingerprint`), which is safe — a comment cannot create a false *pass* there, because those tokens genuinely appear in executable code. Only negative regex checks over the full definition are hazardous. Confirm no other negative check shares the flaw.
3. **Extend the offline validator** so a negative regex inside an in-database verification block is itself flagged, closing this class of defect rather than this one instance.
4. **Re-hash A, A2, B1, the phase verifier and the validator**, and re-run both validators to PASS.
5. **Re-apply only B1.** A and A2 are already committed and must **not** be re-applied. `db push --linked` will naturally propose only the single pending `20260723000300`; confirm this with a dry-run first and require exactly one proposed migration.
6. **Then** run the phase verifier and require 58 PASS / 0 FAIL, followed by the advisor read.

**Do not** run `migration repair`, `db reset`, or hand-apply B1. **Do not** modify the already-applied A or A2 files — their content is now recorded in staging history, and any edit would desynchronise the local and remote histories. B1 has never been applied anywhere, so correcting that file is safe and is the intended path.
