# Phase 14B — City Source-of-Truth Cleanup

Bug: several city dropdowns showed **hardcoded** cities (Bengaluru, Delhi,
Hyderabad, Nagpur, Nashik, Mumbai, Pune) instead of the cities the admin
actually manages. The demo seed also inserted all 7 cities as **active**.

Fix: the **single source of truth** for cities is now the admin-managed
`public.cities` table, filtered to `is_active = true`. Every city dropdown reads
from it, so a city added or deactivated in **Admin → Cities & Locations** is
reflected **everywhere** automatically.

This is a follow-up cleanup only. It does **not** touch Phase 12, 13, 13B, or 14
behavior.

---

## Safety contract

- ❌ No WhatsApp, no vendor notification, no credit deduction, no auto-assignment
- ❌ No n8n calls in this phase
- ❌ No public UI **design** change (same components, just a live data source)
- ❌ No secrets exposed (the `/api/cities` endpoint returns city names only)
- ✅ Phase 12 / 13 / 13B / 14 untouched
- ✅ No `.env` / `.env.local` changes

---

## What changed

| File | Purpose |
| --- | --- |
| `lib/locations/cityService.ts` | Server-only reader of active cities from `public.cities`. Never throws. |
| `app/api/cities/route.ts` | Public, read-only `GET /api/cities` → active city names. |
| `lib/locations/useActiveCities.ts` | Client hook used by public forms + the shared "no active cities" message. |
| `components/HomeEnquiryForm.tsx` | City dropdown now from active cities (removed hardcoded `CITIES`). |
| `components/LeadFunnel.tsx` | City dropdown now from active cities (removed hardcoded `CITIES`). |
| `components/VendorRegisterForm.tsx` | City chips now from active cities (removed static `cities` import). |
| `components/admin/AdminSectionPage.tsx` | Vendor Eligibility Checker + Vendors city filter use active cities (`activeCityNames`). |
| `supabase/migrations/20260630000020_align_active_cities.sql` | Deactivates the extra demo-seed cities so only Pune + Mumbai are active. Reversible. |

### Single source of truth

```
Admin → Cities & Locations  (public.cities, is_active)
            │
            ├── GET /api/cities ──► useActiveCities() ──► public enquiry form,
            │                                              lead funnel, vendor reg
            └── admin snapshot data.cities (filtered is_active) ──► Eligibility
                                                                    Checker, Vendors
                                                                    city filter
```

### Fallback

When no city is active, dropdowns show:

> **No active cities configured. Add cities from Admin → Cities & Locations.**

Forms never offer inactive/unconfigured cities.

---

## SQL setup

Apply on the live DB (idempotent, non-destructive — only `UPDATE ... SET
is_active`; no drop/delete/truncate):

```
supabase/migrations/20260630000020_align_active_cities.sql
```

It deactivates `Bengaluru, Hyderabad, Delhi, Nagpur, Nashik` (matched by slug and
name) and keeps `Pune, Mumbai` active. **Reversible**: re-enable any city from
Admin → Cities & Locations and it reappears everywhere.

> The code change alone (filter by `is_active`) is the real fix; this migration
> just aligns a freshly-seeded DB to the launched set so dropdowns show only Pune
> and Mumbai immediately.

---

## Testing

1. **Build:** `npm run build` passes (no type/lint errors).
2. **No active hardcoded UI usage:**
   ```bash
   rg "Bengaluru|Delhi|Hyderabad|Nagpur|Nashik" components app lib --type ts --type tsx
   ```
   Returns only docs / seed / sample-data / migration references — no live
   dropdown arrays.
3. **Lead Distribution → Vendor Eligibility Checker** shows only **Pune** and
   **Mumbai** in the City dropdown.
4. **Vendor registration** city chips show only **Pune** and **Mumbai**.
5. **Client enquiry** (homepage + funnel) city dropdown shows only **Pune** and
   **Mumbai**.
6. **Add a test city** in Admin → Cities & Locations (Enable) → it appears in all
   dropdowns (refresh public pages / re-open admin).
7. **Deactivate** that test city → it disappears from all dropdowns.

---

## Rollback steps

1. **Re-activate cities:** the fastest path is purely data — re-enable any city
   from Admin → Cities & Locations; dropdowns update automatically.
2. **Revert the migration effect:** `update public.cities set is_active = true
   where slug in ('bengaluru','hyderabad','delhi','nagpur','nashik');` (no schema
   change to undo).
3. **Revert the code:** restore the previous hardcoded `CITIES` arrays in
   `HomeEnquiryForm.tsx` / `LeadFunnel.tsx` and the static `cities` import in
   `VendorRegisterForm.tsx`, and remove the `lib/locations/*` + `/api/cities`
   files. (Not recommended — reintroduces the bug.)

---

## Confirmation

City dropdowns everywhere now use admin-managed **active** cities as the single
source of truth. No WhatsApp, no vendor notification, no credit deduction, no
auto-assignment, and **no n8n** behavior changed. No `.env` files changed.
