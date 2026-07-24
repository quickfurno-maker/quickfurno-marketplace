# QF-MVP-20.5A — Profiles Base-Table Privilege Hardening + admin_role Drift Cleanup

**Status: `PROFILES_PRIVILEGE_AND_ADMIN_ROLE_CLEANUP_GENERATED_REVIEWED_READY_FOR_PREFLIGHT`.**

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
- **service_role: SELECT/INSERT/UPDATE/DELETE preserved** (admin bootstrap upsert + admin dashboard reads).

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
  `grant select, insert, update, delete` to `service_role`;
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

20.5A validator (20 migration + 3 verifier fixtures) PASS; 20.4C 42/42; 20.4A 39/39; E 51/51; D 110/110;
C 83/83; B2 61/61; B1/G 165/165; R1 62/62; `verify:mvp` exit 0; typecheck/lint/build clean;
`git diff --check` exit 0.

## 9. Scope + next phase

**No managed DB access.** Migration **generated but unapplied**. Canonical `profiles.role` authority, the
`20260723000700` trusted-marker contract, and the `R1_BLOCKED_PENDING_OWNER_BINDING` owner-binding
deferral are all unchanged. The 20.4 historical credit-ledger exceptions remain `NO_FINANCIAL_CHANGE` and
are **not** inserted. **Next: staging preflight** (one `db push --linked --dry-run` + this verifier) before
any application.
