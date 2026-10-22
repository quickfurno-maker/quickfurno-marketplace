-- Finance V2 PAY-3 runtime candidate. QUARANTINE: DBA/AppSec/Owner signed review required.
-- OFFLINE PG17 ONLY. No webhook route, provider API, refund API or credit activation changes.
-- Immutable financial facts stay in PAY-2/PAY-3 evidence tables; only the lease queue mutates.
begin;
create table public.finance_event_inbox_jobs (
 id uuid primary key default gen_random_uuid(),
 provider_event_row_id uuid not null unique references public.finance_provider_events(id) on delete restrict,
 state text not null default 'READY' check(state in ('READY','LEASED','RETRY','VERIFIED','DEAD_LETTER')),
 attempts int not null default 0 check(attempts between 0 and 5),
 next_attempt_at timestamptz not null default now(),
 lease_token uuid, lease_until timestamptz,
 last_reason_code text check(last_reason_code is null or last_reason_code ~ '^[A-Z_]{3,64}$'),
 created_at timestamptz not null default now(),
 check((state='LEASED')=(lease_token is not null and lease_until is not null))
);
create index ix_finance_v2_inbox_due on public.finance_event_inbox_jobs(next_attempt_at,id)
 where state in ('READY','RETRY','LEASED');
alter table public.finance_event_inbox_jobs enable row level security;
alter table public.finance_event_inbox_jobs force row level security;
revoke all on public.finance_event_inbox_jobs from public,anon,authenticated;
grant select on public.finance_event_inbox_jobs to service_role;

create or replace function public.qf_finance_v2_enqueue_verified_event(p_event uuid)
returns uuid language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
declare v_job uuid;
begin
 if p_event is null or not exists(
   select 1 from public.finance_provider_events
   where id=p_event and signature_verified=true
 ) then raise exception 'FINANCE_UNVERIFIED_EVENT' using errcode='P0001'; end if;
 insert into public.finance_event_inbox_jobs(provider_event_row_id) values(p_event)
 on conflict(provider_event_row_id) do nothing;
 select id into v_job from public.finance_event_inbox_jobs where provider_event_row_id=p_event;
 return v_job;
end $$;

create or replace function public.qf_finance_v2_claim_inbox(p_limit integer)
returns table(job_id uuid,event_id uuid,token uuid,attempt_num integer)
language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
begin
 if p_limit is null or p_limit<1 or p_limit>10 then
  raise exception 'FINANCE_INVALID_BATCH' using errcode='P0001'; end if;
 return query with locked as (
  select j.id from public.finance_event_inbox_jobs j
   where ((j.state in ('READY','RETRY') and j.next_attempt_at<=now())
      or (j.state='LEASED' and j.lease_until<now()))
     and j.attempts<5
   order by j.next_attempt_at,j.id
   for update skip locked limit p_limit
 ), claimed as (
  update public.finance_event_inbox_jobs j
  set state='LEASED', attempts=j.attempts+1,
   lease_token=gen_random_uuid(),lease_until=now()+interval '60 seconds'
  from locked where j.id=locked.id
  returning j.id,j.provider_event_row_id,j.lease_token,j.attempts
 )
 select c.id,c.provider_event_row_id,c.lease_token,c.attempts from claimed c;
end $$;

-- A successful receipt says only that an independently checked provider event
-- may be marked for human/worker reconciliation. It NEVER credits a wallet.
create or replace function public.qf_finance_v2_finish_inbox(
 p_job uuid,p_token uuid,p_outcome text,p_reason text)
returns boolean language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
declare v_event uuid;v_attempt integer;v_updated uuid;
begin
 if p_outcome not in ('RETRY','VERIFIED','DEAD_LETTER') or
   p_reason is null or p_reason !~ '^[A-Z_]{3,64}$' then
   raise exception 'FINANCE_INVALID_OUTCOME' using errcode='P0001'; end if;
 -- Locked row validates lease token and fences a stale worker.
 select provider_event_row_id,attempts into v_event,v_attempt
 from public.finance_event_inbox_jobs
 where id=p_job and state='LEASED' and lease_token=p_token and lease_until>now()
 for update;
 if not found then return false;end if;
 update public.finance_event_inbox_jobs set
  state=case when p_outcome='RETRY' and v_attempt>=5 then 'DEAD_LETTER' else p_outcome end,
  lease_token=null,lease_until=null,last_reason_code=p_reason,
  next_attempt_at=case when p_outcome='RETRY'
   then now()+make_interval(secs=>power(2,least(v_attempt,5))::integer)
   else now() end
 where id=p_job returning id into v_updated;
 insert into public.finance_event_processing_evidence
 (provider_event_row_id,attempt_sequence,state)
 values(v_event,v_attempt,
  case when p_outcome='RETRY' then
    case when v_attempt>=5 then 'DEAD_LETTER' else 'NEEDS_RETRY' end
   when p_outcome='VERIFIED' then 'PROVIDER_CONFIRMED'
   else 'DEAD_LETTER' end);
 return v_updated=p_job;
end $$;

-- Last-attempt lease expiration is observable as a dead-letter candidate.
-- Do not silently replay or reset attempts beyond the cap.
create or replace view public.qf_finance_v2_dead_letter_candidates_v
with (security_invoker=true) as
select id,provider_event_row_id,attempts,lease_until
from public.finance_event_inbox_jobs
where (state='LEASED' and attempts=5 and lease_until<now())
or state='DEAD_LETTER';
revoke all on public.qf_finance_v2_dead_letter_candidates_v from public,anon,authenticated;
grant select on public.qf_finance_v2_dead_letter_candidates_v to service_role;

revoke all on function public.qf_finance_v2_enqueue_verified_event(uuid) from public,anon,authenticated;
revoke all on function public.qf_finance_v2_claim_inbox(integer) from public,anon,authenticated;
revoke all on function public.qf_finance_v2_finish_inbox(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.qf_finance_v2_enqueue_verified_event(uuid) to service_role;
grant execute on function public.qf_finance_v2_claim_inbox(integer) to service_role;
grant execute on function public.qf_finance_v2_finish_inbox(uuid,uuid,text,text) to service_role;
commit;
