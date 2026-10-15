-- VOX TO-02C: SOURCE-ONLY proposal. Never execute on managed staging/prod.
-- Requires TO-02B schema; user/session AAL2 MUST be verified by Core before RPC.
-- SQL independently rechecks Core owner and TL immutable identities.
begin;
create or replace function public.qf_vox_department_request_v1(
 p_owner uuid,p_target uuid,p_team uuid,p_city uuid,p_pack text,
 p_request_nonce uuid,p_expires timestamptz,p_reason text
)
returns table(request_id uuid,request_state text,request_revision integer)
language plpgsql security definer set search_path=''
as $$
declare m public.vox_staff_memberships_v1%rowtype;
 t public.vox_staff_teams_v1%rowtype;
 v_req uuid;
begin
 if p_owner is null or p_target is null or p_owner=p_target
  or p_team is null or p_city is null or p_request_nonce is null
  or p_pack not in ('client_success','vendor_success','acquisition','service_support')
  or length(btrim(coalesce(p_reason,''))) not between 12 and 500
  or p_expires is null or p_expires<=now()+interval '5 minutes'
  or p_expires>now()+interval '30 days'
 then raise exception 'VOX_DEPT_INVALID_REQUEST' using errcode='P0001'; end if;
 if not exists(
  select 1 from public.profiles p join auth.users a on a.id=p.id
  where p.id=p_owner and p.role='admin' and p.is_active=true
  and a.raw_app_meta_data->>'admin_role'='Superadmin'
 ) then raise exception 'VOX_DEPT_OWNER_DENIED' using errcode='P0001'; end if;
 if not exists(
  select 1 from public.profiles p join auth.users a on a.id=p.id
  where p.id=p_target and p.role is null and p.is_active=true
  and a.raw_app_meta_data->>'qf_principal'='vox_staff'
  and a.raw_app_meta_data->>'admin_role' is null
 ) then raise exception 'VOX_DEPT_TARGET_DENIED' using errcode='P0001'; end if;
 select * into m from public.vox_staff_memberships_v1
  where auth_user_id=p_target for update;
 select * into t from public.vox_staff_teams_v1 where id=p_team for share;
 if not found then raise exception 'VOX_DEPT_TEAM_MISSING' using errcode='P0001'; end if;
 if m.auth_user_id is null or m.team_id<>p_team or not m.is_active
   or m.revoked_at is not null or m.expires_at<p_expires
   or m.expires_at<=now() or not t.is_active or t.city_id<>p_city
   or not exists(select 1 from public.cities c
      where c.id=p_city and c.is_active=true)
 then raise exception 'VOX_DEPT_SCOPE_DENIED' using errcode='P0001'; end if;
 insert into public.vox_staff_department_requests_v1(
  request_nonce,requested_by,target_staff_id,team_id,city_id,
  department,expires_at,reason
 ) values(p_request_nonce,p_owner,p_target,p_team,p_city,p_pack,p_expires,btrim(p_reason))
 returning id into v_req;
 insert into public.vox_staff_department_events_v1(
  request_id,actor_id,target_staff_id,event_kind,event_reference,event_nonce
 ) values(v_req,p_owner,p_target,'REQUESTED','DEPT_REQUEST_'||v_req::text,p_request_nonce);
 return query select v_req,'PENDING'::text,0;
end;
$$;

create or replace function public.qf_vox_department_review_v1(
 p_reviewer uuid,p_request uuid,p_revision integer,p_decision text,
 p_reference text,p_event_nonce uuid
)
returns table(request_id uuid,request_state text,request_revision integer)
language plpgsql security definer set search_path=''
as $$
declare r public.vox_staff_department_requests_v1%rowtype;
 v_state text;
