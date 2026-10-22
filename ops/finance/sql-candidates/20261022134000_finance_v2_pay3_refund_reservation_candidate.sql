-- PAY-3C source-only reservation candidate: no payment/refund/provider execution.
-- Requires PAY-2; DBA+AppSec independent review, OFFLINE PostgreSQL 17 only.
begin;
create table public.finance_capture_confirmations (
 id uuid primary key default gen_random_uuid(),
 attempt_id uuid not null unique references public.finance_payment_attempts(id) on delete restrict,
 confirmed_subunits bigint not null check(confirmed_subunits>0),
 provider_payment_id text not null check(length(btrim(provider_payment_id))>0),
 provider_mode text not null check(provider_mode in ('test','live')),
 merchant_account_id text not null check(length(btrim(merchant_account_id))>0),
 provider_fetch_sha256 text not null check(provider_fetch_sha256 ~ '^[0-9a-f]{64}$'),
 source text not null default 'SERVER_GET' check(source='SERVER_GET'),
 confirmed_at timestamptz not null default now()
);
create table public.finance_refund_reservations (
 id uuid primary key default gen_random_uuid(),
 capture_id uuid not null references public.finance_capture_confirmations(id) on delete restrict,
 attempt_id uuid not null references public.finance_payment_attempts(id) on delete restrict,
 requested_subunits bigint not null check(requested_subunits>0),
 requested_by uuid not null,
 approved_by uuid not null,
 approval_reference uuid not null unique,
 reserved_at timestamptz not null default now(),
 check(requested_by<>approved_by)
);
create index ix_finance_refund_reservation_attempt
 on public.finance_refund_reservations(attempt_id,reserved_at);
do $$
declare t text;
begin
 foreach t in array array['finance_capture_confirmations','finance_refund_reservations'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('alter table public.%I force row level security',t);
  execute format('revoke all on table public.%I from public,anon,authenticated',t);
  execute format('grant select on table public.%I to service_role',t);
  execute format('create trigger trg_finance_v2_no_history_change
   before update or delete on public.%I
   for each row execute function public.qf_finance_v2_reject_history_mutation()',t);
 end loop;
end $$;
-- Server-verified captured evidence insertion must be separately reviewed and wired.
-- This reservation function itself NEVER authorizes a Razorpay API call or wallet reversal.
create or replace function public.qf_finance_v2_reserve_refund(
 p_attempt uuid,p_amount bigint,p_requester uuid,p_approver uuid,p_approval uuid)
returns uuid language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
declare v_capture record;v_existing record;v_reserved numeric;v_result uuid;
begin
 if p_attempt is null or p_approval is null or p_requester is null or p_approver is null
   or p_requester=p_approver or p_amount is null or p_amount<=0 then
  raise exception 'FINANCE_REFUND_APPROVAL_REQUIRED' using errcode='P0001'; end if;
 -- Serialize competing refunds on the same attempt. Hash collisions only cause
 -- extra serialization, never incorrect over-reservation.
 perform pg_advisory_xact_lock(hashtextextended(p_attempt::text,517));
 select r.id,r.attempt_id,r.requested_subunits,r.requested_by,r.approved_by
 into v_existing from public.finance_refund_reservations r
 where r.approval_reference=p_approval;
 if found then
  if v_existing.attempt_id=p_attempt and v_existing.requested_subunits=p_amount
    and v_existing.requested_by=p_requester and v_existing.approved_by=p_approver
    then return v_existing.id; end if;
  raise exception 'FINANCE_REFUND_IDEMPOTENCY_CONFLICT' using errcode='P0001';
 end if;
 select c.id,c.confirmed_subunits into v_capture
 from public.finance_capture_confirmations c
 join public.finance_payment_attempts a on a.id=c.attempt_id
 where c.attempt_id=p_attempt and a.provider='razorpay'
 and a.provider_mode=c.provider_mode
 and a.merchant_account_id=c.merchant_account_id
 and a.provider_payment_id=c.provider_payment_id
 and a.expected_amount_subunits=c.confirmed_subunits;
 if not found then raise exception 'FINANCE_CAPTURE_UNVERIFIED' using errcode='P0001';end if;
 select coalesce(sum(requested_subunits::numeric),0) into v_reserved
 from public.finance_refund_reservations where attempt_id=p_attempt;
 if v_reserved+p_amount::numeric>v_capture.confirmed_subunits then
  raise exception 'FINANCE_REFUND_CAP_EXCEEDED' using errcode='P0001';end if;
 insert into public.finance_refund_reservations
  (capture_id,attempt_id,requested_subunits,requested_by,approved_by,approval_reference)
 values(v_capture.id,p_attempt,p_amount,p_requester,p_approver,p_approval)
 returning id into v_result;
 return v_result;
end $$;
revoke all on function public.qf_finance_v2_reserve_refund(uuid,bigint,uuid,uuid,uuid)
 from public,anon,authenticated;
grant execute on function public.qf_finance_v2_reserve_refund(uuid,bigint,uuid,uuid,uuid)
 to service_role;
-- Capture confirmation rows must come from separately verified provider GET results;
-- no user-visible POST or refund APIs are installed by this SQL.
commit;
