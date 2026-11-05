-- Batch 8 synthetic PostgreSQL17 acceptance for private scanner quarantine.
-- This is NOT a real malware detection test; ClamAV transport is separate.
do $$
declare
 v_owner uuid:='00000000-0000-4000-8000-000000000007';
 v_vendor uuid:='10000000-0000-4000-8000-000000000007';
 v_case uuid;
 v_doc uuid;
 v_infected uuid;
 v_stale uuid;
 v_queue jsonb;
 v_key text;
begin
 insert into auth.users(id,phone,phone_confirmed_at)
  values(v_owner,'+919999999997',now());
 insert into public.profiles(id,role,is_active)
  values(v_owner,'vendor',true);
 insert into public.vendors(
  id,user_id,business_name,owner_name,phone,whatsapp_number,
  city,status,verification_status,paid_status,is_active,
  accepting_leads,public_visibility)
 values(v_vendor,v_owner,'Synthetic Scanner Vendor','Owner Seven',
 '9999999997','9999999997','Pune','Pending','Pending','Unpaid',
 false,false,false);
 insert into public.vendor_dashboard_users(vendor_id,user_id,phone,role,status)
 values(v_vendor,v_owner,'+919999999997','owner','active');

 v_case:=public.qf_vendor_begin_private_verification_case(
  v_vendor,v_owner,'driving_licence','2026-11-04-v1');
 if v_case is null then raise exception 'B8_CASE_NOT_CREATED';end if;
 v_key:='vendors/'||v_vendor::text||'/70000000-0000-4000-8000-000000000007.pdf';
 v_doc:=public.qf_vendor_attach_private_evidence(
  v_vendor,v_owner,v_case,'office_proof',v_key,repeat('a',64));
 if v_doc is null then raise exception 'B8_PENDING_DOCUMENT_MISSING';end if;
 v_queue:=public.qf_vendor_private_scan_queue();
 if jsonb_typeof(v_queue)<>'array' or jsonb_array_length(v_queue)>4
    or not exists(
    select 1 from jsonb_array_elements(v_queue) x
     where x->>'evidenceId'=v_doc::text
       and x->>'sha256'=repeat('a',64)
       and x->>'storageKey'=v_key
       and x->>'caseVersion'='1')
 then raise exception 'B8_PRIVATE_PENDING_QUEUE_MISSING';end if;
 if exists (select 1 from jsonb_array_elements(v_queue) x
    where x->>'vendorId'='10000000-0000-4000-8000-000000000006')
 then raise exception 'B8_REVOKED_CONSENT_IN_SCAN_QUEUE';end if;
 if public.qf_vendor_record_private_scan(v_doc,repeat('b',64),
     'clean','ClamAV_local_engine_v1')<>'denied'
 then raise exception 'B8_HASH_MISMATCH_SCAN_ACCEPTED';end if;
 if public.qf_vendor_record_private_scan(v_doc,repeat('a',64),
     'not_scanned','ClamAV_local_engine_v1')<>'denied'
 then raise exception 'B8_BYPASS_SCAN_VERDICT';end if;
 if public.qf_vendor_record_private_scan(v_doc,repeat('a',64),
     'clean','untrusted string with whitespace')<>'denied'
 then raise exception 'B8_UNTRUSTED_BUILD';end if;
 if public.qf_vendor_record_private_scan(v_doc,repeat('a',64),
     'clean','ClamAV_local_engine_v1')<>'clean'
 then raise exception 'B8_SCAN_VERDICT_NOT_RECORDED';end if;
 if not exists(
  select 1 from qf_vendor_private.verification_evidence e
   join qf_vendor_private.verification_scan_receipts r on r.evidence_id=e.id
  where e.id=v_doc and e.scan_status='clean'
   and e.evidence_state='pending' and e.reviewed_by is null
   and r.verdict='clean' and r.scanner_engine='clamav_local'
   and r.content_sha256=repeat('a',64))
 then raise exception 'B8_SCAN_FALSELY_APPROVED_OR_RECEIPT_MISSING';end if;
 if public.qf_vendor_record_private_scan(v_doc,repeat('a',64),
     'infected','ClamAV_local_engine_v1')<>'denied'
 then raise exception 'B8_DUPLICATE_REPLAY_ACCEPTED';end if;

 v_infected:=public.qf_vendor_attach_private_evidence(
  v_vendor,v_owner,v_case,'category_proof',
  'vendors/'||v_vendor::text||'/70000000-0000-4000-8000-000000000008.pdf',
  repeat('c',64));
 if v_infected is null then raise exception 'B8_INFECTED_SAMPLE_MISSING';end if;
 if public.qf_vendor_record_private_scan(v_infected,repeat('c',64),
     'infected','ClamAV_local_engine_v1')<>'rejected'
 then raise exception 'B8_QUARANTINE_REJECTION_MISSING';end if;
 if not exists(select 1 from qf_vendor_private.verification_evidence
   where id=v_infected and scan_status='rejected'
     and evidence_state='rejected' and reviewed_by is null)
 then raise exception 'B8_INFECTED_DOC_NOT_QUARANTINED';end if;
 if public.qf_vendor_verification_case_ready(v_vendor)
 then raise exception 'B8_SCAN_GRANTED_OWNER_APPROVAL';end if;

 v_stale:=public.qf_vendor_attach_private_evidence(
  v_vendor,v_owner,v_case,'office_proof',
  'vendors/'||v_vendor::text||'/70000000-0000-4000-8000-000000000009.png',
  repeat('d',64));
 if v_stale is null then raise exception 'B8_STALE_DOC_MISSING';end if;
 update qf_vendor_private.verification_consents set revoked_at=now()
  where case_id=v_case;
 if public.qf_vendor_record_private_scan(v_stale,repeat('d',64),
   'clean','ClamAV_local_engine_v1')<>'denied'
 then raise exception 'B8_REVOKED_CASE_SCAN_COMMITTED';end if;
 if exists(select 1 from jsonb_array_elements(public.qf_vendor_private_scan_queue()) item
   where item->>'evidenceId'=v_stale::text)
 then raise exception 'B8_REVOKED_CASE_SCAN_QUEUED';end if;
 raise notice 'PASS B8 pending-only, checksum, clean != approved, infected quarantine, duplicate and consent revocation';
