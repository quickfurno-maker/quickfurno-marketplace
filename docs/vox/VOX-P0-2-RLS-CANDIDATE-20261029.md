# VOX P0-2 — RLS admin/ownership hardening: candidate review (SOURCE-ONLY)

Branch `feat/vox-claude-p0-rls-20261029`, base `94ccdc9a`. Non-deployable candidate work only — nothing in this doc is applied to any managed database.

## 1. What changed

`ops/security/sql-candidates/vox_p0_2_is_admin_active_candidate.sql` is a **non-deployable** `create or replace function` for `public.is_admin()`. It preserves the live signature (`language sql stable security definer set search_path = public`, no arguments) from `supabase/migrations/20260620000002_rls_policies.sql:10-13`, and adds one predicate:

```sql
and is_active is true
```

Effect: an admin profile with `is_active = false` or `is_active = null` now evaluates `is_admin()` to `false` instead of `true`. `NULL IS TRUE` is `false` in Postgres, so the NULL case fails closed by construction — no `coalesce` needed.

This file is not numbered, not in `supabase/migrations/`, and carries a `DO NOT APPLY` header. It is not referenced by any workflow or migration.

## 2. Why `owns_vendor()` is NOT touched in this change

`public.owns_vendor(p_vendor_id uuid)` (`20260620000002_rls_policies.sql:15-18`) checks only `vendors.id = p_vendor_id and user_id = auth.uid()`. It has no `is_active` or `status` awareness at all — unlike `is_admin()`, where the fix is a single added predicate, `owns_vendor()` is shared across **22 Staging policies that mix two different intents**:

- **Historical/record-keeping reads** — a suspended vendor should probably still see their own past payments, leads, and reports. Nothing here currently depends on who's reading; it's about not destroying audit trail visibility for a vendor who exists but is inactive.
- **Active-vendor write gates** — a suspended vendor should probably NOT be able to update lead status, submit new reports, or otherwise act as if still operational.

Grafting a single `vendors.is_active IS TRUE` check onto `owns_vendor()` would apply identically to both cases, because every policy sampled below calls the *same* function for both reads and writes. That would silently cut off suspended vendors' own historical reads at the same moment it correctly blocks their writes — a behavior change with no test coverage and no product sign-off. Fixing it safely requires either a second function (e.g. `owns_active_vendor()`) or splitting read/write policies per table, which is schema-shaped work beyond a single-function patch. **Decision: defer. Do not change `owns_vendor()` in this PR.**

Note: the task brief referenced "invoices/disputes" tables. I could not find `invoices` or `disputes` tables in `supabase/migrations/` (search returned no matches) — **marking this uncertain**. The closest real analogues found in `20260620000002_rls_policies.sql` are `payments`, `lead_assignments`, and `bad_lead_reports`, used below instead.

### 2.1 Read vs. write matrix (grounded in `20260620000002_rls_policies.sql`)

| Table | Policy (source line) | Access | Uses `owns_vendor()` for | Suggested future intent | Confidence |
|---|---|---|---|---|---|
| `vendor_packages` | `"vendor_pkgs owner read"` (L91-92) | SELECT | Owner read | Keep as historical read; active-gating not obviously needed | Uncertain — no product confirmation |
| `payments` | `"payments owner read"` (L99-100) | SELECT | Owner read | Keep as historical read — suspended vendor should likely still see past payment records | Uncertain — no explicit audit-retention requirement found in source |
| `lead_assignments` | `"assign owner read"` (L107-108) | SELECT | Owner read | Keep as historical read | Uncertain |
| `lead_assignments` | `"assign owner update"` (L109-110) | UPDATE (no `is_admin()` fallback) | Owner write gate, via both `USING` and `WITH CHECK` | Candidate for active-vendor gating — this is the clearest write-path case | Moderate — this is a write with no admin override, so it's the best candidate for tightening |
| `lead_status_updates` | `"status owner rw"` (L117, `for all`) | SELECT+INSERT+UPDATE+DELETE combined | Owner read+write undifferentiated (uses `for all`, not split) | Needs splitting into read/write policies before any `is_active` gating is safe | Low — `for all` policies can't be partially gated without rewriting the policy itself |
| `bad_lead_reports` | `"reports owner read"` (L124-125) | SELECT | Owner read | Keep as historical read | Uncertain |
| `bad_lead_reports` | `"reports owner insert"` (L126-133) | INSERT | Owner write gate (plus other `with check` conditions not shown above) | Candidate for active-vendor gating | Moderate |

Takeaway: every `SELECT` policy sampled above is a plausible "keep readable even when suspended" case; every `UPDATE`/`INSERT` policy is a plausible "block when suspended" case; but **none of this is validated against actual product requirements** — it's inferred from policy shape (SELECT vs. write verb), not from any documented vendor-suspension spec. The `lead_status_updates` "status owner rw" policy additionally shows that some tables use a single `for all` policy covering reads and writes together, which structurally cannot be split into read-vs-write behavior without a migration that rewrites the policy, not just the helper function.

