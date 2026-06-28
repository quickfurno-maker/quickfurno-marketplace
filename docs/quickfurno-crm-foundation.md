# QuickFurno CRM Foundation

## What was created

- Admin CRM display foundation at `/admin/crm` through the existing admin section route.
- CRM overview cards for total CRM leads, new leads, hot leads, unassigned leads, follow-ups due, nurture leads, site visits scheduled, won leads, and lost leads.
- Lead pipeline board covering all requested CRM statuses.
- Lead detail placeholder with masked phone, city, service category, budget, source, status, priority, assigned vendors placeholder, timeline placeholder, notes placeholder, and follow-up placeholder.
- Follow-up task table with lead, task type, due date, owner, and status.
- Nurture queue labels for all requested nurture stages and reasons.
- CRM calendar placeholder with all requested event types.
- CRM activity timeline placeholder with safe sample activity cards.
- Safe CRM adapter at `lib/crm/crmAdapter.ts`.
- CRM types in `lib/crm/types/index.ts`.
- Additive migration SQL file under `supabase/migrations`.

## What is placeholder

- CRM overlay data from `crm_*` tables.
- Lead notes.
- Lead tasks.
- Activity timeline persistence.
- Follow-up persistence.
- Nurture reminder scheduling.
- Calendar events and Google Calendar sync.
- Vendor assignment details.
- Full phone reveal.

## What is not active yet

- No WhatsApp sending.
- No n8n webhook call.
- No automatic lead assignment.
- No vendor credit deduction.
- No CRM database writes from the admin page.
- No migration was applied from this implementation.

## Future activation steps

1. Review the SQL migration manually.
2. Apply the migration through the approved Supabase deployment process.
3. Add guarded server actions for CRM writes.
4. Add admin audit logging before enabling sensitive actions.
5. Add full phone reveal only through an audited superadmin-only server action.
6. Connect n8n and WhatsApp only after feature flags and test workflows are approved.
7. Add replacement rules for invalid leads before any paid vendor automation is enabled.

## Safety rules

- Keep public lead forms unchanged.
- Keep vendor forms unchanged.
- Keep phone numbers masked in list and placeholder detail views.
- Do not call real automation from CRM UI.
- Do not deduct credits from CRM UI.
- Do not auto-assign leads from CRM UI.
- Do not apply migrations automatically.
