# QF-MVP-20.3B2 — Universal Assignment Enforcement

**Status: `CORRECTED_B2_APPLIED_VERIFIED_ON_STAGING_READY_FOR_COMMIT_REVIEW` (QF-MVP-20.3B2R1A).**

> **APPLIED AND VERIFIED ON STAGING.** After one failed attempt (QF-MVP-20.3B2A, `name[] = text[]`,
> atomic rollback) and the QF-MVP-20.3B2R1 correction, the corrected B2 (`d1370355…`) was applied to
> staging on **2026-07-23T18:16:43Z** (`npx supabase db push --linked`, **exit 0**); its self-verification
> NOTICE reported **4 functions, 4 triggers, 0 unexpected triggers, B1 authority intact**. Remote history
> is now **6 local / 6 remote**, B2 recorded **exactly once**, and the locked 34-row verifier returns
> **34 PASS / 0 FAIL**. All four functions and four triggers are live; staging application data remains
> **entirely empty**. Production `yqpgcsduqbxulrlzwzap` and QF-Jarvis `coilipywdvxklewquqvv` were never
> accessed. **The next phase is Migration C**, which is not started. See section 16.

Generated at branch `mvp/qf-mvp-20-marketplace-engine-v1`, from the synchronized R1 commit
`5c78ea37a28bb55442bd409636bdfe3dc8efaad7` (parent `4bcdcc55c181ca374e93c9093d45c45620379031`),
origin identical, ahead/behind 0/0, clean tree.

**Corrected artifact hashes (QF-MVP-20.3B2R1):**

| Artifact | SHA-256 |
|---|---|
| `supabase/migrations/20260723000500_qf_mvp_assignment_universal_enforcement.sql` | `d13703553663271172cfdcedc5e9be8374e7e9c1d225d2c67816fce837450cf3` |
| `supabase/staging-verification/verify_qf_mvp_20_3b2.sql` | `89903749acf61061f5332fe1e57a4808a1bf45c6bb0a929ad703810606270677` |
| `scripts/mvp/staging/validate-qf-mvp-20-3b2.mjs` | `87739ae0abc9e1587754add5016199ad0c6312a23c4f4137e22da55ca08aa00d` |

*Pre-correction hashes (superseded, retained for the preflight/failed-apply record in §13–14):*
migration `ab31023e…ca484b`, verifier `0772409e…c2e214`, validator `85cd5f9b…2ee460`.

---

## 1. Why B2 exists

B1 made `qf_assign_lead_vendors_v2` the sole assignment authority and enforced active-3 /
lifetime-6 **inside it**. B1 shipped with **zero** enforcement triggers deliberately, because it
landed before the R1 consumer release — constraining every writer while legacy consumers were
still live would have broken them (staging test **T48**, the B1/B2 boundary proof).

R1 then migrated every compatible runtime consumer onto the authority and made every
client-selected path fail closed. What remains is the **bypass gap**: a write that never goes
through the authority — legacy SQL, a direct `psql` session, an owner-privileged script, a future
rogue writer — is still uncapped. B2 closes it at the database boundary, for every write path and
every role including the table owner.

---

## 2. Invariant matrix

| # | Invariant | Authoritative evidence | Protection before B2 | Bypass path | B2 mechanism | Valid canonical path | Invalid mutation example | Failure behaviour | Verifier row | Validator rule |
|---|---|---|---|---|---|---|---|---|---|---|
| I1 | ≤ 3 **ACTIVE** assignments per lead | `lead_assignments.lifecycle_status ∈ {assigned, delivered, accepted}` | B1 step 6/7 only | any direct INSERT/UPDATE on `lead_assignments` | `trg_lead_assignments_active_cap` → `qf_enforce_lead_assignment_active_cap()` | unaffected — B1 already rejects at the cap **before** inserting, so the trigger never fires on a valid flow | 4th active row, or a transition of an inactive row into ACTIVE at 3 | `raise exception` P0001 `QF_ASSIGNMENT_ACTIVE_LIMIT_REACHED`; whole transaction rolls back | 6, 10, 11, 31 | R08, R09, R10, R12, R13, R17, R18 |
| I2 | ≤ 6 **distinct vendors** per lead lifetime | `lead_assignment_events` where `event_type='assignment_created' AND lifecycle_to='assigned'`, counted `COUNT(DISTINCT vendor_id)` | B1 step 5/8a only | any direct INSERT on `lead_assignment_events` | `trg_lead_assignment_events_lifetime_cap` → `qf_enforce_lead_lifetime_vendor_cap()` | unaffected — B1 skips the vendor at the cap before writing | qualifying event for a 7th distinct vendor | `raise exception` P0001 `QF_ASSIGNMENT_LIFETIME_LIMIT_REACHED`; full rollback | 7, 10, 12, 32 | R08, R09, R11, R12, R13, R18 |
| I2b | a **repeat** event for an already-counted vendor consumes no slot | same | B1 step 8a `not exists` | — | same trigger: `not exists` short-circuit **before** the count | replay via `ON CONFLICT (event_idempotency_key) DO NOTHING` is never rejected | — | allowed | 7 | R11 (fixture N) |
| I3 | `lead_assignment_events` is **append-only** | the table itself | Migration G privileges (application roles only) | the **owner**, and TRUNCATE | `trg_lead_assignment_events_immutable` + `trg_lead_assignment_events_no_truncate` | B1 only INSERTs; `ON CONFLICT DO NOTHING` fires no UPDATE trigger | `UPDATE … SET reason_code=…`, `DELETE`, `TRUNCATE` | `raise exception` P0001 `QF_LEAD_ASSIGNMENT_EVENTS_IMMUTABLE` / `…_TRUNCATE_FORBIDDEN` | 8, 9, 20, 21, 22, 23 | R21 (fixtures X, Y) |
| I4 | **one open replacement** per lead, open = `{requested, approved, activating}` | `replacement_requests.status` | **`uq_replacement_requests_open_per_lead`** (Migration A) — already universal | none | **none added** — already fully enforced declaratively | unaffected | a 2nd open request for the same lead | unique violation 23505 | 16, 17, 33 | — (asserted, not created) |
| I5 | event idempotency unique by `event_idempotency_key` | `uq_lead_assignment_events_idempotency` (Migration A) | already universal | none | **none added** | unaffected | duplicate key | 23505 | 14 | — |
| I6 | assignment uniqueness `lead_id + vendor_id` | pre-existing UNIQUE on `lead_assignments` | already universal | none | **none added** | B1 catches 23505 and reports `duplicate_assignment` | duplicate pair | 23505 | 13 | R02 (no drop) |
| I7 | no caller-controlled assignment cost | B1 `c_credit_cost` + wallet ledger | B1 only | — | **none added** — B2 defines no cost, writes no credit row and calls no credit function | unaffected | — | — | — | R09, check 15 |
| I8 | owner/`postgres` is documented break-glass, **not** an application-role failure | `pg_class.relowner` | G governance | — | reported **informationally** (row 23); B2 additionally blocks the owner at the trigger layer | unaffected | — | — | 23 | R22 |

