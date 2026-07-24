# QF-MVP-20.3C — Public Vendor Projection and Direct-Table Privilege Hardening

**Status: `C_VERIFIER_CORRECTION_IMPLEMENTED_REVIEWED_READY_FOR_STAGING_REVERIFY` (QF-MVP-20.3CVR1).**

> **MIGRATION C IS APPLIED ON STAGING; VERIFICATION COMPLETION IS STILL PENDING.**
> C was applied on **2026-07-24T02:16:04Z** (`npx supabase db push --linked`, **exit 0**),
> is recorded remotely **exactly once**, and staging is **7 local / 7 remote**. Its own
> self-verification reported *vendor_public_v (21 cols, 0 leaks), vendors/leads anon access
> revoked, unsafe policies dropped, B1/B2/G/legacy intact, D absent*. The locked verifier then
> returned **22 PASS / 1 FAIL** — a **false negative** in row **C03** caused by the verifier
> comparing a DB-sorted array against a raw hand-ordered literal. **No migration, view, ACL,
> policy or data defect exists.** QF-MVP-20.3CVR1 corrects the verifier to normalize both sides
> symmetrically and hardens the validator against the whole defect class. **The staging verifier
> has NOT yet been re-run — the next phase is a read-only staging re-verification, not Migration D.**
> See section 14.

Generated at branch `mvp/qf-mvp-20-marketplace-engine-v1`, from the synchronized HEAD
`7d88519c86572a20538b4305469c900634bd8b73` (B2 applied), origin identical, ahead/behind 0/0,
clean tree. No collision for `20260723000600`.

| Artifact | SHA-256 |
|---|---|
| `supabase/migrations/20260723000600_qf_mvp_public_projection_privilege_hardening.sql` | `0d3d871b0c6ab9de8d82eeb8499437f1f40a8a6c81561cf41cb8ade60b464da2` |
| `scripts/mvp/staging/validate-qf-mvp-20-3c.mjs` | `9115ed0b79e675351fb631992499adfbcc9f9bf66a0d226b3e26ba6f8c82d3e4` |
| `supabase/staging-verification/verify_qf_mvp_20_3c.sql` | `1d2bb61a6d0822fa2cac5ffd161e0535c63d514044b158fc61e072ea16a05a75` |

---

## 1. The exposures C closes

Two anonymous exposures survived into the marketplace engine, both at the DB privilege/RLS layer:

1. **Vendor monetization leak.** RLS policy `vendors public listing` let `anon`/`authenticated`
   run `select *` on any Approved + active + publicly-visible + credited vendor row, exposing
   **every** column — `remaining_credits`, `total_credits`, `package_name`, `package_status`,
   `paid_status`, `gst_number`, `phone`, `email`, `whatsapp_number`, `user_id`, precise office
   address/geo, and more.
2. **Unsafe anonymous lead mutation.** RLS policy `leads public insert` was `WITH CHECK (true)`
   for `anon`/`authenticated` — any anonymous caller could INSERT arbitrary lead rows, setting any
   internal column.

Plus the always-true-adjacent `vendors public register` (anon self-INSERT into vendors).

---

## 2. Consumer inventory (traced, not grepped)

A full trace of every `.from("vendors")` / `.from("leads")` and every lead/vendor write across
`app/`, `services/`, `lib/`, `components/` established one decisive fact:

> **Every runtime read of `public.vendors` and every write to `public.leads` already runs
> server-side** — through the service role (`adminClient`) or, for the vendor-own dashboard, an
> authenticated session under the `vendors owner read` RLS policy (`serverClient`). No `"use
> client"` component reads these tables; no browser bundle holds the service-role key.

