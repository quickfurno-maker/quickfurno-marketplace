# QF-MVP-20.3B1A2 — Corrected Canonical Authority Staging Application Results

## STATUS: `B1_APPLIED_VERIFICATION_FAILED_REQUIRES_REVIEW`

**Migration B1 applied successfully (exit 0). The phase verifier returned 57 PASS / 1 FAIL.**

The single failure is **not** a B1 defect and **not** a repeat of the QF-MVP-20.3B1A failure. It is a genuine, correctly-detected **privilege gap originating in Migration A**, which is already applied and immutable: `lead_assignment_events` was declared append-only, but Supabase's platform default privileges granted `UPDATE`/`DELETE` on it to `postgres` and `service_role`, and Migration A never revoked them.

Per the failure protocol: staging was **not** modified, B1 was **not** re-run, `migration repair` was **not** run, `db reset` was **not** run, nothing was hand-patched, and migration history was **not** falsified. Advisors were **not** read, because that gate requires 58 PASS / 0 FAIL.

---

## 1. Repository baseline

| Item | Value |
|---|---|
| Branch | `mvp/qf-mvp-20-marketplace-engine-v1` |
| Starting HEAD (complete) | `dbbb5446074590bc7aaab1835b0838981f6f6495` |
| Commit subject | `fix(mvp): correct canonical authority self-verification` |
| `git status --short` | empty — tracked tree clean |
| Uncommitted changes under `supabase/` or `scripts/` | none |
| Secrets, local skills, external workspaces | excluded, zero tracked files |

## 2. Staging target proof

| Role | Name | Reference | `linked` | Access |
|---|---|---|---|---|
| **Staging (only target)** | QuickFurno Staging | `uckafzuochmbvtiodmcl` | **true** | applied B1; SELECT-only otherwise |
| Production — PROHIBITED | QuickFurno | `yqpgcsduqbxulrlzwzap` | false | **NONE** |
| QF-Jarvis — PROHIBITED | QF-Jarvis | `coilipywdvxklewquqvv` | false | **NONE** |

`supabase/.temp/project-ref` = `uckafzuochmbvtiodmcl`; scanning every `.temp` file found **3** staging references, **0** production, **0** QF-Jarvis. Every SQL statement carried `project_id = uckafzuochmbvtiodmcl` explicitly. No relink was needed or performed.

## 3. Prohibited-target non-access

No command, query or connector call targeted production or QF-Jarvis. They appear only as `linked=false` rows in `projects list`. No password, database URL, API key, token, service-role key, connection string or private application row was printed or recorded.

## 4. Artifact hashes — all verified before remote access

| Artifact | SHA256 | Result |
|---|---|---|
| Staging baseline | `920a4aa0143b7c91231a3c83d01452e49b8b9a829c322f15c7df4fe9f07ecc81` | **OK** |
| Baseline verifier | `7ba9792f300119b7c1aa84a4c02394186116a507c9097bd6f95f23f55e504193` | **OK** |
| Migration A (applied, immutable) | `b6307094715a102fa0cfccc1533cb8089e5b26fbe1e80a294c127b81e29f2b83` | **OK** |
| Migration A2 (applied, immutable) | `9d77f4460701caa1caf172b50886b681f4b7e86849172ca2a7af1ece70eb3d60` | **OK** |
| Corrected Migration B1 | `46ce7377a217a13620305572f1be9038a56c911ce76a556b4d52f91fe107177e` | **OK** |
| Corrected phase verifier | `b66ec0605c88f92629086839f00f481eb9704444f59469a841e4c46e413302ec` | **OK** (re-hashed immediately before execution) |
| Phase validator | `734b6a13af45ed0263484ca342be037f5ca53b148f7af4f132d3de7066cfea3f` | **OK** |
| External production-schema source (outside Git) | `269c9265d32a9f85488d76bfcf9dd528bd9b6b915bafb09ebb024a6bde182a2f` | **OK** |

The raw production schema remains outside Git (0 tracked matches).

## 5. Validator and fixture results

| Validator | Result |
|---|---|
| `validate-qf-mvp-20-3b1.mjs` | **PASS — 126/126** |
| `validate-staging-baseline.mjs` (external source) | **PASS** — 62 tables · 39 functions · 33 SD · 67 policies · 62 RLS · 69 FK · 180 indexes · 0 triggers · 0 views |

Regression fixtures, all with their expected outcome:

| Fixture | Scenario | Expected | Actual |
|---|---|---|---|
| A | forbidden words in line comments | clean | **clean** ✓ |
| B | forbidden words in nested block comments | clean | **clean** ✓ |
| C | forbidden words in string literals | clean | **clean** ✓ |
| D | executable `SELECT … FROM public.app_settings` | dirty | **dirty** ✓ |
| E | executable `UPDATE public.vendor_packages` | dirty | **dirty** ✓ |
| F | raw `pg_get_functiondef` negative-regex guard | rejected | **rejected** ✓ |
| G | unterminated dollar-quote | fail closed | **threw** ✓ |

