# QuickFurno Security Boundaries

This document records safety boundaries for the live QuickFurno Next.js and Supabase project.

## Secrets And Keys

- No Supabase service role key in frontend code.
- No AI API key in frontend code.
- No WhatsApp token in frontend code.
- No n8n webhook secret in frontend code.
- Only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are expected in browser code.
- `SUPABASE_SERVICE_ROLE_KEY` must remain server-only and should only be accessed inside server modules/actions/services.
- Do not log secret values. Logging `Boolean(process.env.KEY)` is safer than logging the key itself.

Current code notes:

- `lib/supabase.ts:adminClient` uses the service role key and must remain server-only.
- `lib/supabaseBrowser.ts:browserClient` uses only public Supabase values.
- Server actions in `app/actions.ts` are the main boundary between browser components and privileged service operations.

## Admin Route Protection

- Admin routes must be protected.
- `middleware.ts` redirects unauthenticated `/admin/*` requests to `/admin/login`.
- Admin pages also call `getAdminSession` and require `isSuperadmin`.
- Admin mutations in `app/actions.ts` go through `requireSuperadmin`.
- Future admin routes such as `/admin/aos`, `/admin/crm`, and `/admin/analytics` should follow this same convention.

## Phone Number And Personal Data Handling

- Phone numbers should be masked in list views.
- Full phone numbers should only be shown in authorized detail views.
- Public vendor APIs must not expose client phone numbers.
- Public vendor listing APIs must not expose vendor phone/email unless intentionally designed and approved.
- AOS logs should store summaries and masked values, not full client phone numbers.

Current code notes:

- `get_public_eligible_vendors` returns safe vendor listing fields and excludes phone/email.
- Admin lead/vendor tables currently show some phone fields in list cells. This is acceptable only for protected Superadmin UI, but future CRM/AOS list views should prefer masked phone by default.
- Vendor dashboard lead detail access is ownership-scoped through server actions.

## Dangerous Actions Requiring Approval

Dangerous admin or agent actions should require explicit approval and audit logging:

- Suspend vendor.
- Approve replacement lead.
- Reject replacement lead.
- Change package price.
- Send bulk campaign.
- Change vendor priority.
- Publish SEO page.
- Delete lead/vendor data.
- Send WhatsApp.
- Deduct credits.
- Assign live lead.
- Change vendor public visibility.

## Messaging And Automation

- No real WhatsApp sending until a feature flag is enabled and templates are approved.
- No n8n webhook calling until signed webhook validation and secret handling are ready.
- No automatic bulk campaign sending.
- WhatsApp/n8n/AOS tool placeholders should remain disabled until the AOS Control Center and rollback controls exist.

Current code notes:

- `lib/aos/tools/whatsappTool.ts` is disabled and placeholder-only.
- `lib/aos/tools/n8nTool.ts` is disabled and placeholder-only.
- The existing `assign_lead_to_vendors` database RPC inserts rows into `whatsapp_logs`. Whether those rows result in real sends depends on the Edge Function/dispatch setup and operational configuration. Treat assignment as a live side-effect boundary.

## Credits And Lead Distribution

- No credit deduction until confirmed.
- No automatic vendor credit deduction by AOS.
- No live lead distribution from AOS until explicitly approved.
- One client lead should eventually be shared with maximum 3 matched vendors.
- Disabled, inactive, suspended, or zero-credit vendors should not receive leads.
- Invalid leads should be replaced, not refunded.

Current code notes:

- `MAX_VENDORS_PER_LEAD = 3` in `lib/config.ts`.
- `app_settings.max_vendors_per_lead` is seeded as `3`.
- `assign_lead_to_vendors` enforces the max vendor cap and deducts one credit per assigned vendor.
- Future AOS matching must remain read-only until an approval/feature-flag layer calls assignment intentionally.

## Vendor Suspension And Moderation

- No automatic vendor suspension.
- TrustShield can recommend vendor review in the future, but suspension should require admin approval.
- Bad-lead reports should be reviewed by admin.
- Replacement lead approval should be auditable.

## Supabase And RLS

- Tables exposed through public schema should have RLS enabled.
- Avoid unsafe public policies.
- Public reads should return only safe fields.
- Service role should be used only on the server.
- `SECURITY DEFINER` functions should be treated as privileged code and carefully reviewed.
- New tables for AOS/CRM/analytics should be admin-only by default unless a public use case is explicitly approved.

Current code notes:

- Existing migrations enable RLS for base and admin-foundation tables.
- Helper functions such as `public.is_admin()` and `public.owns_vendor()` are used by policies.
- Privileged assignment and credit functions revoke execute from public/anon/authenticated and grant to `service_role`.

## Audit Requirements

Sensitive actions should write audit records with:

- Actor/admin user.
- Action name.
- Entity type.
- Entity ID.
- Before/after metadata where safe.
- Reason.
- Created timestamp.

Current code notes:

- `audit_logs` exists in the superadmin foundation migration.
- `services/adminService.ts` writes audit logs best-effort for some admin mutations.
- Future AOS logs should be separate from audit logs but link to audit records for sensitive decisions.
