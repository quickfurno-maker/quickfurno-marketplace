-- PAY-3 Final A signed Razorpay event -> immutable receipt/link/inbox atomic SQL.
-- SOURCE ONLY, never install before independent DBA + AppSec + owner PAY-4 signoff.
-- Requires PAY-2 provider events, PAY-3 inbox; no credit activation or refunds.
begin;
create table public.finance_provider_event_payment_links (
 id uuid primary key default gen_random_uuid(),
 event_row_id uuid not null unique references public.finance_provider_events(id) on delete restrict,
 provider_payment_id text not null check(provider_payment_id ~ '^pay_[A-Za-z0-9]{4,96}$'),
 provider_order_id text not null check(provider_order_id ~ '^order_[A-Za-z0-9]{4,96}$'),
 amount_subunits bigint not null check(amount_subunits>0),
 currency text not null default 'INR' check(currency='INR'),
 created_at timestamptz not null default now()
);
alter table public.finance_provider_event_payment_links enable row level security;
alter table public.finance_provider_event_payment_links force row level security;
revoke all on public.finance_provider_event_payment_links from public,anon,authenticated;
grant select on public.finance_provider_event_payment_links to service_role;
create trigger trg_finance_v2_no_history_change before update or delete
 on public.finance_provider_event_payment_links
 for each row execute function public.qf_finance_v2_reject_history_mutation();
create or replace function public.qf_finance_v2_record_webhook_v1(
 p_event_id text,p_mode text,p_merchant text,p_event_type text,
 p_payload_hash text,p_provider_order_id text,p_provider_payment_id text,
 p_amount_subunits bigint)
returns uuid language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
declare v_order record;v_event public.finance_provider_events%rowtype;
 v_link public.finance_provider_event_payment_links%rowtype;
begin
 if p_event_id is null or p_event_id !~ '^[A-Za-z0-9_.:-]{6,180}$'
   or p_mode not in ('test','live')
   or p_merchant is null or btrim(p_merchant)=''
   or p_event_type not in ('payment.captured','payment.failed')
   or p_payload_hash !~ '^[0-9a-f]{64}$'
   or p_provider_order_id !~ '^order_[A-Za-z0-9]{4,96}$'
   or p_provider_payment_id !~ '^pay_[A-Za-z0-9]{4,96}$'
   or p_amount_subunits is null or p_amount_subunits<=0 then
  raise exception 'FINANCE_WEBHOOK_INPUT_INVALID' using errcode='P0001';end if;
 select o.id,o.provider_mode,o.provider_order_id,o.provider_amount_subunits,
   o.payment_provider into v_order from public.vendor_package_orders o
 where o.provider_order_id=p_provider_order_id;
 if not found or v_order.provider_mode is distinct from p_mode
   or v_order.payment_provider is distinct from 'razorpay'
   or v_order.provider_amount_subunits is distinct from p_amount_subunits then
  raise exception 'FINANCE_WEBHOOK_ORDER_MISMATCH' using errcode='P0001';end if;
 insert into public.finance_provider_events(provider,provider_mode,merchant_account_id,
  provider_event_id,event_type,order_id,payload_sha256,signature_verified)
 values('razorpay',p_mode,p_merchant,p_event_id,p_event_type,v_order.id,p_payload_hash,true)
 on conflict(provider,provider_mode,merchant_account_id,provider_event_id) do nothing;
 select * into v_event from public.finance_provider_events
 where provider='razorpay' and provider_mode=p_mode and
  merchant_account_id=p_merchant and provider_event_id=p_event_id;
 if not found or v_event.payload_sha256 is distinct from p_payload_hash or
  v_event.event_type is distinct from p_event_type or v_event.order_id is distinct from v_order.id then
  raise exception 'FINANCE_WEBHOOK_REPLAY_CONFLICT' using errcode='P0001';end if;
 insert into public.finance_provider_event_payment_links
 (event_row_id,provider_payment_id,provider_order_id,amount_subunits)
 values(v_event.id,p_provider_payment_id,p_provider_order_id,p_amount_subunits)
 on conflict(event_row_id) do nothing;
 select * into v_link from public.finance_provider_event_payment_links where event_row_id=v_event.id;
 if not found or v_link.provider_payment_id is distinct from p_provider_payment_id or
  v_link.provider_order_id is distinct from p_provider_order_id or
  v_link.amount_subunits is distinct from p_amount_subunits then
  raise exception 'FINANCE_WEBHOOK_LINK_CONFLICT' using errcode='P0001';end if;
 perform public.qf_finance_v2_enqueue_verified_event(v_event.id);
 return v_event.id;
end $$;
revoke all on function public.qf_finance_v2_record_webhook_v1(
 text,text,text,text,text,text,text,bigint) from public,anon,authenticated;
grant execute on function public.qf_finance_v2_record_webhook_v1(
 text,text,text,text,text,text,text,bigint) to service_role;
commit;
