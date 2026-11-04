-- QuickFurno — atomic Pending vendor registration and principal linking.
-- SOURCE-ONLY, DRAFT PR #484. DO NOT APPLY TO MANAGED STAGING/PRODUCTION.
-- Requires private OTP-purpose receipt and registration-consent migrations.
-- This is a SERVICE-ROLE-ONLY DB transaction, not a public signup endpoint.
-- The trusted caller MUST separately verify Supabase Auth OTP, signed hook
-- purpose, provider-bound WhatsApp message, role/client conflicts and consent.
-- On any error PostgreSQL rolls back profile, vendor and membership together.
begin;

-- Strict one owner/one phone rules for NEW registrations. Existing rows are NOT
-- rewritten. These indexes deliberately FAIL migration if historical conflicts
-- exist. Complete a preflight duplicate review; never silently pick a winner.
create unique index if not exists uq_qf_vendor_signup_auth_principal
  on public.vendors(user_id) where user_id is not null;
create unique index if not exists uq_qf_vendor_signup_mobile_10
  on public.vendors(phone) where phone ~ '^[6-9][0-9]{9}$';
create unique index if not exists uq_qf_vendor_signup_owner_membership
  on public.vendor_dashboard_users(vendor_id)
  where role='owner' and user_id is not null;

-- Trusted service-only input. Every field in p_registration is independently
-- selected/validated here; JSONB is NEVER passed into a record or SQL dynamic
-- expression and cannot set status, credits, location authority or a role.
create or replace function public.qf_register_pending_vendor_atomic(
  p_auth_user_id uuid,
  p_phone_digest text,
  p_destination_hash text,
  p_provider_key text,
  p_registration jsonb
) returns table(outcome text, vendor_id uuid)
language plpgsql security definer set search_path=pg_catalog
as $$
declare
  v_auth_phone text;
  v_phone_confirmed_at timestamptz;
  v_mobile text;
  v_profile_role text;
  v_business text;
  v_owner text;
  v_city text;
  v_place text;
  v_address text;
  v_office text;
  v_state text;
  v_email text;
  v_gst text;
  v_categories text[];
  v_webhook_id text;
  v_claim_at timestamptz;
  v_new_id uuid;
  v_existing_id uuid;
  v_existing_phone text;
  v_existing_owner uuid;
  v_mapping_vendor uuid;
  v_mapping_role text;
  v_mapping_status text;
  v_count bigint;
