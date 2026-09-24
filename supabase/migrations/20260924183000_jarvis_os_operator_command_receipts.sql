-- Durable replay/idempotency receipts for Jarvis OS operator commands.
-- The receipt stores no PII and no command payload: only opaque ids, digest, action and final result.
create table if not exists public.jarvis_os_operator_command_receipts (
  command_id uuid primary key,
  idempotency_key text not null unique,
  request_digest text not null check (request_digest ~ '^[0-9a-f]{64}$'),
  action text not null check (action in (
    'APPROVAL_DECIDE',
    'CONVERSATION_TAKEOVER',
    'CONVERSATION_RESUME_AI',
    'CONVERSATION_PAUSE_AI'
  )),
  state text not null default 'CLAIMED' check (state in ('CLAIMED','FINALIZED')),
  result_status text check (result_status is null or result_status in (
    'APPLIED_BY_AUTHORITY','REFUSED','UNAVAILABLE','CONFLICT'
  )),
  reason_code text check (reason_code is null or reason_code ~ '^[A-Za-z0-9._:-]{1,128}$'),
  created_at timestamptz not null default now(),
  finalized_at timestamptz,
  constraint jarvis_os_operator_command_receipts_final_shape check (
    (state='CLAIMED' and result_status is null and reason_code is null and finalized_at is null)
    or
    (state='FINALIZED' and result_status is not null and reason_code is not null and finalized_at is not null)
  )
);

alter table public.jarvis_os_operator_command_receipts enable row level security;
revoke all on table public.jarvis_os_operator_command_receipts from anon, authenticated;
grant select, insert, update on table public.jarvis_os_operator_command_receipts to service_role;

comment on table public.jarvis_os_operator_command_receipts is
  'Content-free idempotency/replay receipts for authenticated Jarvis OS operator commands.';
