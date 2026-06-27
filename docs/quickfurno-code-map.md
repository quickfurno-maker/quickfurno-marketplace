# QuickFurno Code Map

This document defines where code and docs should live as QuickFurno grows into AOS, CRM, lead nurturing, analytics, and future automation.

## `app/`

Purpose:

- Next.js App Router routes, layouts, metadata, server pages, route handlers, and server actions.

Current examples:

- Public pages: `app/page.tsx`, `app/enquiry/page.tsx`, `app/vendors/page.tsx`, `app/vendors/[id]/page.tsx`, `app/pricing/page.tsx`.
- Vendor pages: `app/vendor/page.tsx`, `app/vendor/layout.tsx`.
- Admin pages: `app/admin/layout.tsx`, `app/admin/login/page.tsx`, `app/admin/dashboard/page.tsx`, `app/admin/[section]/page.tsx`.
- Server action boundary: `app/actions.ts`.

Guidelines:

- Keep page files focused on route composition, metadata, auth redirects, and data fetching.
- Do not put large business logic directly in route files.
- Server actions should call services and enforce auth boundaries.

## `components/`

Purpose:

- React UI components for public pages, forms, admin UI, vendor dashboard, and shared presentation.

Current examples:

- Lead UI: `components/ClientEnquiryModal.tsx`, `components/LeadFunnel.tsx`, `components/HomeEnquiryForm.tsx`, `components/LeadForm.tsx`.
- Vendor UI: `components/VendorRegisterForm.tsx`, `components/VendorApplicationForm.tsx`, `components/VendorDashboard.tsx`, `components/VendorCards.tsx`.
- Admin UI: `components/AdminDashboard.tsx`, `components/admin/AdminShell.tsx`, `components/admin/AdminSectionPage.tsx`, `components/admin/AdminPrimitives.tsx`.
- Shared public UI: `components/Header.tsx`, `components/Footer.tsx`, `components/Logo.tsx`, `components/QuickFurnoIcons.tsx`.

Guidelines:

- Keep form designs stable unless a phase explicitly asks to change them.
- Keep public UI separate from admin/AOS/CRM surfaces.
- Use `components/admin/` for reusable admin console primitives.

## `lib/aos/`

Purpose:

- AOS foundation, agent configs, agent services, schemas, rules, memory, events, logs, approvals, and safe tool placeholders.

Current areas:

- `lib/aos/agents/*`: agent-specific config, prompt, schema, and service files.
- `lib/aos/kernel/*`: orchestration, routing, permission gates, context, approvals, audit writer.
- `lib/aos/events/*`: event names, event bus, event handlers.
- `lib/aos/memory/*`: placeholder memory helpers.
- `lib/aos/rules/*`: placeholder business/security/matching/replacement/pricing rules.
- `lib/aos/tools/*`: disabled placeholders for Supabase, WhatsApp, email, and n8n.
- `lib/aos/logs/*`: placeholder agent/audit log helpers.
- `lib/aos/approvals/*`: approval service/rules placeholders.
- `lib/aos/types/index.ts`: AOS runtime types.

Guidelines:

- No real AI calls until explicitly enabled.
- No WhatsApp sends from AOS.
- No n8n calls from AOS.
- No credit deductions from AOS.
- No live assignment from AOS.
- Keep agent logic versionable and testable before activation.

## `services/`

Purpose:

- Server-side business logic that talks to Supabase and database RPCs.

Current examples:

- `services/leadService.ts`: lead creation, eligible vendor lookup, assignment RPC.
- `services/vendorService.ts`: vendor registration, dashboard stats, vendor lead status, bad-lead reports.
- `services/packageService.ts`: package listing, manual payments, paid package assignment.
- `services/adminService.ts`: superadmin snapshots, admin CRUD-ish actions, audit logging.

Guidelines:

- Services may use `adminClient` only when imported from server-only call paths.
- Services should return typed `Result` objects.
- Keep side-effecting functions obvious and documented.
- Do not call side-effecting assignment/credit/message functions from AOS without explicit approval.

## `lib/`

Purpose:

- Shared app utilities, config, types, Supabase clients, data helpers, categories, images, errors, and logging helpers.

Current examples:

- `lib/supabase.ts`: server/public/request Supabase clients.
- `lib/supabaseBrowser.ts`: browser auth Supabase client.
- `lib/config.ts`: business constants, contact links, service lists, max vendors per lead.
- `lib/types.ts`: shared app types.
- `lib/errors.ts`: app error/result helpers.
- `lib/categories.ts`, `lib/quickfurno-data.ts`: category/city/service data.
- `lib/geo.ts`, `lib/images.ts`, `lib/supabaseLogging.ts`: support utilities.

Guidelines:

- Keep environment access centralized.
- Do not import server-only modules into client components.
- Keep public constants and server secrets clearly separated.

## `supabase/migrations/`

Purpose:

- Versioned SQL migrations for schema, RLS, functions, seeds, admin foundation, and future safe data-model changes.

Guidelines:

- Migrations must be additive and reversible where possible.
- Avoid destructive database changes.
- Enable RLS for new public-schema tables.
- Avoid unsafe public policies.
- Comment admin-only tables clearly.
- Do not apply migrations automatically from code-generation phases unless explicitly requested.

## `docs/`

Purpose:

- Architecture notes, flow maps, security boundaries, phase plans, and handoff docs.

Current Phase 1C docs:

- `docs/quickfurno-current-flow.md`
- `docs/quickfurno-aos-flow.md`
- `docs/quickfurno-crm-flow.md`
- `docs/quickfurno-security-boundaries.md`
- `docs/quickfurno-code-map.md`

Guidelines:

- Use docs to clarify behavior before changing runtime code.
- Keep docs updated when new admin/AOS/CRM workflows are introduced.

## Future AOS Control Center

Recommended route:

- `/admin/aos`

Recommended placement:

- Add `aos` to `components/admin/adminConfig.ts`.
- Render through `app/admin/[section]/page.tsx` and `components/admin/AdminSectionPage.tsx`, or create `app/admin/aos/page.tsx` if the surface becomes large enough to justify a dedicated route file.
- Keep reusable AOS UI in `components/admin/aos/` if it grows beyond one page.

Safety:

- Use existing Superadmin auth convention.
- Use mock/fallback data until AOS tables exist.
- No live agent execution.
- No real AI calls.
- No live assignment.
- No WhatsApp send.
- No credit deduction.

## Future CRM

Recommended route:

- `/admin/crm`

Recommended placement:

- Add `crm` to admin config or create a dedicated `app/admin/crm/page.tsx`.
- Reuse `components/admin/AdminPrimitives.tsx`.
- Put CRM-specific components in `components/admin/crm/` when needed.
- Keep server-side CRM business logic in `services/crmService.ts` only after the data model is approved.

Safety:

- Start read-only or placeholder-only.
- Map existing statuses before adding new database statuses.
- Do not trigger assignment, messaging, or credits from status changes without explicit approval.

## Future Analytics

Recommended route:

- `/admin/analytics`

Recommended placement:

- Add `analytics` to admin config or create `app/admin/analytics/page.tsx`.
- Keep calculations in `services/analyticsService.ts` when live Supabase queries are introduced.
- Keep UI in `components/admin/analytics/` if the section grows.

Safety:

- Use aggregated metrics where possible.
- Mask phone/client PII in list-level analytics.
- Avoid expensive queries in page render paths.
- Add indexes before large analytics queries go live.
