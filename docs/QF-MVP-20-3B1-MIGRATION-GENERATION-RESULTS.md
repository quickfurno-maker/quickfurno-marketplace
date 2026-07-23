# QF-MVP-20.3B1 — Migration Generation Results

**Branch:** `mvp/qf-mvp-20-marketplace-engine-v1` · **Generated at** `054a446e38f207b62bab6685928c146279b559ad` (QF-MVP-20.3B1) · **Reviewed and corrected at** `33646e8177b5bb73b9a0985778a3819fe972560d` (QF-MVP-20.3B1R) · **Type:** OFFLINE migration authoring, review and static validation.
**No database access of any kind.** No production, no staging, no SQL execution, no `db push` (not even `--dry-run`), no `db reset`, no `migration repair`, no history change, no deploy, no runtime TypeScript.

**Status: GENERATED_REVIEWED_NOT_APPLIED** (reviewed and corrected by QF-MVP-20.3B1R). Three forward-only migrations, one phase verifier and one offline validator exist in the repository and have never been run against a database.

---

## 1. Artifacts and hashes

| Artifact | SHA256 |
|---|---|
| `supabase/migrations/20260723000100_qf_mvp_marketplace_authority_foundation.sql` | `b6307094715a102fa0cfccc1533cb8089e5b26fbe1e80a294c127b81e29f2b83` |
| `supabase/migrations/20260723000200_qf_mvp_assignment_lineage_backfill.sql` | `9d77f4460701caa1caf172b50886b681f4b7e86849172ca2a7af1ece70eb3d60` |
| `supabase/migrations/20260723000300_qf_mvp_canonical_assignment_authority.sql` | `a4b5c3783afc6ed82598035afeff60d0e0e84a0c8cdaa08d874e7b2832b842db` |
| `supabase/staging-verification/verify_qf_mvp_20_3b1.sql` | `688ab439efac077d8868078875cd501d3221a62c8682c63df6223296f3144cf7` |
| `scripts/mvp/staging/validate-qf-mvp-20-3b1.mjs` | `4497a3c0f5b36e061ce4a1d4d4977bd831b194fa4ea2335f3dd92f728b5f4795` |

**Locked artifacts re-hashed and byte-identical (unchanged by this phase):**

| Locked artifact | SHA256 |
|---|---|
| `supabase/staging-baseline/20260722000100_qf_mvp_staging_baseline_269c9265.sql` | `920a4aa0143b7c91231a3c83d01452e49b8b9a829c322f15c7df4fe9f07ecc81` |
| `supabase/staging-baseline/verify_qf_mvp_staging_baseline.sql` | `7ba9792f300119b7c1aa84a4c02394186116a507c9097bd6f95f23f55e504193` |

The baseline verifier was **not** converted into a forward-migration verifier. `verify_qf_mvp_20_3b1.sql` is a separate, phase-specific artifact in a new directory.

## 2. Identity and ordering

Repository `supabase/migrations/**` held 68 files, highest version `20260721000100`. No `20260723*` version or filename existed. All three new versions are greater than the staging baseline version `20260722000100` and are strictly ascending in the required order:

```
20260722000100 (baseline)  <  20260723000100 (A)  <  20260723000200 (A2)  <  20260723000300 (B1)
```

No collision. Preferred identities were used exactly as specified.

## 3. Design blockers resolved by founder decision

Two contradictions in the authoritative documents blocked the first attempt at this phase. Both were resolved by explicit founder decision and are implemented verbatim.

| # | Contradiction | Founder decision implemented |
|---|---|---|
| 1 | `assignment_operations.lead_id` is frozen `uuid NOT NULL`, but the lineage seed was specified as **one** global batch operation row — impossible across many leads | `lead_id` stays NOT NULL. A2 creates **one operation per distinct lead**, keyed `qf_mvp_20_a2_lineage_backfill_v1:<lead_id>`, `mode='recovery_replay'`, `actor_kind='worker'`, `actor_id=NULL`, `reason_code='migration_backfill'`. The shared batch identity is retained in `metadata`/`result`. Counts derived dynamically, never hardcoded. |
| 2 | Design step 14 requires B1 to append `public.audit_logs`, which is **absent** from the applied baseline (62 tables) and created only by drifted migration `20260621000006` | `audit_logs` is **not** created in A and **not** written in B1. `assignment_operations`, `lead_assignment_events`, `vendor_credit_logs`, `credit_restoration_approvals` and `communication_intents` are the authoritative domain audit evidence. The separate audit step is replaced by **completing the `assignment_operations` result** after the assignment, ledger, lineage and intent writes succeed. |