---

## 3. Object classification

| Object / table | Classification | Reason |
|---|---|---|
| `lead_assignments` | **ENFORCE_IN_B2** | active-three has no universal protection |
| `lead_assignment_events` | **ENFORCE_IN_B2** | lifetime-six and append-only both need universal protection |
| `replacement_requests` | **ALREADY_ENFORCED** | `uq_replacement_requests_open_per_lead` is declarative and already universal. B2 asserts it, creates nothing. |
| `assignment_operations` | **ALREADY_ENFORCED** | `uq_assignment_operations_idempotency` + `assignment_operations_terminal_completion_check` + `…_replacement_ref_check` |
| `vendor_credit_logs` | **ALREADY_ENFORCED** | `uq_vendor_credit_logs_idempotency` and the reference-unique index; credit authority is B1's |
| `credit_restoration_approvals` | **ALREADY_ENFORCED** | `uq_restoration_per_assignment_reason` + approval/ledger CHECKs |
| `communication_intents` | **OUT_OF_SCOPE_WITH_REASON** | an intent outbox, not an assignment invariant |
| `leads`, `vendors` (anon privileges, always-true policy) | **DEFER_TO_C** | privilege/policy hardening is Migration C |
| `auth.users` trigger | **DEFER_TO_D** | — |
| legacy assignment RPCs | **DEFER_TO_E** | B2 asserts they are still **retained** (verifier row 24) |
| the 27-row historical ledger gap | **DEFER_TO_20_4** | reconciliation, not enforcement |
| lead↔client ownership binding | **OUT_OF_SCOPE_WITH_REASON** | `R1_BLOCKED_PENDING_OWNER_BINDING` is unchanged — see §8 |

**B2 creates no index and no table constraint.** Migration A's `idx_lead_assignments_active` and
`idx_lead_assignment_events_lifetime` already match both cap predicates exactly. Validator rule
**R17** fails the migration if an index or constraint is ever added here.

---

## 4. Objects created — the complete list

| Object | Kind | Attached to | Timing |
|---|---|---|---|
| `public.qf_enforce_lead_assignment_active_cap()` | function, **SECURITY DEFINER**, `search_path = pg_catalog, public, pg_temp` | — | — |
| `public.qf_enforce_lead_lifetime_vendor_cap()` | function, **SECURITY DEFINER**, pinned `search_path` | — | — |
| `public.qf_prevent_lead_assignment_event_mutation()` | function, INVOKER (reads no table) | — | — |
| `public.qf_prevent_lead_assignment_event_truncate()` | function, INVOKER | — | — |
| `trg_lead_assignments_active_cap` | trigger (`tgtype` 23) | `public.lead_assignments` | BEFORE INSERT OR UPDATE, FOR EACH ROW |
| `trg_lead_assignment_events_lifetime_cap` | trigger (`tgtype` 7) | `public.lead_assignment_events` | BEFORE INSERT, FOR EACH ROW |
| `trg_lead_assignment_events_immutable` | trigger (`tgtype` 27) | `public.lead_assignment_events` | BEFORE UPDATE OR DELETE, FOR EACH ROW |
| `trg_lead_assignment_events_no_truncate` | trigger (`tgtype` 34) | `public.lead_assignment_events` | BEFORE TRUNCATE, FOR EACH STATEMENT |

Plus four `REVOKE ALL … FROM public, anon, authenticated` on the new functions. **No index, no
constraint, no table, no column, no grant, no data.**

**Why SECURITY DEFINER on the two cap functions.** RLS is enabled on both tables. An
INVOKER-rights trigger could be shown a *filtered* subset of rows, count too few, and permit a cap
breach. The definer always sees the true set. This is asserted by verifier rows 3–4 and validator
rule **R13**, and fixture **P** proves the rule bites.

---

## 5. Concurrency and locking proof

Both cap triggers execute, in order:

```
perform 1 from public.leads where id = new.lead_id for update;   -- statement 1
select count(...) ... ;                                          -- statement 2
```

1. **Serialization.** All writers for a lead queue on the same `leads` row lock. Two concurrent
   inserters cannot both pass the count.
2. **Snapshot freshness.** The lock and the count are **separate statements**. Under READ
   COMMITTED — the Supabase/PostgREST default and B1's documented mode — statement 2 takes a new
   snapshot after the lock is granted, so it sees rows committed by the transaction that just
   released it. A `COUNT`-then-`INSERT` race is therefore impossible.
