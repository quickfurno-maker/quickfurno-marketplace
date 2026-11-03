-- VOX VO4 REVIEW ONLY. NEVER apply to managed Supabase or supabase/migrations.
-- Core must verify real Team Leader AAL2 and neutral principal BEFORE invoking
-- this service-role-only function. Human DBA/AppSec, restore and parity gates HOLD.
begin;
create table public.vox_vo4_tl_assignment_receipts_candidate_v1 (
 event_nonce uuid primary key,
 work_item_id uuid not null references public.vox_work_items_candidate_v1(id),
 leader_id uuid not null references public.vox_staff_memberships_v1(auth_user_id),
 target_staff_id uuid not null references public.vox_staff_memberships_v1(auth_user_id),
 expected_revision integer not null check(expected_revision>=0),
 accepted_revision integer not null check(accepted_revision=expected_revision+1),
 original_reason text not null,
 created_at timestamptz not null default clock_timestamp()
);
create index vox_vo4_tl_assignment_target_time_idx
 on public.vox_vo4_tl_assignment_receipts_candidate_v1(target_staff_id,created_at);
alter table public.vox_vo4_tl_assignment_receipts_candidate_v1 enable row level security;
alter table public.vox_vo4_tl_assignment_receipts_candidate_v1 force row level security;
revoke all on public.vox_vo4_tl_assignment_receipts_candidate_v1
 from public,anon,authenticated;
grant select,insert on public.vox_vo4_tl_assignment_receipts_candidate_v1 to service_role;

create or replace function public.qf_vox_tl_assign_work_candidate_v1(
 p_leader uuid,p_target uuid,p_item uuid,
 p_expected_revision integer,p_nonce uuid,p_reason text
) returns table(
 item_id uuid,leader_id uuid,target_id uuid,nonce uuid,
 revision integer,new_state text,external_messages_sent integer,
 vendor_assignments_changed integer,money_minor_units integer
) language plpgsql security definer set search_path='' as $body$
declare
 w public.vox_work_items_candidate_v1%rowtype;
 tl public.vox_staff_memberships_v1%rowtype;
 target_staff public.vox_staff_memberships_v1%rowtype;
 receipt public.vox_vo4_tl_assignment_receipts_candidate_v1%rowtype;
 pack text;