**Vocabulary confirmation (founder decision 3):** `source_kind = 'migration_backfill'` (never `'backfill'`); historical `source_reference = 'legacy_assignment_seed_v1:<assignment_id>'`. This closes the `backfill` vs `migration_backfill` discrepancy between closure §7 and the schema-contract CHECK vocabulary; the CHECK vocabulary governs and the founder confirmed it.

**Divergence view placement:** the design assigns `vendor_wallet_package_divergence_v` to "Migration C or a later ops migration", not to A. It is therefore **not** created in this phase, and the verifier asserts its absence.

## 4. Migration A — schema delta

`20260723000100_qf_mvp_marketplace_authority_foundation.sql` — **ADDITIVE ONLY**, no data statement, no behaviour change.

| Object | Change | Notes |
|---|---|---|
| `assignment_operations` | **NEW** | `UNIQUE (idempotency_key)`; mode/actor/status CHECKs; `lead_id → leads RESTRICT`; `replacement_request_id` required iff `mode='replacement'` |
| `replacement_requests` | **NEW** | partial `uq_replacement_requests_open_per_lead` is the one-at-a-time authority; FKs to leads/assignments/vendors RESTRICT |
| `credit_restoration_approvals` | **NEW** | `UNIQUE (idempotency_key)`; `uq_restoration_per_assignment_reason`; `applied ⇒ restoration_ledger_id NOT NULL` |
| `lead_assignment_events` | **NEW** | append-only lineage — see §5 |
| `communication_intents` | **NEW** | `UNIQUE (idempotency_key)`; `uncertain_outcome ⇒ status='uncertain'` (terminal) |
| `lead_assignments` | +4 columns | `lifecycle_status` (NOT NULL DEFAULT `'assigned'`, 10-value CHECK), `lifecycle_updated_at`, `operation_id`, `replaced_by_assignment_id`; +2 indexes. **Existing `UNIQUE (lead_id, vendor_id)` untouched.** |
| `vendor_credit_logs` | +4 columns | `approval_reference` (FK RESTRICT, required for restorations), `idempotency_key` (partial unique), `actor_kind`, `actor_id` |
| `vendor_credit_logs.change_type` | CHECK replaced | strict superset: **all 11 legacy values retained** + 4 canonical values, so every historical row stays valid |
| `vendors` | +5 columns | assignment-suspension storage + `idx_vendors_assignment_suspended`. **Inert:** nothing in A/A2/B1 can write them |

**Catalog delta:** +5 tables · +4 `lead_assignments` columns · +4 `vendor_credit_logs` columns · +5 `vendors` columns · +11 indexes · +5 RLS enables · **+0 policies** · +0 views · **+0 triggers**.

**RLS/grants:** all five new tables are RLS-enabled with **no policies** (fail-closed for `anon`/`authenticated`) and granted to `service_role` only. `lead_assignment_events` is granted `SELECT, INSERT` only — **no UPDATE and no DELETE to any role**, so append-only holds at the privilege layer before B2's trigger exists.

**Fail-closed on drift:** deliberately no `IF NOT EXISTS` on new tables, columns or constraints, and no exception-swallowing block. A closing verification block re-asserts the delivered shape and aborts on any deviation — including aborting outright if a `UNIQUE (lead_id, vendor_id)` is ever found on the event table or if the existing `lead_assignments` uniqueness is missing.

## 5. Event-idempotency implementation (QF-MVP-20.3A1R)

`lead_assignment_events.event_idempotency_key text NOT NULL` with `UNIQUE (event_idempotency_key)` as the table's **only** non-primary business uniqueness constraint. There is **no** `(lead_id, vendor_id)` unique constraint, and both Migration A's verification block and the phase verifier fail closed if one ever appears.

| Key | Format | Written by |
|---|---|---|
| Historical seed | `legacy_assignment_seed_v1:<assignment_id>` | A2 |
| Canonical runtime | `assignment_event:<operation_id>:<assignment_id>:<event_type>` | B1 |

The authoritative transaction derives the key in both cases. No RPC parameter accepts one, so an untrusted caller can neither supply nor influence it.

**Four separate boundaries, never merged:** operation → `assignment_operations.idempotency_key` · assignment row → the existing `lead_assignments UNIQUE (lead_id, vendor_id)` · ledger → `uq_vendor_credit_logs_reference` (+ the new `uq_vendor_credit_logs_idempotency`) · event → `event_idempotency_key`.