3. **Lock-order / deadlock.** B1's global order is `leads` → `vendors` (ascending id). B2 locks
   **only** `leads`, and inside B1 that lock is already held, so re-taking it is a no-op that adds
   no wait and no new edge to the wait-for graph. No transaction acquires `vendors` before
   `leads`. **No new deadlock cycle is introduced.**
4. **Recursion.** Neither trigger function performs any INSERT, UPDATE or DELETE. Recursion is
   impossible by construction, not by a guard flag.
5. **Trigger ordering.** `lead_assignments` carries exactly one trigger. On
   `lead_assignment_events` the two triggers fire on **disjoint events** (INSERT vs UPDATE/DELETE
   vs TRUNCATE), so alphabetical BEFORE-trigger ordering has nothing to arbitrate.
6. **Higher isolation levels.** Under REPEATABLE READ / SERIALIZABLE the same `FOR UPDATE` either
   serializes correctly or aborts the transaction with a serialization failure. Both outcomes are
   **fail-closed**; neither permits a cap breach.
7. **Partial effects.** Every rejection is `raise exception` (P0001), which aborts the statement
   and the transaction. There is no compensating write and no partial state.

---

## 6. Canonical B1 compatibility proof

| B1 behaviour | Effect of B2 |
|---|---|
| step 6/7 counts active and rejects at 3 **before** inserting | the trigger re-checks the identical predicate at the identical moment → never fires on a valid flow |
| step 8a skips a vendor at lifetime 6 **before** the assignment, debit, event and intent | same → the lifetime trigger never fires on a valid flow |
| **replacement mode** also passes through step 6/7 and requires headroom (it does not deactivate the original first) | B2 applies exactly the same rule; it is never *more* restrictive than B1 already is |
| step 8c wraps the `lead_assignments` INSERT in `exception when unique_violation` | B2 raises **P0001**, not 23505, so it **cannot** be swallowed by that handler — a cap breach always propagates as a full rollback |
| step 8e inserts lineage with `ON CONFLICT (event_idempotency_key) DO NOTHING` | a BEFORE INSERT trigger fires before the conflict is detected; on a replay the vendor already has a qualifying event, so the `not exists` short-circuit returns immediately. Replays are **never** falsely rejected. |
| B1 never UPDATEs or DELETEs `lead_assignment_events` | the immutability trigger is inert for B1 |
| B1 API signatures | **unchanged** — validator rule R20 fails the migration if B2 redefines a canonical function; verifier row 18 proves all five survive, row 19 proves the grant is neither broadened nor narrowed |

---

## 7. The one deliberate immutability exception

Migration A declares the lineage retention contract:

```
assignment_id -> lead_assignments      ON DELETE SET NULL
operation_id  -> assignment_operations ON DELETE SET NULL
-- "lineage must survive assignment-row cleanup (SET NULL, never delete)"
```

PostgreSQL implements those referential actions as **real UPDATE statements**, which fire a BEFORE
UPDATE row trigger. A blanket "no UPDATE ever" would therefore contradict Migration A and make
assignment rows undeletable — a defect found during the independent review, not after.

So `qf_prevent_lead_assignment_event_mutation()` permits an UPDATE **only** when:

* every column except `assignment_id` / `operation_id` is byte-identical — proved by comparing
  `to_jsonb(new) - 'assignment_id' - 'operation_id'` against the same projection of `old`, which
  stays correct if columns are added later; **and**
* a changed back-reference is being **cleared**, never repointed at a different row.

Lineage *content* remains fully immutable. Fixture **X** proves the "cleared, never repointed"
half is load-bearing.

---

## 8. Deferred: `R1_BLOCKED_PENDING_OWNER_BINDING` — unchanged

Still **unresolved and out of scope**. B2 adds no `client_account_id` / `user_id` / `created_by`
column, creates no client-selection request table, infers no ownership from phone equality, does
not reactivate client-selected assignment and adds no legacy fallback. Enforced by validator rule
**R16** (fixture **S**) and verifier rows **27** and **28**.

---

## 9. Validator and verifier design

**Offline validator** — `scripts/mvp/staging/validate-qf-mvp-20-3b2.mjs`, **57 checks, PASS**.
Reads the real migration from the locked path, tokenizes SQL safely (line/nested-block comments,
single-quoted strings, quoted identifiers, dollar-quoted bodies; **fails closed** on an
unterminated construct) and judges it with a single `evaluateB2Migration()` covering 22 rules.

**Fixtures are load-bearing by construction.** All **25** are one-defect **mutations of the real
migration**, run through the **same** evaluator. A fixture whose mutation becomes a no-op is
reported as vacuous and fails. Check 05 additionally proves every enforced rule has at least one
fixture.

**Mutation-tested against the real artifacts**, not just fixtures:
raising the real active cap to 4 tripped checks 02, 13 **and** exposed fixture I as a no-op;
drifting the TS contract cap to 5 tripped check 13 alone; downgrading the immutability trigger to
INSERT tripped check 02. All three restored byte-identical afterwards.

**SELECT-only verifier** — `supabase/staging-verification/verify_qf_mvp_20_3b2.sql`, **34 rows**,
one `SELECT … UNION ALL` chain with no DML/DDL of any kind, so **every acceptance row produces
PASS/FAIL without executing a write**. Enforcement is proved *structurally* from catalog facts
(`to_regprocedure`, `pg_proc.prosecdef`/`proconfig`, `pg_trigger.tgtype`/`tgenabled`, `pg_class`,
`pg_constraint`, `pg_index`, `has_*_privilege`) — the triggers are never exercised by writing a
row.