## 6. External workspace replacement

Workspace `Desktop\qf-staging-apply` — not a Git repository; no Git command was run there and nothing from it was committed.

**Before:** exactly four `.sql` migrations, no non-SQL files, no seed, no Edge Functions. Baseline `920a4aa0…`, A `b6307094…`, A2 `9d77f446…` all matched their locked hashes. B1 was `a4b5c378…` — confirmed the **stale pre-correction copy**.

**Action:** replaced **only** `20260723000300_qf_mvp_canonical_assignment_authority.sql`.

**After:** B1 = `46ce7377…`, `cmp` against the repository file reports **IDENTICAL**. Baseline, A and A2 re-hashed **unchanged**. Still exactly four `.sql` migrations, zero non-SQL files, zero seed files, zero Edge Function directories.

## 7. Pre-application staging state — 23/23 as required

PostgreSQL **17.6** · history rows **3** · baseline / A / A2 each present once · B1 **absent** · names `qf_mvp_staging_baseline_269c9265 | qf_mvp_marketplace_authority_foundation | qf_mvp_assignment_lineage_backfill` · **67** public tables · all five foundation tables present · A's additive columns present (4 on `lead_assignments`, 4 on `vendor_credit_logs`, 5 on `vendors`, `request_fingerprint` NOT NULL) · **0 rows** across all 67 tables · `assignment_operations`, `lead_assignment_events`, `vendor_credit_logs`, `communication_intents`, `lead_assignments` all 0 · `auth.users` 0 · providers inactive · all five canonical functions **absent** · 0 B2 triggers · 0 `auth.users` profile trigger · 0 production references · 0 QF-Jarvis references.

## 8. Migration list before application

| Version | Local | Remote |
|---|---|---|
| `20260722000100` | present | present |
| `20260723000100` | present | present |
| `20260723000200` | present | present |
| `20260723000300` | present | **pending** |

Exactly 4 local, 3 remote, **1 pending**. No repository-history replay, no fabricated history.

## 9–10. Final dry-run

```
npx supabase db push --linked --dry-run
```

Exit **0**. Proposed **exactly one** migration:

```
20260723000300_qf_mvp_canonical_assignment_authority.sql
```

The baseline, Migration A and Migration A2 were **not** proposed. No seed, repair, reset, config deployment or Edge Function step appeared.

## 11–12. Application

```
npx supabase db push --linked
```

Run **exactly once**, no `--include-all`, no `--include-seed`. The interactive confirmation was answered `y`; the command string itself was unmodified.

**Exit code: 0.** The CLI reported `Applying migration 20260723000300_qf_mvp_canonical_assignment_authority.sql...` and finished.

**Migration B1: APPLIED AND COMMITTED.** The QF-MVP-20.3B1A defect did not recur — the corrected §7 verification block ran to completion.

**One non-fatal note.** After the migration committed, the CLI attempted an optional local catalog-caching step and emitted `Warning: failed to cache migrations catalog … Failed to read certificate file '…/pgdelta-target-ca.crt'`, having first pulled the `supabase/edge-runtime` container image locally. This is a **local CLI convenience feature**, not part of the migration and not an Edge Function deployment. It ran after the migration was already committed, changed nothing in the database, and the command still exited 0.

## 13. Final migration history — four truthful rows

| Version | Name as stored | Local = Remote |
|---|---|---|
| `20260722000100` | `qf_mvp_staging_baseline_269c9265` | ✓ |
| `20260723000100` | `qf_mvp_marketplace_authority_foundation` | ✓ |
| `20260723000200` | `qf_mvp_assignment_lineage_backfill` | ✓ |
| `20260723000300` | `qf_mvp_canonical_assignment_authority` | ✓ |

Exactly four rows. No additional versions. History was not falsified.

## 14. Phase verifier — 57 PASS / 1 FAIL

Executed verbatim from `supabase/staging-verification/verify_qf_mvp_20_3b1.sql`, re-hashed to `b66ec060…` immediately before execution. All 58 rows returned; check names, `expected` and `details` matched the file exactly, confirming faithful transmission.

**57 PASS.** Every Migration A structural contract, every event-idempotency contract, all five canonical function signatures, all grant contracts, all exclusion contracts, all A2 backfill semantics, migration history and RLS posture passed.

### The one FAIL

| Field | Value |
|---|---|
| `check_name` | **`R03_lineage_append_only_grants`** |
| `expected` | `0 update/delete grants` |
| `actual` | **`4 update/delete grants`** |
| `status` | **FAIL** |
| `details` | `append-only: no role, including service_role, may UPDATE or DELETE lineage` |

