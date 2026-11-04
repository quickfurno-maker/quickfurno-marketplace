-- Synthetic behavioral acceptance: all test subjects are ephemeral and local.
do $$
declare digest text:=repeat('a',64);
        id uuid:='20000000-0000-4000-8000-000000000001';
        auth_user uuid:='00000000-0000-4000-8000-000000000001';
        purpose text;
begin
  if not public.qf_reserve_auth_otp_purpose(digest,'vendor_login',id,120)
    then raise exception 'OTP_RESERVE_FAILED'; end if;
  if public.qf_reserve_auth_otp_purpose(digest,'client_login',
      '20000000-0000-4000-8000-000000000002',120)
    then raise exception 'OTP_CROSS_PURPOSE_COLLISION_ACCEPTED'; end if;
  purpose:=public.qf_claim_auth_otp_purpose(digest,auth_user,'verified-webhook-1');
  if purpose<>'vendor_login' then raise exception 'OTP_CLAIM_BAD_PURPOSE'; end if;
  if public.qf_claim_auth_otp_purpose(digest,auth_user,'verified-webhook-1')<>'vendor_login'
    then raise exception 'OTP_SAME_WEBHOOK_NOT_IDEMPOTENT'; end if;
  if (select count(*) from public.qf_read_claimed_vendor_auth_otp_purpose(digest,auth_user))<>1
    then raise exception 'VENDOR_CLAIM_READ_MISSING'; end if;
  if (select verified_webhook_id from public.qf_read_claimed_vendor_auth_otp_purpose(digest,auth_user))<>'verified-webhook-1'
    then raise exception 'VENDOR_CLAIM_WEBHOOK_DRIFT'; end if;
  if exists(select 1 from public.qf_read_claimed_vendor_auth_otp_purpose(digest,
       '00000000-0000-4000-8000-000000000002'))
    then raise exception 'VENDOR_CLAIM_CROSS_PRINCIPAL'; end if;
  if exists(select 1 from public.qf_read_claimed_vendor_auth_otp_purpose(repeat('b',64),auth_user))
    then raise exception 'VENDOR_CLAIM_CROSS_PHONE'; end if;
  if exists(select 1 from public.qf_read_claimed_vendor_auth_otp_purpose('invalid-digest',auth_user))
    then raise exception 'VENDOR_CLAIM_INVALID_DIGEST'; end if;

  if public.qf_claim_auth_otp_purpose(digest,auth_user,'verified-webhook-2') is not null
    then raise exception 'OTP_DIFFERENT_WEBHOOK_STOLE_RESERVATION'; end if;
  if public.qf_claim_auth_otp_purpose(digest,
      '00000000-0000-4000-8000-000000000002','verified-webhook-1') is not null
    then raise exception 'OTP_DIFFERENT_AUTH_USER_STOLE_RESERVATION'; end if;
  if public.qf_release_auth_otp_purpose(digest,id)
    then raise exception 'OTP_CLAIM_RELEASE_BYPASS'; end if;
  if public.qf_reserve_auth_otp_purpose(repeat('b',64),'vendor_login',
      '20000000-0000-4000-8000-000000000003',0)
    then raise exception 'ZERO_TTL_ALLOWED'; end if;
  if public.qf_reserve_auth_otp_purpose(repeat('b',64),'vendor_login',
      '20000000-0000-4000-8000-000000000003',120) is not true
    then raise exception 'SECOND_RESERVE_FAILED'; end if;
  if public.qf_release_auth_otp_purpose(repeat('b',64),
      '20000000-0000-4000-8000-000000000003') is not true
    then raise exception 'UNCLAIMED_RELEASE_FAILED'; end if;
  raise notice 'PASS atomic OTP purpose/claim/collision/cleanup';
end $$;

do $$
declare case_id uuid := '30000000-0000-4000-8000-000000000001';
        reviewer uuid:= '00000000-0000-4000-8000-000000000001';
        vendor uuid:='10000000-0000-4000-8000-000000000001';