end;
$$;

do $$
declare rid uuid;
begin
 select id into rid from qf_vendor_private.verification_scan_receipts limit 1;
 if rid is null then raise exception 'B8_NO_RECEIPTS';end if;
 begin
  delete from qf_vendor_private.verification_scan_receipts where id=rid;
  raise exception 'B8_MUTATION_TRIGGER_NOT_ENFORCED';
 exception when sqlstate '42501' then null;
 end;
 if has_function_privilege('anon','public.qf_vendor_private_scan_queue()','EXECUTE')
 or has_function_privilege('authenticated','public.qf_vendor_private_scan_queue()','EXECUTE')
 or has_function_privilege('anon',
  'public.qf_vendor_record_private_scan(uuid,text,text,text)','EXECUTE')
 or has_function_privilege('authenticated',
  'public.qf_vendor_record_private_scan(uuid,text,text,text)','EXECUTE')
 then raise exception 'B8_BROWSER_SCAN_PRIVILEGE';end if;
 raise notice 'PASS B8 immutable receipts and service-role-only scan RPC';
end;$$;

-- Negative bypass acceptance: simply changing an office proof to 'clean'
-- without a matching immutable scanner receipt is insufficient for Owner
-- readiness, even if the case status and approval decision are forged.
do $$
declare
 v_owner uuid:='00000000-0000-4000-8000-000000000008';
 v_vendor uuid:='10000000-0000-4000-8000-000000000008';
 v_reviewer uuid:='00000000-0000-4000-8000-000000000001';
 v_case uuid;
 v_office uuid;
 v_sha text:=repeat('e',64);
begin
 insert into auth.users(id,phone,phone_confirmed_at)
  values(v_owner,'+919999999998',now());
 insert into public.profiles(id,role,is_active)
  values(v_owner,'vendor',true);
 insert into public.vendors(id,user_id,business_name,owner_name,
   phone,whatsapp_number,city,status,verification_status,paid_status,
   is_active,accepting_leads,public_visibility)
 values(v_vendor,v_owner,'Synthetic Unscanned Office','Owner Eight',
 '9999999998','9999999998','Pune','Pending','Pending','Unpaid',
 false,false,false);
 insert into public.vendor_dashboard_users(vendor_id,user_id,phone,role,status)
 values(v_vendor,v_owner,'+919999999998','owner','active');

 v_case:=public.qf_vendor_begin_private_verification_case(
  v_vendor,v_owner,'driving_licence','2026-11-04-v1');
 if v_case is null then raise exception 'B8_UNSCANNED_CASE_SETUP_FAILED';end if;
 insert into qf_vendor_private.verification_evidence
  (case_id,evidence_type,scan_status,evidence_state,
   processor_reference,reviewed_by,reviewed_at)
 values(v_case,'identity_attestation','not_applicable','verified',
 'synthetic_offline_identity_attestation',v_reviewer,now());
 insert into qf_vendor_private.verification_evidence
  (case_id,evidence_type,scan_status,evidence_state,
   private_storage_key,content_sha256,reviewed_by,reviewed_at)
 values(v_case,'office_proof','clean','verified',
  'vendors/'||v_vendor::text||'/70000000-0000-4000-8000-000000000010.pdf',
  v_sha,v_reviewer,now())
 returning id into v_office;
 update qf_vendor_private.verification_cases
   set state='approved',contact_status='verified',identity_status='verified',
       office_status='verified',category_status='verified',zone_status='verified',
       reviewer_user_id=v_reviewer,reviewed_at=now()
 where id=v_case;
 insert into qf_vendor_private.verification_decisions
  (case_id,reviewer_user_id,action,from_state,to_state,reason_code)
 values(v_case,v_reviewer,'approve','under_review','approved','synthetic_receipt_gate');

 if public.qf_vendor_verification_case_ready(v_vendor)
 then raise exception 'B8_MISSING_SCAN_RECEIPT_BYPASSED_OWNER_GATE';end if;
 if (public.qf_vendor_owner_review_snapshot(v_vendor)->>'officeEvidenceVerified')='true'
 then raise exception 'B8_SNAPSHOT_FALSE_CLEAN_EVIDENCE';end if;

 insert into qf_vendor_private.verification_scan_receipts
   (evidence_id,case_id,content_sha256,scanner_engine,scanner_build,verdict)
 values(v_office,v_case,v_sha,'clamav_local','ClamAV_local_engine_v1','clean');

 if not public.qf_vendor_verification_case_ready(v_vendor)
 then raise exception 'B8_ATTESTED_CLEAN_OWNER_GATE_REFUSED';end if;
 if (public.qf_vendor_owner_review_snapshot(v_vendor)->>'officeEvidenceVerified')<>'true'
 then raise exception 'B8_ATTESTED_SNAPSHOT_NOT_VERIFIED';end if;
 raise notice 'PASS B8 scan receipt mandatory for Owner approval, snapshot and new-assignment gate';
end;$$;
