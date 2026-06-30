# Phase 13B — Vendor Actions + Credits / Package Management Sync

Goal: let a **Superadmin** manage vendor **status, package, and credits** directly
from the **Vendors** admin page (no Supabase console needed), and make the
**Lead Assignment Approval Preview** (Phase 13) use the **same** eligibility
logic so the two surfaces always agree.

This unblocks the Phase 13 issue where vendors showed *"No package / Credits 0"*
and therefore never appeared as selectable in the assignment preview.

---

## What changed

| File | Purpose |
| --- | --- |
| `supabase/migrations/20260630000018_vendor_actions_credits_package_sync.sql` | Adds `vendors.package_name / package_status / package_expires_at` + `vendor_credit_logs` table. Idempotent, admin-only RLS. |
| `lib/vendors/vendorEligibility.ts` | **Shared** pure eligibility helper (client + server). One source of truth. |
| `services/vendorAdminService.ts` | Server logic: status/active, credits (manual only), package, credit log. |
| `app/api/admin/vendors/route.ts` | `GET` vendors with computed eligibility. |
| `app/api/admin/vendors/[id]/status/route.ts` | `POST` approve / reject / suspend / activate / deactivate. |
| `app/api/admin/vendors/[id]/credits/route.ts` | `POST` add / set credits (writes a credit log). |
| `app/api/admin/vendors/[id]/package/route.ts` | `POST` assign / update package (+ optional credit top-up). |
| `app/api/admin/vendors/[id]/credit-log/route.ts` | `GET` credit change history. |
| `components/admin/AdminSectionPage.tsx` | Vendors page: new actions, Manage Credits / Assign Package / Credit Log modals, eligibility badges. Eligibility Checker now uses the shared helper. |
| `lib/aos/runtime/leadAssignmentApprovalService.ts` | Phase 13 preview now computes vendor eligibility with the shared helper. |
| `components/admin/LeadAssignmentApprovalControl.tsx` | Preview shows eligibility; only eligible vendors are selectable. |

### Data-shape decisions (normalized safely)

- **Credits** reuse the existing `public.vendors.remaining_credits` column. No new
  credit column was added. The helper also reads `lead_credits / credits /
  credit_balance` as fallbacks if a different schema is ever used.
- **Active flag** reads `is_active` (fallbacks: `active / enabled /
  visibility_enabled`), defaulting to `true`.
- **Package** uses new denormalized columns `package_status` (fallback
  `subscription_status`), `package_name`, `package_expires_at`. The REAL package
  system (`public.vendor_packages` + `update_vendor_visibility` +
  `public_visibility`) and the public website funnel are **unchanged**.

---

## SQL setup

Apply on the live DB (safe / idempotent — `ADD COLUMN IF NOT EXISTS`,
`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`; no drop/delete/truncate):

```
supabase/migrations/20260630000018_vendor_actions_credits_package_sync.sql
```

New `vendors` columns: `package_name text`, `package_status text not null
default 'none'` (CHECK: `none | active | expired | cancelled | trial`),
`package_expires_at timestamptz`.

New table `public.vendor_credit_logs`: `id, vendor_id, change_type (manual_add |
manual_set | manual_remove | package_credit | preview_test | correction),
credits_before, credits_delta, credits_after, reason, updated_by, created_at`.
Admin-only RLS via `public.is_admin()`.

---

## How vendor eligibility works

`evaluateVendorEligibility(vendor, { leadCity?, leadCategory? })` returns:

```ts
{ eligible, reasons[], status, isActive, packageStatus, credits, cityMatch, categoryMatch }
```

A vendor is **eligible** when ALL are true:

1. `status === 'approved'`
2. `is_active === true`
3. `package_status` is `active` or `trial`
4. `credits > 0` (i.e. `remaining_credits`)
5. (only when a lead context is given) `cityMatch && categoryMatch`

`reasons` explains any failure: *Pending approval, Rejected, Suspended, Inactive,
No active package, No credits, City/category mismatch.*

