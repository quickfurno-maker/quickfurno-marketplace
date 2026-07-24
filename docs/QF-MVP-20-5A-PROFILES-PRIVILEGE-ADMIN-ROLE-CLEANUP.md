# QF-MVP-20.5A — Profiles Base-Table Privilege Hardening + admin_role Drift Cleanup

**Status: `PROFILES_PRIVILEGE_AND_ADMIN_ROLE_CLEANUP_APPLIED_AND_VERIFIED_ON_STAGING`.**
(QF-MVP-20.5A generated the migration; 20.5A1 corrected the service_role matrix — §10; 20.5AP ran the
staging preflight — §11; 20.5AA applied + verified on staging — §12.)

> Generation + offline-review only. **No managed database was accessed**; the migration is **generated
> but not applied**. This closes the two mandatory profiles/auth follow-ups before Marketplace Engine
> closeout: (1) add the minimum `authenticated` base-table privilege the real runtime/RLS contract needs,
> and (2) remove the obsolete `profiles.admin_role` drift — **without** changing canonical role authority,
> the auth-trigger trusted-marker contract, or owner-binding deferral.

Generated at HEAD `5fc5ba40909219e17c6a54e446e0c16f17d188a1` (origin identical, 0/0, clean).

## 1. Complete profiles authority inventory (repository-proved)

**Table (canonical `20260620000001`):** `public.profiles(id uuid pk → auth.users on delete cascade,
created_at, full_name, phone, role text check (role in ('admin','vendor')), is_active boolean)`. The
optional historical `20260621000006` added `admin_role text check (...)`.

**RLS + policies (`20260620000002`):** RLS enabled; three policies, all `to authenticated`:
- `profiles self read` — SELECT `using (id = auth.uid() or public.is_admin())`;
- `profiles self update` — UPDATE `using (id = auth.uid()) with check (id = auth.uid())`;
- `profiles admin all` — ALL `using (public.is_admin()) with check (public.is_admin())`.
`public.is_admin()` = `exists(select 1 from public.profiles where id = auth.uid() and role = 'admin')` —
it reads **`profiles.role`**, never `admin_role`.

**Explicit table grants:** **none exist in any migration.** Effective privileges therefore depend on
environment-specific Supabase defaults — genuine drift. (On the staging baseline squash, `authenticated`
currently holds **no** privilege on profiles at all.)

**Runtime reads/writes of profiles (complete):**
| Site | Client role | Op | Columns |
|---|---|---|---|
| `components/AdminLoginForm.tsx` | authenticated (browser) | SELECT | `role` (own row) |
| `components/LoginForm.tsx` | authenticated (browser) | SELECT | `role` (own row) |
| `app/actions.ts` | authenticated (server session) | SELECT | `role` (own row) |
| `services/vendorAccessService.ts` | authenticated (server session) | SELECT | `role` (own row) |
| `services/adminService.ts` | service_role | SELECT | `id, created_at, full_name, phone, role, is_active` |
| `services/communicationRecipientResolver.ts` | service_role | SELECT | `phone` (role='admin') |
| `scripts/grant-superadmin.mjs` | service_role | UPSERT | `id, role, full_name, is_active` |

**There is no `authenticated` write to profiles anywhere.** Profile creation is the `20260723000700`
auth trigger; admin writes/reads go through `service_role` (which bypasses RLS). No query selects
`admin_role`.

**`profiles.role` references:** the login/access guards + `is_admin()` (authority). Unchanged here.

**`profiles.admin_role` references:** only a dead type field (`components/admin/adminTypes.ts`) and a dead
display fallback (`components/admin/AdminSectionPage.tsx`, always `undefined → "Superadmin"` because the
`adminService` select list omits it). No policy/trigger/view/function/query/test depends on it. Distinct
from the legitimate **`auth app_metadata.admin_role`** JWT claim (`grant-superadmin.mjs`, `app/actions.ts`,
`AdminLoginForm.tsx`), which is **not** touched.

## 2. Frozen authenticated privilege decision (evidence-based)

- **authenticated: SELECT only.** Proven by four own-row `SELECT role` read sites through the
  authenticated session; own-row visibility is enforced by the unchanged `profiles self read` policy.
- **authenticated: no INSERT** — creation is trigger-controlled. **no UPDATE** — no self-edit exists.
  **no DELETE/TRUNCATE/REFERENCES/TRIGGER/MAINTAIN.**
