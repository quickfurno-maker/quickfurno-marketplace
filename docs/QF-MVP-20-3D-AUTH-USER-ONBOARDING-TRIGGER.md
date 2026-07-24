# QF-MVP-20.3D — Auth-User Onboarding Trigger

**Status: `D_APPLIED_VERIFIED_ON_STAGING_READY_FOR_COMMIT_REVIEW`.**

> **APPLIED AND VERIFIED ON STAGING.** Migration D was applied to the authorized staging project
> (`uckafzuochmbvtiodmcl`) exactly once on 2026-07-24 06:47:46→06:47:57Z (exit 0); the locked 37-row
> verifier returned **37 PASS / 0 FAIL**. Production and QF-Jarvis were never accessed. The
> completion commit is **not** pushed.

## 0-C. Staging application (QF-MVP-20.3DA) — COMPLETE

Applied from the accepted preflight HEAD `4cc19ff`. The single authorized `npx supabase db push
--linked` (exit 0) applied **exactly** `20260723000700`; the migration's own §4 self-verification
NOTICE confirmed in-transaction that the function is *hardened (role from the app_metadata marker,
neutral by default, admin unreachable), `profiles.role` nullable, `on_auth_user_created` AFTER
INSERT on `auth.users` (tgtype 5, enabled, sole auth trigger), untrusted EXECUTE revoked,
A/A2/B1/G/B2/C intact, E not started, no backfill*. The `drop trigger … skipping` NOTICE was
expected (the trigger was absent pre-application); the trailing `pgdelta-target-ca.crt ENOENT` was a
**local** edge-runtime catalog-cache artifact, non-blocking at exit 0.

**Migration history:** 8 local / 7 remote → **8 local / 8 remote**, D recorded exactly once, no
pending. **Locked verifier** (`verify_qf_mvp_20_3d.sql`, re-hashed `f0e87bfb…`, run byte-exact via
`supabase db query --linked --file`): **37 rows, 37 PASS / 0 FAIL**, contiguous, no skips — including
every installed-body row (D27, D29–D37). **Live catalog facts:** `handle_new_user/0`, SECURITY
DEFINER, returns `trigger`, `search_path=pg_catalog, public, pg_temp`, owner `postgres`, **body is
the D form** (`qf_principal` present, old `coalesce` gone), no dynamic/external calls; trigger
`tgtype=5` enabled on `auth.users` bound to the function, no other auth trigger; anon/authenticated
EXECUTE **false**, service_role **true**. **Empty state preserved:** 67 public tables, **0 total
rows**, 0 auth users, 0 profiles — no data created, no backfill. **Advisors:** neither
`handle_new_user` nor `on_auth_user_created` appears in any security or performance advisor (D's
locked-down EXECUTE means it exposes no callable surface); the only ERROR is the **known, expected**
`security_definer_view` on `vendor_public_v` (Migration C), and `multiple_permissive_policies` stays
at 34 (unchanged from post-C). No unexpected D-related finding. Transcript
`QF-MVP-20.3DA-APPLICATION-…txt` in the external evidence workspace, never committed.

**Next after commit review: Migration E.**

---

Generated at branch `mvp/qf-mvp-20-marketplace-engine-v1`, from the synchronized HEAD
`7161eea605fa6a7052f5ee63561a71873926c07f` (C applied and verified 23/23), origin identical,
ahead/behind 0/0, clean tree. No collision for `20260723000700`; C was the highest migration.
**Corrected in QF-MVP-20.3DR1** (principal classification) and again in **QF-MVP-20.3DVR1**
(verifier installed-body proof), on top of the generation commit `e84b209`.

| Artifact | SHA-256 (current) |
|---|---|
| `supabase/migrations/20260723000700_qf_mvp_auth_user_onboarding_trigger.sql` *(immutable since DR1)* | `8fb3c28c2c0e776d88d3c8163a895c5e108cb84b89ac95f41b86a521f50daecd` |
| `scripts/mvp/staging/validate-qf-mvp-20-3d.mjs` *(hardened in DVR1)* | `db94548135222e0dfb0f6cfadadb4cbb4ebdc72a1325fb9bc052638b4830fecd` |
| `supabase/staging-verification/verify_qf_mvp_20_3d.sql` *(hardened in DVR1, 37 rows)* | `f0e87bfbfc715f9d1f25d003b45a77280f555f1131e9143ce3070df17822c26d` |
| `lib/identity/authPrincipalMarker.ts` *(runtime half, since DR1)* | `fa278b6e3e29314fd03ca4226a3674520b18c3451c07e186370964d7fabc93a8` |