### How it syncs with the Lead Assignment Approval Preview

Both the **Vendors admin page** badge and the **Lead Assignment Approval Preview**
call the SAME helper:

- Vendors page: `evaluateVendorEligibility(vendor)` → "Eligible for lead preview"
  / "Not eligible: <reason>".
- Preview (`leadAssignmentApprovalService`): `evaluateVendorEligibility(vendor, {
  leadCity, leadCategory })`. Approved vendors in the lead's city whose category
  matches are listed; only **eligible** ones are selectable.

So: if a vendor is **Eligible** on the Vendors page and its city + category match
the lead, it appears **selectable** in the preview. They cannot disagree.

---

## How to add credits

1. Admin → **Vendors** → row **Actions** → **Manage Credits**.
2. Choose **Add credits** (delta; negative removes) or **Set credits** (absolute).
3. Enter a **Reason** → **Save**.

Save → updates `remaining_credits`, writes a `vendor_credit_logs` row, refreshes
the list. **Never** notifies the vendor, **never** triggers n8n, **never**
auto-deducts.

## How to assign a package

1. Admin → **Vendors** → row **Actions** → **Assign / Update Package**.
2. Set **Package name**, **Package status** (`none / trial / active / expired /
   cancelled`), optional **Credits to add**, optional **Expiry date** → **Save**.
3. **Mark Package Expired** is a one-click action that sets `package_status =
   expired`.

Save → updates the vendor package fields (and credits + log if credits were
added), refreshes the list. **Never** notifies the vendor, **never** triggers n8n.

---

## Safety confirmation

- ❌ No WhatsApp sending
- ❌ No vendor notification
- ❌ No automatic credit deduction (manual add/set only, always logged)
- ❌ No auto-assignment of vendors
- ❌ No public website UI change (the funnel still uses `vendor_packages` +
  `public_visibility`, untouched)
- ❌ No change to Phase 12 AOS/n8n switch or Phase 13 approval flow
- ✅ All admin APIs are **Superadmin-only**; the service-role key is never exposed
- ✅ Migration is non-destructive and idempotent

---

## Test plan

1. **Build:** `npm run build` (must pass; no type errors).

2. **Vendor actions:** pick a Pune vendor whose `service_categories` include the
   test category. Actions → **Approve vendor**, **Activate vendor**, **Assign /
   Update Package** (status `active`, +10 credits), then confirm the row shows
   **Eligible for lead preview**.

3. **Lead Assignment Preview sync:** Admin → Lead Distribution → **Assignment
   Approval Preview** → select a matching Pune lead/category → **Reload preview**.
   The vendor from step 2 appears and is **selectable**.

4. **Max-3 vendors:** make 4 eligible test vendors in the same city/category;
   selecting a 4th is blocked (UI + API `MAX_VENDORS_EXCEEDED` + DB CHECK).

5. **Approval with Phase 12 switch OFF:** approve a preview. Expected: approval
   saved, `n8nWebhookCalled=false`, `mockMode=true`, no WhatsApp, no vendor
   notification, no credits deducted, no auto-assignment.

6. **Approval with Phase 12 switch ON (preview):** approve a preview. Expected:
   approval saved, `n8nWebhookCalled=true`, `mockMode=false`, the n8n
   `lead.assignment_approved` branch runs (preview only) — still no WhatsApp, no
   vendor notification, no credit deduction, no auto-assignment.

---

## Rollback steps

1. **Hide the new actions/modals:** revert the Vendors page changes in
   `components/admin/AdminSectionPage.tsx` and redeploy. The old approve/reject/
   suspend menu returns.
2. **Stop using package eligibility:** the preview reads `package_status`; setting
   every vendor's `package_status='active'` (or reverting the
   `leadAssignmentApprovalService` change) restores the prior behavior.
3. **Remove the code:** delete the Phase 13B files listed above.
4. **Database:** the new columns and `vendor_credit_logs` table are additive and
   safe to leave in place. The migration performs **no** destructive SQL. If you
   must remove them, do so manually in a maintenance window.
