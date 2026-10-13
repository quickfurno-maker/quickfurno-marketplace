-- Offline-only, transaction-rolled-back certificate for the V3 approval
-- authorization boundary. Never run against live Staging or Production.
begin;
do $cert$
declare
  v_admin uuid;
  v_vendor uuid;
  v_request uuid;
  v_snapshot jsonb;
  v_denied boolean;
  v_out public.vendor_profile_change_requests%rowtype;
begin
  if current_database() not like 'vl05\_%' escape '\' then
    raise exception 'OFFLINE_VL05_TEST_DATABASE_REQUIRED';
  end if;
  select p.id into v_admin from public.profiles p join auth.users u on u.id=p.id
    where p.role='admin' and u.raw_app_meta_data->>'admin_role'='Superadmin' limit 1;
  select id into v_vendor from public.vendors order by id limit 1;
  if v_admin is null or v_vendor is null then
    raise exception 'MISSING_OFFLINE_SUPERADMIN_OR_VENDOR';
  end if;
  select to_jsonb(v) into v_snapshot from public.vendors v where v.id=v_vendor;
  insert into public.vendor_profile_change_requests
    (vendor_id,request_type,proposed_changes,current_snapshot,status)
    values (v_vendor,'profile_update',jsonb_build_object('public_business_name','QF-TEST-CANONICAL'),v_snapshot,'pending')
    returning id into v_request;

  -- Keep profiles.role=admin; a stale or forged authorization via the coarse
  -- profile role MUST NOT qualify when Auth app_metadata is downgraded.
  update auth.users set raw_app_meta_data=
     jsonb_set(coalesce(raw_app_meta_data,'{}'::jsonb),'{admin_role}','"Admin"'::jsonb,true)
    where id=v_admin;
  v_denied := false;
  begin
    perform public.qf_approve_vendor_profile_update_v3(v_request,v_admin,'downgraded');
  exception when others then v_denied := true;
  end;
  if not v_denied then raise exception 'FAIL_DOWNGRADED_ROLE_APPROVED'; end if;
  if (select status from public.vendor_profile_change_requests where id=v_request) <> 'pending'
     or (select business_name from public.vendors where id=v_vendor) = 'QF-TEST-CANONICAL' then
     raise exception 'FAIL_DOWNGRADE_DID_NOT_ROLL_BACK';
  end if;
  raise notice 'PASS_PROFILE_ADMIN_AUTH_DOWNGRADE_DENIED';

  v_denied := false;
  begin
    update public.vendor_profile_change_requests set status='rejected',
      reviewed_by=v_admin, reviewed_at=now(), rejection_reason='downgraded actor'
      where id=v_request;
  exception when others then v_denied := true;
  end;
  if not v_denied then raise exception 'FAIL_AUDIT_TRIGGER_ACCEPTED_DOWNGRADED_ADMIN'; end if;
  raise notice 'PASS_AUDIT_TRIGGER_DOWNGRADE_DENIED';

  update auth.users set raw_app_meta_data=
     jsonb_set(coalesce(raw_app_meta_data,'{}'::jsonb),'{admin_role}','"Superadmin"'::jsonb,true)
    where id=v_admin;
  select * into v_out from public.qf_approve_vendor_profile_update_v3(v_request,v_admin,'restored superadmin');
  if v_out.status <> 'approved' or
    (select count(*) from public.vendor_change_review_audit_v3
      where request_id=v_request and reviewed_by=v_admin and decision='approved') <> 1 then
    raise exception 'FAIL_RESTORED_SUPERADMIN';
  end if;
  raise notice 'PASS_RESTORED_SUPERADMIN_ATOMIC_APPROVAL';
end
$cert$;
rollback;