begin
 if p_leader is null or p_target is null or p_item is null or p_nonce is null
    or p_leader=p_target or p_expected_revision is null
    or p_expected_revision<0 or p_expected_revision>2147483646
    or p_reason is null or length(p_reason)>200 or p_reason<>btrim(p_reason)
    or position(chr(10) in p_reason)>0 or position(chr(13) in p_reason)>0
 then raise exception 'VO4_TL_BAD_ASSIGNMENT' using errcode='P0001'; end if;
 -- Lock canonical Core work row first. This serializes distinct concurrent
 -- Team Leaders and revisions; never touch marketplace vendor assignments.
 select * into w from public.vox_work_items_candidate_v1
 where id=p_item for update;
 if not found then raise exception 'VO4_TL_ITEM_NOT_FOUND' using errcode='P0001'; end if;
 select * into tl from public.vox_staff_memberships_v1
 where auth_user_id=p_leader for share;
 if not found or tl.team_id<>w.team_id or tl.staff_role<>'team_leader'
    or tl.is_active<>true or tl.revoked_at is not null
    or tl.expires_at<=clock_timestamp()
 then raise exception 'VO4_TL_CURRENT_LEADER_DENIED' using errcode='P0001'; end if;
 if not exists(
  select 1 from public.profiles p
  join auth.users au on au.id=p.id
  join public.vox_staff_teams_v1 t on t.id=tl.team_id
  join public.cities c on c.id=t.city_id
  where p.id=p_leader and p.role is null and p.is_active=true
   and au.raw_app_meta_data->>'qf_principal'='vox_staff'
   and au.raw_app_meta_data->>'vox_role'='team_leader'
   and au.raw_app_meta_data->>'admin_role' is null
   and t.id=w.team_id and t.city_id=w.city_id and t.is_active=true
   and c.id=w.city_id and c.is_active=true
 ) then raise exception 'VO4_TL_IDENTITY_OR_CITY_DENIED' using errcode='P0001'; end if;
 -- Lock target membership before checking per-Staff assignment cap.
 select * into target_staff from public.vox_staff_memberships_v1
 where auth_user_id=p_target for update;
 if not found or target_staff.team_id<>w.team_id or
    target_staff.staff_role in ('team_leader','auditor') or
    target_staff.is_active<>true or target_staff.revoked_at is not null or
    target_staff.expires_at<=clock_timestamp()
 then raise exception 'VO4_TL_TARGET_NOT_ACTIVE_STAFF' using errcode='P0001'; end if;
 if not exists(
  select 1 from public.profiles p join auth.users au on au.id=p.id
   where p.id=p_target and p.role is null and p.is_active=true
    and au.raw_app_meta_data->>'qf_principal'='vox_staff'
    and au.raw_app_meta_data->>'admin_role' is null
    and coalesce(au.raw_app_meta_data->>'vox_role','')<>'team_leader'
 ) then raise exception 'VO4_TL_TARGET_NOT_NEUTRAL' using errcode='P0001'; end if;
 pack:=case w.source_kind when 'prospect' then 'acquisition'
   when 'vendor' then 'vendor_success'
   when 'support_thread' then 'service_support'
   else null end;
 if pack is null then raise exception 'VO4_TL_UNKNOWN_SOURCE' using errcode='P0001'; end if;
 if not exists(
  select 1 from public.vox_staff_object_scopes_v1 s
   where s.auth_user_id=p_target and s.scope_kind=w.source_kind
    and s.object_id=w.source_id and s.revoked_at is null
    and s.expires_at>clock_timestamp()
 ) then raise exception 'VO4_TL_TARGET_OBJECT_SCOPE_DENIED' using errcode='P0001'; end if;
 if w.source_kind='support_thread' and not exists(
  select 1 from public.vox_staff_object_scopes_v1 s
   where s.auth_user_id=p_target and s.scope_kind='vendor'
    and s.object_id=w.related_vendor_id and s.revoked_at is null
    and s.expires_at>clock_timestamp()
 ) then raise exception 'VO4_TL_TARGET_DUAL_GRANT_DENIED' using errcode='P0001'; end if;
 -- Exact canonical source city, not a browser-entered city.
 if w.source_kind='prospect' and not exists(
  select 1 from public.aarohi_prospects p
  where p.id=w.source_id and p.city_id=w.city_id
 ) then raise exception 'VO4_TL_PROSPECT_CITY_MISMATCH' using errcode='P0001'; end if;
 if w.source_kind='vendor' and not exists(
  select 1 from public.vendors v
  join public.marketplace_service_zones z on z.id=v.service_zone_id
  where v.id=w.source_id and z.city_id=w.city_id and z.is_active
 ) then raise exception 'VO4_TL_VENDOR_CITY_MISMATCH' using errcode='P0001'; end if;
 if w.source_kind='support_thread' and not exists(
  select 1 from public.vendor_support_threads s
  join public.vendors v on v.id=s.vendor_id
  join public.marketplace_service_zones z on z.id=v.service_zone_id
  where s.id=w.source_id and s.vendor_id=w.related_vendor_id
   and z.city_id=w.city_id and z.is_active
 ) then raise exception 'VO4_TL_SUPPORT_CITY_MISMATCH' using errcode='P0001'; end if;
 -- Reuse existing independently reviewed department grant and reviewer lineage.
 if not exists(
  select 1 from public.vox_staff_department_capabilities_v1 g
  join public.vox_staff_department_requests_v1 req on req.id=g.request_id
  join public.vox_staff_department_decisions_v1 dec on dec.request_id=req.id
  join public.vox_staff_department_activations_v1 act
   on act.request_id=req.id and act.capability_id=g.id
  join public.profiles reviewer on reviewer.id=req.decided_by
  join auth.users review_user on review_user.id=reviewer.id
  join public.vox_staff_memberships_v1 reviewer_tl
   on reviewer_tl.auth_user_id=reviewer.id
  join public.vox_staff_teams_v1 reviewer_team
   on reviewer_team.id=reviewer_tl.team_id
  where g.auth_user_id=p_target and g.team_id=w.team_id
   and g.city_id=w.city_id and g.department=pack
   and g.revoked_at is null and g.revision=2
   and g.expires_at>clock_timestamp()
   and req.target_staff_id=p_target and req.team_id=w.team_id
   and req.city_id=w.city_id and req.department=pack
   and req.state='APPROVED' and req.revision=1
   and req.expires_at>clock_timestamp()
   and req.decided_by<>req.requested_by
   and req.decided_by<>req.target_staff_id
   and dec.reviewer_id=req.decided_by
   and dec.decision='APPROVED' and dec.decision_reference=req.decision_reference
   and act.activated_by=req.requested_by and g.granted_by=req.requested_by
   and reviewer.role is null and reviewer.is_active=true
   and review_user.raw_app_meta_data->>'qf_principal'='vox_staff'
   and review_user.raw_app_meta_data->>'vox_role'='team_leader'
   and review_user.raw_app_meta_data->>'admin_role' is null
   and reviewer_tl.staff_role='team_leader' and reviewer_tl.is_active=true
   and reviewer_tl.revoked_at is null
   and reviewer_tl.expires_at>clock_timestamp()
   and reviewer_team.id=w.team_id and reviewer_team.city_id=w.city_id
   and reviewer_team.is_active=true
 ) then raise exception 'VO4_TL_UNREVIEWED_DEPARTMENT' using errcode='P0001'; end if;
 select * into receipt from public.vox_vo4_tl_assignment_receipts_candidate_v1
 where event_nonce=p_nonce;
 if found then
  if receipt.work_item_id<>p_item or receipt.leader_id<>p_leader
   or receipt.target_staff_id<>p_target or
   receipt.expected_revision<>p_expected_revision or
   receipt.original_reason<>p_reason
  then raise exception 'VO4_TL_NONCE_CONFLICT' using errcode='P0001'; end if;
  return query select p_item,p_leader,p_target,p_nonce,
    receipt.accepted_revision,'ASSIGNED'::text,0,0,0;
  return;
 end if;
 if w.revision<>p_expected_revision or w.state<>'NEW' or w.assignee_id is not null
 then raise exception 'VO4_TL_STALE_OR_ASSIGNED' using errcode='P0001'; end if;
 if (select count(*) from public.vox_work_items_candidate_v1
  where assignee_id=p_target and state<>'DONE')>=24
 then raise exception 'VO4_TL_STAFF_CAPACITY_EXCEEDED' using errcode='P0001'; end if;
 update public.vox_work_items_candidate_v1 set
  state='ASSIGNED',assignee_id=p_target,
  revision=w.revision+1,updated_at=clock_timestamp()
 where id=w.id;
 insert into public.vox_work_events_candidate_v1
 (work_item_id,actor_id,event_nonce,event_type,from_state,to_state,
  from_revision,to_revision,reason)
 values(w.id,p_leader,p_nonce,'TEAM_ASSIGN','NEW','ASSIGNED',
  w.revision,w.revision+1,p_reason);
 insert into public.vox_vo4_tl_assignment_receipts_candidate_v1
 (event_nonce,work_item_id,leader_id,target_staff_id,expected_revision,
  accepted_revision,original_reason)
 values(p_nonce,w.id,p_leader,p_target,w.revision,w.revision+1,p_reason);
 return query select w.id,p_leader,p_target,p_nonce,
  w.revision+1,'ASSIGNED'::text,0,0,0;
end;
$body$;
revoke all on function public.qf_vox_tl_assign_work_candidate_v1(
 uuid,uuid,uuid,integer,uuid,text) from public,anon,authenticated;
grant execute on function public.qf_vox_tl_assign_work_candidate_v1(
 uuid,uuid,uuid,integer,uuid,text) to service_role;
commit;
