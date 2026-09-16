-- QuickFurno — Jarvis production handshake readiness.
-- Durable idempotency/replay ledger for signed qfj.core.decision commands.
-- Stores no private key, provider credential, plaintext phone, or message body.

begin;

create table if not exists public.jarvis_core_decision_receipts (
  command_id text primary key,
  idempotency_key text not null unique,
  proposal_id text not null,
  proposal_version integer not null check (proposal_version >= 1),
  conversation_id text not null,
  expected_revision bigint not null check (expected_revision >= 0),
  proposal_digest text not null,
  state text not null default 'processing'
    check (state in ('processing','completed')),
  outcome text,
  reason text,
  response jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_jarvis_core_decision_receipts_conversation
  on public.jarvis_core_decision_receipts(conversation_id, created_at desc);

comment on table public.jarvis_core_decision_receipts is
  'Core-owned replay/idempotency ledger for signed Jarvis core-decision commands. No execution authority.';

alter table public.jarvis_core_decision_receipts enable row level security;
revoke all on table public.jarvis_core_decision_receipts
  from public, anon, authenticated, service_role;
grant select, insert, update on table public.jarvis_core_decision_receipts
  to service_role;

-- No authenticated/anon policy is created: this is a private Core transport ledger.
-- The service role is the only writer and reader.

commit;