begin
  if public.qf_vendor_verification_case_ready(vendor)
    then raise exception 'EMPTY_CASE_APPROVED'; end if;
  insert into qf_vendor_private.verification_cases
    (id,vendor_id,state,contact_status,identity_status,office_status,
     category_status,zone_status,reviewer_user_id,reviewed_at)
  values (case_id,vendor,'approved','verified','verified','verified',
    'verified','verified',reviewer,now());
  if public.qf_vendor_verification_case_ready(vendor)
    then raise exception 'NO_CONSENT_APPROVED'; end if;
  insert into qf_vendor_private.verification_consents
    (id,case_id,method,notice_version,consented_at)
  values ('40000000-0000-4000-8000-000000000001',
          case_id,'driving_licence','2026-11-04-v1',now());
  if public.qf_vendor_verification_case_ready(vendor)
    then raise exception 'NO_EVIDENCE_APPROVED'; end if;
  insert into qf_vendor_private.verification_evidence
    (case_id,evidence_type,processor_reference,scan_status,evidence_state,reviewed_by,reviewed_at)
  values (case_id,'identity_attestation','synthetic-private-processor-ref',
          'not_applicable','verified',reviewer,now());
  insert into qf_vendor_private.verification_evidence
    (case_id,evidence_type,private_storage_key,scan_status,evidence_state,reviewed_by,reviewed_at)
  values (case_id,'office_proof','private/office/synthetic-example',
          'clean','verified',reviewer,now());
  if public.qf_vendor_verification_case_ready(vendor)
    then raise exception 'NO_DECISION_APPROVED'; end if;
  insert into qf_vendor_private.verification_decisions
    (id,case_id,reviewer_user_id,action,from_state,to_state,reason_code)
  values ('50000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',reviewer,
    'approve','under_review','approved','approved_evidence');
  if not public.qf_vendor_verification_case_ready(vendor)
    then raise exception 'VALID_ALTERNATIVE_ID_NOT_APPROVED'; end if;
  update qf_vendor_private.verification_consents set revoked_at=now()
   where id='40000000-0000-4000-8000-000000000001';
  if public.qf_vendor_verification_case_ready(vendor)
    then raise exception 'REVOKED_CONSENT_STILL_APPROVED'; end if;
  begin
    update qf_vendor_private.verification_decisions set reason_code='tampered';
    raise exception 'MUTABLE_DECISIONS';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS private verification case/consent/immutability';
end $$;

do $$
begin
 if has_schema_privilege('anon','qf_vendor_private','USAGE') or
    has_schema_privilege('authenticated','qf_vendor_private','USAGE') then
      raise exception 'PRIVATE_SCHEMA_BROWSER_EXPOSED'; end if;
 if has_table_privilege('anon','qf_vendor_private.verification_evidence','SELECT') or
    has_table_privilege('authenticated','qf_vendor_private.verification_evidence','SELECT') then
      raise exception 'PRIVATE_EVIDENCE_BROWSER_EXPOSED'; end if;
 if has_function_privilege('anon','public.qf_reserve_auth_otp_purpose(text,text,uuid,integer)','EXECUTE') or
    has_function_privilege('authenticated','public.qf_claim_auth_otp_purpose(text,uuid,text)','EXECUTE') or
    has_function_privilege('anon','public.qf_vendor_verification_case_ready(uuid)','EXECUTE')
    then raise exception 'PRIVATE_FUNCTION_BROWSER_EXPOSED'; end if;
 if has_function_privilege('anon','public.qf_read_claimed_vendor_auth_otp_purpose(text,uuid)','EXECUTE') or
    has_function_privilege('authenticated','public.qf_read_claimed_vendor_auth_otp_purpose(text,uuid)','EXECUTE') then
      raise exception 'VENDOR_CLAIM_RPC_BROWSER_EXPOSED'; end if;
 if not has_function_privilege('service_role','public.qf_read_claimed_vendor_auth_otp_purpose(text,uuid)','EXECUTE') then
      raise exception 'VENDOR_CLAIM_RPC_SERVICE_ROLE_MISSING'; end if;
  if not has_function_privilege('service_role','public.qf_reserve_auth_otp_purpose(text,text,uuid,integer)','EXECUTE')
    then raise exception 'SERVICE_ROLE_FUNCTION_MISSING'; end if;
 if (select count(*) from pg_class c join pg_namespace n on c.relnamespace=n.oid
    where n.nspname='qf_vendor_private' and c.relkind='r' and c.relrowsecurity)=0
    then raise exception 'PRIVATE_RLS_MISSING'; end if;
 raise notice 'PASS private RLS/roles/function grants';
end $$;