**Retention:** `lead_id → leads RESTRICT`, `vendor_id → vendors RESTRICT`, `assignment_id → lead_assignments SET NULL`, `operation_id → assignment_operations SET NULL`. No personal-data snapshot columns; `metadata` carries provenance only.

## 6. Migration A2 — backfill behaviour

`20260723000200_qf_mvp_assignment_lineage_backfill.sql` — reviewed **data** migration, fully idempotent.

**Seed set, defined once and used identically by both INSERTs and by verification:**

```
lead_id is not null and vendor_id is not null and assigned_at is not null
and not exists (select 1 from lead_assignment_events e where e.assignment_id = la.id)
```

The "has no lineage at all" clause is what makes re-running safe, and it also guarantees that once B1/R1 are live — when canonical assignments always write their own `assignment_event:...` lineage — a later re-run can never re-seed a canonical row as a legacy one.

| Behaviour | Implementation |
|---|---|
| Operations | one per distinct qualifying lead, `qf_mvp_20_a2_lineage_backfill_v1:<lead_id>`, `ON CONFLICT (idempotency_key) DO NOTHING` |
| Events | exactly one per qualifying assignment, `ON CONFLICT (event_idempotency_key) DO NOTHING` — **never** `ON CONFLICT (lead_id, vendor_id)` |
| Event contract | `assignment_created` / `lifecycle_from=NULL` / `lifecycle_to='assigned'` / `occurred_at := assigned_at` / `recorded_at :=` one deterministic batch stamp / `actor_kind='worker'` / `actor_id=NULL` / `reason_code='lineage_backfill'` / `source_kind='migration_backfill'` |
| Evidence preserved | `metadata` carries `assignment_type`, `credit_deducted_claimed` and an explicit `credit_debit_proven: false` |
| Empty staging | 0 operations, 0 events, no application data — both statements select from `lead_assignments` |
| Re-run | 0 new operations, 0 new events, 0 other change |
| Incomplete rows | a NULL `lead_id`/`vendor_id`/`assigned_at` row is **skipped and reported** by notice, never guessed |
| Counts | every count derived at runtime; the validator asserts no literal `46` or `24` appears in executable SQL |

**Lifecycle backfill method preserved:** Migration A's `NOT NULL DEFAULT 'assigned'` already sets every pre-existing row. A2 performs **no bulk UPDATE**; it verifies the outcome instead, exactly as instructed.

**A2 does not:** create any `vendor_credit_logs` row · change any balance · claim a debit was proven · create any communication intent · send anything · touch provider state · change any existing column value · convert the pending bad-lead report to `invalid` · create any schema object. Verification blocks abort the migration if the ledger or intent row-count changes at all.

## 7. Migration B1 — canonical authority behaviour

`20260723000300_qf_mvp_canonical_assignment_authority.sql` — five functions, nothing else.

| Function | Signature (type-only) | Security |
|---|---|---|
| `qf_vendor_assignment_eligible` | `(uuid, uuid, integer) → jsonb` | STABLE, **INVOKER** |
| `qf_apply_credit_mutation_v2` | `(uuid, integer, text, text, text, text, text, uuid, text, boolean) → jsonb` | DEFINER |
| `qf_assign_lead_vendors_v2` | `(uuid, text, uuid[], text, text, uuid, uuid, text) → jsonb` | DEFINER |
| `qf_request_replacement_v2` | `(uuid, uuid, text, text, uuid) → jsonb` | DEFINER |
| `qf_approve_credit_restoration_v2` | `(uuid, uuid, text) → jsonb` | DEFINER |

Signatures are exactly those frozen in schema contract §9; parameter names come from design §5. Every DEFINER routine pins `SET search_path = pg_catalog, public, pg_temp`.

**Transaction and locking order inside `qf_assign_lead_vendors_v2`:** argument shape → trusted-actor resolution → operation idempotency claim → **lead `FOR UPDATE`** → client ownership re-assertion → **replacement request `FOR UPDATE`** → lifetime read → active count → active-3 validation → candidate loop with **vendors locked in ascending UUID order** → eligibility → ledger-backed debit → assignment insert → lineage event → communication intent → operation completion. Isolation is the PostgreSQL default `READ COMMITTED`; every invariant is protected by a row lock taken before the read that informs it.

**Rejected inputs:** no caller-controlled maximum count (no `p_total_limit` — the legacy 1..9 ceiling never reaches the database), no caller-proven actor identity, no arbitrary credit delta, no provider-send instruction, and `public_visibility` is not an eligibility gate.

