-- QuickFurno Batch 6 — private vendor office/category proof intake.
-- SOURCE ONLY, Draft PR #484. DO NOT APPLY TO MANAGED STAGING/PRODUCTION.
-- Private storage bucket is provisioned separately under an approved Staging
-- rollout, never exposed as public; no Aadhaar/PAN number or image is stored.
begin;

-- A verified, existing vendor owner may open ONE private review case with
-- explicit offline identity-check consent. No browser grants or case approval.
create or replace function public.qf_vendor_begin_private_verification_case(
  p_vendor_id uuid,
  p_auth_user_id uuid,
  p_identity_method text,
  p_notice_version text
) returns uuid
language plpgsql security definer set search_path=pg_catalog
as $$
declare
  v_case_id uuid;
  v_state text;
  v_version integer;
begin
  if p_vendor_id is null or p_auth_user_id is null
     or p_identity_method not in ('aadhaar_offline','passport','driving_licence','voter_id')
     or p_notice_version is distinct from '2026-11-04-v1'
     then return null; end if;

  -- Account must be in Pending review, already created through verified Auth,
  -- never a client account, and mapped to the exact active vendor owner.
  perform pg_advisory_xact_lock(hashtextextended('qf:vendor:private-case:'||p_vendor_id::text,721630));
  if not exists (
    select 1 from public.vendors v
      join public.vendor_dashboard_users m
        on m.vendor_id=v.id and m.user_id=p_auth_user_id
      join public.profiles p on p.id=p_auth_user_id
      join auth.users u on u.id=p_auth_user_id
    where v.id=p_vendor_id and v.user_id=p_auth_user_id
      and v.status='Pending' and v.is_active=false
      and v.accepting_leads=false and v.public_visibility=false
      and m.role='owner' and m.status='active'
      and p.role='vendor' and u.phone_confirmed_at is not null
      and u.phone='+91'||v.phone
      and not exists(select 1 from public.client_accounts c
         where c.user_id=p_auth_user_id or c.phone_e164=u.phone)
  ) then return null; end if;

  select c.id,c.state,c.case_version into v_case_id,v_state,v_version
   from qf_vendor_private.verification_cases c
   where c.vendor_id=p_vendor_id
   order by c.case_version desc limit 1 for update;
  if found then
    -- Idempotent resume, never re-activate revoked consent or old decisions.
    if v_state not in ('pending','documents_requested','needs_correction') then return null; end if;
    if not exists (
      select 1 from qf_vendor_private.verification_consents consent
       where consent.case_id=v_case_id and consent.revoked_at is null
         and consent.method=p_identity_method
         and consent.notice_version=p_notice_version
    ) then return null; end if;
    return v_case_id;
  end if;

  insert into qf_vendor_private.verification_cases
    (vendor_id,case_version,state)
  values (p_vendor_id,1,'pending')
  returning id into v_case_id;
  insert into qf_vendor_private.verification_consents
    (case_id,method,notice_version,consented_at)
  values (v_case_id,p_identity_method,p_notice_version,now());
  return v_case_id;
end;
$$;

-- Only actual vendor owner + current active case may attach the server-created
-- opaque storage key. Never trust client scan_status or evidence_state.
create or replace function public.qf_vendor_attach_private_evidence(
  p_vendor_id uuid,
  p_auth_user_id uuid,
  p_case_id uuid,
  p_evidence_type text,
  p_storage_key text,
  p_sha256 text
) returns uuid
language plpgsql security definer set search_path=pg_catalog
as $$
declare
  v_case_id uuid;
  v_evidence_id uuid;
begin
  if p_vendor_id is null or p_auth_user_id is null or p_case_id is null
     or p_evidence_type not in ('office_proof','category_proof')
     or p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$'
     or p_storage_key is null
     or length(p_storage_key)>220
     or p_storage_key !~ ('^vendors/'||p_vendor_id::text||
                '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](pdf|png|jpg)$')
  then return null; end if;

  perform pg_advisory_xact_lock(hashtextextended('qf:vendor:private-case:'||p_vendor_id::text,721630));
  if not exists (
    select 1 from public.vendors v
      join public.vendor_dashboard_users m
       on m.vendor_id=v.id and m.user_id=p_auth_user_id
      join auth.users u on u.id=p_auth_user_id
    where v.id=p_vendor_id and v.user_id=p_auth_user_id
      and v.status='Pending' and v.is_active=false
      and m.role='owner' and m.status='active'
      and u.phone_confirmed_at is not null and u.phone='+91'||v.phone
  ) then return null; end if;

  select c.id into v_case_id from qf_vendor_private.verification_cases c
    where c.vendor_id=p_vendor_id
      and c.id=p_case_id
      and c.state in ('pending','documents_requested','needs_correction')
      and (c.expires_at is null or c.expires_at>now())
      and c.case_version=(select max(n.case_version)
        from qf_vendor_private.verification_cases n where n.vendor_id=p_vendor_id)
      and exists(select 1 from qf_vendor_private.verification_consents x
        where x.case_id=c.id and x.revoked_at is null)
    for update;
  if v_case_id is null then return null; end if;

  insert into qf_vendor_private.verification_evidence
    (case_id,evidence_type,private_storage_key,content_sha256,
     scan_status,evidence_state,uploaded_by)
  values (v_case_id,p_evidence_type,p_storage_key,p_sha256,
          'pending','pending',p_auth_user_id)
  returning id into v_evidence_id;
  return v_evidence_id;
end;
$$;

-- Short-lived signed-storage URLs are not exposed through SQL. All file
-- upload bytes use an authenticated server route with a fixed private bucket.
revoke all on function public.qf_vendor_begin_private_verification_case(uuid,uuid,text,text)
 from public,anon,authenticated;
revoke all on function public.qf_vendor_attach_private_evidence(uuid,uuid,uuid,text,text,text)
 from public,anon,authenticated;
grant execute on function public.qf_vendor_begin_private_verification_case(uuid,uuid,text,text)
 to service_role;
grant execute on function public.qf_vendor_attach_private_evidence(uuid,uuid,uuid,text,text,text)
 to service_role;
commit;