| Classification | Consumers |
|---|---|
| **AUTHORIZED_INTERNAL_TABLE_ACCESS** (service role, server-only) | `services/publicVendorService.ts:143,233` (public listing/profile — `adminClient`, maps to the safe `Vendor` shape via `mapToPublicVendor`); all admin/assignment/matching/comms reads (`vendorAdminService`, `adminService`, `manualLeadAssignmentService`, `leadMatchingEngine`, `autoAssignmentEngine`, `clientRequirementGroupService`, …). |
| **VENDOR_OWN_PRIVATE_ACCESS** (authenticated + RLS) | `app/actions.ts:147` `getMyVendor` (own row, incl. own credits/package — allowed); `app/actions.ts:112` `requireVendorOwner`. Both `serverClient()` under `vendors owner read`. |
| **SERVER_OWNED_LEAD_INTAKE** (service role) | `services/leadService.ts:136` `createLead` — the sole lead INSERT, via `adminClient`, reached through the `"use server"` actions `submitLead` / `sendClientSelectedVendorEnquiry`. |
| **Safe anon RPC (kept)** | `get_public_eligible_vendors` (`leadService.ts:351`, `publicClient().rpc`) — SECURITY DEFINER, returns 10 safe fields. C keeps its anon EXECUTE grant. |
| **UNSAFE_DIRECT_BROWSER_ACCESS_TO_REMOVE** | **None.** No anon/browser `.from("vendors")` read and no anon/browser `.from("leads")` INSERT exists. |
| **DEAD/attack-surface (DB layer only)** | the anon RLS policies `vendors public listing`, `vendors public register`, `leads public insert`, and the platform-default anon/authenticated table grants — no application consumer. |

**Consequence:** C is a pure DB-layer hardening. There is no unsafe consumer *code* to migrate —
the runtime was already server-owned (R1-era and earlier). The exposure is closed by revoking the
now-unused anon privileges, dropping the unsafe policies, and providing the sanctioned safe view.

---

## 3. Public vendor field allowlist (frozen from the real consumers)

The allowlist is driven by `services/publicVendorService.ts` → `mapToPublicVendor` (the one place
that maps a private row to the public `Vendor` shape) and the `get_public_eligible_vendors`
precedent. **21 columns, explicit list, no `SELECT *`.**

| # | Column | Public purpose | Consumer | Classification |
|---|---|---|---|---|
| 1 | `id` | vendor identity / profile slug | card, profile | ALLOW |
| 2 | `business_name` | public name (NOT NULL → no `owner_name` fallback needed) | card, profile, SEO | ALLOW |
| 3 | `city` | public location | card, profile | ALLOW |
| 4 | `office_city` | city fallback (coarse) | `normalizeCity` | ALLOW |
| 5 | `areas_covered` | public service area | discovery | ALLOW |
| 6 | `covers_full_city` | service-area flag | discovery | ALLOW |
| 7 | `service_categories` | public services | card, matching | ALLOW |
| 8 | `selected_subcategories` | public sub-trades | matching | ALLOW |
| 9 | `selected_category` | public primary trade | matching | ALLOW |
| 10 | `business_type` | public descriptor | matching | ALLOW |
| 11 | `experience` | public credential | profile | ALLOW |
| 12 | `years_experience` | public credential (fallback) | profile | ALLOW |
| 13 | `starting_price` | vendor's own advertised client price ("rate") — **not** QF monetization | card, profile | ALLOW |
| 14 | `public_description` | explicitly-public bio | profile | ALLOW |
| 15 | `public_service_area_summary` | explicitly-public area text | profile | ALLOW |
| 16 | `public_business_hours` | explicitly-public hours | profile | ALLOW |
| 17 | `profile_image_url` | public avatar | card, profile | ALLOW |
| 18 | `cover_image_url` | public banner | profile | ALLOW |
| 19 | `portfolio_urls` | public portfolio | profile | ALLOW |
| 20 | `rating` | public rating | card, profile | ALLOW |
| 21 | `completed_projects` | public social proof | card | ALLOW |

### Explicitly DENIED (must never appear in the view — verifier row 4 guards a critical subset)

`user_id`, `phone`, `email`, `whatsapp_number`, `gst_number` (contact/PII) · `owner_name`
(proprietor PII) · `total_credits`, `remaining_credits` (wallet — `remaining_credits` is used
**only** as a row filter, never selected) · `package_name`, `package_status`, `package_expires_at`,
`paid_status` (subscription/plan) · `verification_status`, `status`, `is_active`,
`public_visibility`, `accepting_leads` (internal flags — used only as row filters) · `message`
(internal note) · `utm_source/medium/campaign`, `source_url` (attribution) ·
`location_permission_status`, `latitude`, `longitude`, `google_place_id`, `formatted_address`,
`office_address_line1/2`, `office_landmark`, `office_pincode`, `office_state`, `office_latitude`,
`office_longitude` (precise geo / private address) · `last_assigned_at`, `created_at` (internal
timestamps) · `service_radius_km`, `custom_service_area` (internal matching) · `area_normalized`,
`sublocality`, `neighborhood` (internal geo normalization) · `monthly_capacity`, `team_size`
(internal ops).

