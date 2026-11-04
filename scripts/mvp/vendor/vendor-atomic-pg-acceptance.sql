-- Atomic Pending signup acceptance, PostgreSQL 17 isolated Docker only.
-- No external networks, real users, sends, payments, or managed DB access.

do $$
declare
  u uuid:='00000000-0000-4000-8000-000000000001';
  digest text:=repeat('c',64);
  dest text:=repeat('d',64);
  req jsonb;
  result text;
  id uuid;
  retry_id uuid;
begin
  req:=jsonb_build_object(
    'phone','9876543210','whatsapp_number','9876543210',
    'business_name','Synthetic New Business','owner_name','Synthetic Owner',
    'city','Pune','service_categories',jsonb_build_array('Modular Kitchens'),
    'google_place_id','synthetic-place-id',
    'formatted_address','Synthetic verified-for-capture address',
    'office_address_line1','Synthetic office','office_state','Maharashtra',
    'registration_consent_accepted',true,
    'registration_consent_version','2026-11-04-v1',
    -- ATTACKER-controlled fields must be ignored, never inserted:
    'status','Approved','paid_status','Paid','is_active',true,
    'accepting_leads',true,'remaining_credits',9999,
    'public_visibility',true,'role','admin'
  );
  if not public.qf_reserve_auth_otp_purpose(
    digest,'vendor_login','20000000-0000-4000-8000-000000000010',120)
    then raise exception 'ATOMIC_OTP_RESERVATION_FAILED'; end if;
  if public.qf_claim_auth_otp_purpose(digest,u,'signed-vendor-1') <> 'vendor_login'
    then raise exception 'ATOMIC_OTP_CLAIM_FAILED'; end if;
  insert into public.communication_messages(
    message_type,lane,channel,recipient_type,entity_type,entity_id,
    destination_hash,provider,correlation_id,status
  ) values (
    'vendor_login_otp','authentication','whatsapp','vendor','auth_user',u,
    dest,'meta_whatsapp','signed-vendor-1','accepted'
  );

  select outcome,vendor_id into result,id from public.qf_register_pending_vendor_atomic(
    u,digest,dest,'meta_whatsapp',req);
  if result is distinct from 'created_pending' or id is null then
    raise exception 'ATOMIC_PENDING_CREATE_FAILED %',result; end if;
  if (select count(*) from public.vendors where user_id=u) <> 1
    then raise exception 'ATOMIC_CREATED_DUPLICATE_VENDOR'; end if;
  if not exists (
    select 1 from public.vendors v
     where v.id=id and v.phone='9876543210' and v.whatsapp_number='9876543210'
       and v.status='Pending' and v.verification_status='Pending'
       and v.paid_status='Unpaid' and v.is_active=false
       and v.accepting_leads=false and v.public_visibility=false
       and v.total_credits=0 and v.remaining_credits=0
       and v.location_verification_status='unverified'
       and v.service_zone_id is null
       and v.office_latitude is null and v.office_longitude is null
       and v.registration_consent_version='2026-11-04-v1'
       and v.registration_consent_accepted_at is not null
  ) then raise exception 'ATOMIC_SIGNUP_BYPASSED_PENDING_SAFETY'; end if;
  if (select role from public.profiles where id=u) is distinct from 'vendor'
    then raise exception 'ATOMIC_VENDOR_PROFILE_NOT_LINKED'; end if;
  if not exists (
    select 1 from public.vendor_dashboard_users d
     where d.user_id=u and d.vendor_id=id
       and d.role='owner' and d.status='active'
       and d.phone_verified=false and d.whatsapp_otp_enabled=false
  ) then raise exception 'ATOMIC_OWNER_MEMBERSHIP_NOT_LINKED'; end if;

  select outcome,vendor_id into result,retry_id from public.qf_register_pending_vendor_atomic(
    u,digest,dest,'meta_whatsapp',req);
  if result is distinct from 'resume_existing' or retry_id is distinct from id
    then raise exception 'ATOMIC_RETRY_WAS_NOT_IDEMPOTENT'; end if;
  if (select count(*) from public.vendor_dashboard_users where user_id=u)<>1
    then raise exception 'ATOMIC_DUPLICATE_MEMBERSHIP'; end if;

  -- Incomplete consent/version, wrong provider or wrong sender never edits an
  -- already-created vendor. The code is not a business overwrite primitive.
  select outcome into result from public.qf_register_pending_vendor_atomic(
    u,digest,dest,'mock',req);
  if result is distinct from 'denied' then raise exception 'MOCK_PROVIDER_ALLOWED'; end if;
  select outcome into result from public.qf_register_pending_vendor_atomic(
    u,digest,dest,'meta_whatsapp',req - 'registration_consent_version');
  if result is distinct from 'denied' then raise exception 'MISSING_CONSENT_VERSION_ALLOWED'; end if;
  select outcome into result from public.qf_register_pending_vendor_atomic(
    u,digest,repeat('f',64),'meta_whatsapp',req);
  if result is distinct from 'otp_proof_required' then raise exception 'FOREIGN_DELIVERY_ACCEPTED'; end if;
  raise notice 'PASS atomic Pending vendor/profile/member and idempotent retry';
end $$;

do $$
declare
  u uuid:='00000000-0000-4000-8000-000000000002';
  digest text:=repeat('e',64);
  dest text:=repeat('b',64);
  req jsonb;
  result text;