---

## 0-B. Staging preflight (QF-MVP-20.3DP2) — COMPLETE

The rerun preflight, on the synchronized HEAD `67ca73a`, passed end to end. **The verifier
source-proof gate that stopped DP is now satisfied** (`evaluateDVerifier` → 0 findings; the installed
body is proved from `pg_proc.prosrc`, rows 27 + 29–37). External apply workspace holds exactly the 8
expected SQL files, baseline→C hash-exact and D byte-identical to the repo (`8fb3c28c…`). Linked
target is **`uckafzuochmbvtiodmcl`** (staging); production and QF-Jarvis were not linked, connected
or referenced.

**Migration history before** the dry run: **8 local / 7 remote**, D (`20260723000700`) the sole
pending migration. **The single authorized `npx supabase db push --linked --dry-run`** (2026-07-24
05:21:45→05:21:51Z, **exit 0**) proposed **exactly one** migration —
`20260723000700_qf_mvp_auth_user_onboarding_trigger.sql` — under an explicit `DRY RUN` banner, no
earlier migration, no application claim. **History after** was **byte-identical** (7 remote, D still
local-only): **zero** remote rows created, and since no migration SQL executed, no auth/profile/
application row was created. Transcript in the external evidence workspace
(`QF-MVP-20.3DP2-PREFLIGHT-…txt`), never committed. **Next: D staging application.**

---

## 0-A. Why the first D preflight (DP) stopped, and what DVR1 fixed

The QF-MVP-20.3DP staging preflight **correctly halted before any staging contact** with
`D_PREFLIGHT_BLOCKED_VERIFIER_SOURCE_PROOF_INSUFFICIENT`. The verifier proved the classification
contract only from the function **COMMENT** (row D27 read `obj_description()`), and executable SQL
never inspected the installed body. Because `create or replace function` and `comment on function`
are **separate statements**, a replaced body with an intact comment would drift undetected — proved
offline against three separate drift mutations, all of which the old D27 **false-passed**.

**QF-MVP-20.3DVR1 closes that hole.** The verifier now reads the actual installed executable body
from `pg_proc.prosrc`, strips its comments in-SQL, and asserts the frozen contract structurally
(rows 27, 29–37). This satisfies the QF-MVP-20.3B1R2 policy *and* the DP gate at once: B1R2 forbade
an **unstripped** negative regex (which false-*fails* on body comments); DP forbade a **COMMENT-only**
proof (which false-*passes* on drift). A **comment-stripped body** assertion is the one mechanism
that is sound against both. Migration D itself needed no change and is byte-for-byte the DR1 artifact.

---

## 0. Why `e84b209` was NOT accepted for preflight (QF-MVP-20.3DR1)

The first generation replaced the metadata-derived role with the blanket constant `'vendor'`. That
closed the escalation but introduced a **second, opposite defect: principal misclassification.**

**`auth.users` is not a vendor-only table.** `services/clientOtpAuthService.ts` is explicitly the
homeowner/client authentication service, and `requestClientWhatsappOtp()` does:

```ts
const sb = await serverClient();                              // request-scoped ANON SSR client
const { error } = await sb.auth.signInWithOtp({ phone: phoneE164 });
```

`shouldCreateUser` is left at its default (**enabled**) — the source comment even states
*"First-time numbers follow the Supabase user-creation path (default)"* — and **no vendor marker of
any kind is supplied**. `verifyClientWhatsappOtp()` then calls `provisionVerifiedClientAccount()`,
which creates the `public.client_accounts` row that *is* the client principal model.

So an unconditional `role='vendor'` would have stamped **every homeowner** as a vendor profile.
The prior report's claim that every legitimate path keeps an identical final state was therefore
**not proved and is contradicted by this path**; that claim is retracted here.

The correction keeps the escalation fix and adds a real, trusted classification.

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

### Path-by-path outcome (corrected in DR1)