---

## 4. `public.vendor_public_v`

```sql
create or replace view public.vendor_public_v as
  select v.id, v.business_name, v.city, v.office_city, v.areas_covered, v.covers_full_city,
         v.service_categories, v.selected_subcategories, v.selected_category, v.business_type,
         v.experience, v.years_experience, v.starting_price, v.public_description,
         v.public_service_area_summary, v.public_business_hours, v.profile_image_url,
         v.cover_image_url, v.portfolio_urls, v.rating, v.completed_projects
  from public.vendors v
  where v.status = 'Approved' and v.is_active = true
    and v.public_visibility = true and v.remaining_credits > 0;
```

The `WHERE` clause is **identical** to the row set the dropped `vendors public listing` policy
exposed — so the anon-visible row set is unchanged; only the columns are hardened. `revoke all …
from public`, then `grant select … to anon, authenticated, service_role`.

### View security model

`vendor_public_v` is a **plain owner-rights view** — `security_invoker` is left OFF. It is created
by the privileged migration role, so a query against it runs the underlying SELECT with the
owner's rights, which is what lets `anon` read the projection **without any base-table privilege**.

It cannot leak private data, for two structural reasons:
1. **Column absence.** Denied columns are physically absent from the view definition — no
   privilege, RLS setting or client filter can surface a column the view never selects.
2. **Deterministic row filter.** The publicly-visible predicate lives inside the view, never
   trusting a client filter.

`security_invoker` is deliberately **not** enabled: enabling it would require `anon` to hold
base-table SELECT — exactly the full-row exposure this migration removes. Owner-rights + full base
revocation is the only posture that satisfies "anon has no direct vendors privileges; public
browsing uses `vendor_public_v`." A Supabase `security_definer_view` advisor notice on this view is
therefore **expected and accepted** — the projection's safety is the allowlist + row filter, not
the invoker mode. Verifier **row 6** asserts `security_invoker` is not enabled.

---

## 5. `vendors` privilege posture

| Principal | Before | After C |
|---|---|---|
| PUBLIC | platform default | **revoked (all)** |
| `anon` | SELECT/INSERT (+ full-row via `vendors public listing`) | **revoked (all)** |
| `authenticated` | SELECT/INSERT/UPDATE/… | **SELECT only** (writes revoked; needed for the vendor-own dashboard + admin reads under RLS) |
| `service_role` | GRANT ALL | **GRANT ALL (unchanged)** |

Policies: `vendors public listing` and `vendors public register` **dropped**;
`vendors admin all`, `vendors owner read`, `vendors owner update` **preserved**. RLS stays enabled.

---

## 6. `leads` privilege / policy posture

| Principal | Before | After C |
|---|---|---|
| PUBLIC | platform default | **revoked (all)** |
| `anon` | INSERT via `leads public insert` (WITH CHECK true) | **revoked (all)** |
| `authenticated` | INSERT via `leads public insert`; dormant admin/vendor policies | **revoked (all)** (no app path uses non-service-role lead access) |
| `service_role` | GRANT ALL | **GRANT ALL (unchanged)** |

Policies: the always-true `leads public insert` **dropped**; `leads admin all`, `leads vendor
read` **preserved**. RLS stays enabled. **Lead intake stays server-owned** through
`createLead` (`adminClient`); no browser/anon INSERT existed to preserve.

---

## 7. Runtime consumer migration

**None required.** The trace proved every vendor read and lead write is already server-owned
(service role) or a vendor-own authenticated read under RLS. There is no unsafe browser/anon
consumer to move onto the projection or off direct-table access — that was already the case before
C. `services/publicVendorService.ts` remains authorized internal (service-role) access that maps to
the safe shape; it is deliberately **not** forced onto `vendor_public_v`, because it legitimately
serves a broader row set (free vendors when `show_free_vendors_publicly` is on) and computes
runtime-setting-dependent visibility server-side — routing it through the view would regress that
behavior. The validator proves the safe posture statically (checks 13–15): no `"use client"`
module touches these tables or imports the service-role client/key, and no anon/browser lead INSERT
exists.

