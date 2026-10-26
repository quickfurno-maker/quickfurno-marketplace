-- VOX-05 STAFF GOVERNANCE SOURCE-ONLY. Not applied to Staging or Production.
-- Depends on the approved VOX-03 team and grant schema migration.
-- This migration can ONLY review requests. It CANNOT grant any permission.
begin;

create table public.vox_staff_access_requests_v1 (
 id uuid primary key default gen_random_uuid(),
 request_nonce uuid not null unique,
 requested_by uuid not null references public.profiles(id),
 target_profile_id uuid not null references public.profiles(id),
 team_id uuid not null references public.vox_staff_teams_v1(id),
 request_kind text not null check(request_kind in ('STAFF_MEMBERSHIP','OBJECT_SCOPE')),
 requested_role text check(requested_role in ('operations_manager','acquisition_agent','vendor_success_agent','support_agent','auditor')),
 scope_kind text check(scope_kind in ('prospect','vendor','support_thread','conversation')),
 scope_object_id uuid,
 desired_expires_at timestamptz not null,
 reason text not null check(length(btrim(reason)) between 12 and 500),
 state text not null default 'PENDING' check(state in ('PENDING','APPROVED','REJECTED')),
 revision integer not null default 0 check(revision between 0 and 1),
 decided_by uuid references public.profiles(id),
 decided_at timestamptz,
 decision_reference text,
 created_at timestamptz not null default now(),
 constraint vox_request_family_shape check (
   (request_kind='STAFF_MEMBERSHIP' and requested_role is not null and scope_kind is null and scope_object_id is null)
   or
   (request_kind='OBJECT_SCOPE' and requested_role is null and scope_kind is not null and scope_object_id is not null)
 ),
 constraint vox_request_future_expiration check (desired_expires_at > created_at),
 constraint vox_request_decision_consistency check(
    (state='PENDING' and revision=0 and decided_by is null and decided_at is null and decision_reference is null)
    or
    (state in ('APPROVED','REJECTED') and revision=1 and decided_by is not null and decided_at is not null and decision_reference is not null)
 )
);
create index vox_staff_pending_requests_idx on public.vox_staff_access_requests_v1(state,created_at);
create index vox_staff_subject_requests_idx on public.vox_staff_access_requests_v1(target_profile_id,created_at desc);

create table public.vox_staff_access_decisions_v1 (
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null unique references public.vox_staff_access_requests_v1(id) on delete restrict,
 reviewer_id uuid not null references public.profiles(id),
 decision text not null check(decision in ('APPROVED','REJECTED')),
 decision_reference text not null check(length(btrim(decision_reference)) between 8 and 128),
 reviewed_at timestamptz not null default now()
);
create index vox_staff_access_decisions_reviewer_idx on public.vox_staff_access_decisions_v1(reviewer_id,reviewed_at);

alter table public.vox_staff_access_requests_v1 enable row level security;
alter table public.vox_staff_access_requests_v1 force row level security;
alter table public.vox_staff_access_decisions_v1 enable row level security;
alter table public.vox_staff_access_decisions_v1 force row level security;

revoke all on public.vox_staff_access_requests_v1 from PUBLIC,anon,authenticated;
revoke all on public.vox_staff_access_decisions_v1 from PUBLIC,anon,authenticated;
grant select,insert,update on public.vox_staff_access_requests_v1 to service_role;
grant select,insert on public.vox_staff_access_decisions_v1 to service_role;
-- Do not grant DELETE for either table. Decisions are append-only for service_role.

create or replace function public.qf_vox_review_staff_access_v1(
 p_request_id uuid,p_reviewer_profile_id uuid,p_expected_revision integer,
 p_decision text,p_approval_reference text
)
returns table(request_id uuid,decision text,new_revision integer)
language plpgsql
security definer
set search_path=''
as $$
declare
 v_request public.vox_staff_access_requests_v1%rowtype;
 v_decision text;
begin
 if p_request_id is null or p_reviewer_profile_id is null or p_expected_revision<>0
    or p_decision not in ('APPROVE','REJECT')
    or length(btrim(coalesce(p_approval_reference,''))) not between 8 and 128
 then raise exception 'VOX_INVALID_REVIEW' using errcode='P0001'; end if;
 -- A real authenticated Core service must derive reviewer identity from
 -- Supabase Auth getUser(token) with AAL2 BEFORE calling this RPC; never from
 -- user-provided request JSON. This SQL independently checks trusted app_metadata.
 if not exists(
   select 1 from public.profiles p join auth.users a on a.id=p.id
   where p.id=p_reviewer_profile_id and p.role='admin'
     and p.is_active=true and (a.raw_app_meta_data->>'admin_role')='Superadmin'
 ) then raise exception 'VOX_REVIEWER_UNAUTHORIZED' using errcode='P0001'; end if;

 select * into v_request
 from public.vox_staff_access_requests_v1 r
 where r.id=p_request_id for update;
 if not found or v_request.state<>'PENDING'
   or v_request.revision<>p_expected_revision
 then raise exception 'VOX_STALE_OR_MISSING_REVIEW' using errcode='P0001'; end if;
 if p_reviewer_profile_id in (v_request.requested_by,v_request.target_profile_id)
 then raise exception 'VOX_SELF_APPROVAL_FORBIDDEN' using errcode='P0001'; end if;
 if v_request.desired_expires_at <= now()
 then raise exception 'VOX_EXPIRED_REQUEST' using errcode='P0001'; end if;
 -- Only mark REVIEWED. No membership, object scope or vendor state is mutated.
 v_decision := case when p_decision='APPROVE' then 'APPROVED' else 'REJECTED' end;
 update public.vox_staff_access_requests_v1 r
 set state=v_decision,revision=1,decided_by=p_reviewer_profile_id,
     decided_at=now(),decision_reference=p_approval_reference
 where r.id=p_request_id;
 insert into public.vox_staff_access_decisions_v1(
  request_id,reviewer_id,decision,decision_reference
 ) values(p_request_id,p_reviewer_profile_id,v_decision,p_approval_reference);
 return query select p_request_id,v_decision,1;
end;
$$;

revoke all on function public.qf_vox_review_staff_access_v1(uuid,uuid,integer,text,text)
 from PUBLIC,anon,authenticated;
grant execute on function public.qf_vox_review_staff_access_v1(uuid,uuid,integer,text,text)
 to service_role;

commit;