| Signup path | Original (metadata role) | First fix (blanket `'vendor'`) | **Corrected (DR1)** | Verdict |
|---|---|---|---|---|
| `app/actions.ts` vendor account signup | `vendor` | `vendor` | **`vendor`** (from the trusted marker) | preserved |
| `clientOtpAuthService.ts:169` first-time phone OTP | `coalesce(NULL,'vendor')` = `vendor` | `vendor` | **`NULL` — neutral** | **misclassification fixed** |
| `grant-superadmin.mjs` admin bootstrap | `admin`, then its own upsert | `vendor`, then its own upsert | **`NULL`**, then its own upsert → `admin` | preserved |
| **Anonymous signup with `{"role":"admin"}`** | **`admin` — ESCALATION** | `vendor` — blocked | **`NULL` — blocked** | **escalation closed** |

> **Retraction.** The QF-MVP-20.3DG report claimed every legitimate path kept an identical final
> state and that "only the attack changes". Row 2 shows that was **wrong**: the client OTP path did
> change, from `vendor` to a vendor stamp that was never correct in the first place. The corrected
> contract gives homeowners a neutral profile — a deliberate, documented behaviour change, not an
> equivalence.

`grant-superadmin.mjs`'s metadata `role` is now inert and was **removed** in DR1 so it cannot be
mistaken for an authority; the script's explicit service-role upsert is unchanged.

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
| `role` | `new.raw_app_meta_data ->> 'qf_principal'` — exactly `'vendor'` → `'vendor'`; **anything else → `NULL` (neutral)** | **TRUSTED, server-set only** |
| not written | `created_at`, `is_active` | table defaults |
| conflict | `ON CONFLICT (id) DO NOTHING` | idempotent, **never overwrites** |
| fires on | **INSERT only** | password reset / email change never re-run onboarding |
| deletion | unchanged — `ON DELETE CASCADE` from `auth.users` | D adds no delete logic |

**`'admin'` is unreachable.** No branch of the function can produce it; the string does not appear
in the body, and validator rule **R08** fails the migration if it does.

**What the trigger does NOT create:** no vendor row, client account, credits, package/subscription,
verification/approval state, assignment state, consent record, campaign state, or any admin
privilege.

### The trusted classification source, and why it is spoof-resistant

The marker is the Supabase Auth **`app_metadata`** key `qf_principal`, seen by the trigger as
`auth.users.raw_app_meta_data`. It is trusted because an untrusted caller cannot write it:

| Route | Writes | Reachable by |
|---|---|---|
| `auth.signUp({ options: { data } })` | `user_metadata` only | anonymous — **cannot set app_metadata** |
| `auth.updateUser({ data })` | `user_metadata` only | authenticated — **cannot set app_metadata** |
| `auth.admin.createUser` / `updateUserById` | `app_metadata` | **service-role key only**, server-only |

Proved in-repo, not just asserted: no `"use client"` module writes `app_metadata` (validator check
**15b**), no module holds the service-role client or key in client code (check **15**), and no
runtime path puts the marker into `user_metadata` (check **15c**).

**Neutral (`NULL`) is a legitimate role, and it is storable.** `public.profiles.role` has no
`NOT NULL`, and `profiles_role_check` is `role = ANY (ARRAY['admin','vendor'])` — a CHECK whose
expression evaluates to `NULL` is **satisfied**, so the neutral row is accepted without widening the
role vocabulary. The migration asserts the nullability as a catalog fact (§4.6b) and verifier row
**D26** re-asserts it after application.

**Neutral grants nothing — and neither does `'vendor'`.** `public.is_admin()` matches
`role = 'admin'` only; `public.owns_vendor()` reads `public.vendors.user_id` and never consults
`profiles.role`; and no RLS policy, function or application query anywhere selects on
`role = 'vendor'` (the only role filter in the repository is `role = 'admin'`, in
`communicationRecipientResolver.ts:121`). The role is a routing/display attribute, not a privilege.

### Principal outcomes