### Root cause — a Migration A privilege gap, not a B1 defect

Supabase's platform default privileges on the `public` schema (`pg_default_acl`) grant **`arwdDxtm`** — all privileges — on every newly created table to `postgres`, `anon`, `authenticated` and `service_role`, set by both the `postgres` and `supabase_admin` roles.

When Migration A created `lead_assignment_events`, those defaults applied automatically. Migration A then:

- `revoke all … from public, anon, authenticated` — **correct and effective**; and
- `grant select, insert on table public.lead_assignment_events to service_role` — which only **adds**. It never revoked the default-granted `UPDATE`, `DELETE` and `TRUNCATE` from `service_role`, and never touched `postgres` at all.

**Measured grants on `lead_assignment_events`:**

| Role | Privileges held |
|---|---|
| `postgres` | SELECT, INSERT, **UPDATE**, **DELETE**, TRUNCATE, REFERENCES, TRIGGER |
| `service_role` | SELECT, INSERT, **UPDATE**, **DELETE**, TRUNCATE, REFERENCES, TRIGGER |
| `anon`, `authenticated`, `PUBLIC` | **NONE** ✓ |

The verifier's "4" is `UPDATE` + `DELETE` across those two roles. Migration A's own comment states the intent plainly — *"append-only: no UPDATE and no DELETE is granted, to any role"* — so the intent was right and the implementation was incomplete. **The verifier did its job.**

### Severity and current exposure

| Dimension | Assessment |
|---|---|
| Untrusted-role exposure | **None.** `anon`, `authenticated` and `PUBLIC` hold nothing on the lineage table. |
| Trusted-role exposure | `service_role` and `postgres` can currently `UPDATE`/`DELETE` lineage rows. |
| RLS mitigation | RLS is enabled with 0 policies, but **`service_role` bypasses RLS**, so RLS does not close this. |
| Trigger mitigation | `trg_lead_assignment_events_immutable` is a **Migration B2** object and does **not yet exist**. |
| Net position | Append-only on lineage is presently enforced by **neither privileges nor a trigger**. |
| Actual data at risk | **Zero.** Staging holds 0 lineage rows, and no runtime consumer exists (R1 not started). |

This is not an active exposure today, but the stated immutability invariant is unmet and must be closed **before lineage carries real history and before any production application**.

The same default-privilege pattern also leaves `UPDATE`/`DELETE` for `postgres` and `service_role` on `assignment_operations`, `replacement_requests`, `credit_restoration_approvals` and `communication_intents`. Those tables are **not** declared append-only, so no stated contract is violated there — but the founder may wish to tighten them in the same remediation.

## 15. Targeted baseline preservation — all pass

| # | Check | Expected | Actual |
|---|---|---|---|
| 1 | original 62 baseline tables remain | 67 total (62 + 5 from A) | **67** |
| 2 | 39 QuickFurno functions remain + 5 canonical | 45 | **45** |
| 3 | `public.rls_auto_enable()` remains | 1 | **1** |
| 4 | original policies remain | 67 | **67** |
| 5 | RLS remains enabled | 67 | **67** |
| 6 | six legacy assignment RPCs defined | 6 | **6** |
| 7–9 | blocker RPCs unavailable to PUBLIC/anon/authenticated | 0 | **0** |
| 10 | legacy credit primitives unavailable to untrusted roles | 0 | **0** |
| 11 | legacy `service_role` compatibility not revoked | 2 | **2** |
| 12 | no legacy function dropped | — | confirmed |
| 13 | no Migration C privilege hardening applied | pre-C state | confirmed |
| 14 | no B2 enforcement trigger | 0 | **0** |
| 15 | no Auth profile trigger | 0 | **0** |
| 16 | no provider activated | 0 | **0** |
| 17 | no application data created | 0 rows | **0** |

## 16. B1 authority and security proof