begin
  -- Shape and source gate: never accept an anonymous, fake-provider,
  -- client-purpose, unconfirmed-phone or loosely formatted signup.
  if p_auth_user_id is null
     or p_phone_digest is null or p_phone_digest !~ '^[0-9a-f]{64}$'
     or p_destination_hash is null or p_destination_hash !~ '^[0-9a-f]{64}$'
     or nullif(btrim(p_provider_key),'') is null
     or lower(btrim(p_provider_key)) in ('mock','test','fake','local','development')
     or jsonb_typeof(p_registration) is distinct from 'object' then
    return query select 'denied'::text,null::uuid; return;
  end if;
  v_mobile := p_registration->>'phone';
  v_business := btrim(coalesce(p_registration->>'business_name',''));
  v_owner := btrim(coalesce(p_registration->>'owner_name',''));
  v_city := btrim(coalesce(p_registration->>'city',''));
  v_place := btrim(coalesce(p_registration->>'google_place_id',''));
  v_address := btrim(coalesce(p_registration->>'formatted_address',''));
  v_office := btrim(coalesce(p_registration->>'office_address_line1',''));
  v_state := btrim(coalesce(p_registration->>'office_state',''));
  v_email := nullif(lower(btrim(coalesce(p_registration->>'email',''))),'');
  v_gst := nullif(upper(btrim(coalesce(p_registration->>'gst_number',''))),'');
  if v_mobile is null or v_mobile !~ '^[6-9][0-9]{9}$'
     or length(v_business) not between 1 and 150
     or length(v_owner) not between 1 and 150
     or length(v_city) not between 1 and 80
     or length(v_place) not between 1 and 255
     or length(v_address) not between 1 and 1000
     or length(v_office) not between 1 and 255
     or length(v_state) not between 1 and 80
     or p_registration->'registration_consent_accepted' is distinct from 'true'::jsonb
     or p_registration->>'registration_consent_version' <> '2026-11-04-v1'
     or (p_registration ? 'whatsapp_number' and
         p_registration->>'whatsapp_number' is distinct from v_mobile)
     or (v_email is not null and (length(v_email)>254 or
         v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'))
     or (v_gst is not null and v_gst !~ '^(0[1-9]|[12][0-9]|3[0-8]|97)[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$')
     or jsonb_typeof(p_registration->'service_categories') is distinct from 'array'
     or jsonb_array_length(coalesce(p_registration->'service_categories','[]'::jsonb)) not between 1 and 20
  then
    return query select 'denied'::text,null::uuid; return;
  end if;
  if exists (select 1 from jsonb_array_elements(p_registration->'service_categories') e(value)
             where jsonb_typeof(e.value)<>'string'
                or length(btrim(e.value #>> '{}')) not between 1 and 120) then
    return query select 'denied'::text,null::uuid; return;
  end if;
  select array_agg(distinct btrim(value) order by btrim(value)) into v_categories
    from jsonb_array_elements_text(p_registration->'service_categories') e(value);

  -- Serialize competing requests both by principal AND mobile. A second Auth
  -- account cannot race the same phone, and one Auth account cannot register
  -- a second business on a different phone. The unique indexes protect against
  -- writers outside this RPC; no reliance on a pre-insert SELECT alone.
  perform pg_advisory_xact_lock(hashtextextended('qf:vendor:auth:'||p_auth_user_id::text, 721401));
  perform pg_advisory_xact_lock(hashtextextended('qf:vendor:phone:'||v_mobile, 721402));

  select u.phone,u.phone_confirmed_at
    into v_auth_phone,v_phone_confirmed_at
    from auth.users u where u.id=p_auth_user_id for share;
  if not found or v_auth_phone is distinct from '+91'||v_mobile
     or v_phone_confirmed_at is null then
    return query select 'denied'::text,null::uuid; return;
  end if;
  -- Neither an existing client principal nor one with a conflicting profile
  -- role can be reclassified as a vendor by this service-only function.
  if exists(select 1 from public.client_accounts c where c.user_id=p_auth_user_id
            or c.phone_e164='+91'||v_mobile) then
    return query select 'ownership_conflict'::text,null::uuid; return;
  end if;
  select role into v_profile_role from public.profiles
   where id=p_auth_user_id for update;
  if not found or v_profile_role not in ('vendor') and v_profile_role is not null then
    return query select 'ownership_conflict'::text,null::uuid; return;
  end if;

  -- A claimed, recent VENDOR-purpose Standard Webhooks receipt must agree with
  -- this precise Auth principal and phone HMAC. The delivery ledger must use
  -- the same signed webhook, authorized provider and destination SHA-256.
  select r.verified_webhook_id,r.created_at into v_webhook_id,v_claim_at
    from qf_vendor_private.auth_otp_purpose_reservations r
   where r.phone_digest=p_phone_digest and r.auth_user_id=p_auth_user_id
     and r.purpose='vendor_login' and r.state='claimed'
     and r.verified_webhook_id ~ '^[A-Za-z0-9._:-]{1,200}$'
     and r.created_at>now()-interval '10 minutes'
     and r.created_at<=now()+interval '30 seconds';
  if not found or not exists (
    select 1 from public.communication_messages m
     where m.message_type='vendor_login_otp' and m.lane='authentication'
       and m.channel='whatsapp' and m.recipient_type='vendor'
       and m.entity_type='auth_user' and m.entity_id=p_auth_user_id
       and m.destination_hash=p_destination_hash
       and m.provider=p_provider_key
       and m.correlation_id=v_webhook_id
       and m.status in ('accepted','sent','delivered','read')
       and m.created_at>=v_claim_at-interval '30 seconds'
       and m.created_at>now()-interval '10 minutes'
       and m.created_at<=now()+interval '30 seconds'
  ) then
    return query select 'otp_proof_required'::text,null::uuid; return;
  end if;

  -- Inspect every historical business before deciding whether to create or
  -- resume. A legacy NULL user_id owner of this phone is a conflict, not a
  -- public permission to seize that vendor.
  select count(*) into v_count from public.vendors where user_id=p_auth_user_id;
  if v_count>1 then
    return query select 'ownership_conflict'::text,null::uuid; return;
  end if;
  select id,phone into v_existing_id,v_existing_phone from public.vendors
   where user_id=p_auth_user_id limit 1;

  select count(*) into v_count from public.vendors where phone=v_mobile;
  if v_count>1 then
    return query select 'ownership_conflict'::text,null::uuid; return;
  end if;
  select id,user_id into v_new_id,v_existing_owner from public.vendors
   where phone=v_mobile limit 1;
  if (v_new_id is not null and
       (v_existing_id is distinct from v_new_id or v_existing_owner is distinct from p_auth_user_id))
     or (v_existing_id is not null and
       (v_new_id is distinct from v_existing_id or v_existing_phone is distinct from v_mobile)) then
    return query select 'ownership_conflict'::text,null::uuid; return;
  end if;

  select count(*) into v_count from public.vendor_dashboard_users where user_id=p_auth_user_id;
  if v_count>1 then
    return query select 'ownership_conflict'::text,null::uuid; return;
  end if;
  select vendor_id,role,status into v_mapping_vendor,v_mapping_role,v_mapping_status
    from public.vendor_dashboard_users where user_id=p_auth_user_id limit 1;

  if v_existing_id is not null then
    if v_mapping_vendor is distinct from v_existing_id
       or v_mapping_role is distinct from 'owner'
       or v_mapping_status is distinct from 'active'
       or v_profile_role is distinct from 'vendor' then
      return query select 'owner_repair_required'::text,v_existing_id; return;
    end if;
    return query select 'resume_existing'::text,v_existing_id; return;
  end if;
  if v_mapping_vendor is not null then
    return query select 'ownership_conflict'::text,null::uuid; return;
  end if;

  -- Never adopt an unclaimed historical mapping or reassign a vendor owner.
  if exists(select 1 from public.vendor_dashboard_users
            where phone in (v_mobile,'+91'||v_mobile) and user_id is distinct from p_auth_user_id) then
    return query select 'owner_repair_required'::text,null::uuid; return;
  end if;

  -- Transaction begins and ends inside this single RPC. Unknown JSONB keys
  -- (status, credits, paid, role, zone, lat, consent time, visibility) are
  -- deliberately ignored and can NEVER change the written constants.
  insert into public.vendors (
    user_id,business_name,owner_name,phone,whatsapp_number,email,city,
    service_categories,gst_number,google_place_id,formatted_address,
    office_address_line1,office_state,office_city,
    registration_consent_version,registration_consent_accepted_at,
    status,verification_status,paid_status,is_active,accepting_leads,
    public_visibility,total_credits,remaining_credits,
    location_verification_status,service_zone_id,office_latitude,office_longitude
  ) values (
    p_auth_user_id,v_business,v_owner,v_mobile,v_mobile,v_email,v_city,
    v_categories,v_gst,v_place,v_address,v_office,v_state,v_city,
    '2026-11-04-v1',now(),
    'Pending','Pending','Unpaid',false,false,
    false,0,0,'unverified',null,null,null
  ) returning id into v_new_id;

  -- Existing Auth trigger can leave role NULL. It is safe to set only a
  -- neutral profile to the literal vendor role AFTER the OTP/identity proof.
  -- Another non-null role is never overwritten.
  update public.profiles set role='vendor'
   where id=p_auth_user_id and role is null;
  if (select role from public.profiles where id=p_auth_user_id) is distinct from 'vendor' then
    raise exception 'QF_VENDOR_SIGNUP_PROFILE_CONFLICT' using errcode='23514';
  end if;

  insert into public.vendor_dashboard_users (
    vendor_id,user_id,phone,email,role,status,
    phone_verified,whatsapp_otp_enabled,last_login_method,last_login_at
  ) values (
    v_new_id,p_auth_user_id,'+91'||v_mobile,v_email,'owner','active',
    false,false,null,null
  );
  return query select 'created_pending'::text,v_new_id;
end;
$$;

revoke all on function public.qf_register_pending_vendor_atomic(uuid,text,text,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.qf_register_pending_vendor_atomic(uuid,text,text,text,jsonb)
  to service_role;
commit;