begin
  req:=jsonb_build_object(
    'phone','8765432109','business_name','Client Collision','owner_name','Client',
    'city','Pune','service_categories',jsonb_build_array('Painting'),
    'google_place_id','synthetic-place','formatted_address','synthetic address',
    'office_address_line1','synthetic office','office_state','Maharashtra',
    'registration_consent_accepted',true,'registration_consent_version','2026-11-04-v1'
  );
  if not public.qf_reserve_auth_otp_purpose(
    digest,'vendor_login','20000000-0000-4000-8000-000000000011',120)
    then raise exception 'CLIENT_OTP_RESERVE_FAILED'; end if;
  if public.qf_claim_auth_otp_purpose(digest,u,'signed-vendor-2') <> 'vendor_login'
    then raise exception 'CLIENT_OTP_CLAIM_FAILED'; end if;
  insert into public.communication_messages(
    message_type,lane,channel,recipient_type,entity_type,entity_id,
    destination_hash,provider,correlation_id,status
  ) values ('vendor_login_otp','authentication','whatsapp','vendor','auth_user',
    u,dest,'meta_whatsapp','signed-vendor-2','accepted');
  insert into public.client_accounts(user_id,phone_e164)
    values (u,'+918765432109');
  select outcome into result from public.qf_register_pending_vendor_atomic(
    u,digest,dest,'meta_whatsapp',req);
  if result is distinct from 'ownership_conflict'
    then raise exception 'CLIENT_PROMOTED_TO_VENDOR %',result; end if;
  if (select role from public.profiles where id=u) is not null
    then raise exception 'CLIENT_PROFILE_ROLE_CHANGED'; end if;
  if exists(select 1 from public.vendors where user_id=u)
    then raise exception 'CLIENT_COLLISION_CREATED_VENDOR'; end if;

  -- Any business row claiming another user's same phone may NOT be adopted.
  insert into public.vendors(user_id,business_name,phone,city)
    values (null,'Historical Unowned Mobile','8765432109','Pune');
  delete from public.client_accounts where user_id=u;
  select outcome into result from public.qf_register_pending_vendor_atomic(
    u,digest,dest,'meta_whatsapp',req);
  if result is distinct from 'ownership_conflict'
    then raise exception 'UNOWNED_PHONE_TAKEOVER_ALLOWED %',result; end if;
  raise notice 'PASS cross-principal and historical phone conflict refusal';
end $$;

do $$
declare
  u uuid:='00000000-0000-4000-8000-000000000004';
  digest text:=repeat('9',64);
  dest text:=repeat('8',64);
  req jsonb;
  result text;
  id uuid;
begin
  req:=jsonb_build_object(
    'phone','6543210987','business_name','Existing Owner','owner_name','Existing',
    'city','Pune','service_categories',jsonb_build_array('Painting'),
    'google_place_id','synthetic-place','formatted_address','synthetic address',
    'office_address_line1','synthetic office','office_state','Maharashtra',
    'registration_consent_accepted',true,'registration_consent_version','2026-11-04-v1'
  );
  if not public.qf_reserve_auth_otp_purpose(
    digest,'vendor_login','20000000-0000-4000-8000-000000000012',120)
    then raise exception 'EXISTING_OTP_RESERVE_FAILED'; end if;
  if public.qf_claim_auth_otp_purpose(digest,u,'signed-vendor-4') <> 'vendor_login'
    then raise exception 'EXISTING_OTP_CLAIM_FAILED'; end if;
  insert into public.communication_messages(
    message_type,lane,channel,recipient_type,entity_type,entity_id,
    destination_hash,provider,correlation_id,status
  ) values ('vendor_login_otp','authentication','whatsapp','vendor','auth_user',
    u,dest,'meta_whatsapp','signed-vendor-4','accepted');
  update public.profiles set role='vendor' where id=u;
  insert into public.vendors(user_id,business_name,phone,city,status,is_active)
    values(u,'Historical Linked Pending','6543210987','Pune','Pending',false)
    returning id into id;
  select outcome into result from public.qf_register_pending_vendor_atomic(
    u,digest,dest,'meta_whatsapp',req);
  if result is distinct from 'owner_repair_required'
    then raise exception 'MISSING_MEMBERSHIP_AUTO_REPAIRED %',result; end if;
  if exists (select 1 from public.vendor_dashboard_users where vendor_id=id)
    then raise exception 'PUBLIC_SIGNUP_ADOPTED_MEMBER'; end if;
  raise notice 'PASS Owner-only repair, no automatic dashboard adoption';
end $$;

do $$
declare result text;
begin
  -- The unconfirmed third user cannot register even if they know a valid
  -- formatted mobile. This must not create a vendor or change a profile.
  select outcome into result from public.qf_register_pending_vendor_atomic(
    '00000000-0000-4000-8000-000000000003',
    repeat('a',64),repeat('b',64),'meta_whatsapp',
    jsonb_build_object('phone','7654321098',
     'business_name','Unconfirmed User','owner_name','User',
     'city','Pune','service_categories',jsonb_build_array('Painting'),
     'google_place_id','place','formatted_address','address',
     'office_address_line1','office','office_state','Maharashtra',
     'registration_consent_accepted',true,
     'registration_consent_version','2026-11-04-v1'));
  if result is distinct from 'denied' then raise exception 'UNCONFIRMED_PHONE_ADMITTED'; end if;

  if has_function_privilege('anon','public.qf_register_pending_vendor_atomic(uuid,text,text,text,jsonb)','EXECUTE')
     or has_function_privilege('authenticated','public.qf_register_pending_vendor_atomic(uuid,text,text,text,jsonb)','EXECUTE')
    then raise exception 'ATOMIC_SIGNUP_RPC_BROWSER_EXPOSED'; end if;
  if not has_function_privilege('service_role','public.qf_register_pending_vendor_atomic(uuid,text,text,text,jsonb)','EXECUTE')
    then raise exception 'ATOMIC_SIGNUP_RPC_SERVICE_ROLE_MISSING'; end if;
  raise notice 'PASS unconfirmed phone denial and service-role-only authority';
end $$;
