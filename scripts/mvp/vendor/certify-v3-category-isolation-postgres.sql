-- Guarded and rolled-back physical PostgreSQL proof of category eligibility
-- isolation. Must run only against the isolated vl05_ test database.
begin;
do $cert$
declare
  v_admin uuid;
  v_vendor uuid;
  v_snapshot jsonb;
  v_req uuid;
  v_denied boolean;
  v_categories text[];
  v_category text;
  v_result public.vendor_profile_change_requests%rowtype;
begin
  if current_database() not like 'vl05\_%' escape '\' then
    raise exception 'OFFLINE_VL05_DATABASE_REQUIRED';
  end if;
  select p.id into v_admin from public.profiles p join auth.users u on u.id=p.id
    where p.role='admin' and u.raw_app_meta_data->>'admin_role'='Superadmin' limit 1;
  select id, selected_category, service_categories into v_vendor, v_category, v_categories
    from public.vendors order by id limit 1;
  if v_admin is null or v_vendor is null then
    raise exception 'MISSING_SYNTHETIC_ADMIN_OR_VENDOR';
  end if;
  select to_jsonb(v) into v_snapshot from public.vendors v where v.id=v_vendor;
  insert into public.vendor_profile_change_requests
    (vendor_id, request_type, proposed_changes, current_snapshot, status)
    values (v_vendor,'profile_update', jsonb_build_object('public_category','Painter'),v_snapshot,'pending')
    returning id into v_req;
  v_denied := false;
  begin
    perform public.qf_approve_vendor_profile_update_v3(v_req,v_admin,'category');
  exception when others then v_denied := true;
  end;
  if not v_denied then raise exception 'FAIL_GENERAL_CATEGORY_APPROVED'; end if;
  if (select selected_category from public.vendors where id=v_vendor) is distinct from v_category then
    raise exception 'FAIL_CATEGORY_MUTATED';
  end if;
  raise notice 'PASS_GENERAL_PUBLIC_CATEGORY_DENIED';
  update public.vendor_profile_change_requests
    set status='rejected', reviewed_by=v_admin, reviewed_at=now(), rejection_reason='separate coverage review'
    where id=v_req and status='pending';
  insert into public.vendor_profile_change_requests
    (vendor_id,request_type,proposed_changes,current_snapshot,status)
    values(v_vendor,'profile_update',jsonb_build_object('services_offered',jsonb_build_array('Painter')),
      v_snapshot,'pending')
    returning id into v_req;
  v_denied := false;
  begin
    perform public.qf_approve_vendor_profile_update_v3(v_req,v_admin,'services');
  exception when others then v_denied := true;
  end;
  if not v_denied then raise exception 'FAIL_GENERAL_MATCHING_SERVICES_APPROVED'; end if;
  if (select service_categories from public.vendors where id=v_vendor) is distinct from v_categories then
    raise exception 'FAIL_MATCHING_SERVICES_MUTATED';
  end if;
  raise notice 'PASS_GENERAL_MATCHING_SERVICES_DENIED';
  update public.vendor_profile_change_requests
    set status='rejected', reviewed_by=v_admin, reviewed_at=now(), rejection_reason='separate coverage review'
    where id=v_req and status='pending';
  insert into public.vendor_profile_change_requests
    (vendor_id,request_type,proposed_changes,current_snapshot,status)
    values(v_vendor,'profile_update',jsonb_build_object('public_description','QF-SAFE-PUBLIC-COPY'),
      v_snapshot,'pending')
    returning id into v_req;
  select * into v_result from public.qf_approve_vendor_profile_update_v3(v_req,v_admin,'public-only');
  if v_result.status is distinct from 'approved' or
     (select public_description from public.vendors where id=v_vendor) <> 'QF-SAFE-PUBLIC-COPY' or
     (select selected_category from public.vendors where id=v_vendor) is distinct from v_category or
     (select service_categories from public.vendors where id=v_vendor) is distinct from v_categories then
    raise exception 'FAIL_SAFE_PUBLIC_APPROVAL';
  end if;
  raise notice 'PASS_SAFE_PUBLIC_COPY_ONLY';
end
$cert$;
rollback;