| # | Check | Result |
|---|---|---|
| 1 | exactly five canonical functions exist | **5** ✓ |
| 2 | `qf_assign_lead_vendors_v2` exact reviewed signature | resolved by OID ✓ |
| 3 | `qf_apply_credit_mutation_v2` exact reviewed signature | resolved by OID ✓ |
| 4 | safe `search_path` pinned on all four DEFINER routines | **4/4** ✓ |
| 5–7 | canonical functions unavailable to PUBLIC / anon / authenticated | **0 grants** ✓ |
| 8 | `service_role` holds approved EXECUTE | **5/5** ✓ |
| 9–11 | no caller-controlled limit, cost or delta | signature is `p_lead_id, p_mode, p_candidate_vendors, p_operation_key, p_actor_kind, p_actor_id, p_replacement_ref, p_reason_code` — none matches `(cost\|delta\|credit\|limit\|max)` ✓ |
| 12 | one-credit wallet authority structurally encoded | rows 609/610 pass; offline validator confirms `c_credit_cost := 1` ✓ |
| 13 | `vendor_packages` not mutated | 0 rows present; validator proves no executable mutation ✓ |
| 14 | `app_settings` is not the cost authority | validator proves no executable read ✓ |
| 15 | `client_selected` remains fail-closed | rejected before the operation claim ✓ |
| 16 | no phone-equality ownership authority active | no `client_accounts` reference in executable SQL ✓ |
| 17 | no `audit_logs` dependency | table absent; no executable reference ✓ |
| 18–19 | no provider send, no `whatsapp_logs` delivery authority | ✓ |
| 20 | no B2 trigger | **0** ✓ |
| — | eligibility helper is SECURITY INVOKER | **1** ✓ |

No canonical function was invoked.

## 17. Zero-data and A2 preservation

`assignment_operations` 0 · `lead_assignment_events` 0 · `replacement_requests` 0 · `credit_restoration_approvals` 0 · `communication_intents` 0 · `lead_assignments` 0 · `vendor_credit_logs` 0 · **all 67 tables 0 rows, 0 total** · `auth.users` 0.

**B1 installation created no operation row and no data row of any kind.** A2's empty-staging outcome is preserved exactly.

## 18. Provider-inactive proof

Provider accounts **0** · template mappings **0** · active/canary runtime policies **0** · communication delivery events **0** · Meta remains inactive. No inbound message, webhook receipt, consent event or suppression exists.

## 19. Capability boundary

`client_selected`: **`R1_BLOCKED_PENDING_OWNER_BINDING`**. B1 is now installed, but the mode remains deliberately fail-closed — it returns `unauthorized` before the operation claim, so not even an `assignment_operations` row is created. Installation does **not** authorize runtime activation. No runtime consumer may activate the mode until R1 implements a reviewed ownership binding.

## 20. Advisor findings

**Not read.** Advisors are authorized only after the phase verifier reports 58 PASS / 0 FAIL. That gate was not reached, so no advisor query was issued against staging, and none against production.

## 21. Deviations and failures

- **One verifier failure**, `R03_lineage_append_only_grants` — analysed in §14. Not a deviation from procedure.
- The interactive confirmation prompt was answered `y` on stdin; the command string was exactly as authorized.
- The post-commit CLI catalog-caching warning described in §12 — a local convenience step, not a migration action.

No other deviation. Every command ran exactly once as specified.

## 22. Rollback status

**No rollback performed and none required.** B1 committed cleanly and is coherent; staging is in a consistent baseline + A + A2 + B1 state with zero application data. Nothing is partially applied.

The privilege gap is **corrected forward**, never by editing an applied migration.

## 23. Production and QF-Jarvis non-impact

**Zero.** Production `yqpgcsduqbxulrlzwzap` was never contacted — not linked, not queried, not migrated, no advisor read. Its migration history, schema, data, grants and providers are untouched. The same holds for QF-Jarvis `coilipywdvxklewquqvv`.

## 24. Next-phase prerequisites

The gap must be closed by a **new forward migration** — call it **QF-MVP-20.3B1G (grant hardening)**. Migrations A, A2 and B1 are all applied and immutable; **none of them may be edited**, and no `migration repair` or `db reset` may be used.

Required work:

1. **Founder decision on scope.** Minimum: revoke `UPDATE`, `DELETE` and `TRUNCATE` on `public.lead_assignment_events` from `service_role` and `postgres`, restoring the declared append-only posture. Recommended additionally: decide whether `TRUNCATE` should also be revoked on the other four new tables, and whether `postgres` (the migration/owner role) should be exempt since it can always re-grant to itself.
2. **Author the migration** at a new version above `20260723000300`, containing only `REVOKE` statements. It must not create or alter any table, function or trigger.
3. **Guard the class of defect**, not just this instance: extend `validate-qf-mvp-20-3b1.mjs` so that any migration creating a table in `public` must either issue an explicit `REVOKE ALL … FROM service_role, postgres` before its narrow `GRANT`, or be declared exempt. Supabase default privileges make "grant only what you need" insufficient on its own — an explicit revoke is mandatory.
4. **Re-run the phase verifier** and require **58 PASS / 0 FAIL**.
5. **Then** read staging-only security and performance advisors.
6. Consider whether B2's `trg_lead_assignment_events_immutable` should be pulled forward, since it is the designed defence-in-depth for exactly this invariant and currently does not exist.

Until the verifier returns 58/58, **QF-MVP-20.3B1 must not be marked APPLIED_AND_VERIFIED_ON_STAGING**, and QF-MVP-20.3R1 must not begin.
