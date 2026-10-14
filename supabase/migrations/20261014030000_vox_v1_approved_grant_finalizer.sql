-- VOX-07 SOURCE ONLY: ATOMIC APPROVED STAFF GRANT FINALIZER.
-- Not deployable until Core AAL2 reviewer-bound HTTP and Staging signoff.
begin;
create table public.vox_staff_access_activations_v1(
 request_id uuid primary key references public.vox_staff_access_requests_v1(id) on delete restrict,
 activated_by uuid not null references public.profiles(id),
 activated_at timestamptz not null default now(),
 activation_reference text not null check(length(btrim(activation_reference)) between 8 and 128),
 target_profile_id uuid not null references public.profiles(id),
 applied_kind text not null check(applied_kind in ('STAFF_MEMBERSHIP','OBJECT_SCOPE'))
);
alter table public.vox_staff_access_activations_v1 enable row level security;
alter table public.vox_staff_access_activations_v1 force row level security;
revoke all on public.vox_staff_access_activations_v1 from public,anon,authenticated;
grant select,insert on public.vox_staff_access_activations_v1 to service_role;

create or replace function public.qf_vox_activate_reviewed_access_v1(
 p_request_id uuid,p_authenticated_reviewer_id uuid,p_expected_review_revision integer,p_activation_reference text
)
returns table(activated_request_id uuid,applied_kind text)
language plpgsql security definer set search_path=''
as $$
declare
 r public.vox_staff_access_requests_v1%rowtype;
 t public.vox_staff_teams_v1%rowtype;
 m public.vox_staff_memberships_v1%rowtype;
 v_city uuid;
 v_valid boolean:=false;