| Principal | Path | Resulting `profiles.role` |
|---|---|---|
| Server-created vendor | `submitVendorAccountRegistration` → `admin.createUser` + `app_metadata: vendorPrincipalAppMetadata()` | **`'vendor'`** |
| First-time homeowner/client OTP | `clientOtpAuthService.requestClientWhatsappOtp` → anon `signInWithOtp` | **`NULL`** (neutral) |
| Existing client | no `auth.users` INSERT | unchanged |
| Admin/superadmin bootstrap | `grant-superadmin.mjs` → `admin.createUser`, then its **own** service-role upsert | `NULL`, then **`'admin'`** by that explicit step |
| Malicious self-signup `{"role":"admin"}` | public `signUp` | **`NULL`** |
| Malicious self-signup `{"qf_principal":"vendor"}` in `user_metadata` | public `signUp` | **`NULL`** (wrong namespace) |
| Unknown/absent marker | any | **`NULL`** |
| Password reset / update | no INSERT | no trigger, no change |
| Existing profile row | any re-init | preserved — `DO NOTHING` |

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

## 7. Runtime changes (QF-MVP-20.3DR1)

The corrected contract needs a server-controlled marker, so three minimal runtime changes were
made. Nothing else was touched.

1. **`lib/identity/authPrincipalMarker.ts` (new, pure).** Exports
   `QF_PRINCIPAL_APP_METADATA_KEY = "qf_principal"`, `QF_PRINCIPAL_VENDOR = "vendor"` and
   `vendorPrincipalAppMetadata()`. Single source of truth for the writer half.
2. **`app/actions.ts` — `submitVendorAccountRegistration`.** `admin.createUser` now passes
   `app_metadata: vendorPrincipalAppMetadata()`, and the untrusted `role: "vendor"` was **removed
   from `user_metadata`** (it was never an authority and must not look like one). `full_name` and
   `phone` stay — the trigger still reads exactly those two. Cleanup is unchanged: a failed
   `registerVendor` still calls `admin.deleteUser`, which cascades the profile away.
   `currentUser()` additionally normalizes a neutral `NULL` role to `undefined`.
3. **`scripts/grant-superadmin.mjs`.** Dropped the inert `role: "admin"` from `user_metadata`.
   Behaviour is unchanged — the script's **own** explicit service-role upsert is, and always was,
   what grants `'admin'`.

**Marker writer and trigger reader cannot drift apart.** Validator check **16** re-derives the key
and value from the runtime module and asserts the migration reads exactly those; check **17** proves
it is load-bearing with five mutations (writer removed, key renamed, value renamed, untrusted role
re-added, helper export removed) — all caught.

Unchanged and re-proved: **no runtime module inserts or upserts `profiles`** (check 13, so no race
with the trigger), **none requests an admin role via signup metadata** (check 14), and **no
`"use client"` module holds the service-role client or key** (check 15).

The three cases named by the phase are covered against the **real migration source**: first signup
by rule **R10** (explicit `(id, full_name, phone, role)` insert), duplicate initialisation and
existing-row by rule **R11** (`ON CONFLICT (id) DO NOTHING`, and `DO UPDATE` rejected).
Database-level behavioural proof is deliberately **not** attempted here, because this phase forbids
inserting a test auth user — including in the verifier.

---

## 8. Validator and verifier

**Offline validator** — `scripts/mvp/staging/validate-qf-mvp-20-3d.mjs`, **110 checks, PASS**. It
now grades *three* things with one evaluator each: the migration (`evaluateDMigration`, 21 rules
R01–R20, 23 one-defect fixtures), **the verifier itself** (`evaluateDVerifier`, rules V01–V08, 12
verifier fixtures — new in DVR1), and an **offline simulation of the installed-body proof** (checks
14–19). A no-op mutation is reported vacuous, and both "every rule has a fixture" guards hold.
Migration-side security-critical rules:

| Rule | Rejects |
|---|---|
| **R08** | role derived from a metadata `role` key; any reference to `'admin'` |
| **R09** | any privileged metadata key; wholesale metadata copy |
| **R19** | an **unconditional constant role** (the DR1 defect); a role expression reading `raw_user_meta_data`; no equality gate on the marker; **no neutral `NULL` default** |
| **R20** | the marker read from the client-writable `raw_user_meta_data`; any app_metadata key other than `qf_principal` |

**Classification fixtures** (each a one-defect mutation of the real migration): **I** metadata role
restored → R08 · **T** blanket `'vendor'` restored → R19 · **U** neutral default flipped to vendor →
R19 · **V** marker read from `user_metadata` → R20 · **W** wrong metadata key → R20. Check **20**
prevents these five and the nine scenarios below from being quietly deleted.