---

## 8. Scope proof — no D / E / 20.4 / owner-binding

C does **not**: create or restore the `auth.users` trigger (D); revoke or drop any legacy
assignment RPC EXECUTE (E) — every legacy RPC and its current grant are untouched; perform any data
backfill (20.4); add a lead ownership column or client-selection table, or reactivate
client-selected assignment (owner binding). Enforced by validator rules R15–R17 and verifier rows
18–21. `get_public_eligible_vendors` keeps its anon EXECUTE grant (row 14).

---

## 9. Validator and verifier

**Offline validator** — `scripts/mvp/staging/validate-qf-mvp-20-3c.mjs`, **79 checks, PASS**, 23
rules (R01–R19), **23 one-defect fixtures** that are all mutations of the real migration run
through the same `evaluateCMigration()`; a no-op mutation is reported vacuous, and check 05 proves
every rule has a fixture. It tokenizes SQL (comments/strings/dollar-bodies, fail-closed), isolates
the view column list, and enforces: explicit allowlist, zero forbidden columns, no `SELECT *`,
`security_invoker` off, vendors/leads revokes, unsafe-policy drops, narrow view grants, service_role
preserved, authenticated dashboard SELECT retained, no E/D/owner-binding, runtime type-safety
(`array_agg(name)` must be cast — the B2R1 defect family), and B1/B2 untouched. It also statically
proves the repository posture (checks 13–15). **Load-bearing:** three real-artifact mutations
(leak `remaining_credits`; remove the anon vendors revoke; strip the verifier's `::text` cast) were
each caught, and both files restored byte-identical.

**SELECT-only verifier** — `supabase/staging-verification/verify_qf_mvp_20_3c.sql`, **23 rows**, one
`SELECT … UNION ALL` chain with no DML/DDL. Every row is PASS/FAIL from catalog facts
(`pg_class`, `pg_attribute`, `pg_policies`, `has_table_privilege`, `has_function_privilege`,
`to_regprocedure`, `reloptions`). Every catalog `name` array is cast to text (`attname::text =
array[…]::text[]`) — runtime type-safe. It asserts: C recorded once; `vendor_public_v` exists with
**exactly** the 21-column allowlist and **zero** forbidden columns; narrow grants; owner-rights;
PUBLIC/anon revoked on vendors, authenticated read-only on vendors, all-untrusted revoked on leads;
service_role retained; unsafe policies gone, safe policies remain; RLS still on; B1/B2/G intact;
legacy RPCs retained and E not claimed; D absent; owner-binding deferred.

---

## 10. Independent review — findings

Reviewed line-by-line for public leakage, JSON/composite hidden fields (none — the view selects
only scalar/array columns; no `jsonb` column is exposed), view invoker semantics, RLS bypass,
dashboard/admin/lead-form breakage, browser service-role leakage, broad grants, `search_path`
risk (no SECURITY DEFINER function is created — only a view), runtime type-resolution (all
`attname` casts present), and E/D scope creep. **No material defect required correction beyond the
deliberate design choices documented above.** Two design decisions were made explicitly and
recorded rather than guessed: (a) the owner-rights view model with its accepted advisor trade-off
(§4); (b) `authenticated` retains vendors SELECT — required so the vendor-own dashboard
(`getMyVendor` under `vendors owner read`) keeps working after the anon listing policy is dropped.

---

## 11. Gates

| Gate | Result |
|---|---|
| `npm run test:mvp:c` (C validator) | **79 passed, 0 failed** · 23 fixtures |
| C real-artifact mutation tests | 3/3 caught, restored byte-identical |
| `npm run test:mvp:b2` (unchanged) | **61 passed, 0 failed** |
| B1/G validator | **165 passed, 0 failed** |
| `npm run test:mvp:r1` | **62 passed, 0 failed** |
| `npm run verify:mvp` (now runs the C validator too) | **exit 0** |
| typecheck / lint / build | clean, exit 0 |
| `git diff --check` | exit 0 |

No managed-database test was run. `test:supabase:lead` was **not** executed.

**Deviation:** `verify:mvp` was extended to run `test:mvp:c`, and the R1 harness's
declared-later-migrations set gained the C filename (its phase-progression guard). Both strictly
strengthen the gate and remove nothing.

---

## 12. Next phase

**QF-MVP-20.3C staging preflight** — *not* application. C is generated and reviewed only; nothing
has been applied, no dry run has been executed, and no database has been contacted. Migrations A,
A2, B1, G and B2 remain applied and immutable.

> Note: the B1/B2 verifiers assert `vendor_public_v` is *absent* as a point-in-time "Migration C
> not started" check. Those locked verifier files are untouched by C; their absence-assertion is
> intentionally superseded by this C verifier for the post-C state, exactly as each phase's verifier
> reflects its own end-state.

---

## 13. QF-MVP-20.3CP — staging preflight

**Status: `C_PREFLIGHT_COMPLETE_READY_FOR_APPLICATION_REVIEW`. C was NOT applied.**

Executed at repository HEAD `13eeac81f662bba64381fded927c920bd9982ccd` (the C generation commit),
branch `mvp/qf-mvp-20-marketplace-engine-v1`, **origin identical, ahead/behind 0/0**, worktree
clean. Parent `7d88519c86572a20538b4305469c900634bd8b73`.

### Locked hashes — recomputed, all verified

| Artifact | SHA-256 |
|---|---|
| C migration | `0d3d871b0c6ab9de8d82eeb8499437f1f40a8a6c81561cf41cb8ade60b464da2` |
| C validator | `9115ed0b79e675351fb631992499adfbcc9f9bf66a0d226b3e26ba6f8c82d3e4` |
| C verifier | `1d2bb61a6d0822fa2cac5ffd161e0535c63d514044b158fc61e072ea16a05a75` |

baseline / A / A2 / B1 / G / B2 and the B2 verifier + validator are byte-unchanged; the C
generation commit `13eeac8` contains exactly the seven approved paths and no applied migration.

### Offline gates

C validator **79/79** (23 fixtures) · B2 **61/61** · B1/G **165/165** · R1 **62/62** ·
`verify:mvp` exit 0 · typecheck/lint/build exit 0 · `git diff --check` exit 0. **Load-bearing
re-proved on the real artifacts:** leaking `gst_number` into the real view tripped R08 (check 02);
removing the real anon-leads revoke tripped R11 (check 02); reverting the verifier `::text` cast
tripped 07b. All restored byte-identical (`git diff HEAD` exit 0). Fixtures share
`evaluateCMigration()` with the real grade (lines 391 vs 457); the anti-vacuity guard is present.

### External apply workspace

`C:\Users\KESHAV SHARMA\Desktop\qf-staging-apply` — **outside Git**, no `seed.sql`, no
`supabase/functions`, no non-SQL file. **Before: 6 SQL** (baseline/A/A2/B1/G/B2, all hash-exact);
C was **absent** (state A) → copied exactly once. **After: 7 SQL**; `cmp` exit 0 and workspace C
hashes `0d3d871b…` — **byte-identical** to the repository.

### Linked target

`uckafzuochmbvtiodmcl` (QuickFurno Staging) only. **Production `yqpgcsduqbxulrlzwzap` and QF-Jarvis
`coilipywdvxklewquqvv` are not linked and were never contacted** — the production ref appears in
the workspace only inside the baseline migration's own warning comments (documentation, not a
link).

