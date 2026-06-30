# Phase 14C — Category & Subcategory Source-of-Truth Cleanup

Bug: Lead Distribution → **Vendor Eligibility Checker** category dropdown showed
a list (Carpentry, Custom Furniture, False Ceiling, Full Home Interior, Home
Renovation, Modular Kitchen, Painting, Wardrobe) that did not respond to admin
curation — it read every category row regardless of `is_active`.

Fix: the **single source of truth** for admin-facing category dropdowns is now
the admin-managed `public.service_categories` table, filtered to
`is_active = true`. A category added or deactivated in **Admin → Categories** is
reflected in those dropdowns automatically.

This is the same pattern as the Phase 14B city cleanup.

---

## Two intentional category vocabularies (important)

QuickFurno has **two** category systems by design — this phase does **not** merge
them (that would break matching and the public website design):

1. **`public.service_categories`** (admin CMS table; `is_active`, `parent_id`,
   `sort_order`). Seeded with the client-facing service names ("Full Home
   Interior", "Modular Kitchen", …). Used by **Admin → Categories**, the
   **Vendor Eligibility Checker**, the **Vendors category filter**, and the
   **/enquiry** form (`LeadFunnel`). These names align with `lib/config.ts`
   `SERVICES`, so lead↔vendor matching is preserved.
2. **`lib/categories.ts` `mainCategories`** (product taxonomy: "Interior
   Designers", "Carpenters", "Modular Factory", …). The documented single source
   of truth for the **homepage cards**, the **guided enquiry modal**
   (`ClientEnquiryModal`), and **vendor registration** (`VendorRegisterForm`).
   These are intentionally a separate vocabulary used for matching + the public
   UI design, and are **left unchanged** (changing them would alter public
   website UI and break lead↔vendor matching — both out of scope/forbidden).

> If you want ONE unified taxonomy across the whole product, that is a larger
> migration (re-pointing the homepage + vendor registration + matching at
> `service_categories`) and should be its own phase.

---

## Safety contract

- ❌ No WhatsApp, no vendor notification, no credit deduction, no auto-assignment
- ❌ No n8n calls in this phase
- ❌ No public website **design** change (homepage cards + guided modal untouched)
- ❌ No secrets exposed (`/api/categories` returns category names + a safe tree)
- ✅ Phase 12 / 13 / 13B / 14 / 14B untouched; existing leads/vendors untouched
- ✅ No `.env` / `.env.local` changes

---

## What changed

| File | Purpose |
| --- | --- |
| `lib/categories/categoryService.ts` | Server-only reader of active `service_categories` (+ parent→subcategory tree). Never throws. |
| `app/api/categories/route.ts` | Public, read-only `GET /api/categories` → active category names + tree. |
| `lib/categories/useActiveCategories.ts` | Client hook + shared "no active categories" message. |
| `components/admin/AdminSectionPage.tsx` | Vendor Eligibility Checker category dropdown + new Vendors **Category** filter use `activeCategoryNames(data.categories)` (active only). |
| `components/LeadFunnel.tsx` | /enquiry "Service needed" dropdown now from active admin categories (removed the static `SERVICES` array). |

> `lib/categories.ts` (the file) and `lib/categories/` (the new folder) coexist —
> different paths, no conflict.

### What hardcoded category lists were removed

- `components/LeadFunnel.tsx`: `const SERVICES = ENQUIRY_SERVICES` static array →
  now dynamic from `/api/categories`.
- The admin Vendor Eligibility Checker no longer shows **inactive** categories
  (it now filters `is_active`).

The homepage cards / `ClientEnquiryModal` / `VendorRegisterForm` keep
`lib/categories.ts` (the product taxonomy) by design — see above.

---

## Source of truth

```
Admin → Categories  (public.service_categories, is_active / parent_id)
            │
            ├── GET /api/categories ──► useActiveCategories() ──► /enquiry form (LeadFunnel)
            └── admin snapshot data.categories (filtered is_active) ──► Vendor
                                                                        Eligibility
                                                                        Checker,
                                                                        Vendors filter
```

### Fallback

When no category is active, dropdowns show:

> **No active categories configured. Add categories from Admin → Categories.**

No fake fallback categories are shown.

---

## How to add a category / subcategory

1. Admin → **Categories**.
2. Add a category (top-level) or a subcategory (set its `parent_id` to a parent).
   Ensure **is_active = true**.
3. It appears immediately in the Vendor Eligibility Checker, the Vendors category
   filter, and the /enquiry service dropdown (refresh the page / re-open admin).
4. **Deactivate** it (Disable) → it disappears from those dropdowns everywhere.

---

## Which pages now use dynamic categories

- ✅ Admin → Lead Distribution → **Vendor Eligibility Checker** (active categories)
- ✅ Admin → **Vendors** → new **Category** filter (active categories)
- ✅ Admin → **Categories** (already managed `service_categories`)
- ✅ **/enquiry** form (`LeadFunnel`) service dropdown
- ◻️ Homepage cards, guided enquiry modal, vendor registration — **unchanged by
  design** (product taxonomy in `lib/categories.ts`; preserves matching + UI)

---

## Test plan

1. **Build:** `npm run build` passes.
2. **PowerShell search** confirms no NEW hardcoded category arrays in dropdowns:
   ```powershell
   Get-ChildItem -Path . -Recurse -Include *.ts,*.tsx,*.js,*.jsx -File |
     Select-String -Pattern "const SERVICES\s*=\s*ENQUIRY_SERVICES"
   ```
   returns nothing.
3. Vendor Eligibility Checker → Category dropdown shows only **active** admin
   categories; deactivating one in Admin → Categories removes it here.
4. /enquiry form → "Service needed" shows only active admin categories.
5. Admin → Vendors → Category filter shows only active admin categories.
6. Add a test subcategory in Admin → Categories → it appears in the dropdowns;
   deactivate it → it disappears.

---

## Safety confirmation

Admin category dropdowns and the /enquiry service dropdown now read admin **active
categories** as the single source of truth. No WhatsApp, no vendor notification,
no credit deduction, no auto-assignment, **no n8n**, and **no `.env` changes**.
Existing leads/vendors are untouched. The homepage, guided enquiry modal, and
vendor registration keep the product taxonomy by design to preserve lead↔vendor
matching and public UI.

---

## Canonical taxonomy (governance update)

The admin `service_categories` source of truth is now seeded to the launched
taxonomy:

- **Parent categories:** Interior, Sofa, Painter, Civil Work
- **Interior subcategories:** Interior Designers, Carpenters, Modular Factory,
  Premium Interiors

Applied by `supabase/migrations/20260630000021_category_governance.sql` (adds
`parent_id` / `sort_order` / `created_by` / `updated_by` / `created_at` /
`updated_at`, upserts the canonical rows, and SOFT-deactivates the older demo
categories) and/or `scripts/seed-canonical-categories.mjs` (data-only, runs even
on a flat schema). Dropdowns show **selectable leaves** (subcategories +
childless parents), so once the hierarchy exists "Interior" is a grouping in the
manager but not offered as a service.

> The live DB was a flat `service_categories` table (migration 006 not applied),
> so the seed script ran in FLAT mode (names only). Apply migration 021 for the
> parent→subcategory hierarchy and audit columns.

---

## Admin-only category governance

**Only Superadmin/Admin can manage categories/subcategories.** Public, vendor,
and client pages are **read-only consumers**.

- **Where management happens:** Admin → **Categories** (the `CategoryManager`).
  Add category, Add subcategory, Edit, Activate, Deactivate. Active and inactive
  categories are shown in separate, clearly labelled tables.
- **APIs (all Superadmin-guarded — 403 otherwise):**
  - `GET  /api/admin/categories` — list all (active + inactive)
  - `POST /api/admin/categories` — create category/subcategory (`{ name, parentId? }`)
  - `POST /api/admin/categories/[id]` — edit (rename / re-parent / sort)
  - `POST /api/admin/categories/[id]/active` — activate / deactivate (`{ isActive, force? }`)
- **Read-only consumer surface:** `GET /api/categories` (public, active only,
  names + tree). The client enquiry form and vendor pages only ever read this.
- **Service-role key** is never exposed to the frontend — all writes go through
  the admin-guarded API → server-side service-role client.
- **Soft delete over hard delete:** deactivation sets `is_active = false`. There
  is **no** delete endpoint, because old leads/vendors may reference a category
  name. Re-activate anytime.
- **No duplicate names:** create/edit reject a name that already exists
  (case-insensitive) with `409 DUPLICATE`.
- **Parent safety:** deactivating a parent that still has active subcategories
  returns `409 HAS_ACTIVE_SUBCATEGORIES`; the manager warns and only proceeds
  when you confirm (the API is retried with `force: true`).
- **Audit fields:** `created_by` / `updated_by` / `updated_at` are written
  best-effort (present after migration 021).
- **RLS** also enforces admin-only writes (`categories admin write` =
  `public.is_admin()`); anon/public/vendor can only read active rows.

### Why deactivation is preferred over deletion

Leads store `service_required` as a text value and vendors store
`service_categories` as text. Hard-deleting a category row would orphan that
historical data and could break reporting/matching for past records. Soft
deactivation hides a category from all dropdowns immediately while keeping the
row (and its history) intact and reversible.
