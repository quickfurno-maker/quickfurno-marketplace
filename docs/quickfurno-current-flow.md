# QuickFurno Current Flow

This document maps the current live application flow before the AOS Control Center and CRM work begins. It is documentation-only and does not change runtime behavior.

## App Routes

- `app/page.tsx`: public homepage.
- `app/enquiry/page.tsx`: guided homeowner enquiry funnel using `LeadFunnel`.
- `app/vendors/page.tsx`: vendor listing/discovery route.
- `app/vendors/[id]/page.tsx`: vendor detail route.
- `app/vendors/register/page.tsx`: public vendor registration wizard using `VendorRegisterForm`.
- `app/vendor/page.tsx`: authenticated vendor dashboard.
- `app/login/page.tsx`: shared sign-in page for vendor/admin users.
- `app/admin/login/page.tsx`: dedicated Superadmin login.
- `app/admin/layout.tsx`: wraps admin pages in `AdminShell`.
- `app/admin/page.tsx`: redirects to `/admin/dashboard`.
- `app/admin/dashboard/page.tsx`: protected Superadmin dashboard.
- `app/admin/[section]/page.tsx`: protected dynamic admin section route.
- `app/pricing/page.tsx`, `app/privacy/page.tsx`, `app/terms/page.tsx`, `app/category/[slug]/page.tsx`, `app/category/interiors/carpenters/page.tsx`: public content/category routes.

## Client Lead Submission Flow

Primary lead entry points:

- `components/ClientEnquiryModal.tsx`: current "Requirement First" modal used by CTAs across the public site.
- `components/LeadFunnel.tsx`: `/enquiry` page flow with lead creation, eligible-vendor lookup, and optional assignment confirmation.
- `components/HomeEnquiryForm.tsx`: homepage quote form.
- `components/LeadForm.tsx`: legacy or reusable lead form component.

Runtime path:

1. A client fills a public lead form.
2. The client component calls `submitLead` from `app/actions.ts`.
3. `submitLead` calls `services/leadService.ts:createLead`.
4. `createLead` validates required fields, normalizes compatible field names, checks duplicate leads through `check_duplicate_lead`, and inserts into `public.leads` using the server-only `adminClient`.
5. Tracking and consent fields are included when available; `leadService` falls back to the base payload if the tracking/consent migration is not applied.
6. The result returns `{ id, is_duplicate }` to the UI.

Important current behavior:

- `LeadFunnel` can call `fetchEligibleVendors` after lead creation.
- `fetchEligibleVendors` calls `services/leadService.ts:getEligibleVendors`, which uses the `get_public_eligible_vendors` RPC and returns safe public vendor fields only.
- `LeadFunnel` can call `assignLead`, which calls `assign_lead_to_vendors`.
- The current `assign_lead_to_vendors` RPC is not a dry run. It can create `lead_assignments`, deduct vendor credits, update lead status to `Assigned`, and insert `whatsapp_logs` rows. Future AOS/CRM work should treat this as a live side-effect boundary.

## Vendor Registration Flow

Primary vendor entry points:

- `components/VendorRegisterForm.tsx`: current guided vendor onboarding wizard used by `/vendors/register`.
- `components/VendorApplicationForm.tsx`: simpler reusable/legacy vendor application form.
- `app/vendors/register/page.tsx`: public wrapper for the guided registration page.

Runtime path:

1. A vendor submits registration details from the public wizard or application form.
2. The client component calls `submitVendorRegistration` from `app/actions.ts`.
3. `submitVendorRegistration` calls `services/vendorService.ts:registerVendor`.
4. `registerVendor` validates required fields and phone/WhatsApp formats.
5. It inserts into `public.vendors` with forced safe defaults:
   - `status = Pending`
   - `verification_status = Pending`
   - `paid_status = Unpaid`
   - `is_active = true`
   - `public_visibility = false`
6. Admin verification and package/payment steps happen later through admin routes.

Account-linked vendor registration:

- `submitVendorAccountRegistration` in `app/actions.ts` can create a Supabase Auth user through `adminClient().auth.admin.createUser`, then call `registerVendor` with `user_id`.
- If vendor row creation fails, the newly created auth user is deleted as rollback.

## Supabase Usage

Supabase clients:

- `lib/supabase.ts:adminClient`: service-role client, server only, bypasses RLS. Used by services and server actions for privileged writes and RPC calls.
- `lib/supabase.ts:publicClient`: anon client for safe public reads, such as active packages and public eligible vendor RPC results.
- `lib/supabase.ts:serverClient`: request-scoped SSR client that carries Supabase auth cookies and respects the current session.
- `lib/supabaseBrowser.ts:browserClient`: browser auth client using `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

Server action boundary:

- Public forms call server actions in `app/actions.ts`.
- Admin and vendor actions use auth guards in `app/actions.ts`.
- Service role usage stays behind server actions and services.

Existing schema/migration areas:

- `supabase/migrations/20260620000001_create_tables.sql`: base tables for profiles, vendors, leads, packages, vendor packages, payments, assignments, status updates, bad-lead reports, WhatsApp logs, categories, cities, and settings.
- `supabase/migrations/20260620000002_rls_policies.sql`: RLS policies and helper functions.
- `supabase/migrations/20260620000003_functions.sql`: business functions for duplicate checks, eligible vendors, lead assignment, credits, package assignment, and visibility.
- `supabase/migrations/20260620000004_seed_data.sql`: seed package/settings/category/city data.
- `supabase/migrations/20260620000005_homepage_alignment.sql`: lead status/category alignment additions.
- `supabase/migrations/20260621000006_superadmin_foundation.sql`: admin/CMS/AI/automation support tables and policies.
- `supabase/migrations/20260622000007_vendor_location.sql`: vendor location fields.
- `supabase/migrations/20260624000008_lead_capture_consent.sql`: lead tracking and consent fields.
- `supabase/migrations/20260624000009_vendor_onboarding.sql`: guided vendor onboarding fields.
- `supabase/migrations/20260624000010_vendor_exact_columns.sql`: vendor wizard column alignment.
- `supabase/migrations/20260624000011_vendor_office_address.sql`: office address fields.

## Admin And Dashboard Flow

Admin auth:

- `middleware.ts` redirects unauthenticated `/admin/*` traffic to `/admin/login`.
- `app/admin/login/page.tsx` redirects signed-in Superadmin users to `/admin/dashboard`.
- `components/AdminLoginForm.tsx` signs in through Supabase Auth, then verifies `profiles.role = admin` and `user.app_metadata.admin_role = Superadmin`.
- `app/actions.ts:getAdminSession` uses `serverClient()` to read the current user and profile role.
- `app/actions.ts:requireSuperadmin` gates admin server actions.

Admin routes:

- `app/admin/dashboard/page.tsx` checks Superadmin session and renders `AdminDashboard`.
- `app/admin/[section]/page.tsx` checks Superadmin session and renders `AdminSectionPage`.
- `components/admin/AdminShell.tsx` provides the admin layout, navigation, sign-out, and search shell.
- `components/admin/adminConfig.ts` defines admin section metadata.
- `components/admin/AdminSectionPage.tsx` contains section-specific admin pages and safe placeholders for many future workflows.
- `services/adminService.ts:getSuperadminSnapshot` performs best-effort Supabase reads and returns fallback-safe arrays/warnings if optional tables/columns are unavailable.

Vendor dashboard:

- `app/vendor/page.tsx` reads the current user's linked vendor profile via `getMyVendor`.
- Vendor dashboard data comes from `vendorDashboard` and `vendorLeads` server actions.
- `vendorLeads` returns assigned lead details to the owning vendor after auth ownership checks.

## Important Files Discovered

- Lead flow: `components/ClientEnquiryModal.tsx`, `components/LeadFunnel.tsx`, `components/HomeEnquiryForm.tsx`, `components/LeadForm.tsx`, `services/leadService.ts`, `app/actions.ts`.
- Vendor flow: `components/VendorRegisterForm.tsx`, `components/VendorApplicationForm.tsx`, `services/vendorService.ts`, `app/vendors/register/page.tsx`, `app/vendor/page.tsx`.
- Admin flow: `components/AdminDashboard.tsx`, `components/admin/AdminSectionPage.tsx`, `components/admin/AdminShell.tsx`, `components/admin/adminConfig.ts`, `services/adminService.ts`.
- Supabase clients: `lib/supabase.ts`, `lib/supabaseBrowser.ts`.
- Shared config/types: `lib/config.ts`, `lib/types.ts`, `lib/categories.ts`, `lib/quickfurno-data.ts`.
- Auth/session: `middleware.ts`, `app/actions.ts`, `components/LoginForm.tsx`, `components/AdminLoginForm.tsx`.
- AOS foundation: `lib/aos/**`.

## Future CRM And AOS Integration Points

- Lead created: after `services/leadService.ts:createLead` inserts a lead.
- Lead validated/qualified: after duplicate, consent, budget, service, city, and spam checks.
- Vendor matched: after a read-only matching preview, before any assignment RPC is called.
- Lead assigned: only after explicit admin/user confirmation, because assignment has credit and notification side effects today.
- Vendor lifecycle: after vendor registration, admin approval, suspension, package purchase, and credit renewal.
- Bad-lead replacement: through `bad_lead_reports`, not refunds.
- Admin audit: `audit_logs` exists in the superadmin foundation and should be the central record for sensitive admin/AOS decisions.
