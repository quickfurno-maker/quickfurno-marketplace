-- AB7J: GENUINE user-authenticated TWO-PARTY Staff suspend review.
-- UNINSTALLED candidate. User JWT is verified by Supabase PostgREST;
-- SECURITY DEFINER validates auth.uid and AAL2 on each distinct operation.
-- Distinct Owner creates intent, designated neutral TL confirms the SAME nonce.
-- No extra auth system, no Magic Owner role, no account mutation in this script.
begin;
create table public.vox_ab7j_staff_suspend_intents_candidate_v1(
 nonce uuid primary key,
 owner_id uuid not null references public.profiles(id) on delete restrict,
 reviewer_id uuid not null references public.vox_staff_memberships_v1(auth_user_id) on delete restrict,
 target_id uuid not null references public.vox_staff_memberships_v1(auth_user_id) on delete restrict,
 team_id uuid not null references public.vox_staff_teams_v1(id) on delete restrict,
 city_id uuid not null references public.cities(id) on delete restrict,
 request_digest text not null check(request_digest~'^[a-f0-9]{64}$'),
 issued_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null default (clock_timestamp()+interval '10 minutes'),
 constraint ab7j_distinct_staff_approvers check(owner_id<>reviewer_id and
  owner_id<>target_id and reviewer_id<>target_id)
);
alter table public.vox_ab7j_staff_suspend_intents_candidate_v1 enable row level security;
alter table public.vox_ab7j_staff_suspend_intents_candidate_v1 force row level security;
revoke all on public.vox_ab7j_staff_suspend_intents_candidate_v1
 from public,anon,authenticated,service_role;

create function public.qf_vox_ab7j_owner_propose_staff_suspend_v1(
 p_nonce uuid,p_target uuid,p_reviewer uuid,p_team uuid,p_city uuid,p_digest text
) returns uuid language plpgsql security definer set search_path='' as $$
declare me uuid;actual_city uuid;
begin
 me:=auth.uid();
 if me is null or (auth.jwt()->>'aal')<>'aal2' or
  me::text is distinct from (auth.jwt()->>'sub') or
  p_nonce is null or p_target is null or p_reviewer is null or
  p_team is null or p_city is null or p_digest is null or
  p_digest !~ '^[a-f0-9]{64}$' or
  me=p_target or me=p_reviewer or p_reviewer=p_target then
  raise exception 'AB7J_SIGNED_OWNER_AAL2_AND_DISTINCT_REVIEWER_REQUIRED';end if;
 if not exists(select 1 from public.profiles p where p.id=me
  and p.role='admin' and p.is_active=true) then
  raise exception 'AB7J_OWNER_CURRENT_PROFILE_DENIED';end if;
 select t.city_id into actual_city from public.vox_staff_teams_v1 t
 where t.id=p_team and t.is_active=true;
 if actual_city is distinct from p_city then
  raise exception 'AB7J_ACTIVE_TEAM_CITY_REQUIRED';end if;
 if not exists(select 1 from public.vox_staff_memberships_v1 m
  where m.auth_user_id=p_target and m.team_id=p_team and m.is_active=true
  and m.revoked_at is null and m.staff_role not in ('team_leader','auditor')
  and m.expires_at>clock_timestamp()) then
  raise exception 'AB7J_CURRENT_SUSPENSION_TARGET_REQUIRED';end if;
 if not exists(select 1 from public.vox_staff_memberships_v1 m
  join public.profiles p on p.id=m.auth_user_id
  where m.auth_user_id=p_reviewer and m.team_id=p_team
  and m.staff_role='team_leader' and m.is_active=true
  and m.revoked_at is null and m.expires_at>clock_timestamp()
  and p.is_active=true and p.role is null) then
  raise exception 'AB7J_CURRENT_INDEPENDENT_TL_REQUIRED';end if;
 insert into public.vox_ab7j_staff_suspend_intents_candidate_v1(
  nonce,owner_id,reviewer_id,target_id,team_id,city_id,request_digest)
 values(p_nonce,me,p_reviewer,p_target,p_team,p_city,p_digest);
 return p_nonce;
end;
$$;
create function public.qf_vox_ab7j_tl_approve_staff_suspend_v1(
 p_nonce uuid,p_digest text
) returns uuid language plpgsql security definer set search_path='' as $$
declare me uuid;req record;
begin
 me:=auth.uid();
 if me is null or (auth.jwt()->>'aal')<>'aal2' or
  me::text is distinct from (auth.jwt()->>'sub') or
  p_nonce is null or p_digest is null or
  p_digest !~ '^[a-f0-9]{64}$' then
  raise exception 'AB7J_TL_AAL2_REQUIRED';end if;
 select * into req from public.vox_ab7j_staff_suspend_intents_candidate_v1 x
 where x.nonce=p_nonce for update;
 if not found or req.reviewer_id<>me or req.owner_id=me or
  req.target_id=me or req.request_digest<>p_digest or
  req.expires_at<=clock_timestamp() then
  raise exception 'AB7J_INDEPENDENT_TL_INTENT_NOT_CURRENT';end if;
 if not exists(select 1 from public.vox_staff_memberships_v1 m
  join public.profiles p on p.id=m.auth_user_id
  join public.vox_staff_teams_v1 t on t.id=m.team_id
  where m.auth_user_id=me and m.team_id=req.team_id and
  m.staff_role='team_leader' and m.is_active=true and
  m.revoked_at is null and m.expires_at>clock_timestamp()
  and t.city_id=req.city_id and t.is_active=true
  and p.role is null and p.is_active=true) then
  raise exception 'AB7J_TL_CURRENT_MEMBERSHIP_REVOKED';end if;
 if not exists(select 1 from public.profiles p where p.id=req.owner_id
  and p.role='admin' and p.is_active=true) then
  raise exception 'AB7J_OWNER_REVOKED';end if;
 insert into public.vox_ab7i_staff_suspend_approvals_candidate_v1(
  nonce,target_id,owner_id,reviewer_id,team_id,city_id,
  signed_decision_digest,expires_at)
 values(req.nonce,req.target_id,req.owner_id,me,req.team_id,req.city_id,
  req.request_digest,req.expires_at);
 return req.nonce;
end;
$$;
revoke all on function public.qf_vox_ab7j_owner_propose_staff_suspend_v1(
 uuid,uuid,uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.qf_vox_ab7j_tl_approve_staff_suspend_v1(
 uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.qf_vox_ab7j_owner_propose_staff_suspend_v1(
 uuid,uuid,uuid,uuid,uuid,text) to authenticated;
grant execute on function public.qf_vox_ab7j_tl_approve_staff_suspend_v1(
 uuid,text) to authenticated;
commit;
