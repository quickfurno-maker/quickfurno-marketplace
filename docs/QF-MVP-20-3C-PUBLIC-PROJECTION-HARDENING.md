# QF-MVP-20.3C — Public Vendor Projection and Direct-Table Privilege Hardening

**Status: `C_PUBLIC_PROJECTION_HARDENING_GENERATED_REVIEWED_READY_FOR_PREFLIGHT`.**

> **GENERATED AND REVIEWED, NOT APPLIED.** No database was accessed in this phase — not
> staging, not production, not QF-Jarvis. No dry run was executed. Nothing was pushed.

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
