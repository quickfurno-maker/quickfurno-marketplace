# QuickFurno CRM Flow

This document defines target CRM vocabulary for future QuickFurno lead nurturing and operations. It does not mean these statuses are active in the database today.

## CRM Statuses

### `new`

Fresh lead received from public website, enquiry flow, admin entry, or future import.

Entry criteria:

- Required lead fields are present.
- No qualification or matching decision has been made yet.

### `qualified`

Lead appears valid and worth matching.

Entry criteria:

- Required fields pass validation.
- Lead is not clearly spam, invalid, or duplicate.
- Service and city are supported or can be manually handled.

### `spam_review`

Lead needs manual review for spam, abuse, duplicate, fake phone, or suspicious patterns.

Entry criteria:

- Spam indicators detected.
- Repeated low-quality submissions.
- Suspicious vendor/client behavior.

### `vendor_matching`

Lead is ready for vendor matching.

Entry criteria:

- Lead is qualified.
- City, area, service, and vendor eligibility can be evaluated.

### `assigned`

Lead has been assigned/shared with one or more vendors.

Entry criteria:

- Explicit assignment has happened.
- Maximum vendor cap is respected.

### `vendor_contact_pending`

Assigned vendors have not yet updated contact status.

Entry criteria:

- Lead is assigned.
- Vendor response or contact confirmation is pending.

### `client_contacted`

Client has been contacted by QuickFurno admin or vendor.

Entry criteria:

- Contact is logged.
- Follow-up can be scheduled if needed.

### `site_visit_scheduled`

A vendor/client site visit is scheduled.

Entry criteria:

- Date/time is known.
- Vendor and client are aligned.

### `quotation_sent`

Vendor has sent a quotation or proposal.

Entry criteria:

- Quotation sent by vendor or recorded by admin.

### `won`

Lead converted into paid/project work.

Entry criteria:

- Client selected a vendor or project is confirmed.

### `lost`

Lead is no longer an active opportunity.

Entry criteria:

- Client dropped, chose outside QuickFurno, budget mismatch, vendor unavailable, or no response after defined follow-up attempts.

### `nurture_later`

Lead is real but not ready now.

Entry criteria:

- Client wants future follow-up.
- Budget/timeline is later.

### `invalid`

Lead cannot be worked.

Entry criteria:

- Invalid phone.
- Unsupported request.
- Fake/test submission.
- Insufficient contact details after review.

### `duplicate`

Lead matches an existing recent lead.

Entry criteria:

- Duplicate phone + service + city window or manual duplicate confirmation.

## Nurture Stages

### `nurture_3_days`

Short follow-up for hot leads that need a quick nudge.

### `nurture_7_days`

One-week follow-up for leads comparing vendors or waiting for family/internal approval.

### `nurture_15_days`

Two-week follow-up for leads with moderate intent or delayed decision.

### `nurture_30_days`

Monthly follow-up for early-stage or budget-planning leads.

### `nurture_60_days`

Two-month follow-up for slower renovation/interior planning cycles.

### `nurture_90_days`

Quarterly follow-up for long-cycle home projects.

### `nurture_6_months`

Semiannual check-in for future project planning.

### `nurture_1_year`

Annual follow-up for very long-term or not-ready leads.

### `custom_nurture_date`

Admin-selected date outside standard stages.

### `future_project`

Client has a genuine future project but no near-term action.

### `not_ready_now`

Client is currently not ready, but not lost.

### `reopen_later`

Lead was paused/lost and should be reopened later.

## CRM Calendar Event Types

### `client_call`

Admin or vendor call with the client.

### `vendor_call`

Admin call with vendor for availability, response, quote status, renewal, or dispute.

### `site_visit`

Scheduled visit between client and vendor.

### `quotation_followup`

Follow-up after quote or proposal is expected/sent.

### `nurture_followup`

Scheduled nurture touchpoint for future or not-ready leads.

### `complaint_followup`

Follow-up for bad lead, vendor issue, client complaint, or service-quality concern.

### `renewal_followup`

Vendor package, credits, payment, or subscription renewal follow-up.

## Future CRM Placement

Recommended route:

- `/admin/crm`

Recommended implementation location:

- `app/admin/crm/page.tsx` if a dedicated route is needed.
- Or add `crm` to `components/admin/adminConfig.ts` and render it through `app/admin/[section]/page.tsx`.

Recommended data model areas:

- `leads.status` or a new CRM-specific lead status field.
- `lead_timeline_events` for event history.
- `lead_internal_notes` for admin notes and follow-ups.
- A future `crm_tasks` or `crm_calendar_events` table for scheduled work.

Safety rules:

- Do not change existing status enum without a migration plan.
- Keep status mapping backwards-compatible with existing admin dashboard statuses.
- Keep full phone visible only in authorized detail views.
- Do not trigger assignment, WhatsApp, or credit changes from CRM status changes unless explicitly approved.