- **anon / PUBLIC: nothing.**
- **service_role: SELECT/INSERT/UPDATE only** (admin bootstrap upsert + admin dashboard reads). DELETE had
  no proved runtime need, so it — and TRUNCATE/REFERENCES/TRIGGER/MAINTAIN — are **not** granted
  (corrected in QF-MVP-20.5A1 before staging preflight; see §10).

The migration makes this explicit and deterministic (revoke-then-grant), fixing the drift in both
directions: it **adds** the missing `authenticated` SELECT (staging) and **removes** any default write
grant that would otherwise exist (production).

## 3. Role-escalation analysis (mandatory)

The `profiles self update` policy checks only `id = auth.uid()` in its `USING`/`WITH CHECK` — it does **not**
constrain which columns change. So **if** `authenticated` held a table-level `UPDATE`, a user could run
`update public.profiles set role = 'admin' where id = auth.uid()` and self-escalate. Because no runtime
needs `authenticated` UPDATE, the **minimum safe mechanism** is to grant **SELECT only** and revoke UPDATE:
the escalation is closed at the grant layer. The policy is left intact (boundary preserved) but inert
without the grant, and both the migration self-check and the verifier assert `authenticated` has **no**
UPDATE — so any future re-grant is caught.

## 4. admin_role drift decision

