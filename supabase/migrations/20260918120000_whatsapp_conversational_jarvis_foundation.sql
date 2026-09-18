-- QuickFurno conversational WhatsApp + Jarvis preparation foundation.
-- Additive and fail-closed. This does NOT register a second Meta number, enable Jarvis,
-- send a message, or give Jarvis provider credentials/authority.

alter table public.communication_provider_accounts
  add column account_alias text,
  add column account_role text not null default 'transactional'
    check (account_role in ('transactional','conversational')),
  add column jarvis_access_mode text not null default 'denied'
    check (jarvis_access_mode in ('denied','proposal_only')),
  add column is_default_for_role boolean not null default false;

alter table public.communication_provider_accounts
  add constraint communication_provider_account_alias_shape_chk
    check (account_alias is null or account_alias ~ '^[a-z][a-z0-9_-]{0,31}$'),
  add constraint communication_provider_account_jarvis_role_chk
    check (jarvis_access_mode='denied' or account_role='conversational');

create unique index communication_provider_account_alias_uidx
  on public.communication_provider_accounts(provider_key,channel,account_alias)
  where account_alias is not null;

create unique index communication_provider_default_transactional_uidx
  on public.communication_provider_accounts(provider_key,channel)
  where account_role='transactional' and is_default_for_role;

create unique index communication_provider_default_conversational_uidx
  on public.communication_provider_accounts(provider_key,channel)
  where account_role='conversational' and is_default_for_role;

-- Preserve multi-account installations. Only a provably sole pre-existing Meta WhatsApp
-- account may be named the Core default automatically; when two or more already exist,
-- role defaults stay transactional/denied but alias/default selection remains an explicit operator act.
with sole_existing_meta_account as (
  select min(id::text)::uuid as id
  from public.communication_provider_accounts
  where provider_key='meta_whatsapp_cloud'
    and channel='whatsapp'
  having count(*)=1
)
update public.communication_provider_accounts as account
set account_alias='core',
    account_role='transactional',
    jarvis_access_mode='denied',
    is_default_for_role=true,
    updated_at=now()
from sole_existing_meta_account as sole
where account.id=sole.id
  and account.account_alias is null;

