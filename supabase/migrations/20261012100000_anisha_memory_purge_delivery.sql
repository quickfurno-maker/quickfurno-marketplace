-- AN-A2c internal certified source; apply ONLY to isolated staged DB after backup.
-- Durable Core claim -> Jarvis physical erase -> Core acknowledgement.
begin;
alter table public.vendor_anisha_memory_purge_outbox
  add column if not exists lease_token uuid,
  add column if not exists leased_until timestamptz;

-- Every Core claim is a lease, never a deletion receipt.
create or replace function public.qf_claim_vendor_anisha_memory_purges_v1(p_limit integer)
returns table(purge_id uuid, vendor_id uuid, lease_token uuid)
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
 if p_limit is null or p_limit < 1 or p_limit > 10 then
   raise exception 'anisha_purge_claim_invalid';
 end if;
 return query
 with pending as (
   select q.purge_id
   from public.vendor_anisha_memory_purge_outbox q
   where q.completed_at is null
     and (q.leased_until is null or q.leased_until < now())
   order by q.created_at, q.purge_id
   limit p_limit for update skip locked
 ), claimed as (
   update public.vendor_anisha_memory_purge_outbox q
     set lease_token = gen_random_uuid(), leased_until = now() + interval '120 seconds',
         attempts = q.attempts + 1
   from pending p where q.purge_id=p.purge_id
   returning q.purge_id, q.vendor_id, q.lease_token
 )
 select c.purge_id, c.vendor_id, c.lease_token from claimed c;
end; $$;

-- Require an exact live lease token; never acknowledge by vendor ID alone.
create or replace function public.qf_ack_vendor_anisha_memory_purge_v1(
  p_purge_id uuid, p_vendor_id uuid, p_lease_token uuid
) returns boolean
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare updated_count integer;
begin
 perform 1 from public.vendors where id=p_vendor_id for update;
 update public.vendor_anisha_memory_purge_outbox q
 set completed_at=now(), lease_token=null, leased_until=null
 where q.purge_id=p_purge_id and q.vendor_id=p_vendor_id
   and q.lease_token=p_lease_token and q.leased_until>now()
   and q.completed_at is null;
 get diagnostics updated_count=row_count;
 if updated_count <> 1 then return false; end if;
 -- Keep vendor DENIED. Lift "erasure pending" only after the last physical
 -- deletion has been acknowledged, never on claim, failure or timeout.
 update public.vendor_anisha_memory_consents c
 set erase_required=false, updated_at=now(), revision=c.revision+1
 where c.vendor_id=p_vendor_id and c.decision='DENIED'
   and not exists (
     select 1 from public.vendor_anisha_memory_purge_outbox q
     where q.vendor_id=p_vendor_id and q.completed_at is null
   );
 return true;
end; $$;
revoke all on function public.qf_claim_vendor_anisha_memory_purges_v1(integer)
 from public, anon, authenticated;
revoke all on function public.qf_ack_vendor_anisha_memory_purge_v1(uuid,uuid,uuid)
 from public, anon, authenticated;
grant execute on function public.qf_claim_vendor_anisha_memory_purges_v1(integer) to service_role;
grant execute on function public.qf_ack_vendor_anisha_memory_purge_v1(uuid,uuid,uuid) to service_role;
commit;
