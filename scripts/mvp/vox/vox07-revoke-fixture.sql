-- Execute after the VOX07 reviewed grant fixture, in the SAME disposable PG.
do $$
declare wrong_team boolean:=false;wrong_owner boolean:=false;replayed boolean:=false;
begin
 begin
  perform public.qf_vox_emergency_revoke_staff_v1(
   '10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003',
   '30000000-0000-4000-8000-000000000009','70000000-0000-4000-8000-000000000001','INCIDENT-REVOKE-001');
 exception when sqlstate 'P0001' then wrong_team:=true;end;
 if not wrong_team then raise exception 'WRONG_TEAM_REVOKE_ALLOWED';end if;
 begin
  perform public.qf_vox_emergency_revoke_staff_v1(
   '10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000003',
   '30000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000002','INCIDENT-REVOKE-002');
 exception when sqlstate 'P0001' then wrong_owner:=true;end;
 if not wrong_owner then raise exception 'BAD_OWNER_REVOKE_ALLOWED';end if;
 perform public.qf_vox_emergency_revoke_staff_v1(
  '10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003',
  '30000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000001','INCIDENT-REVOKE-001');
 if exists(select 1 from public.vox_staff_memberships_v1 where is_active=true) or
    exists(select 1 from public.vox_staff_object_scopes_v1 where revoked_at is null)
 then raise exception 'REVOCATION_NOT_ATOMIC';end if;
 if (select count(*) from public.vox_staff_grant_audit_v1)<>3 or
    (select count(*) from public.vox_staff_grant_audit_v1 where operation='STAFF_REVOKE')<>1
 then raise exception 'REVOCATION_AUDIT_MISSING';end if;
 begin
  perform public.qf_vox_emergency_revoke_staff_v1(
   '10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003',
   '30000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000001','INCIDENT-REVOKE-001');
 exception when sqlstate 'P0001' then replayed:=true;end;
 if not replayed then raise exception 'REVOKE_REPLAY_ALLOWED';end if;
 raise notice 'VOX07_EMERGENCY_REVOCATION_TEST_PASS';
end $$;