**Actor handling:** `p_actor_id` is recorded and cross-checked, never proof. `system`/`worker` must pass NULL; `client`/`admin` must pass a value. For `client`, ownership is **re-asserted under the lead lock** against an active `client_accounts` row whose normalised `phone_e164` matches the lead's phone — the only ownership linkage that exists in the schema (see §13, open item 1).

**Sanitized result:** `{operation_id, status, lead_id, assigned[], skipped[], active_count_after, lifetime_count_after, communication_intent_ids[]}` with reason codes drawn only from the frozen vocabulary. No SQL text, balances or internal reasons are returned.

### Lifetime-six

```sql
select count(distinct vendor_id)
from public.lead_assignment_events
where lead_id = p_lead_id
  and event_type = 'assignment_created'
  and lifecycle_to = 'assigned';
```

Read once under the lead lock, then re-checked **per candidate**: a candidate is "genuinely new" only if it has no qualifying event. A new candidate against a lead already at six is rejected `lifetime_limit_reached` **before** the assignment insert, **before** the debit, **before** the event and **before** any intent. A failed candidate writes no `assignment_created` event and therefore consumes no slot; a later lifecycle event consumes no additional slot because the count is `DISTINCT vendor_id` over qualifying events only.

### Active-three

`count(*)` over `lifecycle_status IN ('assigned','delivered','accepted')` under the lead lock, compared against the internal constant `3`. The loop exits the moment the running active count reaches the cap. The set is written identically in the RPC, in the `idx_lead_assignments_active` predicate and in the CHECK vocabulary; `in_progress` appears nowhere.

### Credit authority

`qf_apply_credit_mutation_v2` is the sole mutation path. Wallet-only: `vendors.remaining_credits` is the debit target and `vendor_packages` is never touched (the validator asserts no `vendor_packages` UPDATE exists). Change types are restricted to the five canonical values. Every row records vendor, delta, before, after, change type, reason, trusted actor, reference type, reference id, idempotency key, approval reference and timestamp. The ledger insert has **no exception handler**, so a failure rolls back the balance change with it. Debits never clamp — an insufficient balance returns `insufficient_credits`; a negative result requires both `p_allow_negative` and `change_type='authorized_manual_adjustment'`. Duplicate reference or idempotency key returns `already_applied` and writes nothing. The 27 historical missing-evidence cases are untouched and remain QF-MVP-20.4 scope.

### Communication boundary

The transaction inserts a `communication_intents` row and nothing more. `recipient_ref` is a SHA-256 hex digest, never a plaintext destination. No Meta, n8n, Jarvis, WhatsApp or SMS call; no `whatsapp_logs` delivery write; no retry of an uncertain outcome. The validator asserts no `pg_net`, `http`, `dblink` or `pg_background` primitive appears anywhere in the three files.

## 8. Authorization and grants

Every canonical function is `REVOKE ALL … FROM PUBLIC, anon, authenticated` followed by `GRANT EXECUTE … TO service_role`, and nothing else. No mutation authority is granted to `PUBLIC`, `anon` or `authenticated` anywhere in the three migrations — asserted by the validator across every `GRANT` statement and re-asserted by B1's own verification block, which aborts the migration if any canonical function is executable by an untrusted role.

No SECURITY DEFINER function treats a supplied actor UUID as proof of authority. Client and admin authorization through server-owned APIs belongs to R1, not to this SQL-only phase.

## 9. Compatibility behaviour

Legacy authority is fully retained. No legacy function is dropped, replaced, altered or revoked, and no legacy grant is broadened. B1's verification block aborts if fewer than six of the legacy assignment RPCs are present:

`admin_smart_assign_lead_to_vendors` · `assign_client_selected_vendor_to_group` · `assign_lead_to_preferred_vendor` · `assign_lead_to_vendors` · `assign_package_to_vendor` · `assign_vendor_to_requirement_group`

Because legacy `service_role` compatibility survives, a runtime revert during R1 never requires a database rollback.

## 10. Excluded work (B2, C, D, E)

| Excluded | Confirmed absent |
|---|---|
| **B2** universal enforcement triggers | **Zero** triggers created. No trigger function is defined either — the design does not require inert preparation in B1. Both A and B1 abort if any non-internal trigger exists on `lead_assignments` or `lead_assignment_events`. |
| **C** public projection and hardening | No `vendor_public_v`, no `vendor_wallet_package_divergence_v`, no anon revoke on `leads`/`vendors`, no policy drop, no duplicate-index removal, no `select("*")` conversion |
| **D** Auth trigger | No `auth.users` trigger; no Auth user created or referenced |
| **E** legacy revocation | No `REVOKE` of any legacy EXECUTE; no function removal |