**Locked policy honoured.** No row inspects `pg_get_functiondef()`, `pg_proc.prosrc` or
`information_schema` routine-definition text — the comment-retaining sources that aborted B1 in
QF-MVP-20.3B1A. `pg_get_constraintdef()` (row 29) and `pg_get_expr()` (row 17) *are* used: unlike
function source they render a normalized expression that **cannot contain a SQL comment**, so they
are structural facts, not lexical assertions over authored prose.

---

## 10. Material corrections made during independent review

| # | Defect | Why it mattered | Correction |
|---|---|---|---|
| 1 | §5.8 checked legacy-RPC retention by **guessed** `to_regprocedure` signatures | both guesses returning NULL would have **aborted the migration on a false alarm** — authoring from memory, the exact failure mode of QF-MVP-20.3B1A | replaced with a signature-independent `pg_proc.proname` check across all six legacy RPCs |
| 2 | §5.2 matched `proconfig` by **exact string equality** (`@> array['search_path=pg_catalog, public, pg_temp']`) | PostgreSQL normalizes GUC list spelling; a brittle false alarm | structural check: a `proconfig` entry that starts `search_path=` and pins `pg_catalog` |
| 3 | `v_enabled` declared as `"char"` and compared to a text literal | avoidable type surprise in the abort path | declared `text`, selected as `tgenabled::text` |
| 4 | blanket "no UPDATE ever" on lineage | would have **contradicted Migration A's `ON DELETE SET NULL` retention contract** and made assignment rows undeletable | narrow, documented exception: only clearing `assignment_id`/`operation_id`, never repointing (§7) |
| 5 | validator check 12 scanned the **raw** verifier | the verifier's own header *documents* the locked policy by naming `pg_get_functiondef`, so prose flagged itself | scan the comment-stripped text; explicitly exempt `pg_get_constraintdef`/`pg_get_expr` with the reason |
| 6 | validator check 15 rejected any mention of `qf_apply_credit_mutation_v2` | a `to_regprocedure()` **existence assertion** proving B1 is intact is a catalog read, not a credit call | narrowed to actual writes/invocations |
| 7 | R1 harness check 02 was an **absolute** migration count (72) | phase-blind: the next authorized migration makes it fail while R1 is still innocent | split into 02a/02b — no undeclared migration after the R1 boundary, and every later one explicitly declared. Re-proved load-bearing by injecting a rogue migration. |

Correction 7 is the only edit to R1 code: a proven test defect surfaced by B2 generation, corrected
minimally, with R1's guarantee strengthened rather than weakened.

---

## 11. Gates

| Gate | Result |
|---|---|
| `npm run test:mvp:b2` (B2 validator) | **57 passed, 0 failed** · 25 fixtures |
| B2 real-artifact mutation tests | **3/3 caught**, artifacts restored byte-identical |
| `node scripts/mvp/staging/validate-qf-mvp-20-3b1.mjs` (B1/G validator, unchanged) | **165 passed, 0 failed** |
| `npm run test:mvp:r1` (R1 harness) | **62 passed, 0 failed** |
| `npm run test:mvp` (3 suites incl. `assignment-authority`) | **66 cases passed, 0 failed** |
| `npm run verify:mvp` | **exit 0** — now also runs the R1 and B2 validators |
| typecheck / lint / build | clean, exit 0 |
| `git diff --check` | exit 0 |

No managed-database test was run. `test:supabase:lead` was **not** executed.

**Deviation worth flagging:** `verify:mvp` was extended to run `test:mvp:r1` **and**
`test:mvp:b2`. The instruction authorized adding the B2 validator; R1's harness was added in the
same edit because R1 shipped it without gate wiring, which was a real weakness. This strictly
strengthens the gate and removes nothing.

---

## 12. Next phase

**QF-MVP-20.3B2 staging preflight** — *not* application. B2 is generated and reviewed only.
Nothing has been applied, no dry run has been executed, and no database has been contacted.
Migrations A, A2, B1 and G remain applied and immutable.

---

## 13. QF-MVP-20.3B2P — staging preflight

**Status: `B2_PREFLIGHT_COMPLETE_READY_FOR_APPLICATION_REVIEW`. B2 was NOT applied.**

Executed at repository HEAD `5ffce96f15b6ae3ceac6ecbd2afe442fcd5e9c98`, branch
`mvp/qf-mvp-20-marketplace-engine-v1`, **origin identical, ahead/behind 0/0**, worktree clean.
Parent is the R1 commit `5c78ea37a28bb55442bd409636bdfe3dc8efaad7`, unamended.

### Locked hashes — recomputed in full, all verified

| Artifact | SHA-256 |
|---|---|
| B2 migration `20260723000500_...` | `ab31023ebddaec53e9224b04ffaffbb032da130fd67b63b77345c4fc62ca484b` |
| B2 validator | `85cd5f9b033f832165b3dcc4ed439f5e6bbd50e6c00409a2cf14f321472ee460` |
| B2 verifier (34 rows) | `0772409ea2fd25b9f315ea72da7371baaecb2fa7de0b439b19b729e8f2c2e214` |
| baseline `20260722000100` | `920a4aa0143b7c91231a3c83d01452e49b8b9a829c322f15c7df4fe9f07ecc81` |
| baseline verifier | `7ba9792f300119b7c1aa84a4c02394186116a507c9097bd6f95f23f55e504193` |
| A | `b6307094715a102fa0cfccc1533cb8089e5b26fbe1e80a294c127b81e29f2b83` |
| A2 | `9d77f4460701caa1caf172b50886b681f4b7e86849172ca2a7af1ece70eb3d60` |
| B1 | `46ce7377a217a13620305572f1be9038a56c911ce76a556b4d52f91fe107177e` |
| G | `91544524c27ca26020b648f13f462d2613ca407366c8de0f258ea4f04d8c553b` |
| B1 verifier | `e1d9edb85008c8f157016cb04f09ec127aba850d1980ca86ebb8e6721aab7483` |
| B1 validator | `e27d62d09f38e599c34b1084019777b0147df68bba1c91389b52d1df6577a6c8` |

