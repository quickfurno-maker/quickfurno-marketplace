-- AB-7A Staff lifecycle pending-only ledger. SOURCE CANDIDATE, NOT
-- ACTUAL STAFF SUSPENSION/INVITE/TRANSFER OR AN AUTH SESSION REVOCATION.
-- Independent Owner+TL AAL2 MUST be checked by trusted Core before insert.
begin;
create table public.vox_ab7a_staff_lifecycle_pending_candidate_v1(
 id uuid primary key,
 action text not null check(action in
  ('SUSPEND','REVOKE_DEPARTMENT','TRANSFER_TEAM')),
 owner_id uuid not null references public.profiles(id) on delete restrict,
 reviewer_id uuid not null references public.profiles(id) on delete restrict,
 target_staff_id uuid not null references public.profiles(id) on delete restrict,
 team_id uuid not null references public.vox_staff_teams_v1(id) on delete restrict,
 city_id uuid not null references public.cities(id) on delete restrict,
 nonce uuid not null unique,
 expected_roster_revision integer not null check(expected_roster_revision>=0),
 state text not null default 'PENDING_INDEPENDENT_REVIEW'
  check(state='PENDING_INDEPENDENT_REVIEW'),
 issued_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null,
 constraint ab7a_three_distinct_persons check(
  owner_id<>reviewer_id and owner_id<>target_staff_id and
  reviewer_id<>target_staff_id),
 constraint ab7a_time_box check(expires_at>issued_at
  and expires_at<=issued_at+interval '12 hours')
);
create or replace function public.qf_vox_ab7a_pending_validate_candidate_v1()
returns trigger language plpgsql security invoker set search_path='' as $$
declare v_owner boolean;v_tl boolean;v_staff boolean;v_city uuid;
begin
 select p.role='admin' and p.is_active into v_owner
 from public.profiles p where p.id=new.owner_id;
 select t.city_id into v_city from public.vox_staff_teams_v1 t
 where t.id=new.team_id and t.is_active=true;
 select m.staff_role='team_leader' and m.is_active and
  m.revoked_at is null and m.expires_at>clock_timestamp() and
  p.is_active and p.role is null into v_tl
 from public.vox_staff_memberships_v1 m
 join public.profiles p on p.id=m.auth_user_id
 where m.auth_user_id=new.reviewer_id and m.team_id=new.team_id;
 select m.staff_role not in ('team_leader','auditor') and
  m.is_active and m.revoked_at is null and
  m.expires_at>clock_timestamp() and p.is_active and p.role is null
 into v_staff from public.vox_staff_memberships_v1 m
 join public.profiles p on p.id=m.auth_user_id
 where m.auth_user_id=new.target_staff_id and m.team_id=new.team_id;
 if v_owner is distinct from true or v_tl is distinct from true or
  v_staff is distinct from true or v_city is distinct from new.city_id
 then raise exception 'VOX_AB7A_CURRENT_INDEPENDENT_MEMBERSHIP_REQUIRED';end if;
 return new;
end;
$$;
create trigger qf_vox_ab7a_pending_guard_v1 before insert on
 public.vox_ab7a_staff_lifecycle_pending_candidate_v1
 for each row execute function public.qf_vox_ab7a_pending_validate_candidate_v1();
create trigger qf_vox_ab7a_append_only_v1 before update or delete on
 public.vox_ab7a_staff_lifecycle_pending_candidate_v1
 for each row execute function public.qf_vox_f1_immutable_audit_candidate_v1();
alter table public.vox_ab7a_staff_lifecycle_pending_candidate_v1 enable row level security;
alter table public.vox_ab7a_staff_lifecycle_pending_candidate_v1 force row level security;
revoke all on public.vox_ab7a_staff_lifecycle_pending_candidate_v1
 from public,anon,authenticated;
grant select,insert on public.vox_ab7a_staff_lifecycle_pending_candidate_v1
 to service_role;
revoke all on function public.qf_vox_ab7a_pending_validate_candidate_v1()
 from public,anon,authenticated;
commit;
