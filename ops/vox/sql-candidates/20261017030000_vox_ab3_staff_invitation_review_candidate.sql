-- VOX AB-3A: immutable, NON-ACTIVATING Staff invitation proposal ledger.
-- SQL CANDIDATE ONLY. Not in managed Supabase migrations. No Auth sends.
-- Genuine Core checks Superadmin AAL2 and independently approved TL AAL2.
begin;
create table public.vox_ab3_staff_invitation_requests_candidate_v1(
 id uuid primary key,
 owner_id uuid not null references public.profiles(id) on delete restrict,
 reviewer_id uuid not null references public.profiles(id) on delete restrict,
 team_id uuid not null references public.vox_staff_teams_v1(id) on delete restrict,
 city_id uuid not null references public.cities(id) on delete restrict,
 email_sha256 text not null check(email_sha256 ~ '^[a-f0-9]{64}$'),
 department_packs text[] not null,
 nonce uuid not null unique,
 expected_roster_revision integer not null check(expected_roster_revision >= 0),
 issued_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null,
 state text not null default 'PENDING_INDEPENDENT_REVIEW'
  check(state='PENDING_INDEPENDENT_REVIEW'),
 constraint vox_ab3_invite_distinct_review check(owner_id<>reviewer_id),
 constraint vox_ab3_invite_packs_nonempty check(
  cardinality(department_packs) between 1 and 4),
 constraint vox_ab3_invite_packs_allowed check(
  department_packs <@ array['acquisition','vendor_success',
    'service_support','client_success']::text[]),
 constraint vox_ab3_invite_time check(expires_at>issued_at
   and expires_at<=issued_at + interval '24 hours')
);
create unique index vox_ab3_invite_pending_email_team_v1 on
 public.vox_ab3_staff_invitation_requests_candidate_v1(team_id,email_sha256);
create or replace function public.qf_vox_ab3_invite_validate_candidate_v1()
returns trigger language plpgsql security invoker set search_path='' as $$
declare v_city uuid; v_owner boolean;v_reviewer boolean;
begin
 if new.department_packs is distinct from (select array_agg(x order by x)
   from unnest(new.department_packs) as x) then
  raise exception 'VOX_AB3_PACKS_NOT_SORTED';
 end if;
 if (select count(distinct x) from unnest(new.department_packs) as x)
   <> cardinality(new.department_packs) then
  raise exception 'VOX_AB3_DUPLICATE_PACK';
 end if;
 select t.city_id into v_city from public.vox_staff_teams_v1 t
 where t.id=new.team_id and t.is_active=true;
 if v_city is distinct from new.city_id then
  raise exception 'VOX_AB3_TEAM_CITY_MISMATCH';
 end if;
 select p.is_active and p.role='admin' into v_owner
 from public.profiles p where p.id=new.owner_id;
 select m.is_active and m.staff_role='team_leader'
   and m.team_id=new.team_id and m.revoked_at is null and
   m.expires_at>clock_timestamp() into v_reviewer
 from public.vox_staff_memberships_v1 m where m.auth_user_id=new.reviewer_id;
 if v_owner is distinct from true or v_reviewer is distinct from true then
  raise exception 'VOX_AB3_CURRENT_OWNER_OR_TL_DENIED';
 end if;
 return new;
end;
$$;
create trigger qf_vox_ab3_invite_current_review_v1
 before insert on public.vox_ab3_staff_invitation_requests_candidate_v1
 for each row execute function public.qf_vox_ab3_invite_validate_candidate_v1();

-- Approval decisions are new immutable rows, never an UPDATE granting access.
create table public.vox_ab3_staff_invitation_decisions_candidate_v1(
 request_id uuid primary key references
  public.vox_ab3_staff_invitation_requests_candidate_v1(id) on delete restrict,
 reviewer_id uuid not null references public.profiles(id) on delete restrict,
 decision text not null check(decision in ('APPROVED','REJECTED')),
 decision_reference uuid not null unique,
 reviewed_at timestamptz not null default clock_timestamp(),
 review_signature_sha256 text not null check(review_signature_sha256 ~ '^[a-f0-9]{64}$')
);
create or replace function public.qf_vox_ab3_invite_decision_guard_candidate_v1()
returns trigger language plpgsql security invoker set search_path='' as $$
declare v_req record;v_active boolean;
begin
 select * into v_req from public.vox_ab3_staff_invitation_requests_candidate_v1
  where id=new.request_id for update;
 if not found or v_req.reviewer_id<>new.reviewer_id
  or v_req.owner_id=new.reviewer_id or v_req.expires_at<=clock_timestamp() then
  raise exception 'VOX_AB3_DECISION_AUTHORITY_REVOKED';
 end if;
 select m.is_active and m.staff_role='team_leader'
  and m.team_id=v_req.team_id and m.revoked_at is null
  and m.expires_at>clock_timestamp() into v_active
 from public.vox_staff_memberships_v1 m where m.auth_user_id=new.reviewer_id;
 if v_active is distinct from true then
  raise exception 'VOX_AB3_DECISION_REVIEWER_REVOKED';
 end if;
 return new;
end;
$$;
create trigger qf_vox_ab3_invite_decision_review_v1 before insert on
 public.vox_ab3_staff_invitation_decisions_candidate_v1 for each row
 execute function public.qf_vox_ab3_invite_decision_guard_candidate_v1();
create or replace function public.qf_vox_ab3_append_only_candidate_v1()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 raise exception 'VOX_AB3_APPEND_ONLY';
end;
$$;
create trigger qf_vox_ab3_invite_immutable_v1 before update or delete
 on public.vox_ab3_staff_invitation_requests_candidate_v1
 for each row execute function public.qf_vox_ab3_append_only_candidate_v1();
create trigger qf_vox_ab3_decision_immutable_v1 before update or delete
 on public.vox_ab3_staff_invitation_decisions_candidate_v1
 for each row execute function public.qf_vox_ab3_append_only_candidate_v1();
alter table public.vox_ab3_staff_invitation_requests_candidate_v1 enable row level security;
alter table public.vox_ab3_staff_invitation_requests_candidate_v1 force row level security;
alter table public.vox_ab3_staff_invitation_decisions_candidate_v1 enable row level security;
alter table public.vox_ab3_staff_invitation_decisions_candidate_v1 force row level security;
revoke all on public.vox_ab3_staff_invitation_requests_candidate_v1
 from public,anon,authenticated;
revoke all on public.vox_ab3_staff_invitation_decisions_candidate_v1
 from public,anon,authenticated;
grant select,insert on public.vox_ab3_staff_invitation_requests_candidate_v1
 to service_role;
grant select,insert on public.vox_ab3_staff_invitation_decisions_candidate_v1
 to service_role;
revoke all on function public.qf_vox_ab3_invite_validate_candidate_v1()
 from public,anon,authenticated;
revoke all on function public.qf_vox_ab3_invite_decision_guard_candidate_v1()
 from public,anon,authenticated;
revoke all on function public.qf_vox_ab3_append_only_candidate_v1()
 from public,anon,authenticated;
commit;