The three B2 hashes were cross-checked three ways — working tree, the **accepted commit object**
(`git show 5ffce96:<path>`), and the values recorded in this document — and all three agree. No
applied migration was edited: `git diff 5c78ea37..HEAD -- supabase/migrations/` lists only
`20260723000500`.

### Offline gates

| Gate | Result |
|---|---|
| B2 validator | **57 passed, 0 failed** · 25 fixtures |
| B1/G validator | **165 passed, 0 failed** |
| R1 harness | **62 passed, 0 failed** |
| `npm run verify:mvp` | **exit 0** — `test:mvp` 66 cases, r1 62, b2 57, typecheck, lint, build |
| typecheck / lint / build | exit 0 |
| `git diff --check` | exit 0 |

**Load-bearing re-proved independently**, not taken from the validator's self-report: injecting
`begin;/commit;`, `drop table public.lead_assignments;` and a Migration C
`create or replace view public.vendor_public_v` into the **real** migration each tripped check 02
(*real B2 migration has zero findings*); the file was restored **byte-identical** each time
(`ab31023e...` before and after, `git status` clean). Source inspection confirms all 25 fixtures
call the same `evaluateB2Migration()` that grades the real file (line 496 vs 640), that a fixture
whose mutation becomes a no-op is reported **vacuous**, and that check 05 proves every enforced
rule has a fixture.

### External apply workspace

`C:\Users\KESHAV SHARMA\Desktop\qf-staging-apply` — **outside Git** (`git rev-parse` →
*fatal: not a git repository*), no `seed.sql`, no `supabase/functions` directory, no non-SQL file
in `supabase/migrations`.

| | Before | After |
|---|---|---|
| SQL files | **5** — baseline, A, A2, B1, G (all hash-matching the repository) | **6** — plus B2 |

B2 was **absent**, so it was copied exactly once. `cmp` exits 0 and both copies hash
`ab31023ebddaec53e9224b04ffaffbb032da130fd67b63b77345c4fc62ca484b` — **byte-identical**.

### Linked target

`.temp/project-ref` = `uckafzuochmbvtiodmcl`; `.temp/linked-project.json` =
`{"ref":"uckafzuochmbvtiodmcl","name":"QuickFurno Staging"}`; the pooler host
`aws-0-ap-southeast-1.pooler.supabase.com` carries the staging ref only. **Production
`yqpgcsduqbxulrlzwzap` and QF-Jarvis `coilipywdvxklewquqvv` are not linked and were never
contacted.**

> The production ref does appear three times in the workspace — all inside the **baseline
> migration's own warning comments** ("MUST NEVER be applied to production"). That is
> documentation warning against production, not a link to it.

### Migration history

| | Before dry run | After dry run |
|---|---|---|
| local | 6 | 6 |
| remote | 5 | **5** |
| pending | B2 only | B2 only |

Parsed structurally from the CLI's JSON, not by eye: remote is exactly
`20260722000100`, `20260723000100`, `20260723000200`, `20260723000300`, `20260723000400`;
`20260723000500` is **local-only**; no unexpected version exists.

### The dry run — exactly one

```
$ npx supabase db push --linked --dry-run      # cwd: qf-staging-apply
Initialising login role...
DRY RUN: migrations will *not* be pushed to the database.
Connecting to remote database...
Would push these migrations:
 - 20260723000500_qf_mvp_assignment_universal_enforcement.sql
Finished supabase db push.
```

`2026-07-23T17:08:21Z` to `17:08:26Z UTC`, **exit code 0**. Structurally verified: the DRY RUN
banner is present, **exactly one** migration is proposed and it is B2, **no earlier migration is
proposed**, there is **no application claim** (`Applying` / `Applied` / `successfully applied` all
absent) and no error text. The command was run **once** and never repeated.

### Proof no write occurred

The migration list was re-run immediately afterwards. Remote history is **byte-identical** to the
pre-dry-run listing: still exactly five remote versions, still 6 local / 5 remote, B2 still
local-only. **No remote history row was created.**

### Safety confirmations

B2 was **not applied**. No `db push` without `--dry-run`. No `migration up`, `repair` or `reset`.
No hand-executed SQL. No link change. No application data, auth user, provider activation, Edge
Function or deployment. No PR, no push.

**Transcript:** `qf-staging-workspace\QF-MVP-20.3B2P-PREFLIGHT-20260723T170821Z.txt` — outside Git.

### Next phase

**QF-MVP-20.3B2 staging application** — *not* Migration C. B2 remains generated, reviewed and
preflighted, but unapplied. Migrations A, A2, B1 and G stay applied and immutable.

---

## 14. QF-MVP-20.3B2A failed application, and the QF-MVP-20.3B2R1 correction

**Status: `B2_RUNTIME_TYPE_CORRECTION_IMPLEMENTED_REVIEWED_READY_FOR_PREFLIGHT`. B2 is NOT applied.**

### The failed application (QF-MVP-20.3B2A)

The single authorized `npx supabase db push --linked` ran at **2026-07-23T17:22:22Z** and exited
**non-zero**. The CLI ran the four `drop trigger if exists` guards (NOTICE skips — normal on a
first apply) and then aborted at **statement 20**, the `DO $verify$` self-verification block:

