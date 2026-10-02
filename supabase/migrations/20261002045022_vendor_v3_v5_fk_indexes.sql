-- Vendor V3-V5 covering indexes for newly introduced foreign keys.
begin;

create index if not exists idx_bad_lead_reports_credit_restoration_approval_id
  on public.bad_lead_reports(credit_restoration_approval_id)
  where credit_restoration_approval_id is not null;

create index if not exists idx_bad_lead_reports_replacement_request_id
  on public.bad_lead_reports(replacement_request_id)
  where replacement_request_id is not null;

create index if not exists idx_lead_delivery_logs_communication_intent_id
  on public.lead_delivery_logs(communication_intent_id)
  where communication_intent_id is not null;

commit;