**Focused principal-classification behaviour (checks 18–19c).** The classifier is *derived from the
migration text*, so the scenarios re-grade automatically if the contract is edited. All nine pass:
forged `role=admin` → neutral · forged `role=vendor` → neutral · forged marker in `user_metadata` →
neutral · first-time client OTP → neutral · server-created vendor → `'vendor'` · no `app_metadata`
→ neutral · unknown marker → neutral · admin bootstrap → neutral · `qf_principal='admin'` →
neutral. Check **19b** proves admin is unreachable from every scenario; **19c** proves an
established row is preserved.

**Load-bearing, proved on the real artifacts (both phases):**
1. reintroducing the metadata-derived role tripped **R08**;
2. restoring the blanket `'vendor'` tripped **R19** — the misclassification cannot return silently;
3. changing `AFTER INSERT` to `BEFORE INSERT` tripped **R07** (it would break the profiles FK);
4. adding `insert into auth.users` to the real verifier tripped checks **07 and 07b**.
All artifacts were restored byte-identical.

**SELECT-only verifier** — `supabase/staging-verification/verify_qf_mvp_20_3d.sql`, **37 rows**,
one `WITH … SELECT … UNION ALL` chain with no DML/DDL, and it **never inserts a test auth user** —
the trigger is proved structurally from catalog facts (`pg_proc.prosecdef`/`proconfig`/`prosrc`,
`pg_trigger.tgtype`/`tgenabled`/`tgfoid`, `pg_constraint`, `has_function_privilege`,
`has_table_privilege`). Catalog `name` values are compared as text and every set comparison
normalises both sides (row **D35** deliberately keeps its expected literal hand-unordered so the
PostgreSQL sort stays load-bearing).

### The installed-body proof (DVR1, rows 27 + 29–37)

A `WITH` prelude binds `d_body` = the installed `pg_proc.prosrc`, comment-stripped in three ordered
`regexp_replace` steps (block `/* */` with `.` spanning newlines, then line `--` with the
newline-sensitive `gn` flags, then whitespace collapse + lower-case) and `d_lits` = the exact set of
single-quoted literals in that body. Every row below asserts on `d_body`, never on the COMMENT:

| Row | Proves (from the executable body) |
|---|---|
| D27 | exactly one `public.handle_new_user` (no overload) and its body was obtained |
| D29 | **A. trusted source** — reads `new.raw_app_meta_data ->> 'qf_principal'` |
| D30 | **B. output** — an exact `= 'vendor'` gate is the only thing assigning the vendor role |
| D31 | **B. neutral default** — absent/unknown marker falls through to SQL `NULL` |
| D32 | **B+C+E shape** — exact target/columns; the role position is an *identifier*, never a literal (no blanket role); `full_name`/`phone` are the only user-metadata reads; conflict is `DO NOTHING` |
| D33 | **C. boundary** — no assignment is fed by `raw_user_meta_data`; no privileged key read from it |
| D34 | **D. absence** — no executable `'admin'`/`'superadmin'`/`admin_role`/`is_admin` branch |
| D35 | **exhaustive constants** — the body's literal set is exactly `{full_name, phone, qf_principal, vendor}` (positively proves the marker; negatively proves no other constant exists) |
| D36 | **E. idempotency** — retains `ON CONFLICT (id) DO NOTHING`; no update/delete path |
| D37 | **F. stability** — returns `NEW`; no dynamic SQL, external call, or business-state mutation |

Rows **D26/D28** keep the catalog-decidable half: `profiles.role` stays nullable (so the neutral
principal is storable) and the client principal model (`client_accounts`) is intact.