B2 is deliberately withheld because B1 lands **before** R1: the legacy admin path still accepts a total limit up to 9, legacy RPCs write no lineage at all, and in production the legacy blockers remain anon-executable. A universal trigger now would convert working legacy flows into mid-transaction failures.

**Also excluded:** no suspension or restoration **mutation** path. Migration A adds the five suspension columns as inert storage and B1 reads them as a hard gate; nothing in A/A2/B1 can write them. `qf_approve_credit_restoration_v2` applies an approval that is **already** in status `approved` — it can neither create nor self-approve one. An audited administrative path is R1/B2 or a later reviewed migration.

## 11. Phase verification design

`supabase/staging-verification/verify_qf_mvp_20_3b1.sql` — 58 checks, each returning `check_name · expected · actual · status · details`, `status ∈ {PASS, FAIL}`.

**SELECT-only by construction:** the whole file is one `WITH … SELECT … UNION ALL` statement. It contains no INSERT/UPDATE/DELETE/MERGE/TRUNCATE/CREATE/ALTER/DROP/GRANT/REVOKE/COPY/CALL/DO/SET outside comments — asserted independently by the offline validator.

**Environment agnostic:** no production-specific count is used as a universal expectation. A `facts` CTE derives `assignments_total`, `assignments_qualifying`, `leads_qualifying`, `seed_events` and `seed_operations` from live data, and the A2 checks compare derived against derived. On empty staging the seed checks read `0 = 0` and pass; on a production-shaped database they compare real counts.

Coverage maps to the required list: Migration A columns (1–3) · foundation tables, PK/unique/partial-index contracts (4–7) · event key exists/NOT NULL/uniquely constrained, no `(lead_id, vendor_id)` uniqueness, existing `lead_assignments` uniqueness preserved (8–11) · retention FK delete actions (12–13) · lifecycle vocabulary and active set, lifetime index, ledger vocabulary (14–17) · views absent in this phase (18) · exact canonical signatures resolved by **OID**, not by name, and untrusted roles hold no EXECUTE while `service_role` does (19–23) · six legacy RPCs present and legacy grants not broadened (24–25) · no B2 trigger, no false Migration C claim, no `auth.users` trigger, no provider account, no delivery row (26–30) · A2 semantics: no fabricated ledger row, derived seed counts, key format, event contract, no missing seed, no duplicate key, correct operation anchoring, empty-database consistency (31–39) · migration history holds exactly the baseline plus the three expected versions and no extra same-day version (40–41) · RLS on with no policies, no anon/authenticated grant, no UPDATE/DELETE grant on lineage (42–44).

Check 27 is explicitly **informational** and always reports PASS, with details stating it must never be read as proof that Migration C hardening happened.

## 12. Offline validator design

`scripts/mvp/staging/validate-qf-mvp-20-3b1.mjs` — **105 checks, all passing** (82 generation checks plus 23 QF-MVP-20.3B1R contract checks). Entirely offline: it opens no socket, spawns no process, reads no environment variable and touches no database.

It uses two complementary SQL views, both fail-closed on an unterminated comment, string or dollar-quoted body:

- **`code`** — comments, string literals, quoted identifiers and function bodies removed. Used for structural keyword scans, so a keyword inside a comment or a literal can never trigger a finding.
- **`all`** — comments removed recursively (including inside function bodies) but string literals preserved. Used for value assertions, so a word appearing only in a header comment can never satisfy or violate one.

Checks: exact identities and ascending order above the baseline · SHA256 of all five artifacts · locked baseline and baseline-verifier hashes unchanged · no unapproved destructive operation (the single approved exception is the additive `change_type` CHECK replacement) · no TRUNCATE/DELETE/DROP DATABASE · no role or session-authority change · no URL, project ref, token or credential in executable text · no grant to PUBLIC/anon/authenticated · explicit `REVOKE … FROM PUBLIC` and `GRANT … TO service_role` for each of the five canonical RPCs · `search_path` pinned on every DEFINER function · no legacy function dropped and no legacy `service_role` EXECUTE revoked · no trigger attached · no `auth.users` trigger · no Migration C work · no `audit_logs` object or write · no `UNIQUE (lead_id, vendor_id)` defined and `UNIQUE (event_idempotency_key)` present and NOT NULL · existing `lead_assignments` uniqueness not dropped · A2 seeds on the event key and never on `(lead_id, vendor_id)` · `source_kind='migration_backfill'` · per-lead operation key · A2 writes no ledger row and no intent · no hardcoded `46`/`24` in executable SQL · B1 writes assignment, ledger, lineage and intent in one function body with no explicit COMMIT/ROLLBACK/SAVEPOINT · runtime event-key format · lifetime is `count(distinct vendor_id)` · no limit parameter · no provider primitive · wallet-only debit · no suspension mutation path · phase verifier is SELECT-only with the five required output columns and derived expectations · header discipline on all three migrations.