```
ERROR: operator does not exist: name[] = text[] (SQLSTATE 42883)
At statement: 20
```

The Supabase CLI wraps a migration and its history insert in **one transaction**, so the abort
**rolled the entire migration back atomically**. Confirmed read-only afterwards:

* migration history stayed **6 local / 5 remote**, byte-identical to before;
* `20260723000500` remained **remote-empty** — not recorded;
* **no** B2 function or trigger persisted;
* no second application attempt was made; no repair/reset/up was run.

Transcript (outside Git): `qf-staging-workspace\QF-MVP-20.3B2A-APPLICATION-20260723T172222Z.txt`.

### Root cause — proved from catalog semantics

`pg_attribute.attname` is PostgreSQL type **`name`**. Therefore `array_agg(a.attname …)` returns
**`name[]`**. The comparison literal `array['lead_id','vendor_id']` resolves to **`text[]`**, and
PostgreSQL has **no `name[] = text[]` equality operator** → SQLSTATE 42883. The statement fails at
**plan time**, which is why:

* the **offline validator** (structural/lexical; it never executes the block) passed 57/57; and
* the **dry run** (reports *which* migration would apply; it never runs the SQL) proposed exactly
  B2 with exit 0.

Neither harness executes catalog SQL, so a runtime type-resolution error can only surface at real
application. This is the same defect **family** as QF-MVP-20.3B1A (a `pg_get_functiondef` regex
that only failed on apply).

### Corrected sites — five, all the same family

| # | File | Location | Before | After |
|---|---|---|---|---|
| 1 | migration | §5.7 (constraint-column check) | `array_agg(a.attname order by a.attname) … = array['lead_id', 'vendor_id']` | `array_agg(a.attname::text order by a.attname::text) … = array['lead_id', 'vendor_id']::text[]` |
| 2–3 | verifier | row **B13** (value + CASE) | same uncast form | `a.attname::text` both places + `::text[]` on the literal |
| 4–5 | verifier | row **B15** (value + CASE) | same uncast form | `a.attname::text` both places + `::text[]` on the literal |

A repository-wide search found **no other** `array_agg` over a `name`-typed catalog column and no
sibling in any other catalog (`relname`, `proname`, `tgname`, `conname`, `nspname`). All single
`name = text` comparisons (`relname = 'x'`, `proname in (…)`, `tgname = v_name`) are **type-safe**
— PostgreSQL has a `name = text` operator — and were left unchanged.

### Enforcement semantics are unchanged

The cast changes only the **type domain**, not the values: `array_agg(a.attname::text order by
a.attname::text)` yields the same ordered set of column-name strings, and `= array[…]::text[]`
compares the same values. Ordering, set membership, null behaviour and row cardinality are
identical. Row **B13** still asserts `UNIQUE (lead_id, vendor_id)` **is present** (expected 1) and
row **B15** still asserts the event table is **not** pair-unique (expected 0). No check was removed
or weakened; the migration self-verification was **corrected, not deleted**.

### Validator hardening — rule R23

The offline validator gains **R23_catalog_name_array_cast**, enforced on both the real migration
(via `evaluateB2Migration`, check 02) and the real verifier (check 07b). It parses the **balanced
argument list** of every `array_agg(...)` over comment-stripped SQL (whitespace- and
comment-tolerant, not a brittle regex) and fails if the aggregated element is a known `name`-typed
catalog column (`attname`, `relname`, `proname`, `tgname`, `nspname`, `conname`, …) without a
`::text`/`::varchar` cast. Coverage:

* **fixture Z** reverts the §5.7 cast on the real migration and must trip R23 (proves it bites);
* **fixture Z-pass** proves the corrected `attname::text` form yields **no** finding (the rule is
  discriminating, not a blanket ban on `array_agg`);
* **fixture Z-defect** proves the uncast shape is flagged;
* **real-artifact mutation tests** removed the casts from the actual migration and the actual
  verifier — each tripped its check (02 and 07b), and both files were restored **byte-identical**.

### Independent runtime-type review

Re-reviewed the whole verify block and verifier for type-resolution risk: `v_relname` / `v_enabled`
are declared `text` (the latter fed by `tgenabled::text`), `v_tgtype` is `smallint` compared to
integer literals, `v_sigs`/`v_b1_sigs`/`v_expected` are explicit `text[]`, `proconfig` is coalesced
with `'{}'::text[]`, and every `unnest(array['…'])` is a `text[]` literal passed to
`has_table_privilege(text, text, text)`. **The `array_agg(name)` family was the only defect.** No
over-casting was introduced.

### Gates (all after correction)

| Gate | Result |
|---|---|
| B2 validator | **61 passed, 0 failed** · 26 fixtures (incl. Z, Z-pass, Z-defect, 07b) |
| Real-artifact R23 mutations | migration + verifier both caught; restored byte-identical |
| B1/G validator | **165 passed, 0 failed** |
| R1 harness | **62 passed, 0 failed** |
| `npm run verify:mvp` | **exit 0** |
| typecheck / lint / build | exit 0 |
| `git diff --check` | exit 0 |

### Corrected hashes

| Artifact | SHA-256 |
|---|---|
| B2 migration | `d13703553663271172cfdcedc5e9be8374e7e9c1d225d2c67816fce837450cf3` |
| B2 verifier | `89903749acf61061f5332fe1e57a4808a1bf45c6bb0a929ad703810606270677` |
| B2 validator | `87739ae0abc9e1587754add5016199ad0c6312a23c4f4137e22da55ca08aa00d` |

Baseline, A, A2, B1, G and the B1/G validator+verifier are **byte-unchanged**. No database was
accessed, no dry run was run, no application was retried, and production/QF-Jarvis were never
contacted.

