# QF-MVP-20.3D — Auth-User Onboarding Trigger

**Status: `D_AUTH_TRIGGER_GENERATED_REVIEWED_READY_FOR_PREFLIGHT`.**

> **GENERATED AND REVIEWED, NOT APPLIED.** No database was accessed in this phase — not
> staging, not production, not QF-Jarvis. No dry run was executed. Nothing was pushed.

Generated at branch `mvp/qf-mvp-20-marketplace-engine-v1`, from the synchronized HEAD
`7161eea605fa6a7052f5ee63561a71873926c07f` (C applied and verified 23/23), origin identical,
ahead/behind 0/0, clean tree. No collision for `20260723000700`; C was the highest migration.

| Artifact | SHA-256 |
|---|---|
| `supabase/migrations/20260723000700_qf_mvp_auth_user_onboarding_trigger.sql` | `16697efc2a9f780c64131cbc477fcfa0fd1cfb804376f5ddf42781771bf7b243` |
| `scripts/mvp/staging/validate-qf-mvp-20-3d.mjs` | `a3a7f1308d8d0a1dff8be30cbbf2095845662a56b9c787233391892d911918c1` |
| `supabase/staging-verification/verify_qf_mvp_20_3d.sql` | `52d2384a571006152c4b74fed2246506e9ad931b72457a2667bc9b2405f126c0` |

---

## 1. Why the trigger is missing, and why it matters

The original repository contract (`20260620000003_functions.sql:10-27`) created **both**
`public.handle_new_user()` **and** the trigger `on_auth_user_created` on `auth.users`.

The QF-MVP-20.2 staging baseline captured the **function** (it lives in `public`) but **not the
trigger** — the baseline is a schema dump and a trigger attached to `auth.users` belongs to the
managed `auth` schema, which the dump excludes. Production still has the trigger; staging does
not. This was recorded at the time as `OPEN_FORWARD_MIGRATION_PREREQUISITE`, and Migration C's
verifier row C20 reports it (`auth.users` trigger count = 0).

**The consequence on staging is severe.** `public.profiles` has **no INSERT policy for any role**
and **no application code inserts it** — the trigger is its sole writer. Without it:

* `public.is_admin()` reads `profiles`, and ~all RLS policies in the schema call `is_admin()`, so
  every admin path fails closed;
* four hot paths read `.from("profiles").select("role").eq("id", <auth uid>)` immediately after
  auth (`app/actions.ts:64`, `LoginForm.tsx:32`, `AdminLoginForm.tsx:46`,
  `vendorAccessService.ts:255`);
* `vendors.user_id` is a foreign key to **`public.profiles(id)`**, so the account-linked vendor
  signup (`app/actions.ts:324`) would fail with an FK violation and roll the auth user back.

---

## 2. The privilege-escalation defect D closes

The original function derived the profile role from **untrusted signup metadata**:

```sql
coalesce(new.raw_user_meta_data->>'role', 'vendor')
```

`raw_user_meta_data` is populated verbatim from the client-supplied `options.data` of a public
`POST /auth/v1/signup`, so it is entirely attacker-controlled. `profiles.role` is CHECK-constrained
to `('admin','vendor')`, and:

```sql
create function public.is_admin() returns boolean ... as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;
```

Attaching the trigger unchanged would let **any anonymous visitor self-register as an
administrator** by passing `{"role":"admin"}` at signup, unlocking every `is_admin()` policy
(profiles, vendors, leads, lead_assignments, …). This phase's contract forbids exactly that
("never trust user metadata for admin/superadmin privileges"), so **D hardens the function in the
same forward-only step that restores the trigger.**

Administrator access is granted only by the deliberate service-role operator path
`scripts/grant-superadmin.mjs`, which sets `auth app_metadata.admin_role` (not client-writable)
and upserts `profiles.role = 'admin'`. **Signup never grants privilege.**

### Behavioural equivalence — the hardening breaks no legitimate path

| Signup path | metadata `role` | Original result | Hardened result | Final state |
|---|---|---|---|---|
| `app/actions.ts:303` vendor account signup | `'vendor'` | `vendor` | `vendor` | **identical** |
| `clientOtpAuthService.ts:169` first-time phone OTP | absent | `coalesce(NULL,'vendor')` = `vendor` | `vendor` | **identical** |
| `scripts/grant-superadmin.mjs:74` admin bootstrap | `'admin'` | `admin` | `vendor`, then the script's own upsert (L105-115) sets `admin` | **identical** |
| **Anonymous `POST /auth/v1/signup` with `{"role":"admin"}`** | `'admin'` | **`admin` — ESCALATION** | **`vendor` — BLOCKED** | **defect closed** |