> **How both locked policies are satisfied at once.** QF-MVP-20.3B1R2 forbade an **unstripped**
> negative regex over function source (it false-*failed* on the body's own comments). QF-MVP-20.3DP
> forbade a **COMMENT-only** proof (it false-*passed* on a drifted body). Asserting on the
> **comment-stripped `prosrc`** is the single mechanism sound against both: after stripping, only
> executable text remains, so a comment can neither cause a failure nor supply a pass.
> `pg_get_functiondef()` is deliberately not used — `prosrc` is the narrower, non-pretty-printed
> source of exactly the reviewed function. The stripping is fail-closed: if a string literal ever
> contained `--`, D35's exact literal set would stop matching and the row would FAIL, never silently
> pass.

**Load-bearing, proved offline (DVR1):**
- The old COMMENT-only D27 **false-passed** three separate drift mutations (unconditional `'vendor'`,
  role from `raw_user_meta_data`, unknown→vendor); the new body proof **catches all three**, plus an
  added executable `admin` branch and an `ON CONFLICT … DO UPDATE` overwrite (checks 17–18).
- All ten shipped body patterns were run against the real normalised `prosrc`: six positives match,
  and every negative — including `raw_user_meta_data`-fed assignment, `'admin'`, `'superadmin'`,
  `DO UPDATE`, dynamic `EXECUTE` — is absent (checks 15–16).
- A comment naming `admin`/`superadmin` **does not** false-fail either the verifier proof or the
  migration validator (check 19).
- The 12 verifier fixtures each restore a specific drift hole: COMMENT-only proof (V05), no body
  inspection / `pg_get_functiondef` / prosrc-in-a-comment (V04), stripping removed (V06), any
  required row deleted (V07), a negative moved onto raw `prosrc` (V08), and the verifier writing an
  auth user or profile (V01) — all caught.

---

## 9. Independent review — findings

Reviewed line-by-line for metadata privilege escalation, admin-role injection, vendor
approval/package/credit injection, RLS bypass, a publicly callable SECURITY DEFINER function,
duplicate-initialisation races, overwriting existing profile data, OAuth/email/phone metadata
inconsistency, trigger recursion, signup rollback, orphan/delete semantics, non-empty production
compatibility, runtime type resolution and E/20.4 scope creep.

**Three material defects were found and corrected across the D phases:**

1. **The metadata-derived `role`** (§2, DR1) — the reason the trigger could not simply be re-attached
   as written. Any anonymous visitor could have self-registered as an administrator.
2. **Principal misclassification by the first fix** (§0, DR1) — the blanket `'vendor'` constant would
   have classified every homeowner/client OTP auth user as a vendor.
3. **A verifier that could not detect body drift** (§0-A, DVR1) — the post-application verifier
   proved the classification contract only from the function COMMENT, so a replaced body with an
   intact comment would have passed. Now proved from the comment-stripped `pg_proc.prosrc`.

**DVR1 independent review also found and fixed a real runtime-SQL defect in the new verifier:** the
literal-extraction regex `regexp_matches(body, '''([^'']*)''', 'g')` had **seven** single-quotes —
an unbalanced SQL string literal that would have errored (or mis-parsed) at PostgreSQL execution,
undetected by the offline validator (which computes literals in JS). It was rewritten with
dollar-quoting — `regexp_matches(body, $lit$'([^']*)'$lit$, 'g')` — removing the quote-doubling
hazard entirely. All ten shipped body patterns were then re-verified against the real `prosrc`, and
the comment-strip → normalise pipeline was checked for line/block comments, whitespace, and
literal-preservation (no `--` can truncate a literal in the real body).

The DR1 review additionally checked, and found clean: vendor classified as client; admin/superadmin
injection through either metadata namespace (unreachable — no `'admin'` branch exists); vendor RLS
accidentally granted to clients (`owns_vendor()` reads `vendors.user_id`, never `profiles.role`);
client access granted to vendors (`client_accounts` is untouched by D); server-marker spoofing
(app_metadata is unwritable by anon/authenticated, proved in-repo); app_metadata/user_metadata
confusion (rules R19/R20 + fixtures V/W); OAuth vs OTP vs admin-create differences (no OAuth path
exists; the other two are scenarios S4/S5/S8); profile ↔ `client_accounts` inconsistency (D creates
no client account, and the OTP verify path still provisions it); cleanup/orphan behaviour
(`admin.deleteUser` cascades the profile); non-empty production compatibility (`DO NOTHING`
preserves every established row, including `role='admin'`); and trigger rollback semantics (a failed
initialisation rolls back the auth user).

Everything else in the original contract survived review unchanged.

**Deliberate deviation from the earlier design note.** `QF-MVP-20-3A-REMEDIATION-MIGRATION-DESIGN.md`
said the function was *"already exists in staging … **Not recreated**"*. That note predates the
discovery above. This phase's safety requirements ("never trust user metadata for admin/superadmin
privileges") are absolute and override it, and D's declared scope explicitly covers the
"auth-user initialization **function** and trigger". Recreating the function forward-only is
therefore required, in scope, and documented here rather than done silently.

### Pre-existing issues disclosed, NOT changed by D — investigated and classified (DR1 §9)

**1. `profiles` has no table GRANT for `authenticated` → `SEPARATE_NON_BLOCKING_FOLLOW-UP`.**

Confirmed by re-investigation: the baseline carries exactly two `profiles` table-privilege
statements — `REVOKE ALL … FROM PUBLIC, anon, authenticated` and `GRANT ALL … TO service_role` —
and **no migration in the repository grants anything back**. Yet `LoginForm.tsx:32`,
`AdminLoginForm.tsx:47` and `currentUser()` in `app/actions.ts:64` all read `profiles` as
`authenticated`. A table privilege is checked *before* RLS, so those reads cannot succeed on a
baseline-shaped database, regardless of the `profiles self read` policy.

It is **not** required for D's correctness and does **not** block D's application: the trigger
writes with `SECURITY DEFINER` owner rights, and `is_admin()` / `owns_vendor()` are likewise
`SECURITY DEFINER`, so every RLS policy that calls them still works. D neither causes, worsens nor
depends on this. Per the phase rule ("do not change these unless D cannot function correctly
without the change"), **nothing was changed.** It is nevertheless independently severe for the
admin/vendor login UX and warrants its own reviewed phase.

**2. `profiles.admin_role` drift → `SEPARATE_NON_BLOCKING_FOLLOW-UP` (inert).**

Confirmed: `20260621000006_superadmin_foundation.sql` adds `admin_role`, and the production-derived
baseline does not have it — so that migration was never applied to the database the baseline came
from. The drift is **inert**: no runtime code reads `profiles.admin_role`. `AdminLoginForm.tsx:53`
reads the *auth* `app_metadata.admin_role`, and `grant-superadmin.mjs:100-103` documents in its own
comment that it deliberately does **not** write a `profiles.admin_role` column. D asserts nothing
about it and is unaffected. **Not changed.**

---

## 10. Scope proof

D does **not**: revoke or drop any legacy assignment RPC (Migration E — all six and their EXECUTE
posture are untouched and asserted); perform historical credit-ledger reconciliation (QF-MVP-20.4 —
no ledger row is written); implement client-selected owner binding; change the Migration C
projection, its ACLs or policies; or change assignment, credit, package, consent or campaign
authority. Enforced by validator rules R14–R16, R18 and verifier rows 16–23. DVR1 changed **only**
the D validator and verifier — Migration D and the DR1 runtime marker are byte-for-byte unchanged.

---

## 11. Gates

| Gate | Result |
|---|---|
| `npm run test:mvp:d` (D validator + verifier evaluator + body-proof sim) | **110 passed, 0 failed** |
| Verifier fixtures (V01–V08) | **12/12** caught |
| Installed-body drift simulations | **5/5** caught (incl. the 3 the old COMMENT-only proof false-passed) |
| Focused client/vendor/admin classification scenarios | **9/9** as specified · admin unreachable |
| Runtime↔trigger marker agreement mutations | **5/5** caught |
| `npm run test:mvp:c` | **83 passed, 0 failed** |
| `npm run test:mvp:b2` | **61 passed, 0 failed** |
| B1/G validator | **165 passed, 0 failed** |
| `npm run test:mvp:r1` | **62 passed, 0 failed** |
| `npm run verify:mvp` | **exit 0** |
| typecheck / lint / build | clean, exit 0 |
| `git diff --check` | exit 0 |

No managed-database test was run. `test:supabase:lead` was **not** executed.

**Deviation:** `verify:mvp` gained `test:mvp:d` (in DG), and the R1 harness's declared-later-migrations
set gained the D filename (its phase-progression guard). Both strictly strengthen the gate.

---

## 12. Next phase

**Migration E** (legacy assignment-RPC EXECUTE revocation) — after this application commit is
reviewed. Migration D is now **applied and verified on staging** (§0-C): 8/8 history, 37/37 verifier,
live function/trigger/EXECUTE posture proved, empty state preserved. The two disclosed follow-ups
remain open and out of scope: the `profiles` `authenticated` table-GRANT (**mandatory** before final
marketplace closeout) and the inert `profiles.admin_role` drift (schema cleanup). Migrations A, A2,
B1, G, B2 and C remain applied and immutable; Migration D and its DR1 runtime marker are unchanged;
QF-MVP-20.4 and owner binding are not started.