### Next phase

**A fresh QF-MVP-20.3B2 staging preflight** against the corrected artifacts — not application, not
Migration C. The preflight in §13 was run against the superseded `ab31023e…` migration and must be
re-run for the corrected `d1370355…` migration before any new application attempt.


---

## 15. QF-MVP-20.3B2R1P — corrected B2 fresh staging preflight

**Status: `CORRECTED_B2_PREFLIGHT_COMPLETE_READY_FOR_APPLICATION_REVIEW`. B2 was NOT applied.**

Executed at repository HEAD `c3350cd09e2fc9f9048018cd8e7c7eea90e87cdb` (the correction commit),
branch `mvp/qf-mvp-20-marketplace-engine-v1`, **origin identical, ahead/behind 0/0**, worktree
clean. Parent `f633f86cd12ccda27a25183304def60cee744627`.

### Corrected hashes — recomputed, all verified

| Artifact | SHA-256 |
|---|---|
| B2 migration | `d13703553663271172cfdcedc5e9be8374e7e9c1d225d2c67816fce837450cf3` |
| B2 validator | `87739ae0abc9e1587754add5016199ad0c6312a23c4f4137e22da55ca08aa00d` |
| B2 verifier | `89903749acf61061f5332fe1e57a4808a1bf45c6bb0a929ad703810606270677` |

Baseline, A, A2, B1, G are byte-unchanged; the correction commit `c3350cd` contains exactly the
five approved paths and no applied migration.

### Offline gates

B2 validator **61/61** (26 fixtures) · B1/G **165/165** · R1 **62/62** · `verify:mvp` exit 0 ·
typecheck/lint/build exit 0 · `git diff --check` exit 0. **R23 re-proved load-bearing on the real
artifacts:** reverting the `::text` cast on the actual migration tripped check 02, and on the
actual verifier tripped check 07b; both restored byte-identical.

### Superseded workspace file — safely replaced

The external apply workspace still held the pre-correction B2 (`ab31023e…ca484b`,
state **KNOWN_SUPERSEDED_PRESENT**), with baseline/A/A2/B1/G all hash-exact. **Before** any
replacement, the linked migration list proved remote B2 **absent** (6 local / 5 remote, B2 sole
pending). The superseded file was then preserved outside Git and outside the migrations directory
as `qf-staging-workspace\QF-MVP-20.3B2R1P-SUPERSEDED-B2-ab31023e-20260723T174000Z.sql`, and only
the workspace B2 was overwritten from the corrected repository file. Result: workspace B2 =
`d1370355…`, `cmp` byte-identical to the repository; migrations directory still exactly six SQL
files; baseline/A/A2/B1/G untouched.

### Linked target

`uckafzuochmbvtiodmcl` (QuickFurno Staging) only. **Production `yqpgcsduqbxulrlzwzap` and QF-Jarvis
`coilipywdvxklewquqvv` are not linked and were never contacted** — the production ref appears in
the workspace only inside the baseline migration's own warning comments (documentation, not a
link).

### Migration history and the dry run

| | Before dry run | After dry run |
|---|---|---|
| local / remote | 6 / 5 | 6 / **5** |
| B2 | local-only, sole pending | local-only |

```
$ npx supabase db push --linked --dry-run      # cwd: qf-staging-apply
DRY RUN: migrations will *not* be pushed to the database.
Would push these migrations:
 • 20260723000500_qf_mvp_assignment_universal_enforcement.sql
Finished supabase db push.
```

`2026-07-23T18:04:38Z → 18:04:42Z UTC`, **exit 0**. Structurally verified: DRY RUN banner present,
**exactly one** migration proposed and it is the corrected B2, no earlier migration proposed, no
application claim, no error text. Run **once**, never repeated. The immediate re-list is
**byte-identical** to the pre-run listing — **zero remote history rows created**, B2 still
remote-empty.

### Safety confirmations

B2 not applied. No `db push` without `--dry-run`. No `migration up`/`repair`/`reset`. No
hand-executed SQL. No link change. No applied migration modified in repo or workspace. No
application data, auth user, provider activation, deploy, PR or push.

**Transcript:** `qf-staging-workspace\QF-MVP-20.3B2R1P-PREFLIGHT-20260723T180438Z.txt` — outside Git.

### Next phase

**Corrected QF-MVP-20.3B2 staging application** — *not* Migration C. The corrected B2 (`d1370355…`)
is now preflighted and remains unapplied and local-only. Migrations A, A2, B1 and G stay applied
and immutable.


---

## 16. QF-MVP-20.3B2R1A — corrected B2 staging application and verification

**Status: `CORRECTED_B2_APPLIED_VERIFIED_ON_STAGING_READY_FOR_COMMIT_REVIEW`.**

Executed at repository HEAD `4947eec9b73d8cfe0d6736b7b50852260ce5e43d` (origin identical, 0/0, clean),
parent `c3350cd…`. All corrected hashes verified, workspace B2 byte-identical to the repository,
offline gates green (B2 validator 61/61, B1/G 165/165, R1 62/62, `verify:mvp` exit 0), and R23
re-proved load-bearing on both real artifacts.

### Application

| Item | Value |
|---|---|
| Command | `npx supabase db push --linked` (from the external apply workspace) |
| Start / end (UTC) | `2026-07-23T18:16:43Z` → `2026-07-23T18:16:54Z` |
| **Exit code** | **0** |
| Migration applied | **only** `20260723000500_qf_mvp_assignment_universal_enforcement.sql` (`d1370355…`) |
| Self-verification NOTICE | `4 functions, 4 triggers, 0 unexpected triggers, B1 authority intact.` |