The only behaviour that changes is the attack. The metadata `role` sent by
`grant-superadmin.mjs` is now inert; it is left in place (harmless) rather than edited, keeping the
runtime diff at zero.

---

## 3. Auth / onboarding inventory

| Path | file:line | client / context | Classification |
|---|---|---|---|
| `auth.admin.createUser` (vendor account signup) | `app/actions.ts:303` | `adminClient()` service role, `"use server"` | **TRIGGER_MUST_INITIALIZE** |
| `signInWithOtp({phone})` — creates a user for a first-time number | `services/clientOtpAuthService.ts:169` | `serverClient()` | **TRIGGER_MUST_INITIALIZE** |
| `auth.admin.createUser` (superadmin bootstrap) | `scripts/grant-superadmin.mjs:74` | service role, Node CLI | **ADMIN_ONLY** (script upserts the role itself) |
| `signInWithPassword` (vendor / admin login) | `components/LoginForm.tsx:29`, `components/AdminLoginForm.tsx:24`, `services/vendorAuthService.ts:244` | browser / server | **PASSWORD_RESET_NOT_SIGNUP** — session only, no new auth user |
| `verifyOtp` | `services/clientOtpAuthService.ts:245` | `serverClient()` | session only |
| `updateUserById` (password reset) | `services/vendorPasswordResetService.ts:708` | `adminClient()` | **PASSWORD_RESET_NOT_SIGNUP** — UPDATE, so the INSERT-only trigger never fires |
| vendor business registration (no auth user) | `services/vendorService.ts:15` | `adminClient()` | **VENDOR_ONBOARDING_LATER** — `vendors.user_id` stays NULL |
| `client_accounts` / `vendor_dashboard_users` creation | `clientAccessService.ts:363`, `vendorAccessService.ts:376` | `adminClient()` | **CLIENT/VENDOR_ONBOARDING_LATER** — explicit flows, not signup |
| "invitation" = unclaimed `vendor_dashboard_users` row | `vendorAccessService.ts:359` | `adminClient()` | **OUT_OF_SCOPE_WITH_REASON** — admin adoption, no auth user created |
| OAuth / PKCE callback | — | — | **DEAD_OR_TEST_ONLY** — no `signUp(`, `signInWithOAuth(` or `exchangeCodeForSession(` exists anywhere |
| any application write to `profiles` | — | — | **none exist** — the trigger is the sole writer |

---

## 4. Frozen onboarding contract

| Field | Value | Trusted source |
|---|---|---|
| target table | `public.profiles` | repository |
| key | `profiles.id = new.id` (FK → `auth.users(id)` **ON DELETE CASCADE**) | catalog |
| `id` | `new.id` | **TRUSTED** (auth) |
| `full_name` | `new.raw_user_meta_data ->> 'full_name'` | untrusted, **non-privileged** display text, single allowlisted key |
| `phone` | `new.raw_user_meta_data ->> 'phone'` | untrusted, **non-privileged** display text, single allowlisted key |
| `role` | **constant `'vendor'`** | **TRUSTED CONSTANT — never metadata** |
| not written | `created_at`, `is_active` | table defaults |
| conflict | `ON CONFLICT (id) DO NOTHING` | idempotent, **never overwrites** |
| fires on | **INSERT only** | password reset / email change never re-run onboarding |
| deletion | unchanged — `ON DELETE CASCADE` from `auth.users` | D adds no delete logic |

**What the trigger does NOT create:** no vendor row, client account, credits, package/subscription,
verification/approval state, assignment state, consent record, campaign state, or any admin
privilege.

### Trusted vs untrusted metadata

| Key | Read? | Rationale |
|---|---|---|
| `full_name` | **yes** | non-privileged display text; explicit single key |
| `phone` | **yes** | non-privileged display text; explicit single key |
| `role`, `admin`, `admin_role`, `is_admin`, `superadmin`, `verified`, `verification_status`, `package`, `package_status`, `paid`, `paid_status`, `credits`, `remaining_credits`, `total_credits`, `status`, `approved` | **never** | privileged — validator rule R09 fails the migration if any is read |
| the metadata JSON as a whole | **never** | no wholesale copy; only two explicit `->>` extractions |

