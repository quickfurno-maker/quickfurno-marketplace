# QF-MVP-20.3B1R2 — Canonical Authority Self-Verification Correction

**Status: `COMPLETE`. Migration B1 is `CORRECTED_REVIEWED_NOT_APPLIED`.**

**Type:** offline SQL correction · validator hardening · documentation.
**No production access. No staging access. No SQL executed. No `db push`, not even a dry-run. No migration repair. No staging reset. No runtime code. No provider access.**

---

## 1. Repository baseline

| Item | Value |
|---|---|
| Branch | `mvp/qf-mvp-20-marketplace-engine-v1` |
| Starting HEAD (complete) | `8fea7930bda7026bd4cf6ea6a8a9b4ce5ec9e930` |
| Commit subject | `docs(mvp): record authority migration staging failure` |
| `git status --short` | empty — tracked tree clean |
| Uncommitted migration changes | none |
| Secrets, local skills, external workspaces | excluded, zero tracked files |

## 2. Truthful staging migration state (recorded, not re-queried)

Staging `uckafzuochmbvtiodmcl` was **not accessed** during this task. Its state as established by QF-MVP-20.3B1A:

| # | Version | Name | Status |
|---|---|---|---|
| 1 | `20260722000100` | `qf_mvp_staging_baseline_269c9265` | applied |
| 2 | `20260723000100` | `qf_mvp_marketplace_authority_foundation` | applied |
| 3 | `20260723000200` | `qf_mvp_assignment_lineage_backfill` | applied |
| — | `20260723000300` | *(B1)* | **absent — never committed** |

67 public tables, all empty · Migration A objects present · A2 produced zero operations and zero events (staging was empty) · canonical B1 functions absent · no B2 trigger · no Migration C or D work · no Auth users · providers inactive.

## 3. Failure root cause

Migration B1 created its five canonical functions successfully inside its transaction, then its own §7.5c self-verification guard ran a **negative regular expression over `pg_get_functiondef()`** to prove that `qf_assign_lead_vendors_v2` reads neither `app_settings` nor `vendor_packages`.

`pg_get_functiondef()` returns the stored definition **including comments**. The function body carries three comment lines that name those objects precisely in order to document that they are never read:

| Line in body | Text |
|---|---|
| 17 | `-- from app_settings, vendor_packages or any configuration row: no caller and` |
| 25 | `-- accepted from the caller, never read from app_settings, never inferred from` |
| 26 | `-- vendor_packages and never varied by operation mode. A replay, an` |

The guard matched its own prose and raised. The transaction rolled back completely: no canonical function persisted, no B1 history row was written, no application data changed, and A and A2 remained committed.

**This is a migration-authoring defect, not a schema or staging-data defect.** The executable SQL of `qf_assign_lead_vendors_v2` contains no `app_settings` read, no `get_setting_int` call and no `vendor_packages` access; `ASSIGNMENT_CREDIT_COST` remains the internal literal `1`.

## 4. Why B1 may be corrected in place

B1's transaction rolled back, so **no remote migration-history row exists for version `20260723000300`**. Nothing in any database claims that this file was applied. Editing it therefore keeps local and remote history perfectly consistent, and is the truthful action.

The version and filename are **unchanged**. No `20260723000400` and no replacement or "fix" migration was created — inventing a new version would imply the original had been applied, which would be false.

## 5. Immutable applied migrations — re-verified unchanged

| Migration | Locked SHA256 | Result |
|---|---|---|
| A `20260723000100_qf_mvp_marketplace_authority_foundation.sql` | `b6307094715a102fa0cfccc1533cb8089e5b26fbe1e80a294c127b81e29f2b83` | **UNCHANGED** |
| A2 `20260723000200_qf_mvp_assignment_lineage_backfill.sql` | `9d77f4460701caa1caf172b50886b681f4b7e86849172ca2a7af1ece70eb3d60` | **UNCHANGED** |
| Staging baseline `20260722000100_…_269c9265.sql` | `920a4aa0143b7c91231a3c83d01452e49b8b9a829c322f15c7df4fe9f07ecc81` | **UNCHANGED** |
| Baseline verifier | `7ba9792f300119b7c1aa84a4c02394186116a507c9097bd6f95f23f55e504193` | **UNCHANGED** |

A and A2 are already represented by truthful remote history rows and were not edited, reformatted, renamed, squashed or replaced. The validator now enforces this permanently (§8, check 14).

