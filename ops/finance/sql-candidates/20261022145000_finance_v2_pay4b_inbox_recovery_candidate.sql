-- PAY-4B2 isolated audit inbox recovery candidate. UNINSTALLED, no wallet actions.
begin;
create or replace function public.qf_finance_v2_expire_exhausted_inbox(p_limit integer)
returns integer language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
declare v_count integer;
begin
 if p_limit is null or p_limit<1 or p_limit>10 then
  raise exception 'FINANCE_INVALID_BATCH' using errcode='P0001';end if;
 with due as (
  select j.id from public.finance_event_inbox_jobs j
  where j.state='LEASED' and j.lease_until<now() and j.attempts>=5
  order by j.lease_until,j.id
  for update skip locked limit p_limit
 ), finalized as(
  update public.finance_event_inbox_jobs j
  set state='DEAD_LETTER',lease_token=null,lease_until=null,
   last_reason_code='LEASE_EXHAUSTED'
  from due where j.id=due.id
  returning j.provider_event_row_id,j.attempts
 ), evidence as(
  insert into public.finance_event_processing_evidence
   (provider_event_row_id,attempt_sequence,state)
   select provider_event_row_id,attempts,'DEAD_LETTER' from finalized
   returning id
 )
 select count(*)::integer into v_count from evidence;
 return coalesce(v_count,0);
end $$;
revoke all on function public.qf_finance_v2_expire_exhausted_inbox(integer)
 from public,anon,authenticated;
grant execute on function public.qf_finance_v2_expire_exhausted_inbox(integer) to service_role;
create or replace view public.qf_finance_v2_inbox_health_v
with (security_invoker=true) as
select
 count(*)::integer as total,
 count(*) filter(where state='READY')::integer as ready,
 count(*) filter(where state='RETRY')::integer as retry,
 count(*) filter(where state='LEASED' and lease_until>now())::integer as active,
 count(*) filter(where state='LEASED' and lease_until<=now())::integer as expired,
 count(*) filter(where state='DEAD_LETTER')::integer as dead_letter,
 count(*) filter(where state='VERIFIED')::integer as verified
from public.finance_event_inbox_jobs;
revoke all on public.qf_finance_v2_inbox_health_v from public,anon,authenticated;
grant select on public.qf_finance_v2_inbox_health_v to service_role;
comment on view public.qf_finance_v2_inbox_health_v is
'PAY4B audit-only job counts. Contains no payment amounts, secrets or provider payload.';
commit;