---

## 5. Function, trigger, and privilege posture

**Function** `public.handle_new_user()` — `CREATE OR REPLACE`, forward-only.
`SECURITY DEFINER`, `search_path = pg_catalog, public, pg_temp`, no dynamic SQL, every reference
schema-qualified, returns `NEW`.

**SECURITY DEFINER is required, and proved:** the `auth.users` INSERT is performed by the Supabase
auth service role, which holds no privilege on `public.profiles`, and `profiles` has RLS enabled
with only self/admin policies (none of which an auth-service insert satisfies). Without it every
signup would abort. It is not an escalation surface — EXECUTE is revoked from PUBLIC/anon/
authenticated (service_role only, matching the applied baseline), it takes no arguments, and
`pg_temp` is pinned **last** so no temporary object can shadow a referenced relation.

**Trigger** `on_auth_user_created` — `AFTER INSERT ON auth.users FOR EACH ROW`, tgtype **5**
(`ROW|INSERT`, BEFORE bit unset). **AFTER is mandatory**, not stylistic: `profiles.id` carries a
foreign key to `auth.users(id)`, so the auth row must exist first. Guarded by
`drop trigger if exists … on auth.users` naming only the reviewed trigger, so re-application is
idempotent. Production already has this trigger; the drop+create runs inside the migration's single
transaction, so there is no window in which signups lack it.

| Principal | EXECUTE on `handle_new_user()` |
|---|---|
| PUBLIC / anon / authenticated | **revoked** |
| service_role | granted (unchanged from baseline) |
| trigger execution | unaffected — the executor invokes trigger functions directly |

---

## 6. Atomicity, existing users, failure semantics

* **Atomic.** `AFTER INSERT … FOR EACH ROW` runs inside the signup transaction, so a failed
  initialisation **rolls back the auth user** rather than leaving a half-initialised or privileged
  account. No partial state can survive.
* **No historical backfill.** D deliberately creates no profiles for pre-existing auth users;
  that is historical reconciliation and belongs to a separate, separately approved migration. The
  application already tolerates a missing row (`profile?.role`). Validator rule **R16** fails the
  migration if a backfill is added.
* **Existing row.** `ON CONFLICT (id) DO NOTHING` — never overwrites application-managed data.
  In particular the superadmin script's `role='admin'` survives a later trigger firing.
* **Deletion.** Unchanged: `profiles.id → auth.users(id) ON DELETE CASCADE`.

---

## 7. Runtime compatibility — no change required, and proved

* **No runtime module inserts or upserts `profiles`** (validator check 13), so there is no race
  and no duplicate-key path. The only writer in the repository is the admin CLI
  `grant-superadmin.mjs`, which upserts deliberately.
* **No runtime module requests an admin role in signup metadata** (validator check 14).
* **No `"use client"` module holds the service-role client or key** (validator check 15).
* Every legitimate signup path produces an **identical final state** before and after the
  hardening (§2 table).

The three cases named by the phase are covered against the **real migration source**: first signup
by rule **R10** (explicit `(id, full_name, phone, role)` insert), duplicate initialisation and
existing-row by rule **R11** (`ON CONFLICT (id) DO NOTHING`, and `DO UPDATE` rejected).
Database-level behavioural proof is deliberately **not** attempted here, because this phase forbids
inserting a test auth user — including in the verifier.

---

## 8. Validator and verifier

**Offline validator** — `scripts/mvp/staging/validate-qf-mvp-20-3d.mjs`, **50 checks, PASS**,
19 rules (R01–R18) with **19 one-defect fixtures**, all mutations of the real migration run through
the same `evaluateDMigration()`; a no-op mutation is reported vacuous and check 05 proves every
rule has a fixture. The security-critical rules are **R08** (role must be a trusted constant) and
**R09** (metadata allowlist).

**Load-bearing, proved on the real artifacts:**
1. reintroducing `coalesce(new.raw_user_meta_data->>'role','vendor')` into the real migration
   tripped **R08 and R09** — the escalation regression cannot return silently;
2. changing `AFTER INSERT` to `BEFORE INSERT` tripped **R07** (it would break the profiles FK);
3. adding `insert into auth.users` to the real verifier tripped checks **07 and 07b**.
All artifacts were restored byte-identical.

