-- Batch6 private vendor document intake, isolated PostgreSQL 17 only.
-- No Supabase Storage external calls and absolutely no live vendor records.
do $$
declare
 v_owner uuid:='00000000-0000-4000-8000-000000000006';
 v_vendor uuid:='10000000-0000-4000-8000-000000000006';
 v_case uuid;
 v_again uuid;
 v_doc uuid;
 v_key text;
begin
 insert into auth.users(id,phone,phone_confirmed_at) values
  (v_owner,'+919999999996',now());
 insert into public.profiles(id,role,is_active)
  values(v_owner,'vendor',true);
 insert into public.vendors(id,user_id,business_name,owner_name,phone,whatsapp_number,
  city,status,verification_status,paid_status,is_active,accepting_leads,public_visibility)
 values(v_vendor,v_owner,'Synthetic Private Proof','Owner Six','9999999996','9999999996',
  'Pune','Pending','Pending','Unpaid',false,false,false);
 insert into public.vendor_dashboard_users(vendor_id,user_id,phone,role,status)
 values(v_vendor,v_owner,'+919999999996','owner','active');

 if public.qf_vendor_begin_private_verification_case(
  v_vendor,'00000000-0000-4000-8000-000000000001','aadhaar_offline','2026-11-04-v1') is not null
 then raise exception 'B6_FOREIGN_VENDOR_CLAIMED'; end if;
 if public.qf_vendor_begin_private_verification_case(
  v_vendor,v_owner,'aadhaar_offline','wrong_revision') is not null
 then raise exception 'B6_WRONG_NOTICE_ACCEPTED'; end if;
 if public.qf_vendor_begin_private_verification_case(
  v_vendor,v_owner,null,'2026-11-04-v1') is not null
 then raise exception 'B6_NO_IDENTITY_METHOD_ACCEPTED'; end if;

 v_case:=public.qf_vendor_begin_private_verification_case(
  v_vendor,v_owner,'aadhaar_offline','2026-11-04-v1');
 if v_case is null then raise exception 'B6_VENDOR_CASE_NOT_OPENED'; end if;
 v_again:=public.qf_vendor_begin_private_verification_case(
  v_vendor,v_owner,'aadhaar_offline','2026-11-04-v1');
 if v_again is distinct from v_case then
  raise exception 'B6_OPEN_CASE_NOT_IDEMPOTENT'; end if;
 if (select count(*) from qf_vendor_private.verification_cases where vendor_id=v_vendor)<>1
 then raise exception 'B6_DUPLICATE_REVIEW_CASE'; end if;
 if (select count(*) from qf_vendor_private.verification_consents where case_id=v_case)<>1
 then raise exception 'B6_DUPLICATE_IDENTITY_CONSENT'; end if;
 if (select method from qf_vendor_private.verification_consents where case_id=v_case)
    is distinct from 'aadhaar_offline' then raise exception 'B6_METHOD_NOT_RECORDED'; end if;

 v_key:='vendors/'||v_vendor::text||'/70000000-0000-4000-8000-000000000006.pdf';
 v_doc:=public.qf_vendor_attach_private_evidence(
  v_vendor,v_owner,v_case,'office_proof',v_key,repeat('a',64));
 if v_doc is null then raise exception 'B6_PRIVATE_PROOF_NOT_ATTACHED'; end if;
 if not exists (
  select 1 from qf_vendor_private.verification_evidence e
  where e.id=v_doc and e.case_id=v_case and e.private_storage_key=v_key
  and e.scan_status='pending' and e.evidence_state='pending'
  and e.uploaded_by=v_owner and e.reviewed_by is null
 ) then raise exception 'B6_UPLOAD_WAS_FALSELY_VERIFIED'; end if;
 if public.qf_vendor_verification_case_ready(v_vendor)
 then raise exception 'B6_UPLOAD_AUTO_APPROVED'; end if;

 if public.qf_vendor_attach_private_evidence(
   v_vendor,v_owner,v_case,'identity_attestation',v_key,repeat('b',64)) is not null
   then raise exception 'B6_RAW_IDENTITY_IMAGE_ALLOWED'; end if;
 if public.qf_vendor_attach_private_evidence(
   v_vendor,v_owner,v_case,'office_proof','vendors/'||v_vendor||'/../../id.pdf',repeat('b',64)) is not null
   then raise exception 'B6_TRAVERSAL_ACCEPTED'; end if;
 if public.qf_vendor_attach_private_evidence(
   v_vendor,'00000000-0000-4000-8000-000000000001',v_case,
   'office_proof',v_key,repeat('c',64)) is not null
   then raise exception 'B6_CROSS_ACCOUNT_UPLOAD_ALLOWED'; end if;

 update qf_vendor_private.verification_consents set revoked_at=now()
  where case_id=v_case;
 if public.qf_vendor_begin_private_verification_case(
   v_vendor,v_owner,'aadhaar_offline','2026-11-04-v1') is not null
 then raise exception 'B6_REVOKED_CONSENT_RESUMED'; end if;
 if public.qf_vendor_attach_private_evidence(
   v_vendor,v_owner,v_case,'office_proof',v_key,repeat('d',64)) is not null
 then raise exception 'B6_REVOKED_CONSENT_UPLOAD_ALLOWED'; end if;
 raise notice 'PASS private evidence: owner-only, consent, one case, pending scan, revocation';
end $$;

do $$
begin
 if has_function_privilege('anon',
   'public.qf_vendor_begin_private_verification_case(uuid,uuid,text,text)','EXECUTE')
 or has_function_privilege('authenticated',
   'public.qf_vendor_begin_private_verification_case(uuid,uuid,text,text)','EXECUTE')
 or has_function_privilege('anon',
   'public.qf_vendor_attach_private_evidence(uuid,uuid,uuid,text,text,text)','EXECUTE')
 or has_function_privilege('authenticated',
   'public.qf_vendor_attach_private_evidence(uuid,uuid,uuid,text,text,text)','EXECUTE')
 then raise exception 'B6_BROWSER_PRIVATE_RPC_EXPOSED';end if;
 if not has_function_privilege('service_role',
   'public.qf_vendor_attach_private_evidence(uuid,uuid,uuid,text,text,text)','EXECUTE')
 then raise exception 'B6_PRIVATE_SERVICE_ROLE_MISSING';end if;
 raise notice 'PASS private evidence service-only access';
end $$;
