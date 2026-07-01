# Phase 25A - Paid-Only Auto Match + Free Vendor Interest

## Business Rules

- Public visibility is separate from lead assignment eligibility.
- Approved active paid vendors can be publicly visible and can appear in preview suggestions when credits are available.
- Trial vendors can appear in suggestions only when `allow_trial_vendors_for_assignment` is on and credits are available.
- Free/unpaid vendors can be publicly visible only when `show_free_vendors_publicly` is on.
- Free/unpaid vendors never receive assigned leads and never receive client contact details.
- If no suitable paid/trial vendor is available, the lead is placed in `lead_assignment_queue`.
- Free vendor contact requests capture masked/hash client phone only and show the safe client confirmation message.

## Public Visibility vs Assignment Eligibility

- `lib/vendors/vendorVisibility.ts` decides whether a vendor can be shown publicly.
- `lib/vendors/vendorEligibility.ts:evaluateVendorLeadAssignmentEligibility()` decides whether a vendor can be suggested for paid-only lead assignment preview.
- Free/unpaid vendors always return `free_unpaid_vendor_not_eligible_for_assignment`.
- Hard rejection reasons include package expiry, no credits, city/category/subcategory mismatch, inactive, pending approval, and suspended status.

## Supabase Migration

Migration:

`supabase/migrations/20260701000022_phase_25a_paid_only_auto_match_free_vendor_interest.sql`

Adds:

- `marketplace_runtime_settings`
- `free_vendor_profile_interests`
- `lead_assignment_queue`
- `lead_auto_assignment_logs`

The migration is additive only: create tables, create indexes, and seed settings with `on conflict do nothing`.

## Admin Switches

Settings are stored in `marketplace_runtime_settings`:

- `show_free_vendors_publicly`
- `allow_free_vendor_interest_capture`
- `notify_free_vendor_recharge_interest`
- `allow_trial_vendors_for_assignment`
- `minimum_paid_vendors_required_for_auto_assignment`
- `max_vendors_per_lead`
- `auto_assignment_mode`

## AOS Events

Added safe preview event types:

- `vendor.profile_interest_captured`
- `vendor.recharge_prompt_preview`
- `lead.assignment_queued`
- `lead.assignment_queue_rechecked`

## n8n Preview Mapping

- `vendor.profile_interest_captured` -> `QF-n8n-Free-Vendor-Interest-Preview`
- `vendor.recharge_prompt_preview` -> `QF-n8n-Vendor-Recharge-Prompt-Preview`
- `lead.assignment_queued` -> `QF-n8n-Lead-Assignment-Queued`
- `lead.assignment_queue_rechecked` -> `QF-n8n-Lead-Queue-Rechecked`

## Safety Rules

- No call to `assignLeadToVendors()` from the auto matching preview engine.
- No call to the `assign_lead_to_vendors` RPC.
- No WhatsApp sending.
- No vendor notification with client details.
- No credit deduction.
- No final assignment.
- No public secret exposure.
- AOS/n8n forwarding still goes through the Phase 12 two-lock gate via `resolveAosN8nActivation()`.

## Testing Checklist

- Run `npm run build`.
- Confirm `git status --short .env .env.local` shows no env changes.
- Confirm `git diff --stat`.
- In admin settings, toggle free vendor visibility and verify public free vendor cards hide/show.
- Run auto match preview for a lead with no paid eligible vendors and verify it queues.
- Run queue recheck and verify status/logs are preview-only.
- Submit a free vendor callback request and verify only masked/hash phone is stored.
- Confirm free vendors are never assignment eligible.

## Rollback Steps

- Turn `auto_assignment_mode` to `off`.
- Turn `show_free_vendors_publicly` off if free vendor profiles must be hidden.
- Turn `allow_free_vendor_interest_capture` off to stop new interest capture.
- Leave captured rows in place for audit; do not delete production records.