## 6. Removed defective self-checks

Three assertions were withdrawn from B1's §7 verification block. All three were lexical assertions over `pg_get_functiondef()`:

| Assertion | Class | Why withdrawn |
|---|---|---|
| §7.5c `~* '(app_settings\|get_setting_int\|vendor_packages)'` | **negative source** | **The failure.** Matched the function's own comments. |
| §7.5b `not like '%idempotency_conflict%'` | **positive source** | A comment alone satisfies it — false assurance, never proof. |
| §7.5b `not like '%request_fingerprint%'` | **positive source** | Same. The catalog fact (the `NOT NULL` column) is kept instead. |

A prominent **withdrawal notice** replaces §7.5c in the file, stating the locked policy and naming where each proof now lives, so the defect cannot be reintroduced by a future author who does not know the history.

**Locked policy recorded in the migration:** no in-database self-verification block may make a lexical assertion — positive or negative — over any representation that retains comments or quoted literals (`pg_get_functiondef()`, `pg_proc.prosrc`, information_schema routine-definition text). Proving a property of *executable* SQL requires tokenization, which is an offline responsibility. No parser or source-stripping helper function was added to the production schema.

## 7. Retained positive catalog checks

Every catalog-fact assertion is kept — none can be influenced by comments:

| Check | Basis |
|---|---|
| exact function identities and signatures | `to_regprocedure` OID resolution |
| function existence (all five canonical) | `to_regprocedure` non-null |
| no EXECUTE for PUBLIC / anon / authenticated | `has_function_privilege` |
| approved `service_role` EXECUTE | `has_function_privilege` |
| pinned `search_path` on every DEFINER routine | `pg_proc.proconfig` |
| SECURITY DEFINER / INVOKER posture | `pg_proc.prosecdef` |
| no B2 enforcement trigger | `pg_trigger` |
| replay substrate present | `pg_attribute` (`request_fingerprint` NOT NULL) |
| six legacy assignment functions retained | `pg_proc` count |

### Sibling-guard audit — every assertion classified

| # | Assertion | Class | Disposition |
|---|---|---|---|
| 7.1 | `to_regprocedure` existence | positive catalog | **retained** |
| 7.1 | `has_function_privilege` PUBLIC/anon/authenticated | negative catalog | **retained** — privilege facts, not text |
| 7.1 | `has_function_privilege` service_role | positive catalog | **retained** |
| 7.2 | `pg_get_function_identity_arguments … ilike '%limit%'` | negative over **comment-free** projection | **retained** — renders parameter names and types only; no comments, no literals, so a negative match is a genuine signature fact |
| 7.3 | `proconfig … like 'search_path=%'` | positive catalog | **retained** |
| 7.4 | `prosecdef` | positive catalog | **retained** |
| 7.5 | `pg_trigger` existence | negative catalog | **retained** |
| 7.5b | `pg_attribute` request_fingerprint NOT NULL | positive catalog | **retained** |
| 7.5b | `pg_get_functiondef … idempotency_conflict` | **positive source** | **withdrawn** |
| 7.5b | `pg_get_functiondef … request_fingerprint` | **positive source** | **withdrawn** |
| 7.5c | `pg_get_functiondef ~* (app_settings\|…)` | **negative source** | **withdrawn** |
| 7.6 | legacy function count | positive catalog | **retained** |

Migration A and A2 were audited without editing: **neither contains any source-text assertion.** A's verification block reads only `pg_class`, `pg_constraint`, `pg_attribute`, `pg_trigger` and `pg_get_constraintdef` (the last only for *positive* vocabulary presence on a constraint definition, which carries no comments). A2 reads only row counts and column values. Confirmed by the validator across all three migrations.

## 8. Validator hardening

`scripts/mvp/staging/validate-qf-mvp-20-3b1.mjs` grew from **105** to **126** checks. No existing check was weakened or removed.

A new **executable view** (`exec`) was added alongside the existing structural views: top-level code plus every function body, with line comments, nested block comments, single-quoted and escape-string literals and quoted-identifier decoration removed. It is now the only view permitted to answer "does this SQL reference X?".

New checks:

| # | Proves |
|---|---|
| 1–2 | no migration performs a lexical assertion over raw `pg_get_functiondef` / `prosrc` / `routine_definition` — applied to **all three** migrations |
| — | the **phase verifier** makes no such assertion either |
| — | `pg_get_function_identity_arguments` remains explicitly permitted (comment-free structured rendering) |
| 3–5 | `app_settings`, `vendor_packages`, `audit_logs`, `whatsapp_logs`, `get_setting_int` are absent from B1's **executable** SQL, with comments and literals excluded |
| — | B1's prose **does** name those objects while its executable view does **not** — asserting the two views genuinely differ, so the tokenizer cannot pass vacuously |
| 6–7 | executable references are still caught (fixtures D and E) |
| 8 | canonical debit is exactly one wallet credit (retained) |
| 9 | package counters unmodified by B1 and A2 (retained) |
| 10 | B1 retains all **nine** positive catalog guards |
| 11 | no `audit_logs` dependency (retained + extended) |
| 12 | B1 creates no trigger (retained) |
| 13 | canonical grants are `service_role`-only (retained) |
| 14 | **A and A2 are byte-identical to their applied hashes** — an applied migration may never be edited |

## 9. Regression fixture results — all as expected

Deterministic in-memory fixtures, no file or database access:

| Fixture | Scenario | Expected | Actual |
|---|---|---|---|
| **A** | forbidden words in **line comments** | clean | **clean** ✓ |
| **B** | forbidden words in **nested block comments** | clean | **clean** ✓ |
| **C** | forbidden words in **string literals** | clean | **clean** ✓ |
| **D** | executable `SELECT … FROM public.app_settings` | dirty | **dirty** ✓ |
| **E** | executable `UPDATE public.vendor_packages` | dirty | **dirty** ✓ |
| **F** | a raw `pg_get_functiondef` negative-regex guard | rejected | **rejected** ✓ |
| **G** | unterminated dollar-quote | fail closed | **threw** ✓ |

D, E, F and G are the ones that matter: they prove the checks have teeth rather than passing trivially. **Fixture F reproduces the exact defect that failed B1 on staging and confirms the validator would now reject it before any application.**

## 10–12. Artifact hashes

| Artifact | SHA256 | Change |
|---|---|---|
| **B1** (pre-correction) | `a4b5c3783afc6ed82598035afeff60d0e0e84a0c8cdaa08d874e7b2832b842db` | superseded |
| **B1** (corrected) | `46ce7377a217a13620305572f1be9038a56c911ce76a556b4d52f91fe107177e` | **NEW** |
| **Phase verifier** (pre-correction) | `688ab439efac077d8868078875cd501d3221a62c8682c63df6223296f3144cf7` | superseded |
| **Phase verifier** (corrected) | `b66ec0605c88f92629086839f00f481eb9704444f59469a841e4c46e413302ec` | **NEW** |
| **Validator** (pre-hardening) | `4497a3c0f5b36e061ce4a1d4d4977bd831b194fa4ea2335f3dd92f728b5f4795` | superseded |
| **Validator** (hardened) | `734b6a13af45ed0263484ca342be037f5ca53b148f7af4f132d3de7066cfea3f` | **NEW** |

### Phase verifier — correction WAS required

The verifier carried the **same defect in six rows**, and two of them **would have failed against a correctly applied B1**:

| Row | Old assertion | Would have failed? | Disposition |
|---|---|---|---|
| 605 | positive probe for `request_fingerprint` / `idempotency_conflict` / `conflict_retry` | no — but comment-satisfiable, false assurance | replaced by **catalog facts** (fingerprint NOT NULL + terminal-completion CHECK) |
| 607 | `~* (app_settings\|get_setting_int\|vendor_packages)` | **YES** — 2 comment hits each | withdrawn → **INFORMATIONAL**, proof moved to validator + T57–T63 |
| 608 | `~* 'update\s+public\.vendor_packages'` | not today, latent | replaced by a **data fact** (`vendor_packages` row count) |
| 611 | positive probe for the `R1_BLOCKED_PENDING_OWNER_BINDING` marker | no — proved only documentation | **INFORMATIONAL**, proof is T64/T65 + row 622 |
| 612 | `~* 'client_accounts'` | not today, latent | withdrawn → **INFORMATIONAL** |
| 613 | `~* 'audit_logs'` | **YES** — 1 comment hit | replaced by the **catalog fact** that `public.audit_logs` does not exist |

Row **606** (`pg_get_function_identity_arguments … !~* '(cost\|delta\|credit\|limit\|max)'`) is **retained**: identity arguments contain no comments and no literals.

