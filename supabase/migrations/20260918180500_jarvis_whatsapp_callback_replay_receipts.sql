-- Durable replay claim for authenticated Jarvis -> QuickFurno WhatsApp callbacks.
-- A request id is claimed BEFORE reply queueing so a conflicting signed body cannot
-- create a second outbox entry. The claim is finalized only after the governed outbox
-- exists. An identical unfinished retry may safely resume because the outbox itself is
-- idempotent on idempotency_key.

create table public.communication_jarvis_callback_receipts (
  request_id uuid primary key,
  protocol text not null check (protocol='qfj.whatsapp.reply'),
  request_version integer not null check (request_version in (1,2)),
  request_digest text not null check (request_digest ~ '^[0-9a-f]{64}$'),
  idempotency_key text not null check (idempotency_key ~ '^[0-9a-f]{64}$'),
  outbox_id uuid references public.communication_conversation_outbox(id) on delete restrict,
  issued_at timestamptz not null,
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  constraint communication_jarvis_callback_receipt_finalize_chk
    check (
      (outbox_id is null and finalized_at is null)
      or (outbox_id is not null and finalized_at is not null)
    )
);

create index communication_jarvis_callback_receipts_created_idx
  on public.communication_jarvis_callback_receipts(created_at desc);

alter table public.communication_jarvis_callback_receipts enable row level security;
revoke all on public.communication_jarvis_callback_receipts from public,anon,authenticated;
revoke all on public.communication_jarvis_callback_receipts from service_role;
grant select,insert,update on public.communication_jarvis_callback_receipts to service_role;

comment on table public.communication_jarvis_callback_receipts is
  'Durable authenticated-request replay claim ledger for Jarvis WhatsApp callbacks. Claims are created before queueing; identical unfinished retries may resume, while conflicting request-id reuse is rejected before the outbox.';
