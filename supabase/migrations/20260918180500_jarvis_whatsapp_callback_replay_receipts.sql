-- Durable replay receipt for authenticated Jarvis -> QuickFurno WhatsApp callbacks.
-- The governed conversation outbox remains the first idempotency barrier. A callback
-- receipt is recorded only after the reply has been durably queued, avoiding a crash
-- window where replay protection could suppress work that was never accepted.

create table public.communication_jarvis_callback_receipts (
  request_id uuid primary key,
  protocol text not null check (protocol='qfj.whatsapp.reply'),
  request_version integer not null check (request_version in (1,2)),
  request_digest text not null check (request_digest ~ '^[0-9a-f]{64}$'),
  idempotency_key text not null check (idempotency_key ~ '^[0-9a-f]{64}$'),
  outbox_id uuid not null references public.communication_conversation_outbox(id) on delete restrict,
  issued_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index communication_jarvis_callback_receipts_created_idx
  on public.communication_jarvis_callback_receipts(created_at desc);

alter table public.communication_jarvis_callback_receipts enable row level security;
revoke all on public.communication_jarvis_callback_receipts from public,anon,authenticated;
revoke all on public.communication_jarvis_callback_receipts from service_role;
grant select,insert on public.communication_jarvis_callback_receipts to service_role;

comment on table public.communication_jarvis_callback_receipts is
  'Durable authenticated-request replay ledger for Jarvis WhatsApp callbacks. Rows are written only after the governed QuickFurno outbox has been durably created.';
