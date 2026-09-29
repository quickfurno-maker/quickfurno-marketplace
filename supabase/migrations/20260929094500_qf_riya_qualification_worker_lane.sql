-- QuickFurno Phase 2: stateless Riya qualification over the existing Jarvis worker lane.
-- Additive only. Ordinary Jarvis WhatsApp stays independent and provider authority remains in Core.

alter table public.communication_jarvis_turn_outbox
  add column if not exists turn_purpose text not null default 'conversation',
  add column if not exists qualification_request_id uuid null
    references public.lead_clarification_requests(id) on delete restrict;

alter table public.communication_jarvis_turn_outbox
  drop constraint if exists communication_jarvis_turn_outbox_purpose_check;
alter table public.communication_jarvis_turn_outbox
  add constraint communication_jarvis_turn_outbox_purpose_check
  check (turn_purpose in ('conversation','lead_qualification'));

alter table public.communication_jarvis_turn_outbox
  drop constraint if exists communication_jarvis_turn_outbox_qualification_check;
alter table public.communication_jarvis_turn_outbox
  add constraint communication_jarvis_turn_outbox_qualification_check
  check (
    (turn_purpose='conversation' and qualification_request_id is null)
    or
    (turn_purpose='lead_qualification' and qualification_request_id is not null and assigned_actor='RIYA')
  );

create index if not exists communication_jarvis_turn_outbox_qualification_dispatch_idx
  on public.communication_jarvis_turn_outbox(status,created_at)
  where turn_purpose='lead_qualification'
    and status in ('pending','retry_scheduled');

alter table public.communication_jarvis_callback_receipts
  add column if not exists qualification_request_id uuid null
    references public.lead_clarification_requests(id) on delete restrict;

alter table public.communication_jarvis_callback_receipts
  drop constraint if exists communication_jarvis_callback_receipts_request_version_check;
alter table public.communication_jarvis_callback_receipts
  add constraint communication_jarvis_callback_receipts_request_version_check
  check (request_version in (1,2,3));

alter table public.communication_jarvis_callback_receipts
  drop constraint if exists communication_jarvis_callback_receipt_finalize_chk;
alter table public.communication_jarvis_callback_receipts
  add constraint communication_jarvis_callback_receipt_finalize_chk
  check (
    (outbox_id is null and qualification_request_id is null and finalized_at is null)
    or
    (outbox_id is not null and qualification_request_id is null and finalized_at is not null)
    or
    (outbox_id is null and qualification_request_id is not null and finalized_at is not null)
  );

comment on column public.communication_jarvis_turn_outbox.turn_purpose is
  'Closed Jarvis turn purpose. lead_qualification is the narrow Phase-2 stateless Riya interpretation lane.';
comment on column public.communication_jarvis_turn_outbox.qualification_request_id is
  'Exact active Core clarification request for a lead_qualification turn. Never a client identity.';
comment on column public.communication_jarvis_callback_receipts.qualification_request_id is
  'Terminal Core clarification-request reference for a finalized v3 qualification callback; mutually exclusive with conversational outbox_id.';