## 12b. QF-MVP-20.3B1R - contract review and corrections

Four contracts were reviewed against the generated SQL. **Three required correction; one was already satisfied.**

### Contract 1 - idempotent replay: CORRECTED

The generated B1 trusted `assignment_operations.idempotency_key` **alone**. Reusing one key with a *different* authority request would have replayed a foreign result as success. Corrections:

- **Migration A** gains `assignment_operations.request_fingerprint text NOT NULL` (minimum length 16) and `assignment_operations_terminal_completion_check` - a terminal operation must carry both `completed_at` and a non-empty `result`.
- **Migration B1** computes a normalized fingerprint before the claim and branches four ways:

| Situation | Outcome | Mutation |
|---|---|---|
| Key free | claim, proceed | the operation itself |
| Same key, same fingerprint, terminal | persisted `result` verbatim + `already_applied = true` | **none** |
| Same key, **different** fingerprint | `idempotency_conflict` | **none** |
| Same key, same fingerprint, still `in_progress` | `conflict_retry` (incomplete/rolled-back attempt) | **none** |
| Key row vanished (claimant rolled back) | `conflict_retry` | **none** |

**Fingerprint composition** - SHA-256 hex of a canonical JSON payload: `v`, `lead_id`, `mode`, **deduplicated and sorted** candidate vendor ids, `reason_code`, `replacement_ref`, `actor_kind`, `actor_id`. Caller ordering is only a ranking preference, so sorting keeps the fingerprint stable. It deliberately excludes `now()`, transaction ids, random values and all volatile database state - the validator asserts this, because a volatile fingerprint would make every genuine replay look like a conflict.

**Persisted replay result** - `result` carries `operation_id`, `assigned[]` (assignment_id, vendor_id, credit_ledger_id), `skipped[]` (vendor_id, sanitized reason_code), `active_count_after`, `lifetime_count_after` and `communication_intent_ids[]`. The replay branch returns it verbatim: it mints no new id, runs no second eligibility calculation, and does not change its answer because vendor state, credit balance or assignment counts moved after the original commit. Completion is written inside the same transaction as the assignment, ledger, lineage and intent writes.

**Concurrency** - `INSERT ... ON CONFLICT (idempotency_key) DO NOTHING` means exactly one invocation claims the operation; a concurrent duplicate blocks until the first transaction resolves and then takes the replay-or-conflict path. A2 supplies its own deterministic fingerprint so backfill rows satisfy the same schema.

### Contract 2 - assignment credit cost: CONFIRMED, made explicit

`ASSIGNMENT_CREDIT_COST = 1` is now stated as a single named authority with a locked comment. The debit is `-c_credit_cost` with `change_type='lead_assignment_debit'`, reference `lead_assignment`/`<assignment_id>` and idempotency key `assignment_debit:<operation_id>:<assignment_id>`.

Zero-cost by construction, because none of these reaches the debit: a replay (returns before the loop), an already-assigned vendor (`duplicate_assignment` on the existing unique constraint), a rejected candidate, a cap-blocked candidate, and the A2 backfill. Replacement debits only when it creates a genuinely new assignment.

Not configurable: no caller parameter, no `app_settings` or `get_setting_int` read, no inference from `vendor_packages`, no variation by mode. Balances never clamp - an insufficient balance returns `insufficient_credits`. Atomicity is symmetric: the assignment rolls back if the debit fails, and the debit rolls back if the assignment, event or intent fails.

### Contract 3 - client ownership: FAIL-CLOSED, `R1_BLOCKED_PENDING_OWNER_BINDING`

The generated B1 re-asserted client ownership by matching `client_accounts.phone_e164` to `leads.phone` through `qf_norm_text`. Review rejected this:

- `public.qf_norm_text` is `nullif(lower(trim(coalesce(...))), '')` - **raw-text equality after casing and trimming**, not canonical phone normalization, and the schema contains no phone normalizer at all.
- `public.leads` has no `client_account_id`, `user_id` or `created_by` column, so there is no ownership binding to re-assert against.
- Founder decision 3 requires canonical normalized phone values and forbids accepting zero or multiple matches. That condition cannot be met with the available schema, and inventing a canonicalisation here would be a new runtime ownership system the schema contract never froze.