### Migration history and the dry run

| | Before dry run | After dry run |
|---|---|---|
| local / remote | 7 / 6 | 7 / **6** |
| C | local-only, sole pending | local-only |

```
$ npx supabase db push --linked --dry-run      # cwd: qf-staging-apply
DRY RUN: migrations will *not* be pushed to the database.
Would push these migrations:
 • 20260723000600_qf_mvp_public_projection_privilege_hardening.sql
Finished supabase db push.
```

`2026-07-23T19:06:25Z → 19:06:31Z UTC`, **exit 0**. Structurally verified: DRY RUN banner present,
**exactly one** migration proposed and it is C, no earlier migration proposed, no application
claim, no error text. Run **once**, never repeated. The immediate re-list is **byte-identical** to
the pre-run listing — **zero remote history rows created**, C still remote-empty.

### Safety confirmations

C not applied. No `db push` without `--dry-run`. No `migration up`/`repair`/`reset`. No
hand-executed SQL. No link change. No application data, auth user, provider activation, deploy, PR
or push.

**Transcript:** `qf-staging-workspace\QF-MVP-20.3CP-PREFLIGHT-20260723T190625Z.txt` — outside Git.

### Next phase

**QF-MVP-20.3C staging application** — *not* Migration D. C remains generated, reviewed and
preflighted, but unapplied and local-only. Migrations A, A2, B1, G and B2 stay applied and
immutable.


