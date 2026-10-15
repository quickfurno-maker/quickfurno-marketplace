-- VOX TO-02C NON-DEPLOYABLE SQL CANDIDATE.
-- Only use after independent DB/security review and stage-only Auth AAL2 E2E.
-- Core MUST derive actor IDs from freshly verified Supabase Auth AAL2,
-- never HTTP request JSON. These RPCs are callable by service_role ONLY.
-- No provider sends, no Auth Admin invitation, no client/object data grants.
begin;

create or replace function public.qf_vox_request_department_v1(
 p_authenticated_owner_id uuid,p_target_staff_id uuid,p_team_id uuid,
 p_department text,p_expires_at timestamptz,p_reason text,p_nonce uuid
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
declare v_member public.vox_staff_memberships_v1%rowtype;
declare v_city uuid;
begin
 if p_authenticated_owner_id is null or p_target_staff_id is null or
    p_authenticated_owner_id=p_target_staff_id or p_team_id is null or p_nonce is null or
    p_department not in ('client_success','vendor_success','acquisition','service_support') or
    length(btrim(coalesce(p_reason,''))) not between 12 and 500 or
    p_expires_at is null or p_expires_at<=now()+interval '5 minutes' or
    p_expires_at>now()+interval '30 days'
 then raise exception 'VOX_DEPARTMENT_REQUEST_INVALID' using errcode='P0001'; end if;

 if not exists(select 1 from public.profiles p join auth.users a on a.id=p.id
   where p.id=p_authenticated_owner_id and p.is_active=true and p.role='admin'
     and a.raw_app_meta_data->>'admin_role'='Superadmin')
 then raise exception 'VOX_DEPARTMENT_ADMIN_DENIED' using errcode='P0001'; end if;

 if not exists(select 1 from public.profiles p join auth.users a on a.id=p.id
   where p.id=p_target_staff_id and p.is_active=true and p.role is null
     and a.raw_app_meta_data->>'qf_principal'='vox_staff'
     and a.raw_app_meta_data->>'admin_role' is null)
 then raise exception 'VOX_DEPARTMENT_NEUTRAL_STAFF_REQUIRED' using errcode='P0001'; end if;

 select * into v_member from public.vox_staff_memberships_v1
    where auth_user_id=p_target_staff_id for update;
 if not found or v_member.team_id<>p_team_id or v_member.is_active is not true or
    v_member.revoked_at is not null or v_member.expires_at<p_expires_at
 then raise exception 'VOX_DEPARTMENT_MEMBERSHIP_DENIED' using errcode='P0001'; end if;

 select t.city_id into v_city from public.vox_staff_teams_v1 t
    join public.cities c on c.id=t.city_id
    where t.id=p_team_id and t.is_active=true and c.is_active=true;
 if not found then raise exception 'VOX_DEPARTMENT_TEAM_CITY_DENIED' using errcode='P0001'; end if;

 insert into public.vox_staff_department_requests_v1(
   request_nonce,requested_by,target_staff_id,team_id,city_id,department,expires_at,reason
 ) values(p_nonce,p_authenticated_owner_id,p_target_staff_id,p_team_id,v_city,p_department,
     p_expires_at,btrim(p_reason)) returning id into v_id;

 insert into public.vox_staff_department_events_v1(
   request_id,actor_id,target_staff_id,event_kind,event_reference,event_nonce
 ) values(v_id,p_authenticated_owner_id,p_target_staff_id,'REQUESTED',
    left(btrim(p_reason),128),p_nonce);
 return v_id;
end;
$$;

create or replace function public.qf_vox_review_department_v1(
 p_request_id uuid,p_authenticated_reviewer_id uuid,p_expected_revision integer,
 p_decision text,p_reference text,p_event_nonce uuid
) returns uuid language plpgsql security definer set search_path='' as $$
declare r public.vox_staff_department_requests_v1%rowtype;
declare v_decision text;
begin
 if p_request_id is null or p_authenticated_reviewer_id is null or
    p_expected_revision is distinct from 0 or
    p_decision not in ('APPROVE','REJECT') or p_event_nonce is null or
    length(btrim(coalesce(p_reference,''))) not between 8 and 128
 then raise exception 'VOX_DEPARTMENT_REVIEW_INVALID' using errcode='P0001'; end if;

 select * into r from public.vox_staff_department_requests_v1
    where id=p_request_id for update;
 if not found or r.state<>'PENDING' or r.revision<>0 or r.expires_at<=now() or
    p_authenticated_reviewer_id in (r.requested_by,r.target_staff_id)
 then raise exception 'VOX_DEPARTMENT_REVIEW_STALE_OR_SELF' using errcode='P0001'; end if;

 if not exists(
   select 1 from public.profiles p
   join auth.users a on a.id=p.id
   join public.vox_staff_memberships_v1 m on m.auth_user_id=p.id
   join public.vox_staff_teams_v1 t on t.id=m.team_id
   join public.cities c on c.id=t.city_id
   where p.id=p_authenticated_reviewer_id and p.role is null and p.is_active=true
     and a.raw_app_meta_data->>'qf_principal'='vox_staff'
     and a.raw_app_meta_data->>'admin_role' is null
     and a.raw_app_meta_data->>'vox_role'='team_leader'
     and m.staff_role='team_leader' and m.team_id=r.team_id
     and m.is_active=true and m.revoked_at is null and m.expires_at>now()
     and t.is_active=true and t.city_id=r.city_id and c.is_active=true
 ) then raise exception 'VOX_DEPARTMENT_INDEPENDENT_REVIEWER_DENIED' using errcode='P0001'; end if;

 v_decision:=case when p_decision='APPROVE' then 'APPROVED' else 'REJECTED' end;
 update public.vox_staff_department_requests_v1 set
  state=v_decision,revision=1,decided_by=p_authenticated_reviewer_id,
  decided_at=now(),decision_reference=btrim(p_reference)
  where id=r.id;
 insert into public.vox_staff_department_decisions_v1(
  request_id,reviewer_id,decision,decision_reference
 ) values(r.id,p_authenticated_reviewer_id,v_decision,btrim(p_reference));
 insert into public.vox_staff_department_events_v1(
  request_id,actor_id,target_staff_id,event_kind,event_reference,event_nonce
 ) values(r.id,p_authenticated_reviewer_id,r.target_staff_id,
  case when v_decision='APPROVED' then 'REVIEW_APPROVED' else 'REVIEW_REJECTED' end,
  btrim(p_reference),p_event_nonce);
 return r.id;
end;
$$;

create or replace function public.qf_vox_activate_department_v1(
 p_request_id uuid,p_authenticated_owner_id uuid,p_expected_revision integer,
 p_activation_reference text,p_event_nonce uuid
) returns uuid language plpgsql security definer set search_path='' as $$
declare r public.vox_staff_department_requests_v1%rowtype;
declare m public.vox_staff_memberships_v1%rowtype;
declare v_capability_id uuid;
begin
 if p_request_id is null or p_authenticated_owner_id is null or
    p_expected_revision is distinct from 1 or p_event_nonce is null or
    length(btrim(coalesce(p_activation_reference,''))) not between 8 and 128
 then raise exception 'VOX_DEPARTMENT_ACTIVATION_INVALID' using errcode='P0001'; end if;

 if not exists(select 1 from public.profiles p join auth.users a on a.id=p.id
   where p.id=p_authenticated_owner_id and p.is_active=true and p.role='admin'
     and a.raw_app_meta_data->>'admin_role'='Superadmin')
 then raise exception 'VOX_DEPARTMENT_ADMIN_DENIED' using errcode='P0001'; end if;

 select * into r from public.vox_staff_department_requests_v1
     where id=p_request_id for update;
 if not found or r.state<>'APPROVED' or r.revision<>1 or
    r.requested_by<>p_authenticated_owner_id or
    r.decided_by in (r.requested_by,r.target_staff_id) or
    r.expires_at<=now() or r.expires_at>now()+interval '30 days'
 then raise exception 'VOX_DEPARTMENT_ACTIVATION_STALE' using errcode='P0001'; end if;

 if not exists(select 1 from public.vox_staff_department_decisions_v1 d
    where d.request_id=r.id and d.reviewer_id=r.decided_by
      and d.decision='APPROVED' and d.decision_reference=r.decision_reference)
 then raise exception 'VOX_DEPARTMENT_SIGNED_REVIEW_MISSING' using errcode='P0001'; end if;

 if not exists(select 1 from public.profiles p join auth.users a on a.id=p.id
   join public.vox_staff_memberships_v1 tl on tl.auth_user_id=p.id
   join public.vox_staff_teams_v1 tt on tt.id=tl.team_id
   where p.id=r.decided_by and p.is_active=true and p.role is null
     and a.raw_app_meta_data->>'qf_principal'='vox_staff'
     and a.raw_app_meta_data->>'admin_role' is null
     and a.raw_app_meta_data->>'vox_role'='team_leader'
     and tl.staff_role='team_leader' and tl.team_id=r.team_id
     and tl.is_active=true and tl.revoked_at is null and tl.expires_at>now()
     and tt.is_active=true and tt.city_id=r.city_id)
 then raise exception 'VOX_DEPARTMENT_REVIEWER_REVOKED' using errcode='P0001'; end if;

 if not exists(select 1 from public.profiles p join auth.users a on a.id=p.id
   where p.id=r.target_staff_id and p.is_active=true and p.role is null
     and a.raw_app_meta_data->>'qf_principal'='vox_staff'
     and a.raw_app_meta_data->>'admin_role' is null)
 then raise exception 'VOX_DEPARTMENT_TARGET_NOT_NEUTRAL' using errcode='P0001'; end if;

 select * into m from public.vox_staff_memberships_v1 where auth_user_id=r.target_staff_id for update;
 if not found or m.team_id<>r.team_id or m.is_active is not true or
    m.revoked_at is not null or m.expires_at<r.expires_at
 then raise exception 'VOX_DEPARTMENT_TARGET_MEMBERSHIP_REVOKED' using errcode='P0001'; end if;

 if not exists(select 1 from public.vox_staff_teams_v1 t join public.cities c on c.id=t.city_id
   where t.id=r.team_id and t.is_active=true and c.is_active=true and t.city_id=r.city_id)
 then raise exception 'VOX_DEPARTMENT_CITY_REVOKED' using errcode='P0001'; end if;

 if exists(select 1 from public.vox_staff_department_activations_v1
   where request_id=r.id) then raise exception 'VOX_DEPARTMENT_ALREADY_ACTIVATED' using errcode='P0001'; end if;

 if exists(select 1 from public.vox_staff_department_capabilities_v1 g
   where g.auth_user_id=r.target_staff_id and g.team_id=r.team_id
      and g.department=r.department and g.revoked_at is null)
 then raise exception 'VOX_DEPARTMENT_DUPLICATE_ACTIVE_GRANT' using errcode='P0001'; end if;

 insert into public.vox_staff_department_capabilities_v1(
  request_id,auth_user_id,team_id,city_id,department,granted_by,expires_at
 ) values(r.id,r.target_staff_id,r.team_id,r.city_id,r.department,
     p_authenticated_owner_id,r.expires_at) returning id into v_capability_id;

 insert into public.vox_staff_department_activations_v1(
  request_id,capability_id,activated_by,activation_reference
 ) values(r.id,v_capability_id,p_authenticated_owner_id,btrim(p_activation_reference));

 insert into public.vox_staff_department_events_v1(
  request_id,actor_id,target_staff_id,event_kind,event_reference,event_nonce
 ) values(r.id,p_authenticated_owner_id,r.target_staff_id,'ACTIVATED',
    btrim(p_activation_reference),p_event_nonce);
 return v_capability_id;
end;
$$;

create or replace function public.qf_vox_revoke_department_v1(
 p_capability_id uuid,p_authenticated_owner_id uuid,p_expected_revision integer,
 p_incident_reference text,p_event_nonce uuid
) returns uuid language plpgsql security definer set search_path='' as $$
declare g public.vox_staff_department_capabilities_v1%rowtype;
begin
 if p_capability_id is null or p_authenticated_owner_id is null or
    p_expected_revision is distinct from 2 or p_event_nonce is null or
    length(btrim(coalesce(p_incident_reference,''))) not between 12 and 128
 then raise exception 'VOX_DEPARTMENT_REVOCATION_INVALID' using errcode='P0001'; end if;

 if not exists(select 1 from public.profiles p join auth.users a on a.id=p.id
   where p.id=p_authenticated_owner_id and p.is_active=true and p.role='admin'
     and a.raw_app_meta_data->>'admin_role'='Superadmin')
 then raise exception 'VOX_DEPARTMENT_ADMIN_DENIED' using errcode='P0001'; end if;

 select * into g from public.vox_staff_department_capabilities_v1
    where id=p_capability_id for update;
 if not found or g.revoked_at is not null or g.revision<>p_expected_revision
 then raise exception 'VOX_DEPARTMENT_ALREADY_REVOKED_OR_STALE' using errcode='P0001'; end if;
 update public.vox_staff_department_capabilities_v1
   set revoked_at=now(),revision=3 where id=g.id;
 insert into public.vox_staff_department_events_v1(
   request_id,actor_id,target_staff_id,event_kind,event_reference,event_nonce
 ) values(g.request_id,p_authenticated_owner_id,g.auth_user_id,'REVOKED',
     btrim(p_incident_reference),p_event_nonce);
 return g.id;
end;
$$;

revoke all on function public.qf_vox_request_department_v1(uuid,uuid,uuid,text,timestamptz,text,uuid)
 from public,anon,authenticated;
revoke all on function public.qf_vox_review_department_v1(uuid,uuid,integer,text,text,uuid)
 from public,anon,authenticated;
revoke all on function public.qf_vox_activate_department_v1(uuid,uuid,integer,text,uuid)
 from public,anon,authenticated;
revoke all on function public.qf_vox_revoke_department_v1(uuid,uuid,integer,text,uuid)
 from public,anon,authenticated;
grant execute on function public.qf_vox_request_department_v1(uuid,uuid,uuid,text,timestamptz,text,uuid) to service_role;
grant execute on function public.qf_vox_review_department_v1(uuid,uuid,integer,text,text,uuid) to service_role;
grant execute on function public.qf_vox_activate_department_v1(uuid,uuid,integer,text,uuid) to service_role;
grant execute on function public.qf_vox_revoke_department_v1(uuid,uuid,integer,text,uuid) to service_role;
commit;
