-- VOX AB-7B: ORIGINAL Aarohi CRM follow-up write + immutable Staff provenance.
-- SOURCE CANDIDATE ONLY. DO NOT install on managed DB until DBA/AppSec review.
-- The real aarohi_tasks + aarohi_events and AB7B F1/nonce are one transaction.
-- Depends on independently verified AB7B original-source tables/triggers.
begin;
create or replace function public.qf_vox_ab7b_aarohi_task_atomic_candidate_v1(
 p_actor uuid,p_team uuid,p_city uuid,p_prospect uuid,p_nonce uuid,
 p_priority text,p_due timestamptz
)
returns table(task_id uuid,crm_event_id uuid,source_event_id uuid,
 nonce_consumed boolean,native_event_appended boolean,provider_messages_sent integer)
language plpgsql security invoker set search_path='' as $$
declare
 v_city uuid;
 v_stage text;
 v_dnc boolean;
 v_merged uuid;
 v_revision integer;
 v_task uuid;
 v_crm uuid;
begin
 if p_actor is null or p_team is null or p_city is null or
    p_prospect is null or p_nonce is null or p_priority not in ('NORMAL','HIGH')
    or p_due is null or p_due<=clock_timestamp()+interval '5 minutes'
    or p_due>clock_timestamp()+interval '30 days'
 then raise exception 'VOX_AB7B_AAROHI_INPUT_DENIED';end if;
 -- The canonical prospect row lock serializes concurrent revision allocation.
 -- Never create staff tasks for suppressed, merged or converted prospects.
 select a.city_id,a.prospect_stage,a.do_not_contact,a.merged_into_prospect_id
 into v_city,v_stage,v_dnc,v_merged
 from public.aarohi_prospects a
 where a.id=p_prospect and a.tenant_id='quickfurno' for update;
 if not found or v_city is distinct from p_city or v_dnc is distinct from false
    or v_merged is not null or v_stage in ('SUPPRESSED','WON','LOST')
 then raise exception 'VOX_AB7B_AAROHI_PROSPECT_DENIED';end if;
 if not exists(
  select 1 from public.vox_staff_memberships_v1 m
  where m.auth_user_id=p_actor and m.team_id=p_team
   and m.staff_role='acquisition_agent' and m.is_active=true
   and m.revoked_at is null and m.expires_at>clock_timestamp()
 ) then raise exception 'VOX_AB7B_AAROHI_STAFF_NOT_CURRENT';end if;
 select coalesce(max(a.revision),0)+1 into v_revision
 from public.vox_ab7b_native_source_actions_candidate_v1 a
 where a.source='CRM_AAROHI' and a.subject_id=p_prospect;
 v_task:=gen_random_uuid();
 -- These are the existing native Aarohi CRM tables, not parallel VOX copies.
 insert into public.aarohi_tasks
  (id,prospect_id,task_type,due_at,priority,reason,assigned_to,created_by,status,
   workflow_reference)
 values(v_task,p_prospect,'FOLLOW_UP',p_due,p_priority,
  'VOX Staff assigned internal follow-up',p_actor,p_actor,'OPEN',
  'vox-staff:'||p_nonce::text);
 insert into public.aarohi_events
  (prospect_id,event_type,actor_type,actor_reference,safe_summary,
   reference_type,reference_id,idempotency_key)
 values(p_prospect,'task.created','HUMAN',p_actor::text,
  'FOLLOW_UP task created by scoped VOX Staff','task',v_task::text,
  'vox-staff-aarohi-'||p_nonce::text)
 returning id into v_crm;
 -- BEFORE trigger rechecks CURRENT neutral Staff membership, object grant,
 -- department capability, team/city and RLS. AFTER trigger writes F1 + nonce.
 -- Any failure rolls back BOTH original Aarohi inserts as well.
 insert into public.vox_ab7b_native_source_actions_candidate_v1
  (id,source,subject_kind,subject_id,actor_id,team_id,city_id,
   revision,event_kind,nonce)
 values(v_task,'CRM_AAROHI','prospect',p_prospect,p_actor,p_team,p_city,
   v_revision,'AAROHI_TASK_CREATED',p_nonce);
 return query select v_task,v_crm,v_task,true,true,0;
end;
$$;
revoke all on function public.qf_vox_ab7b_aarohi_task_atomic_candidate_v1(
 uuid,uuid,uuid,uuid,uuid,text,timestamptz) from public,anon,authenticated;
grant execute on function public.qf_vox_ab7b_aarohi_task_atomic_candidate_v1(
 uuid,uuid,uuid,uuid,uuid,text,timestamptz) to service_role;
commit;