create table public.communication_conversations (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'quickfurno',
  channel text not null default 'whatsapp' check (channel='whatsapp'),
  provider_key text not null,
  provider_account_id uuid not null references public.communication_provider_accounts(id) on delete restrict,
  destination_hash text not null check (destination_hash ~ '^[0-9a-f]{64}$'),
  destination_masked text not null,
  sealed_destination_ciphertext text not null,
  sealed_destination_nonce text not null,
  sealed_destination_auth_tag text not null,
  encryption_key_id text not null check (encryption_key_id ~ '^[A-Za-z0-9._:-]{1,64}$'),
  aad_schema_version integer not null default 1 check (aad_schema_version=1),
  subject_type text not null default 'unknown'
    check (subject_type in ('unknown','prospect','client','vendor')),
  subject_id uuid,
  aarohi_prospect_id uuid references public.aarohi_prospects(id) on delete set null,
  assigned_actor text not null default 'AAROHI'
    check (assigned_actor in ('AAROHI','ANISHA','RIYA','HUMAN','SYSTEM')),
  state text not null default 'OPEN'
    check (state in ('OPEN','PAUSED','HUMAN','CLOSED')),
  jarvis_enabled boolean not null default false,
  human_takeover boolean not null default false,
  last_inbound_at timestamptz,
  service_window_expires_at timestamptz,
  last_outbound_at timestamptz,
  last_inbound_provider_message_id text,
  last_outbound_provider_message_id text,
  revision bigint not null default 0 check (revision>=0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint communication_conversation_human_state_chk
    check ((human_takeover=false) or state='HUMAN'),
  constraint communication_conversation_jarvis_human_chk
    check (not (jarvis_enabled and human_takeover))
);

create unique index communication_conversation_active_destination_uidx
  on public.communication_conversations(provider_account_id,destination_hash)
  where state in ('OPEN','PAUSED','HUMAN');

create index communication_conversation_actor_idx
  on public.communication_conversations(assigned_actor,state,updated_at desc);

create index communication_conversation_service_window_idx
  on public.communication_conversations(service_window_expires_at)
  where state='OPEN' and human_takeover=false;

alter table public.communication_inbound_messages
  add column conversation_id uuid references public.communication_conversations(id) on delete set null;

create index communication_inbound_messages_conversation_idx
  on public.communication_inbound_messages(conversation_id,received_at desc)
  where conversation_id is not null;

alter table public.communication_messages
  add column conversation_id uuid references public.communication_conversations(id) on delete set null;

create index communication_messages_conversation_idx
  on public.communication_messages(conversation_id,created_at desc)
  where conversation_id is not null;

create table public.communication_conversation_outbox (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.communication_conversations(id) on delete restrict,
  provider_account_id uuid not null references public.communication_provider_accounts(id) on delete restrict,
  proposal_source text not null check (proposal_source in ('JARVIS','HUMAN','SYSTEM')),
  proposal_id text,
  expected_revision bigint not null check (expected_revision>=0),
  body_digest text not null check (body_digest ~ '^[0-9a-f]{64}$'),
  sealed_body_ciphertext text not null,
  sealed_body_nonce text not null,
  sealed_body_auth_tag text not null,
  encryption_key_id text not null check (encryption_key_id ~ '^[A-Za-z0-9._:-]{1,64}$'),
  aad_schema_version integer not null default 1 check (aad_schema_version=1),
  idempotency_key text not null unique,
  status text not null default 'pending'
    check (status in ('pending','claimed','accepted','sent','delivered','read','failed','cancelled','superseded','outcome_unknown')),
  provider_message_id text,
  attempt_count integer not null default 0 check (attempt_count between 0 and 1),
  failure_code text,
  failure_reason_sanitized text,
  claimed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index communication_conversation_outbox_dispatch_idx
  on public.communication_conversation_outbox(status,created_at)
  where status='pending';

create index communication_conversation_outbox_provider_message_idx
  on public.communication_conversation_outbox(provider_account_id,provider_message_id)
  where provider_message_id is not null;

create table public.communication_jarvis_turn_outbox (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.communication_conversations(id) on delete restrict,
  inbound_message_id uuid not null references public.communication_inbound_messages(id) on delete restrict,
  conversation_revision bigint not null check (conversation_revision>=0),
  assigned_actor text not null check (assigned_actor in ('AAROHI','ANISHA','RIYA')),
  status text not null default 'pending'
    check (status in ('pending','claimed','accepted','retry_scheduled','failed','cancelled')),
  attempt_count integer not null default 0 check (attempt_count between 0 and 5),
  next_retry_at timestamptz,
  last_safe_code text,
  claimed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(inbound_message_id)
);

create index communication_jarvis_turn_outbox_dispatch_idx
  on public.communication_jarvis_turn_outbox(status,next_retry_at,created_at)
  where status in ('pending','retry_scheduled');

create table public.communication_conversation_events (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.communication_conversations(id) on delete restrict,
  event_type text not null,
  actor_type text not null check (actor_type in ('AAROHI','ANISHA','RIYA','JARVIS','HUMAN','SYSTEM','META')),
  safe_summary text,
  reference_type text,
  reference_id text,
  event_data jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index communication_conversation_events_timeline_idx
  on public.communication_conversation_events(conversation_id,occurred_at desc);

do $$
declare t text;
begin
  foreach t in array array[
    'communication_conversations',
    'communication_conversation_outbox',
    'communication_jarvis_turn_outbox',
    'communication_conversation_events'
  ] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('revoke all on public.%I from service_role',t);
  end loop;
end $$;

grant select,insert,update on public.communication_conversations to service_role;
grant select,insert,update on public.communication_conversation_outbox to service_role;
grant select,insert,update on public.communication_jarvis_turn_outbox to service_role;
grant select,insert on public.communication_conversation_events to service_role;

comment on table public.communication_conversations is
  'QuickFurno-owned WhatsApp conversation authority. Jarvis may propose replies but never owns provider credentials, service-window authority, or send authority.';
comment on table public.communication_conversation_outbox is
  'Encrypted one-shot conversational reply queue. No automatic resend after a provider attempt; uncertain outcomes remain outcome_unknown.';
comment on column public.communication_provider_accounts.jarvis_access_mode is
  'Provider-account boundary. proposal_only permits Jarvis reply proposals only; QuickFurno remains the sender and policy authority.';
