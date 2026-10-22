-- Finance V2 PAY-2: append-only provider/payment history foundation.
-- SOURCE-ONLY candidate. No provider sends, refunds, schema activation or
-- financial credit mutation. Owner/DBA/AppSec signoff required before install.
begin;

-- Dedicated history rows MUST NOT be edited/deleted by an app, including
-- service_role: state changes are new provider/audit events instead.
create or replace function public.qf_finance_v2_reject_history_mutation()
returns trigger language plpgsql security invoker
set search_path=pg_catalog,public,pg_temp as $$
begin
 raise exception 'FINANCE_V2_IMMUTABLE_HISTORY' using errcode='P0001';
end $$;
revoke all on function public.qf_finance_v2_reject_history_mutation()
 from public,anon,authenticated;
grant execute on function public.qf_finance_v2_reject_history_mutation()
 to service_role;

create table public.finance_payment_attempts (
 id uuid primary key default gen_random_uuid(),
 order_id uuid not null references public.vendor_package_orders(id) on delete restrict,
 provider text not null check (provider='razorpay'),
 provider_mode text not null check (provider_mode in ('test','live')),
 merchant_account_id text not null check (length(btrim(merchant_account_id))>0),
 provider_payment_id text,
 expected_amount_subunits bigint not null check (expected_amount_subunits>0),
 currency text not null default 'INR' check(currency='INR'),
 initiated_at timestamptz not null default now(),
 initiated_source text not null check (initiated_source in ('checkout','webhook_recovery','provider_reconciliation')),
 unique(order_id,id)
);
create unique index uq_finance_v2_attempt_provider_payment
 on public.finance_payment_attempts(provider,provider_mode,merchant_account_id,provider_payment_id)
 where provider_payment_id is not null;
create index ix_finance_v2_attempt_order_time
 on public.finance_payment_attempts(order_id,initiated_at desc,id);

create table public.finance_provider_events (
 id uuid primary key default gen_random_uuid(),
 provider text not null check(provider='razorpay'),
 provider_mode text not null check(provider_mode in ('test','live')),
 merchant_account_id text not null check(length(btrim(merchant_account_id))>0),
 provider_event_id text not null check(length(btrim(provider_event_id))>0),
 event_type text not null check(length(btrim(event_type))>0),
 order_id uuid references public.vendor_package_orders(id) on delete restrict,
 attempt_id uuid references public.finance_payment_attempts(id) on delete restrict,
 provider_event_time timestamptz,
 received_at timestamptz not null default now(),
 payload_sha256 text not null check(payload_sha256 ~ '^[0-9a-f]{64}$'),
 signature_verified boolean not null check(signature_verified=true),
 unique(provider,provider_mode,merchant_account_id,provider_event_id)
);
create index ix_finance_v2_event_order_time
 on public.finance_provider_events(order_id,received_at desc,id);
create index ix_finance_v2_event_attempt_time
 on public.finance_provider_events(attempt_id,received_at desc,id);

create table public.finance_refunds (
 id uuid primary key default gen_random_uuid(),
 attempt_id uuid not null references public.finance_payment_attempts(id) on delete restrict,
 provider text not null check(provider='razorpay'),
 provider_mode text not null check(provider_mode in ('test','live')),
 merchant_account_id text not null check(length(btrim(merchant_account_id))>0),
 provider_refund_id text,
 requested_amount_subunits bigint not null check(requested_amount_subunits>0),
 currency text not null default 'INR' check(currency='INR'),
 request_reason_code text not null check(length(btrim(request_reason_code))>0),
 approval_reference uuid,
 requested_by uuid,
 requested_at timestamptz not null default now()
);
create unique index uq_finance_v2_provider_refund_id
 on public.finance_refunds(provider,provider_mode,merchant_account_id,provider_refund_id)
 where provider_refund_id is not null;
create index ix_finance_v2_refunds_attempt_time
 on public.finance_refunds(attempt_id,requested_at desc,id);

create table public.finance_audit_events (
 id uuid primary key default gen_random_uuid(),
 entity_type text not null check(entity_type in ('order','payment','attempt','webhook','refund','manual_receipt','reconciliation')),
 entity_id uuid not null,
 action text not null check(length(btrim(action))>0),
 actor_type text not null check(actor_type in ('system','staff','owner','provider','worker')),
 actor_id uuid,
 approval_reference uuid,
 occurred_at timestamptz not null default now(),
 reason_code text not null check(length(btrim(reason_code))>0),
 related_order_id uuid references public.vendor_package_orders(id) on delete restrict,
 evidence_sha256 text check(evidence_sha256 is null or evidence_sha256 ~ '^[0-9a-f]{64}$')
);
create index ix_finance_v2_audit_entity
 on public.finance_audit_events(entity_type,entity_id,occurred_at desc,id);
create index ix_finance_v2_audit_order
 on public.finance_audit_events(related_order_id,occurred_at desc,id);

-- All financial source/event records are SERVER ONLY, including read access.
-- Staff Finance projections require separately governed Core AAL2/ABAC routes.
do $$
declare t text;
begin
 foreach t in array array[
  'finance_payment_attempts','finance_provider_events',
  'finance_refunds','finance_audit_events'
 ] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('alter table public.%I force row level security',t);
  execute format('revoke all on table public.%I from public,anon,authenticated',t);
  execute format('grant select,insert on table public.%I to service_role',t);
  execute format(
    'create trigger trg_finance_v2_no_history_change
     before update or delete on public.%I
     for each row execute function public.qf_finance_v2_reject_history_mutation()',t);
 end loop;
end $$;

comment on table public.finance_payment_attempts is
 'PAY-2 SOURCE ONLY: immutable payment attempt identity, provider status derives from append-only events.';
comment on table public.finance_provider_events is
 'PAY-2 SOURCE ONLY: verified-provider event IDs; raw webhook body/secrets are intentionally not stored.';
comment on table public.finance_refunds is
 'PAY-2 SOURCE ONLY: immutable refund request reference, no refund API execution; transitions via later approved events.';
comment on table public.finance_audit_events is
 'PAY-2 SOURCE ONLY: access-controlled append-only human/provider finance actions.';

commit;