---

## 14. QF-MVP-20.3CA application, and the QF-MVP-20.3CVR1 verifier correction

**Status: `C_VERIFIER_CORRECTION_IMPLEMENTED_REVIEWED_READY_FOR_STAGING_REVERIFY`.**
**Migration C is applied and correct. Verification completion is pending a read-only re-run.**

### What happened on application (QF-MVP-20.3CA)

| Item | Value |
|---|---|
| Command | `npx supabase db push --linked` |
| Window (UTC) | `2026-07-24T02:16:04Z` -> `02:16:09Z` |
| **Exit code** | **0** |
| Applied | **only** `20260723000600_qf_mvp_public_projection_privilege_hardening.sql` |
| Self-verification NOTICE | `vendor_public_v (21 cols, 0 leaks), vendors/leads anon access revoked, unsafe policies dropped, B1/B2/G/legacy intact, D absent.` |
| Post-application history | **7 local / 7 remote**, C recorded **exactly once**, no pending |
| Application data | unchanged and empty (`vendors=0 leads=0`; sum of all public rows = 0) |
| Locked verifier | **22 PASS / 1 FAIL** — row **C03** only |

A trailing Docker/pgdelta warning appeared; it is the known **post-commit** local
catalog-cache step (Docker Desktop not running). It ran after the migration committed,
changed nothing, and the command still exited 0.

### The C03 false negative — exact cause

C03 compared a **DB-sorted** aggregate against a **raw hand-ordered** literal:

```sql
-- BEFORE (defective: asymmetric)
(select array_agg(a.attname::text order by a.attname::text) from pg_catalog.pg_attribute a ...)
  = array['areas_covered', ..., 'covers_full_city','cover_image_url', ...]::text[]
```

The literal held the **identical 21-name set**, but `cover_image_url` and `covers_full_city`
were **transposed** (PostgreSQL sorts `cover_image_url` first). The left side was sorted by the
database, the right side by hand — so the literal's typed order silently became part of the
assertion. Result: `expected 21, actual 21, FAIL`.

Proved read-only at the time: re-sorting the **same** literal inside PostgreSQL reproduced the
actual array exactly, and `set_matches_when_both_sorted = true`. Migration C's own section 5.2
passed precisely because it already sorts **both** sides (`array_agg(x order by x)` over
`unnest(...)`). **The asymmetry was the entire bug.**

### The correction — symmetric normalization

```sql
-- AFTER (correct: both sides normalized by PostgreSQL)
(select array_agg(a.attname::text order by a.attname::text)
   from pg_catalog.pg_attribute a
  where a.attrelid='public.vendor_public_v'::regclass and a.attnum>0 and not a.attisdropped)
  = (select array_agg(x order by x) from unnest(
       array['areas_covered', ..., 'covers_full_city','cover_image_url', ...]::text[]) x)
```

The literal is **deliberately left in its original hand-typed (transposed) order**. That is the
strongest available proof that the fix is real: the comparison now passes *despite* the literal
being hand-mis-sorted, so the hand-ordering failure mode is genuinely removed rather than merely
papered over by swapping two elements.

**Contract preserved exactly:** 23 verifier rows; row name `C03_view_columns_match_allowlist`
unchanged; `expected` still `'21'`; `actual` still the live column count; the **identical
21-field allowlist set**; verifier still SELECT-only; no assertion weakened and C03 not removed.

### Validator hardening — rule R20

The C validator gains a symmetric-normalization rule enforced against the **real** verifier:

* `findAsymmetricArrayComparisons()` scans comment-stripped SQL for any comparison whose
  right-hand side is a **raw `array[...]` literal** and whose left-hand side (within a 400-char
  window) contains `array_agg(` — i.e. a DB-ordered aggregate measured against a hand-typed list.
  `= any(array[...])` membership tests never match this shape and are correctly exempt.