**SELECT-only verifier** — `supabase/staging-verification/verify_qf_mvp_20_3d.sql`, **25 rows**,
one `SELECT … UNION ALL` chain with no DML/DDL, and it **never inserts a test auth user** — the
trigger is proved structurally from catalog facts (`pg_proc.prosecdef`/`proconfig`,
`pg_trigger.tgtype`/`tgenabled`/`tgfoid`, `pg_constraint`, `has_function_privilege`,
`has_table_privilege`). It carries forward every locked policy: no `pg_get_functiondef`/`prosrc`
assertion, catalog `name` values compared as text, and no asymmetric array comparison.

> **Where the role guarantee is enforced.** The source-level guarantee that `role` is a constant is
> enforced by the **offline validator**, which grades the migration text. Proving it in-database
> would require inserting a test auth user, which this phase forbids. This split is deliberate and
> stated in both artifacts.

---

## 9. Independent review — findings

Reviewed line-by-line for metadata privilege escalation, admin-role injection, vendor
approval/package/credit injection, RLS bypass, a publicly callable SECURITY DEFINER function,
duplicate-initialisation races, overwriting existing profile data, OAuth/email/phone metadata
inconsistency, trigger recursion, signup rollback, orphan/delete semantics, non-empty production
compatibility, runtime type resolution and E/20.4 scope creep.

**One material defect was found and corrected: the metadata-derived `role`** (§2) — the reason the
trigger could not simply be re-attached as written. Everything else in the original contract
survived review unchanged.

**Deliberate deviation from the earlier design note.** `QF-MVP-20-3A-REMEDIATION-MIGRATION-DESIGN.md`
said the function was *"already exists in staging … **Not recreated**"*. That note predates the
discovery above. This phase's safety requirements ("never trust user metadata for admin/superadmin
privileges") are absolute and override it, and D's declared scope explicitly covers the
"auth-user initialization **function** and trigger". Recreating the function forward-only is
therefore required, in scope, and documented here rather than done silently.

### Pre-existing issues disclosed, NOT changed by D (out of scope)

1. **`profiles` has no table GRANT for `authenticated`.** The baseline carries
   `REVOKE ALL ON TABLE public.profiles FROM PUBLIC, anon, authenticated`, yet
   `LoginForm.tsx:32` and `AdminLoginForm.tsx:47` read `profiles` from the **browser** as
   `authenticated`. RLS policies grant nothing without a table privilege, so those reads cannot
   succeed on a baseline-shaped database. This is pre-existing, unrelated to the trigger, and
   changing `profiles` ACLs is outside D's frozen scope (the trigger is SECURITY DEFINER and does
   not need it). **Recommended for a separate reviewed phase.**
2. **`profiles.admin_role` drift.** Migration `20260621000006_superadmin_foundation.sql` adds an
   `admin_role` column that the production-derived baseline does **not** have, while
   `components/admin/adminTypes.ts:213` still references it. Pre-existing drift, unrelated to D.

---

## 10. Scope proof

D does **not**: revoke or drop any legacy assignment RPC (Migration E — all six and their EXECUTE
posture are untouched and asserted); perform historical credit-ledger reconciliation (QF-MVP-20.4 —
no ledger row is written); implement client-selected owner binding; change the Migration C
projection, its ACLs or policies; or change assignment, credit, package, consent or campaign
authority. Enforced by validator rules R14–R16, R18 and verifier rows 16–23.

---

## 11. Gates

| Gate | Result |
|---|---|
| `npm run test:mvp:d` (D validator) | **50 passed, 0 failed** · 19 fixtures |
| D real-artifact mutations | 3/3 caught, artifacts restored byte-identical |
| `npm run test:mvp:c` | **83 passed, 0 failed** |
| `npm run test:mvp:b2` | **61 passed, 0 failed** |
| B1/G validator | **165 passed, 0 failed** |
| `npm run test:mvp:r1` | **62 passed, 0 failed** |
| `npm run verify:mvp` (now runs the D validator too) | **exit 0** |
| typecheck / lint / build | clean, exit 0 |
| `git diff --check` | exit 0 |

No managed-database test was run. `test:supabase:lead` was **not** executed.

**Deviation:** `verify:mvp` gained `test:mvp:d`, and the R1 harness's declared-later-migrations set
gained the D filename (its phase-progression guard). Both strictly strengthen the gate.

---

## 12. Next phase

**QF-MVP-20.3D staging preflight** — *not* application. D is generated and reviewed only; nothing
has been applied, no dry run has been executed, and no database has been contacted. Migrations A,
A2, B1, G, B2 and C remain applied and immutable.