begin
 if p_reviewer is null or p_request is null or p_event_nonce is null
  or p_revision is distinct from 0 or p_decision not in ('APPROVE','REJECT')
  or length(btrim(coalesce(p_reference,''))) not between 8 and 128
 then raise exception 'VOX_DEPT_INVALID_REVIEW' using errcode='P0001'; end if;
 select * into r from public.vox_staff_department_requests_v1
 where id=p_request for update;
 if not found or r.state<>'PENDING' or r.revision<>0
  or r.requested_by=p_reviewer or r.target_staff_id=p_reviewer
  or r.expires_at<=now()
 then raise exception 'VOX_DEPT_REVIEW_STALE' using errcode='P0001'; end if;
 if not exists(
  select 1 from public.profiles p
  join auth.users a on a.id=p.id
  join public.vox_staff_memberships_v1 m on m.auth_user_id=p.id
  join public.vox_staff_teams_v1 t on t.id=m.team_id
  where p.id=p_reviewer and p.role is null and p.is_active=true
   and a.raw_app_meta_data->>'qf_principal'='vox_staff'
   and a.raw_app_meta_data->>'vox_role'='team_leader'
   and a.raw_app_meta_data->>'admin_role' is null
   and m.staff_role='team_leader' and m.is_active=true
   and m.revoked_at is null and m.expires_at>now()
   and m.team_id=r.team_id and t.id=r.team_id
   and t.is_active=true and t.city_id=r.city_id
 ) then raise exception 'VOX_DEPT_REVIEWER_NOT_TL' using errcode='P0001'; end if;
 v_state:=case when p_decision='APPROVE' then 'APPROVED' else 'REJECTED' end;
 update public.vox_staff_department_requests_v1
 set state=v_state,revision=1,decided_by=p_reviewer,decided_at=now(),
  decision_reference=btrim(p_reference)
 where id=r.id;
 insert into public.vox_staff_department_decisions_v1(
  request_id,reviewer_id,decision,decision_reference
 ) values(r.id,p_reviewer,v_state,btrim(p_reference));
 insert into public.vox_staff_department_events_v1(
  request_id,actor_id,target_staff_id,event_kind,event_reference,event_nonce
 ) values(r.id,p_reviewer,r.target_staff_id,
  case when v_state='APPROVED' then 'REVIEW_APPROVED' else 'REVIEW_REJECTED' end,
  btrim(p_reference),p_event_nonce);
 return query select r.id,v_state,1;
end;
$$;

create or replace function public.qf_vox_department_activate_v1(
 p_owner uuid,p_request uuid,p_revision integer,
 p_reference text,p_event_nonce uuid
)
returns table(request_id uuid,capability_id uuid)
language plpgsql security definer set search_path=''
as $$
declare r public.vox_staff_department_requests_v1%rowtype;
 m public.vox_staff_memberships_v1%rowtype;
 v_cap uuid;
begin
 if p_owner is null or p_request is null or p_event_nonce is null
  or p_revision is distinct from 1
  or length(btrim(coalesce(p_reference,''))) not between 8 and 128
 then raise exception 'VOX_DEPT_INVALID_ACTIVATION' using errcode='P0001'; end if;
 if not exists(select 1 from public.profiles p join auth.users a on a.id=p.id
  where p.id=p_owner and p.role='admin' and p.is_active=true
    and a.raw_app_meta_data->>'admin_role'='Superadmin')
 then raise exception 'VOX_DEPT_OWNER_DENIED' using errcode='P0001'; end if;
 select * into r from public.vox_staff_department_requests_v1
 where id=p_request for update;
 if not found or r.state<>'APPROVED' or r.revision<>1
  or r.decided_by is null or r.decided_by=p_owner
  or r.target_staff_id=p_owner or r.expires_at<=now()
 then raise exception 'VOX_DEPT_ACTIVATION_STALE' using errcode='P0001'; end if;
 if not exists(select 1 from public.vox_staff_department_decisions_v1 d
  where d.request_id=r.id and d.reviewer_id=r.decided_by
   and d.decision='APPROVED' and d.decision_reference=r.decision_reference)
 then raise exception 'VOX_DEPT_AUDIT_MISSING' using errcode='P0001'; end if;
 if not exists(
  select 1 from public.profiles p
  join auth.users a on a.id=p.id
  join public.vox_staff_memberships_v1 tl on tl.auth_user_id=p.id
  join public.vox_staff_teams_v1 t on t.id=tl.team_id
  where p.id=r.decided_by and p.role is null and p.is_active=true
   and a.raw_app_meta_data->>'qf_principal'='vox_staff'
   and a.raw_app_meta_data->>'vox_role'='team_leader'
   and a.raw_app_meta_data->>'admin_role' is null
   and tl.staff_role='team_leader' and tl.is_active=true
   and tl.revoked_at is null and tl.expires_at>now()
   and tl.team_id=r.team_id and t.is_active=true and t.city_id=r.city_id)
 then raise exception 'VOX_DEPT_TL_REVOKED' using errcode='P0001'; end if;
 if not exists(select 1 from public.profiles p join auth.users a on a.id=p.id
   where p.id=r.target_staff_id and p.role is null and p.is_active=true
    and a.raw_app_meta_data->>'qf_principal'='vox_staff'
    and a.raw_app_meta_data->>'admin_role' is null)
 then raise exception 'VOX_DEPT_STAFF_REVOKED' using errcode='P0001'; end if;
 select * into m from public.vox_staff_memberships_v1
  where auth_user_id=r.target_staff_id for update;
 if not found or m.team_id<>r.team_id or not m.is_active
  or m.revoked_at is not null or m.expires_at<r.expires_at
  or m.expires_at<=now()
  or not exists(select 1 from public.vox_staff_teams_v1 t
    join public.cities c on c.id=t.city_id
    where t.id=r.team_id and t.city_id=r.city_id and t.is_active
      and c.is_active)
 then raise exception 'VOX_DEPT_MEMBERSHIP_REVOKED' using errcode='P0001'; end if;
 if exists(select 1 from public.vox_staff_department_capabilities_v1 c
  where c.auth_user_id=r.target_staff_id and c.team_id=r.team_id
  and c.department=r.department and c.revoked_at is null)
 then raise exception 'VOX_DEPT_DUPLICATE_CAPABILITY' using errcode='P0001'; end if;
 insert into public.vox_staff_department_capabilities_v1(
  request_id,auth_user_id,team_id,city_id,department,
  granted_by,expires_at)
 values(r.id,r.target_staff_id,r.team_id,r.city_id,
   r.department,p_owner,r.expires_at)
 returning id into v_cap;
 insert into public.vox_staff_department_activations_v1(
  request_id,capability_id,activated_by,activation_reference)
 values(r.id,v_cap,p_owner,btrim(p_reference));
 insert into public.vox_staff_department_events_v1(
  request_id,actor_id,target_staff_id,event_kind,event_reference,event_nonce)
 values(r.id,p_owner,r.target_staff_id,'ACTIVATED',btrim(p_reference),p_event_nonce);
 return query select r.id,v_cap;
