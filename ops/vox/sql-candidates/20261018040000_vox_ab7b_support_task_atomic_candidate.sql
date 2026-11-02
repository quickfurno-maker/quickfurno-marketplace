-- VOX AB-7B: candidate atomic original Vendor CRM support-task + Staff F1 event.
-- UNINSTALLED / DRAFT / RELEASE HOLD. Requires independent DBA/AppSec review.
-- The original native vendor_tasks insert and immutable AB7B action/nonce/F1
-- inserts commit or roll back together. There is no provider message or reply.
-- Requires prior reviewed AB7B F1+native candidate tables/triggers.
begin;
create or replace function public.qf_vox_ab7b_support_task_atomic_candidate_v1(
 p_actor uuid,p_team uuid,p_city uuid,p_thread uuid,p_nonce uuid,
 p_priority text,p_due timestamptz,p_idempotency_key text
)
returns table(task_id uuid,source_event_id uuid,nonce_consumed boolean,
 native_event_appended boolean,provider_messages_sent integer)
language plpgsql security invoker set search_path='' as $$
declare
 v_vendor uuid;
 v_city uuid;
 v_revision integer;
 v_task uuid;
begin
 if p_actor is null or p_team is null or p_city is null or
    p_thread is null or p_nonce is null or
    p_priority not in ('low','medium','high') or p_due is null or
    p_due<=clock_timestamp()+interval '5 minutes' or
    p_due>clock_timestamp()+interval '30 days' or
    p_idempotency_key is null or
    p_idempotency_key !~ '^vox-desk-[0-9a-f]{64}$'
 then raise exception 'VOX_AB7B_SUPPORT_INPUT_DENIED';end if;
 -- Serialize ALL original support mutations for this thread, not just nonce
 -- contenders; concurrent revisions cannot pass by racing a MAX()+1 read.
 select t.vendor_id into v_vendor
 from public.vendor_support_threads t
 where t.id=p_thread and t.status in ('open','admin_replied','vendor_replied')
 for update;
 if not found then raise exception 'VOX_AB7B_THREAD_NOT_OPEN';end if;
 select z.city_id into v_city
 from public.vendors v join public.marketplace_service_zones z
   on z.id=v.service_zone_id
 where v.id=v_vendor and z.is_active=true
 for share of v,z;
 if v_city is distinct from p_city
 then raise exception 'VOX_AB7B_CROSS_CITY_OR_INACTIVE_ZONE';end if;
 -- Fresh membership and current team scopes are checked again by the
 -- immutable native-source BEFORE INSERT trigger later in this transaction.
 -- AAL2/auth principal is verified by Core; no caller-supplied client actor.
 if not exists(
  select 1 from public.vox_staff_memberships_v1 m
  where m.auth_user_id=p_actor and m.team_id=p_team
   and m.staff_role='support_agent' and m.is_active=true
   and m.revoked_at is null and m.expires_at>clock_timestamp()
 ) then raise exception 'VOX_AB7B_STAFF_NOT_CURRENT';end if;
 if exists(select 1 from public.vendor_tasks
   where idempotency_key=p_idempotency_key)
 then raise exception 'VOX_AB7B_TASK_REPLAY';end if;
 select coalesce(max(a.revision),0)+1 into v_revision
 from public.vox_ab7b_native_source_actions_candidate_v1 a
 where a.source='SUPPORT_DESK' and a.subject_id=p_thread;
 insert into public.vendor_tasks
  (vendor_id,task_type,title,priority,due_at,idempotency_key,
   source,status,created_by,updated_by)
 values(v_vendor,'complaint','Follow up on assigned support case',
   p_priority,p_due,p_idempotency_key,'manual','open',p_actor,p_actor)
 returning id into v_task;
 -- Trigger verifies exact current neutral Staff profile, department, object
 -- grant and team/city before inserting canonical F1 + one-use nonce.
 insert into public.vox_ab7b_native_source_actions_candidate_v1
  (id,source,subject_kind,subject_id,actor_id,team_id,city_id,
   revision,event_kind,nonce)
 values(v_task,'SUPPORT_DESK','support_thread',p_thread,p_actor,
   p_team,p_city,v_revision,'SUPPORT_TASK_CREATED',p_nonce);
 return query select v_task,v_task,true,true,0;
end;
$$;
revoke all on function public.qf_vox_ab7b_support_task_atomic_candidate_v1(
 uuid,uuid,uuid,uuid,uuid,text,timestamptz,text
) from public,anon,authenticated;
grant execute on function public.qf_vox_ab7b_support_task_atomic_candidate_v1(
 uuid,uuid,uuid,uuid,uuid,text,timestamptz,text
) to service_role;
commit;
