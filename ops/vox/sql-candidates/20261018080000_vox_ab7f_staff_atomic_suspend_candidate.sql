-- AB7F: native STAFF GRANT fence candidate, NEVER managed-installed.
-- Trusted Core must verify current independent Owner/TL AAL2 signed approval,
-- exact team/city/revision BEFORE privileged RPC. Does NOT end GoTrue sessions.
begin;
create table public.vox_ab7f_staff_suspend_receipts_candidate_v1(
 nonce uuid primary key,
 staff_id uuid not null references public.vox_staff_memberships_v1(auth_user_id) on delete restrict,
 owner_id uuid not null references public.profiles(id) on delete restrict,
 reviewer_id uuid not null references public.profiles(id) on delete restrict,
 team_id uuid not null references public.vox_staff_teams_v1(id) on delete restrict,
 department_grants_revoked integer not null check(department_grants_revoked>=0),
 object_scopes_revoked integer not null check(object_scopes_revoked>=0),
 occurred_at timestamptz not null default clock_timestamp(),
 constraint ab7f_independent_staff_review check(owner_id<>reviewer_id
  and owner_id<>staff_id and reviewer_id<>staff_id)
);
alter table public.vox_ab7f_staff_suspend_receipts_candidate_v1 enable row level security;
alter table public.vox_ab7f_staff_suspend_receipts_candidate_v1 force row level security;
revoke all on public.vox_ab7f_staff_suspend_receipts_candidate_v1
 from public,anon,authenticated;
grant select on public.vox_ab7f_staff_suspend_receipts_candidate_v1 to service_role;
create function public.qf_vox_ab7f_staff_suspend_atomic_candidate_v1(
 p_target uuid,p_owner uuid,p_reviewer uuid,p_team uuid,p_city uuid,p_nonce uuid
) returns table(target_id uuid,receipt_nonce uuid,
 department_grants_revoked integer,object_scopes_revoked integer)
language plpgsql security definer set search_path='' as $$
declare m record;v_city uuid;v_grants integer;v_scopes integer;
begin
 if p_target is null or p_owner is null or p_reviewer is null or
  p_team is null or p_city is null or p_nonce is null or
  p_owner=p_reviewer or p_owner=p_target or p_reviewer=p_target
 then raise exception 'AB7F_INDEPENDENT_REVIEW_REQUIRED'; end if;
 if not exists(select 1 from public.profiles p where p.id=p_owner
   and p.role='admin' and p.is_active=true)
 then raise exception 'AB7F_ACTIVE_OWNER_REQUIRED';end if;
 select t.city_id into v_city from public.vox_staff_teams_v1 t
 where t.id=p_team and t.is_active=true;
 if v_city is distinct from p_city then
  raise exception 'AB7F_ACTIVE_TEAM_CITY_REQUIRED';end if;
 if not exists(select 1 from public.vox_staff_memberships_v1 l
   join public.profiles p on p.id=l.auth_user_id
   where l.auth_user_id=p_reviewer and l.team_id=p_team
   and l.staff_role='team_leader' and l.is_active=true
   and l.revoked_at is null and l.expires_at>clock_timestamp()
   and p.is_active=true and p.role is null)
 then raise exception 'AB7F_CURRENT_INDEPENDENT_TEAM_LEADER_REQUIRED';end if;
 select l.auth_user_id,l.staff_role,l.is_active,l.revoked_at,l.team_id,
   l.expires_at into m from public.vox_staff_memberships_v1 l
 where l.auth_user_id=p_target for update;
 if not found or m.team_id<>p_team or m.staff_role in ('team_leader','auditor')
   or m.is_active is distinct from true or m.revoked_at is not null or
   m.expires_at<=clock_timestamp()
 then raise exception 'AB7F_STAFF_MEMBERSHIP_CHANGED';end if;
 update public.vox_staff_department_capabilities_v1 c
  set revoked_at=clock_timestamp(),revision=3
 where c.auth_user_id=p_target and c.team_id=p_team
   and c.city_id=p_city and c.revoked_at is null;
 get diagnostics v_grants=row_count;
 update public.vox_staff_object_scopes_v1 s
  set revoked_at=clock_timestamp()
 where s.auth_user_id=p_target and s.revoked_at is null;
 get diagnostics v_scopes=row_count;
 update public.vox_staff_memberships_v1 l
  set is_active=false,revoked_at=clock_timestamp()
 where l.auth_user_id=p_target and l.is_active=true;
 insert into public.vox_ab7f_staff_suspend_receipts_candidate_v1
  (nonce,staff_id,owner_id,reviewer_id,team_id,
   department_grants_revoked,object_scopes_revoked)
 values(p_nonce,p_target,p_owner,p_reviewer,p_team,v_grants,v_scopes);
 return query select p_target,p_nonce,v_grants,v_scopes;
end;
$$;
revoke all on function public.qf_vox_ab7f_staff_suspend_atomic_candidate_v1(
 uuid,uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.qf_vox_ab7f_staff_suspend_atomic_candidate_v1(
 uuid,uuid,uuid,uuid,uuid,uuid) to service_role;
commit;