**Disposition:** `client_selected` mode returns `unauthorized` and mutates nothing - the rejection happens *before* the operation claim, so not even an operation row is created. This is the founder's stated fallback, chosen over weakening authorization to make the mode operational. The whole function remains `service_role`-only, so `anon` and `authenticated` reach it in no mode.

**R1 unblocks it** with either an explicit lead/client ownership binding column, or a server-created client-selection request row binding authenticated client, lead and requested vendor. Until that review lands, no runtime consumer may activate the mode.

### Contract 4 - audit and historical gap: CONFIRMED, no change needed

Migration A does not create `public.audit_logs`; B1 does not insert into it; the five domain tables carry the evidence. A2 creates no `vendor_credit_logs` row, changes no existing assignment row and fabricates no historical debit, so the 27 ledger-gap assignments are untouched and remain QF-MVP-20.4 scope. The `audit_logs` drift stays non-blocking.

## 12c. Baseline-validator reproducibility: RESOLVED

The previous phase reported this **BLOCKED_EXTERNAL_EVIDENCE**. It is now closed.

The approved external source at `Desktop\qf-staging-workspace\production-public-schema.sql` exists and hashes to `269c9265d32a9f85488d76bfcf9dd528bd9b6b915bafb09ebb024a6bde182a2f`, matching the required SHA256 exactly. `scripts/mvp/staging/validate-staging-baseline.mjs` ran with its documented arguments and returned **PASS**: 62 tables, 39 functions, 33 SECURITY DEFINER, 67 policies, 62 RLS, 62 PK, 69 FK, 15 unique, 169 check, 180 indexes, 0 triggers, 0 views; `anon` holds no table grant and executes only `get_public_eligible_vendors`; 10 mutation RPCs verified not reachable by anon/authenticated/PUBLIC; baseline SHA confirmed locked and unmodified.

The raw schema was **not** copied into Git, **not** modified, and no database was accessed.

## 12d. QF-MVP-20.3B1P — staging application preflight: PASSED

Full record: [`QF-MVP-20-3B1-STAGING-APPLICATION-PREFLIGHT.md`](QF-MVP-20-3B1-STAGING-APPLICATION-PREFLIGHT.md).

All seven locked artifact hashes re-verified, phase validator **105/105 PASS**, baseline validator **PASS**. Staging (`uckafzuochmbvtiodmcl`) proven as the sole linked target — production and QF-Jarvis both `linked=false`, and zero production/Jarvis references anywhere under `supabase/.temp/`.

**Staging pre-application state (SELECT-only, 20/20 as expected):** PostgreSQL 17.6 · 62 tables · 39 QuickFurno + 1 managed = 40 functions · 62 RLS · 67 policies · exactly one history row `20260722000100` / `qf_mvp_staging_baseline_269c9265` · all 62 tables zero rows · `auth.users` 0 · providers empty and disabled · none of the five foundation tables present · neither canonical RPC present · zero production or Jarvis references in object bodies, defaults or comments.

**Locked baseline verifier re-executed verbatim → 40 PASS / 0 FAIL.** The phase verifier was deliberately not run, since A/A2/B1 are not applied.

**Dry-run:** `npx supabase db push --linked --dry-run`, exit code **0**, proposing **exactly three** migrations in order — A, then A2, then B1. The baseline was not re-proposed and none of the other 68 repository migrations appeared. **Post-dry-run non-mutation proof:** history still 1 row, A/A2/B1 still absent remotely, foundation tables and canonical functions still absent, all tables still empty, `auth.users` still 0, providers still inactive, 0 public-table triggers.

**Status: A / A2 / B1 remain `GENERATED_REVIEWED_NOT_APPLIED`.** No staging write, no real `db push`, no migration-history change, no production access.

## 13. Remaining unknowns and open items