end;
$$;

create or replace function public.qf_vox_department_revoke_v1(
 p_owner uuid,p_capability uuid,p_revision integer,
 p_reference text,p_event_nonce uuid
)
returns table(revoked_capability_id uuid,new_revision integer)
language plpgsql security definer set search_path=''
as $$
declare c public.vox_staff_department_capabilities_v1%rowtype;
begin
 if p_owner is null or p_capability is null or p_event_nonce is null
  or p_revision is distinct from 2
  or length(btrim(coalesce(p_reference,''))) not between 8 and 128
 then raise exception 'VOX_DEPT_INVALID_REVOKE' using errcode='P0001'; end if;
 if not exists(select 1 from public.profiles p join auth.users a on a.id=p.id
  where p.id=p_owner and p.role='admin' and p.is_active=true
   and a.raw_app_meta_data->>'admin_role'='Superadmin')
 then raise exception 'VOX_DEPT_OWNER_DENIED' using errcode='P0001'; end if;
 select * into c from public.vox_staff_department_capabilities_v1
 where id=p_capability for update;
 if not found or c.revoked_at is not null or c.revision<>2
 then raise exception 'VOX_DEPT_REVOKE_STALE' using errcode='P0001'; end if;
 update public.vox_staff_department_capabilities_v1
 set revoked_at=now(),revision=3 where id=c.id;
 insert into public.vox_staff_department_events_v1(
  request_id,actor_id,target_staff_id,event_kind,event_reference,event_nonce)
 values(c.request_id,p_owner,c.auth_user_id,'REVOKED',btrim(p_reference),p_event_nonce);
 return query select c.id,3;
end;
$$;
revoke all on function public.qf_vox_department_request_v1(uuid,uuid,uuid,uuid,text,uuid,timestamptz,text)
 from public,anon,authenticated;
revoke all on function public.qf_vox_department_review_v1(uuid,uuid,integer,text,text,uuid)
 from public,anon,authenticated;
revoke all on function public.qf_vox_department_activate_v1(uuid,uuid,integer,text,uuid)
 from public,anon,authenticated;
revoke all on function public.qf_vox_department_revoke_v1(uuid,uuid,integer,text,uuid)
 from public,anon,authenticated;
grant execute on function public.qf_vox_department_request_v1(uuid,uuid,uuid,uuid,text,uuid,timestamptz,text)
 to service_role;
grant execute on function public.qf_vox_department_review_v1(uuid,uuid,integer,text,text,uuid)
 to service_role;
grant execute on function public.qf_vox_department_activate_v1(uuid,uuid,integer,text,uuid)
 to service_role;
grant execute on function public.qf_vox_department_revoke_v1(uuid,uuid,integer,text,uuid)
 to service_role;
commit;