* **check 13** requires the real verifier to be free of that shape;
* **check 13b** requires C03 and its full 21-name allowlist to still be present (C03 cannot be
  deleted to make the rule pass);
* **checks 13c / 13d** are a discriminating control pair: the corrected symmetric form must
  produce **no** finding, and the asymmetric form **must** be flagged — so the rule is not a
  blanket ban on `array_agg`.

**Load-bearing, proved on the real artifact:** reverting C03 to the exact original asymmetric
raw-literal form made check 13 **FAIL** (83 -> 82/83); the verifier was then restored
**byte-identical**.

One defect was found and corrected *in the hardening itself* during this phase: the first
detector walked **forward** from `array_agg(` and was defeated by the intervening `from ... )`
clause, so control **13d** did not flag the asymmetric form. It was rewritten as a **backward**
window scan from the `= array[` site. The control pair is what caught it.

### Order-sensitivity search — full classification

| Site | Comparison | Class |
|---|---|---|
| `verify_qf_mvp_20_3c.sql` C03 | DB-sorted `array_agg` **=** raw hand-ordered literal | **FIX_REQUIRED** (corrected) |
| `verify_qf_mvp_20_3b2.sql` B13/B15 (4 occurrences) | `array_agg(...) = array['lead_id','vendor_id']` | **OUT_OF_SCOPE_WITH_REASON** — the 2-element literal is already in correct sort order (`lead_id` < `vendor_id`), so no defect is proven; the artifact is locked and outside this phase's edit authorization |
| C verifier `= any(array[...])` (5 sites) | membership | **TYPE_SAFE_AND_ORDER_SAFE** |
| C verifier `unnest(array[...])` row sources | existence / count | **TYPE_SAFE_AND_ORDER_SAFE** |
| `verify_qf_mvp_20_3b1.sql`, baseline verifier | 0 ordered `array_agg` sites | **TYPE_SAFE_AND_ORDER_SAFE** |

### Independent verifier review

Re-reviewed the whole corrected verifier: every catalog `name` value is compared as a single
`name = text` (safe) or cast with `::text`; **no** `name[] = text[]` array comparison remains;
the only surviving raw `= array[` text sits inside a **header comment** (the validator strips
comments before scanning); a missing view raises `undefined_table` via `::regclass`, so C03 fails
closed rather than silently passing; C03 asserts **both** the count and the set; and the D/E
scope rows (18, 19, 20) are untouched. **No further defect was found.**

### Hashes

| Artifact | SHA-256 |
|---|---|
| **Applied Migration C — UNCHANGED** | `0d3d871b0c6ab9de8d82eeb8499437f1f40a8a6c81561cf41cb8ade60b464da2` |
| C verifier (corrected) | `1f7bf9a511eb77f37578ef92771fdddf85cd2aa0522ac4648a7041b56586a980` |
| C validator (hardened) | `d632aa2584976cce1ac6058e782ac1910675c3cbaa70ccf6f30593f9c2c3725d` |

baseline, A, A2, B1, G, B2 and the B1/G + B2 validators/verifiers are all byte-unchanged.

### Gates

| Gate | Result |
|---|---|
| C validator | **83 passed, 0 failed** (79 prior + 4 hardening) · 23 fixtures |
| Real-artifact mutation (C03 -> asymmetric) | caught; verifier restored byte-identical |
| B2 validator | **61 passed, 0 failed** |
| B1/G validator | **165 passed, 0 failed** |
| R1 harness | **62 passed, 0 failed** |
| `npm run verify:mvp` | **exit 0** |
| typecheck / lint / build | exit 0 |
| `git diff --check` | exit 0 |

**No database was accessed in this phase**: no staging, production or QF-Jarvis; no dry run; no
migration application, repair, reset or `up`; and **the staging verifier was deliberately NOT
re-run**.

### Next phase

**A read-only QF-MVP-20.3C staging RE-VERIFICATION** — run the corrected verifier
(`1f7bf9a5…`) against staging to reach **23 PASS / 0 FAIL**, then read advisors and complete the
C record. **Not Migration D.** Migration C is applied and immutable; C is **not** marked fully
complete until that re-verification passes.