1. **`client_selected` mode is FAIL-CLOSED - `R1_BLOCKED_PENDING_OWNER_BINDING`.** `public.leads` has no `client_account_id`, `user_id` or `created_by` column, and the schema has no canonical phone normalizer, so the database cannot re-assert client ownership. The mode now returns `unauthorized` before any write (see 12b, contract 3). **R1 must add an explicit ownership binding** - either a lead/client column or a server-created client-selection request row - before any runtime consumer activates the mode. This is the one functional capability deliberately withheld.
2. **`public.audit_logs` drift is now documented but not closed.** The table is created by repository migration `20260621000006_superadmin_foundation.sql` yet is absent from the applied baseline and therefore from production. Whether to apply that drifted migration is a separate decision, tracked outside this phase.
3. **Replay and conflict codes are runtime contract.** R1 must treat `already_applied` as success, `idempotency_conflict` as a caller bug (never retry the same key with changed inputs) and `conflict_retry` as safe to retry with the same key. The server must also derive the operation key deterministically, or a retried request will fingerprint-match but key-miss.
4. **`ASSIGNMENT_CREDIT_COST = 1` is locked in SQL**, mirroring the legacy `LEAD_CREDIT_COST` in `assign_lead_to_paid_vendors_phase26a` and `lib/vendors/vendorEligibility.ts`. A shared SQL+TS constant assertion is R1 work.
5. **The 27-row ledger gap is untouched** and remains QF-MVP-20.4 scope. Neither A2 nor B1 improves or worsens it.

## 14. Rollback boundaries

| Migration | Rollback | Caveat |
|---|---|---|
| **A** | drop the five new tables, the added columns on `lead_assignments`/`vendor_credit_logs`/`vendors`, and restore the 11-value `change_type` CHECK | Fully reversible **while the new tables are empty**. Once lineage or operation rows exist they are business truth and must not be dropped to roll back code (rollback rule 6) — stop using them instead. |
| **A2** | `delete from lead_assignment_events where source_kind='migration_backfill' and event_idempotency_key like 'legacy_assignment_seed_v1:%'` then `delete from assignment_operations where idempotency_key like 'qf_mvp_20_a2_lineage_backfill_v1:%'` | In that order, as a reviewed forward step. Re-running A2 afterwards reproduces the identical seed, because every key is derived deterministically from existing row identifiers. |
| **B1** | drop the five canonical functions | Legacy RPCs are untouched and serve traffic immediately. Rows already created by the canonical engine are never deleted to roll back code. |

Migration history is never manually falsified; rollback is expressed as a new reviewed forward migration.

## 15. Application prerequisites

**Staging (QF-MVP-20.3B1P — Staging Application Preflight):**
1. Confirm staging is still `APPLIED_AND_VERIFIED` at baseline `920a4aa0…` with verifier `7ba9792f…` unchanged.
2. Confirm `supabase_migrations.schema_migrations` holds exactly the one baseline row and no `20260723*` version.
3. `db push --dry-run` (linked staging) — confirm exactly these three versions are pending, in order.
4. Confirm staging remains empty, providers inactive, no Auth users.
5. Apply A → A2 → B1 in one reviewed push, then run `verify_qf_mvp_20_3b1.sql` and require **all-PASS**.
6. Re-run the locked baseline verifier and confirm it still passes unchanged.
7. Execute the staging test matrix, including T33–T42 (lineage idempotency) and the new T43–T48 (this phase).

**Production:** staging all-PASS **and** rollback rehearsed **and** founder sign-off on A2 as a reviewed data step — A2 mutates production by creating lineage rows and must be approved separately from the schema DDL. Migration C remains the fix for the live anon exposure on `leads`/`vendors`, and Migration E for the anon-executable blockers; neither is in this phase, so **applying A/A2/B1 to production closes no existing production exposure.**

## 16. Gate result

| Gate | Result |
|---|---|
| Offline validator (`validate-qf-mvp-20-3b1.mjs`) | **PASS** — 105/105 |
| Locked baseline + verifier hashes | **UNCHANGED** |
| `git diff --check` | clean |
| `npm run verify:mvp` | **PASS** — 40/40 test cases, typecheck, lint, build |
| Database access | **NONE** — no production, no staging, no SQL executed |
| Migration state | **A / A2 / B1 = GENERATED_REVIEWED_NOT_APPLIED** |

**Locked baseline validator:** **PASS**. The external source at `Desktop\qf-staging-workspace\production-public-schema.sql` was located and hashed to the required `269c9265d32a9f85488d76bfcf9dd528bd9b6b915bafb09ebb024a6bde182a2f`, and `scripts/mvp/staging/validate-staging-baseline.mjs` ran to PASS with its documented arguments. This closes the `BLOCKED_EXTERNAL_EVIDENCE` status carried by QF-MVP-20.3B1. See 12c. The raw schema was not copied into Git, not modified, and no database was accessed.

**QF-MVP-20.3B1P readiness: READY.** The baseline-validator blocker is resolved, the phase validator passes 105/105, and the three migrations plus the phase verifier are reviewed. The one open functional gap, `client_selected` fail-closed, does not block staging application - it is deliberately withheld authority, not a defect.