## 3. `is_admin()` policy fan-out

59 Staging `public` schema RLS policies reference `is_admin()` (per prior read-only Staging inventory). Because every one of those policies calls the same zero-argument function, the active-profile fix is a single-point change: if the candidate function is ever promoted to a real migration, all 59 policies inherit the fix with no per-policy edits. This is the opposite situation from `owns_vendor()` — one helper, one consistent intent (admin privilege should require an active admin profile), no read/write ambiguity. That asymmetry is why this candidate targets `is_admin()` only.

## 4. Test coverage added

`ops/security/tests/vox_p0_2_admin_rls_pg17.sql` — pure SQL, run manually with `psql` against a disposable/synthetic database (PostgreSQL 17 target; no Docker, no network, no managed credentials). Wrapped in `BEGIN; ... ROLLBACK;` so it leaves no trace on whatever database it's pointed at.

Builds a synthetic `auth.uid()` shim and a minimal `public.profiles` table shaped to match the candidate (`id uuid`, `role text`, `is_active boolean`), loads the candidate function via `\ir`, then exercises:

- Case 1 — active admin (`is_active = true`) → `is_admin()` true.
- Case 1a — active admin → can `SELECT` a demo `admin_only_demo` row gated by `USING (public.is_admin())`.
- Case 2 — disabled admin (`is_active = false`) → `is_admin()` not true.
- Case 2a — disabled admin → `SELECT` on the demo table returns 0 rows.
- Case 3 — null-active admin (`is_active = null`) → not true (confirms fail-closed on NULL).
- Case 4 — active non-admin (`role = 'user'`) → not true.
- Case 5 — missing profile row for the JWT sub → not true.
- Case 6 — absent JWT sub (`auth.uid()` returns null) → not true.
- Case 7 — disabled admin attempts `UPDATE` on the demo table (separate `admin_only_update` policy with matching `USING`/`WITH CHECK`) → 0 rows affected, confirming the fix holds under `SET ROLE authenticated` for a write path, not just `SELECT`.

This was actually run, isolated, against a disposable Docker `postgres:17-alpine` container started with `--network none` (no external network access, no managed credentials reachable), and produced 9 `RAISE NOTICE 'PASS: ...'` lines matching the 9 cases above (active true, active SELECT, disabled false, disabled SELECT, null false, nonadmin false, missing profile false, missing JWT false, disabled UPDATE), with no `ASSERT` failure.

A companion runner `ops/security/tests/invoke-vox-p0-2-admin-rls-pg17.ps1` exists at the sibling path for the operator to re-run against their own disposable instance.

### 4.1 Operator validation commands

```powershell
# Against a disposable/local PostgreSQL 17 instance only — never Staging/Production.
psql "<disposable-pg17-connection-string>" -f ops/security/tests/vox_p0_2_admin_rls_pg17.sql
```

Expect 9 `RAISE NOTICE 'PASS: ...'` lines and no `ASSERT` failure (which would abort the transaction with an error). Exit via `ROLLBACK` either way — the scratch DB is left unchanged.

**`ROLLBACK` is not authorization to run this SQL on any managed (Staging/Production) database.** The `BEGIN; ... ROLLBACK;` wrapper only guarantees the *disposable, isolated* database used here is left unchanged — it does not make the script safe to execute against a managed Supabase database, and it is not a substitute for the sign-offs required in section 5. Only ever run this against a disposable/local instance, as demonstrated in this section.

## 5. Release HOLD

**HOLD — do not apply the `is_admin()` candidate (or any derivative) to the managed Staging or Production database under any circumstance as part of this task.** This includes:

- No `supabase/migrations/` file for this change yet exists and none should be created from this doc alone.
- No `CREATE OR REPLACE FUNCTION public.is_admin()` execution against managed Staging/Production.
- No grant, policy, or schema change on live `public.profiles`, `public.vendors`, or any table referencing `is_admin()`/`owns_vendor()`.

Release requires, independently of this doc:

1. **Real identity/authorization regression testing** against an actual Supabase Auth-backed environment (not the synthetic shim here) — covering real JWTs, real `auth.uid()` session behavior, and real role claims, not just the local synthetic harness in section 4.
2. Confirmation that all 59 `is_admin()`-dependent policies behave as expected for currently-active admins (no unintended lockout) before promoting the candidate to a real migration.
3. A separate, scoped decision — with product/security sign-off — on `owns_vendor()` read/write differentiation per the matrix in section 2.1, including resolving the `lead_status_updates` `for all` policy shape, before any `owns_vendor()` change is attempted.
4. Human DBA/AppSec review and sign-off (deferred/pending per current task scope — not satisfied by this document).

No source files outside `docs/vox/`, `ops/security/sql-candidates/`, and `ops/security/tests/` were touched. No shell commands were run. No credentials were accessed or required.