begin
 if p_request_id is null or p_authenticated_reviewer_id is null or
    p_expected_review_revision is distinct from 1 or
    length(btrim(coalesce(p_activation_reference,''))) not between 8 and 128
 then raise exception 'VOX_INVALID_ACTIVATION' using errcode='P0001'; end if;
 -- Reviewer id must be derived from a freshly verified Supabase Auth AAL2
 -- bearer by Core, not browser JSON; trusted account/role also checked here.
 if not exists(select 1 from public.profiles p join auth.users a on a.id=p.id
     where p.id=p_authenticated_reviewer_id and p.is_active=true
       and p.role='admin' and a.raw_app_meta_data->>'admin_role'='Superadmin')
 then raise exception 'VOX_ACTOR_DENIED' using errcode='P0001'; end if;
 select * into r from public.vox_staff_access_requests_v1
  where id=p_request_id for update;
 if not found or r.state<>'APPROVED' or r.revision<>1 or
    r.decided_by is distinct from p_authenticated_reviewer_id or
    r.requested_by=p_authenticated_reviewer_id or r.target_profile_id=p_authenticated_reviewer_id or
    r.desired_expires_at<=now() or r.desired_expires_at>now()+interval '90 days'
 then raise exception 'VOX_REVIEW_NOT_ELIGIBLE' using errcode='P0001'; end if;
 if not exists(select 1 from public.vox_staff_access_decisions_v1 a
     where a.request_id=r.id and a.decision='APPROVED'
       and a.reviewer_id=p_authenticated_reviewer_id
       and a.decision_reference=r.decision_reference)
 then raise exception 'VOX_AUDIT_EVIDENCE_MISSING' using errcode='P0001'; end if;
 if exists(select 1 from public.vox_staff_access_activations_v1 a where a.request_id=r.id)
 then raise exception 'VOX_ALREADY_ACTIVATED' using errcode='P0001'; end if;
 if not exists(select 1 from public.profiles p join auth.users a on a.id=p.id
     where p.id=r.target_profile_id and p.role is null and p.is_active=true\n       and a.raw_app_meta_data->>'qf_principal'='vox_staff'\n       and a.raw_app_meta_data->>'admin_role' is null)
 then raise exception 'VOX_TARGET_INACTIVE' using errcode='P0001'; end if;
 select * into t from public.vox_staff_teams_v1 where id=r.team_id for update;
 if not found or not t.is_active
    or not exists(select 1 from public.cities c where c.id=t.city_id and c.is_active=true)
 then raise exception 'VOX_TEAM_CITY_DENIED' using errcode='P0001'; end if;
 v_city:=t.city_id;
 if r.request_kind='STAFF_MEMBERSHIP' then
   if exists(select 1 from public.vox_staff_memberships_v1 mm where mm.auth_user_id=r.target_profile_id)
   then raise exception 'VOX_EXISTING_MEMBERSHIP_REQUIRES_REVOKE_REVIEW' using errcode='P0001'; end if;
   insert into public.vox_staff_memberships_v1(
      auth_user_id,team_id,staff_role,is_active,expires_at,granted_by
   ) values (r.target_profile_id,r.team_id,r.requested_role,true,r.desired_expires_at,p_authenticated_reviewer_id);
 elsif r.request_kind='OBJECT_SCOPE' then
   select * into m from public.vox_staff_memberships_v1
     where auth_user_id=r.target_profile_id for update;
   if not found or m.team_id<>r.team_id or not m.is_active or
      m.revoked_at is not null or m.expires_at<=now() or
      r.desired_expires_at>m.expires_at
   then raise exception 'VOX_MEMBERSHIP_DENIED' using errcode='P0001'; end if;
   if not (
     (r.scope_kind='prospect' and m.staff_role in ('acquisition_agent','operations_manager','auditor')) or
     (r.scope_kind='vendor' and m.staff_role in ('vendor_success_agent','operations_manager','auditor','support_agent')) or
     (r.scope_kind='support_thread' and m.staff_role in ('vendor_success_agent','operations_manager','support_agent')) or
     (r.scope_kind='conversation' and m.staff_role in ('vendor_success_agent','acquisition_agent','operations_manager','support_agent'))
   ) then raise exception 'VOX_ROLE_SCOPE_DENIED' using errcode='P0001'; end if;
   if r.scope_kind='prospect' then
     select exists(select 1 from public.aarohi_prospects p
       where p.id=r.scope_object_id and p.city_id=v_city) into v_valid;
   elsif r.scope_kind='vendor' then
     select exists(select 1 from public.vendors v
       join public.marketplace_service_zones z on z.id=v.service_zone_id
       where v.id=r.scope_object_id and z.city_id=v_city and z.is_active=true) into v_valid;
   elsif r.scope_kind='support_thread' then
     select exists(select 1 from public.vendor_support_threads s
       join public.vendors v on v.id=s.vendor_id
       join public.marketplace_service_zones z on z.id=v.service_zone_id
       where s.id=r.scope_object_id and z.city_id=v_city and z.is_active=true) into v_valid;
   elsif r.scope_kind='conversation' then
     select exists(select 1 from public.communication_conversations c
       where c.id=r.scope_object_id and c.subject_type in ('prospect','vendor') and
       ((c.subject_type='prospect' and exists(
          select 1 from public.aarohi_prospects p where p.id=c.subject_id and p.city_id=v_city)) or
        (c.subject_type='vendor' and exists(
          select 1 from public.vendors v join public.marketplace_service_zones z
            on z.id=v.service_zone_id
          where v.id=c.subject_id and z.city_id=v_city and z.is_active=true))))
       into v_valid;
   end if;
   if not v_valid then raise exception 'VOX_OBJECT_WRONG_CITY_OR_UNKNOWN' using errcode='P0001'; end if;
   if exists(select 1 from public.vox_staff_object_scopes_v1 s
       where s.auth_user_id=r.target_profile_id and s.scope_kind=r.scope_kind
         and s.object_id=r.scope_object_id and s.revoked_at is null)
   then raise exception 'VOX_DUPLICATE_GRANT' using errcode='P0001'; end if;
   insert into public.vox_staff_object_scopes_v1(
      auth_user_id,scope_kind,object_id,granted_by,expires_at,reason
   ) values (r.target_profile_id,r.scope_kind,r.scope_object_id,p_authenticated_reviewer_id,
     r.desired_expires_at,r.reason);
 else raise exception 'VOX_UNSUPPORTED_REQUEST' using errcode='P0001'; end if;
 insert into public.vox_staff_grant_audit_v1(
   actor_id,target_staff_id,operation,scope_kind,object_id,approval_reference,request_id
 ) values(p_authenticated_reviewer_id,r.target_profile_id,
   case when r.request_kind='STAFF_MEMBERSHIP' then 'STAFF_GRANT' else 'SCOPE_GRANT' end,
   r.scope_kind,r.scope_object_id,p_activation_reference,r.id);
 insert into public.vox_staff_access_activations_v1(
   request_id,activated_by,activation_reference,target_profile_id,applied_kind
 ) values(r.id,p_authenticated_reviewer_id,p_activation_reference,r.target_profile_id,r.request_kind);
 return query select r.id,r.request_kind;
end;
$$;
revoke all on function public.qf_vox_activate_reviewed_access_v1(uuid,uuid,integer,text)
 from public,anon,authenticated;
grant execute on function public.qf_vox_activate_reviewed_access_v1(uuid,uuid,integer,text)
 to service_role;
commit;
