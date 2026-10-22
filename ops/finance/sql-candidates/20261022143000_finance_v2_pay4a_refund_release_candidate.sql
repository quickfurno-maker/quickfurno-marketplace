-- PAY-4A internal candidate, NEVER auto-applied. Source-only, no Razorpay execution.
-- Releasing a RESERVED but NOT SUBMITTED refund requires independent reviewer
-- and a newly fetched provider search proof outside SQL. This SQL additionally
-- conservatively refuses release if ANY finance_refunds journal exists.
begin;
create table public.finance_refund_reservation_releases(
 id uuid primary key default gen_random_uuid(),
 reservation_id uuid not null unique references public.finance_refund_reservations(id) on delete restrict,
 requested_by uuid not null,
 independently_approved_by uuid not null,
 approval_reference uuid not null unique,
 provider_non_submission_evidence_sha256 text not null
  check(provider_non_submission_evidence_sha256 ~ '^[0-9a-f]{64}$'),
 reason_code text not null check(reason_code in
  ('PROVIDER_NOT_SUBMITTED','CANCELLED_BEFORE_GATEWAY','DUPLICATE_INTERNAL_REQUEST')),
 created_at timestamptz not null default now(),
 check(requested_by<>independently_approved_by)
);
alter table public.finance_refund_reservation_releases enable row level security;
alter table public.finance_refund_reservation_releases force row level security;
revoke all on public.finance_refund_reservation_releases from public,anon,authenticated;
grant select on public.finance_refund_reservation_releases to service_role;
create trigger trg_finance_v2_no_history_change before update or delete
 on public.finance_refund_reservation_releases for each row
 execute function public.qf_finance_v2_reject_history_mutation();

create or replace function public.qf_finance_v2_release_unsubmitted_refund(
 p_reservation uuid,p_requester uuid,p_reviewer uuid,p_approval uuid,
 p_provider_proof text,p_reason text)
returns uuid language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
declare v_res record;v_old record;v_id uuid;
begin
 if p_reservation is null or p_requester is null or p_reviewer is null or
 p_approval is null or p_requester=p_reviewer or p_provider_proof !~ '^[0-9a-f]{64}$'
 or p_reason not in
 ('PROVIDER_NOT_SUBMITTED','CANCELLED_BEFORE_GATEWAY','DUPLICATE_INTERNAL_REQUEST') then
 raise exception 'FINANCE_RELEASE_REVIEW_REQUIRED' using errcode='P0001';end if;
 select r.* into v_res from public.finance_refund_reservations r
 where r.id=p_reservation;
 if not found then raise exception 'FINANCE_RESERVATION_NOT_FOUND' using errcode='P0001';end if;
 perform pg_advisory_xact_lock(hashtextextended(v_res.attempt_id::text,517));
 select * into v_old from public.finance_refund_reservation_releases
 where reservation_id=p_reservation;
 if found then
  if v_old.requested_by=p_requester and v_old.independently_approved_by=p_reviewer
  and v_old.approval_reference=p_approval and
  v_old.provider_non_submission_evidence_sha256=p_provider_proof
  and v_old.reason_code=p_reason then return v_old.id;end if;
  raise exception 'FINANCE_RELEASE_REPLAY_CONFLICT' using errcode='P0001';
 end if;
 -- Source-only conservative barrier: cannot release anything with even one
 -- potentially submitted gateway refund on that attempt, regardless of state.
 if exists(select 1 from public.finance_refunds f where f.attempt_id=v_res.attempt_id) then
  raise exception 'FINANCE_GATEWAY_REFUND_MAY_EXIST' using errcode='P0001';end if;
 insert into public.finance_refund_reservation_releases
 (reservation_id,requested_by,independently_approved_by,approval_reference,
 provider_non_submission_evidence_sha256,reason_code)
 values(p_reservation,p_requester,p_reviewer,p_approval,p_provider_proof,p_reason)
 returning id into v_id;
 return v_id;
end $$;
revoke all on function public.qf_finance_v2_release_unsubmitted_refund(
 uuid,uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.qf_finance_v2_release_unsubmitted_refund(
 uuid,uuid,uuid,uuid,text,text) to service_role;

-- Alter only the source-candidate refund reservation admission to subtract
-- independently approved RELEASED reservations; never erase a financial fact.
create or replace function public.qf_finance_v2_reserve_refund(
 p_attempt uuid,p_amount bigint,p_requester uuid,p_approver uuid,p_approval uuid)
returns uuid language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
declare v_capture record;v_existing record;v_reserved numeric;v_result uuid;
begin
 if p_attempt is null or p_approval is null or p_requester is null or p_approver is null
 or p_requester=p_approver or p_amount is null or p_amount<=0 then
 raise exception 'FINANCE_REFUND_APPROVAL_REQUIRED' using errcode='P0001';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_attempt::text,517));
 select r.id,r.attempt_id,r.requested_subunits,r.requested_by,r.approved_by
 into v_existing from public.finance_refund_reservations r
 where r.approval_reference=p_approval;
 if found then
  if exists(select 1 from public.finance_refund_reservation_releases
     where reservation_id=v_existing.id) then
   raise exception 'FINANCE_RELEASED_APPROVAL_CANNOT_REUSE' using errcode='P0001';end if;
  if v_existing.attempt_id=p_attempt and v_existing.requested_subunits=p_amount
    and v_existing.requested_by=p_requester and v_existing.approved_by=p_approver
   then return v_existing.id;end if;
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
 select coalesce(sum(r.requested_subunits::numeric),0) into v_reserved
 from public.finance_refund_reservations r
 where r.attempt_id=p_attempt and not exists(
  select 1 from public.finance_refund_reservation_releases x where x.reservation_id=r.id);
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
grant execute on function public.qf_finance_v2_reserve_refund(uuid,bigint,uuid,uuid,uuid) to service_role;
commit;
