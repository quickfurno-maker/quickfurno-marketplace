-- VOX RC37 Track a-core: candidate ATOMIC Core Vendor CRM task transition.
-- UNINSTALLED / DRAFT / RELEASE HOLD. Requires independent DBA/AppSec review.
-- NOT a migration and NOT part of any pinned manifest. Never applied by tooling.
-- Closes the service_role compare-and-set race of
-- app/api/vox/v1/vendor-task-transition: Staff membership, team, city, vendor
-- grant and vendor service-zone city are locked FOR SHARE and re-verified in the
-- SAME transaction as the vendor_tasks write, and the task row is locked FOR
-- UPDATE. A concurrent revocation UPDATE must wait for this transaction (ordered
-- strictly before or after the write); a transition that waited behind a
-- committed revocation re-evaluates the locked predicates and is denied.
-- Replay is exact only: same actor, same terminal state, same completion text,
-- and it is gated by the same current-authority checks. A different terminal
-- state, actor or text is a conflict, never a silent replay.
-- Complete/cancel only. updated_by is always the verified actor. The receipt is
-- a deterministic SHA-256 over the committed row, identical on exact replay.
-- No provider message, consent, credit, vendor or CORE_CONVERSATION write.
-- Unknown task and out-of-grant task raise the SAME error (no existence oracle).
begin;
create or replace function public.qf_vox_core_vendor_task_transition_atomic_candidate_v1(
 p_actor uuid,p_team uuid,p_city uuid,p_role text,p_task uuid,
 p_action text,p_result text
)
returns table(task_id uuid,task_status text,replayed boolean,receipt text)
language plpgsql security invoker set search_path='' as $$
declare
 v_vendor uuid;
 v_row record;
 v_target text;
 v_now timestamptz;
 v_receipt text;
begin
 if p_actor is null or p_team is null or p_city is null or p_task is null or
    p_role is null or p_role not in ('operations_manager','vendor_success_agent') or
    p_action is null or p_action not in ('complete','cancel') or
    (p_action='cancel' and p_result is not null) or
    (p_action='complete' and (
      p_result is null or char_length(p_result) not between 8 and 300 or
      p_result<>btrim(p_result) or p_result ~ '[[:cntrl:]]' or
      p_result ~ '[[:space:]]{2}'))
 then raise exception 'VOX_CORE_TASK_TRANSITION_INPUT_DENIED';end if;
 v_target:=case p_action when 'complete' then 'done' else 'cancelled' end;
 -- Unlocked read ONLY to learn which vendor grant to lock; re-checked below.
 select t.vendor_id into v_vendor from public.vendor_tasks t where t.id=p_task;
 if v_vendor is null
 then raise exception 'VOX_CORE_TASK_VENDOR_GRANT_NOT_CURRENT';end if;
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
  where s.auth_user_id=p_actor and s.scope_kind='vendor' and s.object_id=v_vendor
   and s.revoked_at is null and s.expires_at>clock_timestamp()
  for share;
 if not found then raise exception 'VOX_CORE_TASK_VENDOR_GRANT_NOT_CURRENT';end if;
 perform 1 from public.vendors v
  join public.marketplace_service_zones z on z.id=v.service_zone_id
  where v.id=v_vendor and z.city_id=p_city and z.is_active=true
  for share of v,z;
 if not found then raise exception 'VOX_CORE_TASK_VENDOR_CITY_DENIED';end if;
 -- Authority is now frozen; serialize competing transitions on the task row.
 select t.id,t.vendor_id,t.status,t.completion_result,t.updated_by,t.updated_at
  into v_row from public.vendor_tasks t where t.id=p_task for update;
 if not found or v_row.vendor_id is distinct from v_vendor
 then raise exception 'VOX_CORE_TASK_VENDOR_GRANT_NOT_CURRENT';end if;
 if v_row.status in ('open','in_progress','blocked') then
  v_now:=clock_timestamp();
  update public.vendor_tasks t
   set status=v_target,
       completion_result=case when p_action='complete' then p_result else t.completion_result end,
       completed_at=case when p_action='complete' then v_now else t.completed_at end,
       updated_by=p_actor,updated_at=v_now
   where t.id=p_task and t.vendor_id=v_vendor
    and t.status in ('open','in_progress','blocked');
  if not found then raise exception 'VOX_VENDOR_TASK_STATE_CONFLICT';end if;
  v_receipt:=encode(sha256(convert_to(concat_ws('|','vox-rc37-vendor-task-transition-v1',
   p_task,v_vendor,p_actor,v_target,coalesce(case when p_action='complete' then p_result end,''),
   (extract(epoch from v_now)*1000000)::bigint),'UTF8')),'hex');
  return query select p_task,v_target,false,v_receipt;return;
 end if;
 -- Terminal already: exact replay only (authority above was re-proven).
 if v_row.status is distinct from v_target or v_row.updated_by is distinct from p_actor or
    (p_action='complete' and v_row.completion_result is distinct from p_result)
 then raise exception 'VOX_VENDOR_TASK_STATE_CONFLICT';end if;
 v_receipt:=encode(sha256(convert_to(concat_ws('|','vox-rc37-vendor-task-transition-v1',
  p_task,v_vendor,p_actor,v_target,coalesce(case when p_action='complete' then p_result end,''),
  (extract(epoch from v_row.updated_at)*1000000)::bigint),'UTF8')),'hex');
 return query select p_task,v_target,true,v_receipt;
end;
$$;
revoke all on function public.qf_vox_core_vendor_task_transition_atomic_candidate_v1(
 uuid,uuid,uuid,text,uuid,text,text
) from public,anon,authenticated;
grant execute on function public.qf_vox_core_vendor_task_transition_atomic_candidate_v1(
 uuid,uuid,uuid,text,uuid,text,text
) to service_role;
commit;
