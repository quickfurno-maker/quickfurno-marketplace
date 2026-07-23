# QF-MVP-20.3B1G — Lineage Append-Only Grant Repair

**Status: `GENERATED_REVIEWED_NOT_APPLIED`.**

**Type:** offline SQL authoring review, correction and static validation.
**No staging access. No production access. No SQL executed. No `db push`, not even a dry-run. Migration G was NOT copied to the apply workspace.**

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

## 8. Residual observations (not defects, recorded for the founder)

- **Other new tables retain default `UPDATE`/`DELETE` for `postgres` and `service_role`** — `assignment_operations`, `replacement_requests`, `credit_restoration_approvals`, `communication_intents`. None of them declares an append-only contract, so no stated invariant is violated and G deliberately leaves them alone. Tightening them is a separate decision.
- **Verifier rows 45 and 46 scope to `service_role` by name.** A future non-owner role granted lineage mutation would not be caught by those rows, though row 44 covers the untrusted three. A catch-all "no non-owner grantee holds mutation" assertion would be stronger; it is not added here because it is beyond the reviewed contract.
- **Defence in depth is still pending.** Until Migration B2 adds `trg_lead_assignment_events_immutable`, append-only rests solely on the privilege boundary that G establishes. `service_role` bypasses RLS, so RLS can never substitute. Staging test **T70** covers this.