The verifier still returns **58 checks** and remains **SELECT-only**. It continues to check exact canonical signatures, canonical grants, the one-credit contract where structurally provable (rows 606/609/610), no caller cost parameter, no B2 triggers, no `auth.users` trigger, A2 empty-staging behaviour, migration history, legacy function preservation and no public mutation authority.

**Had this file not been corrected, QF-MVP-20.3B1A2 would have applied B1 successfully and then failed verification for the same reason B1 originally failed.**

## 13. Baseline validator

`validate-staging-baseline.mjs` run offline against the external source (`269c9265d32a9f85488d76bfcf9dd528bd9b6b915bafb09ebb024a6bde182a2f`, hash re-verified) → **PASS**: 62 tables · 39 functions · 33 SECURITY DEFINER · 67 policies · 62 RLS · 62 PK · 69 FK · 15 UNIQUE · 169 CHECK · 180 indexes · 0 triggers · 0 views. The raw schema remains outside Git and was not modified.

## 14. Business-contract preservation

The correction touches **only** the §7 self-verification block and the file header. No executable line of any canonical function changed. All eighteen locked behaviours are byte-for-byte as reviewed in 20.3B1R:

1. request fingerprint · 2. persisted replay result · 3. exact replay · 4. `idempotency_conflict` · 5. `conflict_retry` · 6. one-credit assignment cost · 7. wallet-only debit · 8. active-three · 9. lifetime-six · 10. deterministic vendor locking · 11. assignment/event/ledger/intent atomicity · 12. `client_selected` fail-closed · 13. `service_role`-only canonical execution · 14. no provider send · 15. no `whatsapp_logs` delivery authority · 16. no `audit_logs` · 17. no B2 triggers · 18. six legacy assignment functions retained.

The validator independently re-confirms all of these on the corrected file (126/126).

## 15. Migration-history model

- **A and A2 are immutable.** They are applied and represented by truthful remote history rows. Editing them would desynchronise local and remote history. The validator now fails closed if either hash moves.
- **B1 is editable.** Its transaction rolled back and version `20260723000300` is absent remotely, so no database claims it was applied.
- **Corrected B1 retains version `20260723000300`.** No replacement version was created.
- **The next dry-run must propose exactly one pending migration**, `20260723000300`.
- **The next real push must apply B1 only.** A and A2 must not be re-applied.
- **No migration repair is needed.** History is already truthful.
- **No migration-history falsification is permitted** under any circumstance.

## 16. QF-MVP-20.3B1A2 prerequisites

1. Confirm branch and a clean tree; re-verify the **immutable** hashes: A `b6307094…`, A2 `9d77f446…`, baseline `920a4aa0…`, baseline verifier `7ba9792f…`.
2. Re-verify the corrected artifacts: B1 `46ce7377…`, phase verifier `b66ec060…`, validator `734b6a13…`.
3. Run the hardened validator → require **126/126 PASS**, including fixtures A–G.
4. Run the baseline validator against the external source → require **PASS**.
5. Prove the target: `linked=true` for `uckafzuochmbvtiodmcl` only; production and QF-Jarvis `linked=false`; zero production/Jarvis references under `supabase/.temp/`.
6. Refresh the external apply workspace so its `20260723000300` copy is **byte-identical to the corrected file** (`46ce7377…`). The stale pre-correction copy must be overwritten. A and A2 copies must remain at their applied hashes.
7. SELECT-only precheck: history holds exactly **three** rows; `20260723000300` absent; 67 tables all empty; `auth.users` 0; providers inactive; canonical functions still absent.
8. `npx supabase migration list --linked` → 3 remote / 4 local / **exactly one pending**.
9. `npx supabase db push --linked --dry-run` → exit 0 proposing **exactly one** migration, `20260723000300`. Stop if it proposes A, A2 or anything else.
10. `npx supabase db push --linked` **once**. No `--include-all`, no `--include-seed`.
11. On exit 0: history must hold **four** rows; then run the corrected phase verifier (`b66ec060…`) and require **58 PASS / 0 FAIL**.
12. Then, and only then, read staging-only advisors.

### Prohibited repair and reset actions

**Never** run `supabase migration repair`, `supabase db reset`, or any command that edits `supabase_migrations.schema_migrations`. **Never** hand-execute B1's SQL. **Never** re-apply A or A2. **Never** edit A or A2 to "match" a corrected B1. If B1 fails again, stop, gather SELECT-only evidence, and record the failure exactly as QF-MVP-20.3B1A did — history is already truthful and must stay that way.
