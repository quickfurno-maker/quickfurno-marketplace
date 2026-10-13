-- Run only against isolated offline copy of Staging database, inside a
-- transaction which is ROLLED BACK unconditionally. No external effects.
begin;
do $$
declare
  v_vendor uuid;
  v_admin uuid;
  v_name text;
  v_baseline jsonb;
  v_request uuid;
  v_stale uuid;
  v_unknown uuid;
  v_result public.vendor_profile_change_requests%rowtype;
  denied boolean;
begin
  select id, business_name into v_vendor, v_name from public.vendors order by id limit 1;
  select id into v_admin from public.profiles where role='admin' limit 1;
  if v_vendor is null or v_admin is null then
    raise exception 'TEST_NEEDS_CLONED_VENDOR_AND_ADMIN';
  end if;
  select to_jsonb(v) into v_baseline from public.vendors v where id=v_vendor;
  insert into public.vendor_profile_change_requests
    (vendor_id,request_type,proposed_changes,current_snapshot,status)
    values(v_vendor,'profile_update',
      jsonb_build_object('public_business_name','QF-APPROVAL-SYNTHETIC'),
      v_baseline,'pending')
    returning id into v_request;
  select * into v_result from public.qf_approve_vendor_profile_update_v3(v_request,v_admin,'offline-test');
  if v_result.status <> 'approved' or v_result.reviewed_by <> v_admin then
    raise exception 'CERT_APPROVAL_STATUS_FAIL';
  end if;
  if (select business_name from public.vendors where id=v_vendor) <> 'QF-APPROVAL-SYNTHETIC' then
    raise exception 'CERT_APPROVAL_VENDOR_UPDATE_FAIL';
  end if;
  if (select count(*) from public.vendor_change_review_audit_v3
      where request_id=v_request and decision='approved' and reviewed_by=v_admin) <> 1 then
    raise exception 'CERT_APPROVAL_AUDIT_MISSING';
  end if;
  raise notice 'PASS_ATOMIC_APPROVAL_AND_AUDIT';
  denied := false;
  begin
    perform public.qf_approve_vendor_profile_update_v3(v_request,v_admin,'repeat');
  exception when others then
    denied := true;
  end;
  if not denied then raise exception 'CERT_REPLAY_NOT_DENIED'; end if;
  raise notice 'PASS_REPLAY_DENIED';
  insert into public.vendor_profile_change_requests
    (vendor_id,request_type,proposed_changes,current_snapshot,status)
    values(v_vendor,'profile_update',
      jsonb_build_object('public_description','synthetic-change'),
      v_baseline,'pending')
    returning id into v_stale;
  denied := false;
  begin
    perform public.qf_approve_vendor_profile_update_v3(v_stale,v_admin,'stale');
  exception when others then
    denied := true;
  end;
  if not denied then raise exception 'CERT_STALE_NOT_DENIED'; end if;
  if (select status from public.vendor_profile_change_requests where id=v_stale) <> 'pending' then
    raise exception 'CERT_STALE_REQUEST_MUTATED';
  end if;
  raise notice 'PASS_STALE_DENIED_AND_CANONICAL_UNTOUCHED';
  update public.vendor_profile_change_requests
    set status='rejected', reviewed_by=v_admin, reviewed_at=now(), rejection_reason='stale'
    where id=v_stale and status='pending';
  if (select count(*) from public.vendor_change_review_audit_v3
      where request_id=v_stale and decision='rejected' and reviewed_by=v_admin) <> 1 then
    raise exception 'CERT_REJECTION_AUDIT_MISSING';
  end if;
  raise notice 'PASS_REJECTION_AUDIT';
  insert into public.vendor_profile_change_requests
    (vendor_id,request_type,proposed_changes,current_snapshot,status)
    values(v_vendor,'profile_update',
      jsonb_build_object('remaining_credits',90000), (select to_jsonb(v) from public.vendors v where id=v_vendor),'pending')
    returning id into v_unknown;
  denied := false;
  begin
    perform public.qf_approve_vendor_profile_update_v3(v_unknown,v_admin,'illegal');
  exception when others then denied := true;
  end;
  if not denied then raise exception 'CERT_UNEXPECTED_FIELD_ACCEPTED'; end if;
  raise notice 'PASS_FINANCIAL_FIELD_DENIED';
  denied := false;
  begin
    perform public.qf_approve_vendor_profile_update_v3(v_stale,gen_random_uuid(),'wrong admin');
  exception when others then denied := true;
  end;
  if not denied then raise exception 'CERT_NON_ADMIN_ACCEPTED'; end if;
  raise notice 'PASS_NONADMIN_DENIED';
end $$;
rollback;
select 'CERT_ROLE_SELECT' as check, has_table_privilege('authenticated','public.vendor_profile_change_requests','SELECT')::text
union all select 'CERT_ROLE_INSERT_REVOKED', (not has_table_privilege('authenticated','public.vendor_profile_change_requests','INSERT'))::text
union all select 'CERT_ROLE_UPDATE_REVOKED', (not has_table_privilege('authenticated','public.vendor_profile_change_requests','UPDATE'))::text
union all select 'CERT_RPC_AUTHENTICATED_DENIED', (not has_function_privilege('authenticated','public.qf_approve_vendor_profile_update_v3(uuid,uuid,text)','EXECUTE'))::text
union all select 'CERT_RPC_SERVICE_EXEC_ALLOWED', has_function_privilege('service_role','public.qf_approve_vendor_profile_update_v3(uuid,uuid,text)','EXECUTE')::text;
