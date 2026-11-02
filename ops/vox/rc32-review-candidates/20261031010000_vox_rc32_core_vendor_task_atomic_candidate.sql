-- VOX RC32 Track a-core: candidate ATOMIC Core Vendor CRM task writer.
-- UNINSTALLED / DRAFT / RELEASE HOLD. Requires independent DBA/AppSec review.
-- Closes the route-level check-then-write window of app/api/vox/v1/vendor-task:
-- Staff membership, team, city, vendor grant and vendor service-zone city are
-- locked FOR SHARE and re-verified in the SAME transaction as the vendor_tasks
-- insert. A concurrent revocation UPDATE must wait for this transaction (so it
-- is ordered strictly before or after the write). Idempotent replay is gated by
-- the same current-authority checks and compared field-by-field; a reused key
-- with a different payload is a conflict, never a silent replay.
-- No provider message, consent, credit, vendor or CORE_CONVERSATION write.
begin;
create or replace function public.qf_vox_core_vendor_task_atomic_candidate_v1(
 p_actor uuid,p_team uuid,p_city uuid,p_role text,p_vendor uuid,
 p_task_type text,p_title text,p_priority text,p_due timestamptz,
 p_idempotency_key text
)
returns table(task_id uuid,created boolean)
language plpgsql security invoker set search_path='' as $$
declare
 v_task uuid;
 v_existing record;
begin
 if p_actor is null or p_team is null or p_city is null or p_vendor is null or
    p_role is null or p_role not in ('operations_manager','vendor_success_agent') or
    p_task_type is null or p_task_type not in
      ('onboarding','documents','verification','complaint',
       'campaign_response_followup','general') or
    p_title is null or char_length(p_title) not between 8 and 120 or
    p_title<>btrim(p_title) or p_title ~ '[[:cntrl:]]' or
    p_priority is null or p_priority not in ('low','medium','high') or
    p_due is null or p_due<=clock_timestamp()+interval '5 minutes' or
    p_due>clock_timestamp()+interval '90 days' or
    p_idempotency_key is null or p_idempotency_key !~ '^vox-[0-9a-f]{64}$'
 then raise exception 'VOX_CORE_TASK_INPUT_DENIED';end if;
 -- Row locks make revocation (UPDATE) serialize with this write.
 perform 1 from public.vox_staff_memberships_v1 m
  where m.auth_user_id=p_actor and m.team_id=p_team and m.staff_role=p_role
   and m.is_active=true and m.revoked_at is null
   and m.expires_at>clock_timestamp()
  for share;
 if not found then raise exception 'VOX_CORE_TASK_STAFF_NOT_CURRENT';end if;
 perform 1 from public.vox_staff_teams_v1 t
  join public.cities c on c.id=t.city_id
  where t.id=p_team and t.city_id=p_city and t.is_active=true and c.is_active=true
  for share of t,c;
 if not found then raise exception 'VOX_CORE_TASK_TEAM_OR_CITY_NOT_CURRENT';end if;
 perform 1 from public.vox_staff_object_scopes_v1 s
  where s.auth_user_id=p_actor and s.scope_kind='vendor' and s.object_id=p_vendor
   and s.revoked_at is null and s.expires_at>clock_timestamp()
  for share;
 if not found then raise exception 'VOX_CORE_TASK_VENDOR_GRANT_NOT_CURRENT';end if;
 perform 1 from public.vendors v
  join public.marketplace_service_zones z on z.id=v.service_zone_id
  where v.id=p_vendor and z.city_id=p_city and z.is_active=true
  for share of v,z;
 if not found then raise exception 'VOX_CORE_TASK_VENDOR_CITY_DENIED';end if;
 insert into public.vendor_tasks
  (vendor_id,task_type,title,priority,due_at,idempotency_key,
   source,status,created_by,updated_by)
 values(p_vendor,p_task_type,p_title,p_priority,p_due,p_idempotency_key,
   'manual','open',p_actor,p_actor)
 on conflict (idempotency_key) where idempotency_key is not null do nothing
 returning id into v_task;
 if v_task is not null then return query select v_task,true;return;end if;
 -- Lost the race or exact retry: authority above was already re-proven.
 select t.id,t.vendor_id,t.created_by,t.task_type,t.title,t.priority,t.due_at,
        t.description into v_existing
 from public.vendor_tasks t where t.idempotency_key=p_idempotency_key;
 if not found or v_existing.vendor_id is distinct from p_vendor or
    v_existing.created_by is distinct from p_actor or
    v_existing.task_type is distinct from p_task_type or
    v_existing.title is distinct from p_title or
    v_existing.priority is distinct from p_priority or
    v_existing.due_at is distinct from p_due or
    nullif(v_existing.description,'') is not null
 then raise exception 'VOX_VENDOR_TASK_IDEMPOTENCY_CONFLICT';end if;
 return query select v_existing.id,false;
end;
$$;
revoke all on function public.qf_vox_core_vendor_task_atomic_candidate_v1(
 uuid,uuid,uuid,text,uuid,text,text,text,timestamptz,text
) from public,anon,authenticated;
grant execute on function public.qf_vox_core_vendor_task_atomic_candidate_v1(
 uuid,uuid,uuid,text,uuid,text,text,text,timestamptz,text
) to service_role;
commit;