**State B (production drift).** The column exists in the historical migration chain (`20260621000006`) and
on any environment where that ran (production), but is **non-authoritative and unused** (proof in §1). The
migration removes it forward-only and idempotently:
`alter table public.profiles drop column if exists admin_role;` — a no-op on the staging squash (column
absent), a clean removal on production. No parallel admin field is introduced. The two dead runtime
references are removed atomically (`adminTypes.ts` field deleted; `AdminSectionPage.tsx` renders the
constant `"Superadmin"`, preserving today's always-`Superadmin` behaviour). The stale
`grant-superadmin.mjs` log line that falsely claimed to set `profiles.admin_role` is corrected.

## 5. Migration (generated, unapplied)

`supabase/migrations/20260723001000_qf_mvp_profiles_privilege_admin_role_cleanup.sql`:
- re-asserts RLS enabled (idempotent);
- `revoke all` on profiles from `public`, `anon`, `authenticated`; `grant select` to `authenticated`;
  `revoke all` from `service_role` then `grant select, insert, update` to `service_role` (no DELETE);
- `drop column if exists admin_role`;
- catalog-fact self-verification (`do $verify$`): RLS on; authenticated SELECT and **no** write/DDL
  privilege (escalation proof); anon/PUBLIC zero; service_role SELECT+INSERT+UPDATE; `admin_role` absent;
  `role` present; the three policies present with no anon target; `is_admin()` + the D auth trigger
  present; the 20.4C register present; no owner-binding column on `leads`.
- Contains no DML/backfill, no role rewrite, no transaction control, no history write, no
  ALTER DEFAULT PRIVILEGES, no broad-schema grant, and does not touch the auth trigger or
  assignment/package/credit/lead/public-vendor-projection logic.

## 6. Admin bootstrap preservation

`grant-superadmin.mjs` sets `auth app_metadata.admin_role = 'Superadmin'` (JWT claim, unchanged) and
upserts `profiles(role='admin', …)` via **service_role**. The migration preserves `service_role`
SELECT/INSERT/UPDATE on profiles, so the bootstrap still works. No client-side path can create an admin
profile; no admin is inferred from an email allowlist.

## 7. Verifier

`supabase/staging-verification/verify_qf_mvp_20_5a.sql` — pure SELECT (23 rows) asserting, after future
application: migration recorded once; profiles present; RLS on; authenticated SELECT-only; no-UPDATE
escalation prevention; anon/PUBLIC zero; the own-row SELECT + self-update + admin policies preserved with
no anon target; `admin_role` absent; `role` + `is_admin()` + the D trigger/`handle_new_user` preserved;
service_role bootstrap authority; the 20.4C register intact and empty; and A/A2/B1/G/B2/C/D/E + owner
binding deferral untouched.

## 8. Offline gates

20.5A1 validator (23 migration + 3 verifier fixtures) PASS; 20.4C 42/42; 20.4A 39/39; E 51/51; D 110/110;
C 83/83; B2 61/61; B1/G 165/165; R1 62/62; `verify:mvp` exit 0; typecheck/lint/build clean;
`git diff --check` exit 0.

## 9. Scope + next phase

Migration **generated, corrected (§10) and preflighted (§11) but still unapplied**. Canonical
`profiles.role` authority, the `20260723000700` trusted-marker contract, and the
`R1_BLOCKED_PENDING_OWNER_BINDING` owner-binding deferral are all unchanged. The 20.4 historical
credit-ledger exceptions remain `NO_FINANCIAL_CHANGE` and are **not** inserted. **Next: staging application
review** — one `db push --linked` applying exactly `20260723001000`, then the SELECT-only verifier
`verify_qf_mvp_20_5a.sql`.

## 10. QF-MVP-20.5A1 — service_role least-privilege correction

**Proved defect.** The as-generated 20.5A migration granted `select, insert, update, delete` on profiles to
`service_role`, but no runtime path deletes profiles (the admin bootstrap only upserts; the dashboard only
reads). The `delete` was an unnecessary privilege, and the migration self-verification / staging verifier /
validator did not reject it — a report/verification inconsistency.

**Correction (offline, no DB access).** The migration now `revoke all privileges … from service_role`
first (version-safe — no explicit `MAINTAIN` keyword needed) and grants **only `select, insert, update`**.
The `$verify$` block now proves the exact contract: `service_role` SELECT+INSERT+UPDATE **present** and
DELETE/TRUNCATE/REFERENCES/TRIGGER **absent**, plus MAINTAIN absent on PostgreSQL 17+ (guarded by
`server_version_num`), failing closed on any over-grant (including one leaked via role membership, since
`has_table_privilege` is effective). The staging verifier row `Y16` now asserts the same exact matrix, and
the offline validator adds rule **G19** (rejects a `service_role` DELETE/TRUNCATE/REFERENCES/TRIGGER/MAINTAIN/
ALL grant, a missing deterministic revoke, and a self-check that omits the DELETE-absence proof) with three
one-defect fixtures. DELETE had **no proved runtime need** and was removed **before** staging preflight;
migration remains **unapplied**; next phase remains staging preflight.

**Final service_role matrix:** SELECT ✓ · INSERT ✓ · UPDATE ✓ · DELETE ✗ · TRUNCATE ✗ · REFERENCES ✗ ·
TRIGGER ✗ · MAINTAIN ✗. (authenticated SELECT-only, anon/PUBLIC zero — unchanged.)

## 11. QF-MVP-20.5AP — staging preflight (COMPLETE, NOT applied)

**Date:** 2026-07-24 (15:32–15:35 UTC) · **Linked target:** authorized staging `uckafzuochmbvtiodmcl`
(production `yqpgcsduqbxulrlzwzap` and QF-Jarvis `coilipywdvxklewquqvv` not the target, not contacted).
**Nothing applied** — one `supabase db push --linked --dry-run` + SELECT-only catalog checks + `migration
list`. **Identity:** correction commit HEAD `a863c8beb722600b7285c6426ac4752179af3e96` (parent
`3b2c51dcdb31be97a3412de4e1284121accf2c14`, grandparent `5fc5ba40909219e17c6a54e446e0c16f17d188a1`, origin
identical, **0/0**, clean). Locked hashes exact (migration `5cf12b72…`, validator `2458f7f8…`, verifier
`fb582dbd…`); applied A/A2/B1/G/B2/C/D/E/20.4C + profiles-source + 20.4A/20.4C artifacts byte-unchanged.

**External apply workspace (`qf-staging-apply`, outside Git):** no seed/functions; 10 SQL (baseline + A…E +
20.4C, byte-identical) → `20260723001000` absent → copied ONLY the locked migration (byte-identical,
`5cf12b72…`) → **11** SQL.

**Live pre-state (SELECT-only) — as expected:** `20260723001000` absent from remote (10 remote); profiles
present, RLS on, **0 rows**; `auth.users` 0; **`profiles.admin_role` absent** on staging; `profiles.role`
present; **`authenticated` holds 0 profiles privileges** (the drift the migration fixes by adding SELECT);
anon/PUBLIC 0; **`service_role` currently holds all seven** (`DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,
UPDATE`) via Supabase defaults — the migration tightens it to SELECT/INSERT/UPDATE only; 3 profiles policies
present; D auth trigger + `handle_new_user()` + `is_admin()` present; no owner-binding columns; the 20.4C
register present + **0 rows**; A/A2/B1/G/B2/C/D/E intact; 68 public tables → **0 rows**.

**History:** **11 local / 10 remote**; `20260723001000` local-only, **sole pending**. **Dry run (once, exit
0):** `DRY RUN: migrations will *not* be pushed`; exactly one proposed — `20260723001000_…cleanup.sql`; no
earlier migration, no application claim. **No-write proof:** re-listing history + re-running the pre-state
returned **identical** results (remote 10, 20.5A local-only, grants unchanged, admin_role absent, register
empty). Transcript + queries outside Git in `qf-staging-workspace/QF-MVP-20.5AP-PREFLIGHT-20260724T153254Z/`.

**Next: application review** — one `db push --linked` applying exactly `20260723001000` (schema/ACL only),
then the verifier `verify_qf_mvp_20_5a.sql`. Owner binding deferred; the 20.4 exception register stays empty.

## 12. QF-MVP-20.5AA — staging application (APPLIED + VERIFIED)

**Date:** 2026-07-24 (16:03–16:06 UTC) · **Linked target:** authorized staging `uckafzuochmbvtiodmcl`
(production `yqpgcsduqbxulrlzwzap` and QF-Jarvis `coilipywdvxklewquqvv` not the target, not contacted).
**Migration `20260723001000` is APPLIED to staging** via exactly one `supabase db push --linked`
(16:04:06→16:04:16 UTC, **exit 0**); exactly that migration, no earlier migration, no repair/reset, no
second push. The in-transaction `$verify$` NOTICE fired (authenticated SELECT-only, no escalation surface;
anon/PUBLIC zero; **service_role SELECT+INSERT+UPDATE only, no DELETE/TRUNCATE/REFERENCES/TRIGGER/MAINTAIN**;
admin_role drift removed; `profiles.role` + `is_admin()` + D auth trigger intact; 20.4C register +
owner-binding deferral untouched). The `column "admin_role" … does not exist, skipping` NOTICE is the
`drop column if exists` no-op on the staging squash; the trailing `pgdelta-target-ca.crt ENOENT` is the
known non-blocking edge-runtime cache artifact — exit 0.

**Identity:** applied at HEAD `e37d6d25565dcd866678232158d963051d2f27c2` (parent
`a863c8beb722600b7285c6426ac4752179af3e96`, origin identical, **0/0**, clean). Locked hashes exact
(migration `5cf12b72…`, validator `2458f7f8…`, verifier `fb582dbd…`); applied A/A2/B1/G/B2/C/D/E/20.4C
byte-unchanged.

**History:** before **11 local / 10 remote** (`20260723001000` sole pending) → after **11 local / 11
remote**, all paired exactly once, applied once with no duplicate.

**Locked verifier `verify_qf_mvp_20_5a.sql` (`fb582dbd…`) ran once against staging: 23 rows, 23 PASS / 0
FAIL.** Proven live: profiles present, RLS on; **authenticated holds SELECT and NO
INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER/MAINTAIN**; role-escalation impossible (no authenticated
UPDATE); anon/PUBLIC zero; **service_role holds exactly SELECT/INSERT/UPDATE** (no
DELETE/TRUNCATE/REFERENCES/TRIGGER/MAINTAIN); `admin_role` absent; `profiles.role` present; the three
own-row/admin policies preserved with no anon target; `is_admin()` + the D auth trigger + `handle_new_user()`
preserved; the 20.4C register intact and empty; and A/A2/B1/G/B2/C/D/E + owner-binding deferral untouched.

**Final privilege matrix (verified live):** PUBLIC none · anon none · authenticated **SELECT only** ·
service_role **SELECT/INSERT/UPDATE only**.

**No data write:** a post-application SELECT-only pass confirmed the ONLY change was the ACL of
`20260723001000` — authenticated went 0 → SELECT and service_role went all-seven → SELECT/INSERT/UPDATE.
Every data table remained **0 rows** (profiles, `auth.users`, all 68 public tables, the 20.4C register,
`vendor_credit_logs`, `lead_assignments`); no role value changed; no assignment/package/credit/lead
mutation; no historical exception inserted; no state-changing RPC.

**Gates:** 20.5A **40/40**, 20.4C 42/42, 20.4A 39/39, E 51/51, D 110/110, C 83/83, B2 61/61, B1/G 165/165,
R1 62/62, `verify:mvp` exit 0, typecheck/lint/build clean, `git diff --check` exit 0. Transcript + queries +
before/after captures outside Git in `qf-staging-workspace/QF-MVP-20.5AA-APPLICATION-20260724T160323Z/`.

**Next: Marketplace Engine final closeout review** — not another cleanup subphase. Owner binding remains
deferred; the 20.4 historical exception register remains empty.
