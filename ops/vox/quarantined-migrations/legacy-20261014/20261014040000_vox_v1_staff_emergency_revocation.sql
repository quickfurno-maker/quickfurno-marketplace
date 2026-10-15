-- VOX-07 audited security incident revocation. SOURCE ONLY and unapplied.
-- Emergency staff suspension is immediate by an existing, independently
-- verified Superadmin. Use this to contain compromise; it NEVER grants access.
begin;
create or replace function public.qf_vox_emergency_revoke_staff_v1(
 p_authenticated_owner_id uuid,p_target_id uuid,p_expected_team_id uuid,
 p_unique_incident_id uuid,p_incident_reference text
)
returns table(revoked_staff_id uuid,revoked_scopes integer)
language plpgsql security definer set search_path=''
as $$
declare
 m public.vox_staff_memberships_v1%rowtype;
 v_count integer;
begin
 if p_authenticated_owner_id is null or p_target_id is null
    or p_expected_team_id is null or p_unique_incident_id is null
    or p_authenticated_owner_id=p_target_id
    or length(btrim(coalesce(p_incident_reference,''))) not between 8 and 128
 then raise exception 'VOX_INVALID_REVOCATION' using errcode='P0001'; end if;
 if not exists(
   select 1 from public.profiles p join auth.users a on a.id=p.id
   where p.id=p_authenticated_owner_id and p.is_active=true
     and p.role='admin' and a.raw_app_meta_data->>'admin_role'='Superadmin'
 ) then raise exception 'VOX_OWNER_DENIED' using errcode='P0001'; end if;
 select * into m from public.vox_staff_memberships_v1
  where auth_user_id=p_target_id for update;
 if not found or m.team_id<>p_expected_team_id or m.is_active<>true or
    m.revoked_at is not null
 then raise exception 'VOX_STAFF_NOT_ACTIVE_OR_WRONG_TEAM' using errcode='P0001'; end if;
 if exists(select 1 from public.vox_staff_grant_audit_v1
   where request_id=p_unique_incident_id)
 then raise exception 'VOX_DUPLICATE_INCIDENT_ID' using errcode='P0001'; end if;
 update public.vox_staff_memberships_v1
 set is_active=false,revoked_at=now(),updated_at=now()
 where auth_user_id=p_target_id and is_active=true;
 update public.vox_staff_object_scopes_v1
 set revoked_at=now()
 where auth_user_id=p_target_id and revoked_at is null;
 get diagnostics v_count=row_count;
 insert into public.vox_staff_grant_audit_v1(
  actor_id,target_staff_id,operation,approval_reference,request_id
 ) values(p_authenticated_owner_id,p_target_id,'STAFF_REVOKE',
  p_incident_reference,p_unique_incident_id);
 return query select p_target_id,v_count;
end;
$$;
revoke all on function public.qf_vox_emergency_revoke_staff_v1(uuid,uuid,uuid,uuid,text)
 from public,anon,authenticated;
grant execute on function public.qf_vox_emergency_revoke_staff_v1(uuid,uuid,uuid,uuid,text)
 to service_role;
commit;