The corrected `DO $verify$` block ran to completion — the `name[] = text[]` defect that aborted the
first attempt is fixed. A trailing `failed to cache migrations catalog` pgdelta-certificate Warning
appeared; it is the known **post-commit** local catalog-cache convenience step (identical to
QF-MVP-20.3B1A2 and B1G-A), runs after the migration commits, changed nothing, and the command
still exited 0.

### Migration history

| | Before | After |
|---|---|---|
| local | 6 | 6 |
| remote | 5 | **6** |
| pending | B2 only | **none** |

Remote now holds all six versions — B2 recorded **exactly once**, no unexpected version. The failed
20.3B2A attempt left no history row (atomic rollback), as expected.

### Locked verifier — 34 PASS / 0 FAIL

Executed the locked SELECT-only `verify_qf_mvp_20_3b2.sql` (hash re-checked `89903749…`, unchanged)
against staging. **All 34 rows PASS, zero FAIL, none skipped, no expected value altered, no DML.**
Rows proving the enforcement is live:

| Row | Check | Actual | Verdict |
|---|---|---|---|
| 1 | B2 recorded once | 1 | PASS |
| 2 | 4 enforcement functions | 4 | PASS |
| 3 / 4 | both cap functions SECURITY DEFINER / pinned search_path | 2 / 2 | PASS |
| 5 | none untrusted-executable | 0 | PASS |
| 6 | `trg_lead_assignments_active_cap` (BEFORE INSERT/UPDATE, tgtype 23, enabled) | 1 | PASS |
| 7 | `trg_lead_assignment_events_lifetime_cap` (BEFORE INSERT, tgtype 7) | 1 | PASS |
| 8 | `trg_lead_assignment_events_immutable` (BEFORE UPDATE/DELETE, tgtype 27) | 1 | PASS |
| 9 | `trg_lead_assignment_events_no_truncate` (BEFORE TRUNCATE, tgtype 34) | 1 | PASS |
| 10 | no unexpected trigger on the two tables | 0 | PASS |
| 13 | **UNIQUE (lead_id, vendor_id) present** (the corrected B13) | 1 | PASS |
| 15 | **event stream not pair-unique** (the corrected B15) | 0 | PASS |
| 16 / 17 | one-open-replacement index; open = {requested, approved, activating} | 1 / 1 | PASS |
| 18 / 19 | 5 canonical B1 functions intact; authority service-role-only | 5 / 1 | PASS |
| 20–22 | Migration G lineage boundary preserved (untrusted 0, service_role forbidden 0, SELECT+INSERT 2) | 0 / 0 / 2 | PASS |
| 23 | owner = `postgres`, informational break-glass | postgres | PASS |
| 24 | legacy RPCs RETAINED | RETAINED | PASS |
| 25 / 26 | Migration C projection absent / Migration D auth trigger absent | 0 / 0 | PASS |
| 27 / 28 | owner-binding column / client-selection table still absent | 0 / 0 | PASS |
| 29 / 30 | no `in_progress` lifecycle value; RLS still enabled on both tables | 1 / 2 | PASS |
| 31–33 | no active-3, lifetime-6 or open-replacement breach in live data | 0 / 0 / 0 | PASS |
| 34 | application data | assignments=0 events=0 operations=0 replacements=0 | PASS |

The corrected **B13** and **B15** — the two rows whose cast was fixed in B2R1 — both PASS against the
live catalog, confirming the fix works end-to-end.

### Staging state (SELECT-only)

67 public tables, **sum of all public-table rows = 0** (every table empty), `auth.users` **0**,
provider accounts **0**, ready/active providers **0**, `vendor_public_v` **absent**, `auth.users`
trigger **absent**, legacy RPCs **6**, B2 functions **4**, B2 triggers **4**, **total public
triggers 4** (only B2's). B2 introduced exactly its four functions, four triggers and one history
row — nothing else, no application data.

### Advisors (read-only, after 34/34) — none blocking, none B2-related

**Security — 44 lints.** 37 INFO `rls_enabled_no_policy` (deliberate fail-closed posture, incl. the
Migration A tables); 1 WARN `rls_policy_always_true` on the `leads` INSERT policy (pre-existing;
**Migration C** closes it); 6 WARN SECURITY DEFINER executable (`get_public_eligible_vendors`,
`is_admin`, `owns_vendor`, `rls_auto_enable` — all pre-existing).

**Performance — 230 lints.** 153 INFO `unused_index` (empty-DB artifact); 36 WARN
`multiple_permissive_policies`; 30 INFO `unindexed_foreign_keys`; 7 WARN `auth_rls_initplan`; 3 WARN
`duplicate_index` (Migration C scope); 1 INFO platform.

**No advisor references any B2 object.** B2 added only trigger functions (not REST-callable) and
triggers, so it cannot create or resolve an index or policy lint. Nothing was auto-fixed. None
blocks: none proves B2 failed its reviewed contract, an unexpected schema change, or a critical
staging safety defect.

### Safety confirmations

One real `db push` only. No second push. No `migration up`/`repair`/`reset`. No hand-executed B2
SQL. No link change. No application data, auth user, provider activation, seed, Edge Function or
deployment. No PR, no push. Production and QF-Jarvis were never accessed. The earlier 20.3B2A
failure (SQLSTATE 42883) rolled back atomically and is not a remote history event.

**Transcript:** `qf-staging-workspace\QF-MVP-20.3B2R1A-APPLICATION-20260723T181643Z.txt` — outside Git.

### Next phase

**Migration C** — public vendor projection, anon revokes on `leads`/`vendors`, and replacement of the
always-true `leads` INSERT policy. **C is not started.** Migrations A, A2, B1, G and now B2 are
applied and immutable.
