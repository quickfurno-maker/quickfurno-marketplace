-- Batch5: isolated PostgreSQL17 Owner case decision + assignment safety
-- No provider, public signup, live credits or managed database effects.
do $$
declare
 owner_id uuid:='00000000-0000-4000-8000-000000000005';
 wrong_id uuid:='00000000-0000-4000-8000-000000000002';
 vendor_id uuid;
 v_case_id uuid:='30000000-0000-4000-8000-000000000008';
 state text;
 snap jsonb;
 decision_count bigint;
begin
 select v.id into vendor_id from public.vendors v
   where v.user_id='00000000-0000-4000-8000-000000000001';
 if vendor_id is null then raise exception 'B5_PENDING_VENDOR_MISSING'; end if;
 snap:=public.qf_vendor_owner_review_snapshot(vendor_id);
 if snap->>'casePresent' <> 'false'
    or snap->>'readyForCoreApproval' <> 'false'
   then raise exception 'B5_MISSING_CASE_WAS_READY'; end if;

 insert into qf_vendor_private.verification_cases
   (id,vendor_id,case_version,state,contact_status,identity_status,
    office_status,category_status,zone_status)
 values (case_id,vendor_id,1,'pending','verified','verified',
         'verified','verified','verified');

 state:=public.qf_owner_record_vendor_verification_decision(
   vendor_id,wrong_id,'approve','approved_evidence');
 if state <> 'owner_required' then raise exception 'B5_NONOWNER_DECIDED'; end if;
 state:=public.qf_owner_record_vendor_verification_decision(
   vendor_id,owner_id,'approve','approved_evidence');
 if state <> 'evidence_required' then raise exception 'B5_UNPROVEN_CASE_APPROVED'; end if;
 if exists(select 1 from qf_vendor_private.verification_decisions where d.case_id=v_case_id) then
   raise exception 'B5_FALSE_AUDIT_CREATED'; end if;

 state:=public.qf_owner_record_vendor_verification_decision(
   vendor_id,owner_id,'request_documents','identity_proof_missing');
 if state <> 'documents_requested' then raise exception 'B5_DOCUMENT_REQUEST_DENIED'; end if;
 state:=public.qf_owner_record_vendor_verification_decision(
   vendor_id,owner_id,'request_correction','office_address_issue');
 if state <> 'needs_correction' then raise exception 'B5_CORRECTION_DENIED'; end if;

 insert into qf_vendor_private.verification_consents
  (case_id,method,notice_version,consented_at)
 values (case_id,'driving_licence','2026-11-04-v1',now());
 insert into qf_vendor_private.verification_evidence
  (case_id,evidence_type,processor_reference,scan_status,evidence_state,reviewed_by,reviewed_at)
 values (case_id,'identity_attestation','synthetic-private-id-ref',
         'not_applicable','verified',owner_id,now());
 insert into qf_vendor_private.verification_evidence
  (case_id,evidence_type,private_storage_key,scan_status,evidence_state,reviewed_by,reviewed_at)
 values (case_id,'office_proof','private/synthetic/office-ref',
         'clean','verified',owner_id,now());

 state:=public.qf_owner_record_vendor_verification_decision(
   vendor_id,owner_id,'approve','approved_evidence');
 if state <> 'approved' then raise exception 'B5_OWNER_APPROVAL_FAILED %',state; end if;
 if public.qf_vendor_verification_case_ready(vendor_id) is not true
   then raise exception 'B5_COMPLETE_REVIEW_NOT_READY'; end if;
 snap:=public.qf_vendor_owner_review_snapshot(vendor_id);
 if snap->>'readyForCoreApproval' <> 'true'
    or snap->>'identityEvidenceVerified' <> 'true'
    or snap->>'officeEvidenceVerified' <> 'true'
    or snap->>'consentValid' <> 'true'
   then raise exception 'B5_PRIVATE_REVIEW_SNAPSHOT_MISSING_FLAGS'; end if;
 if snap::text like '%synthetic-private%' or snap::text like '%private/synthetic%'
   then raise exception 'B5_PRIVATE_STORAGE_KEY_EXPOSED'; end if;
 select count(*) into decision_count
  from qf_vendor_private.verification_decisions d where d.case_id=v_case_id;
 if decision_count <> 3 then raise exception 'B5_IMMUTABLE_AUDIT_COUNT_DRIFT %',decision_count; end if;
 state:=public.qf_owner_record_vendor_verification_decision(
   vendor_id,owner_id,'approve','approved_evidence');
 if state <> 'case_not_reviewable' then raise exception 'B5_DUPLICATE_APPROVAL'; end if;
 if (select count(*) from qf_vendor_private.verification_decisions d where d.case_id=v_case_id)<>3
   then raise exception 'B5_DUPLICATE_DECISION_INSERTED'; end if;
 raise notice 'PASS Owner review: AAL2 backend gate, private evidence, immutable audit, no PII projection';
end $$;

do $$
declare
 good_vendor uuid;
 other_vendor uuid:='10000000-0000-4000-8000-000000000001';
 rejected boolean:=false;
begin
 select id into good_vendor from public.vendors
  where user_id='00000000-0000-4000-8000-000000000001';
 if good_vendor is null then raise exception 'B5_VENDOR_NOT_FOUND'; end if;
 insert into public.lead_assignments(id,lead_id,vendor_id,lifecycle_status)
 values ('a0000000-0000-4000-8000-000000000001',
         '90000000-0000-4000-8000-000000000001',good_vendor,'assigned');

 begin
  insert into public.lead_assignments(id,lead_id,vendor_id,lifecycle_status)
    values ('a0000000-0000-4000-8000-000000000002',
            '90000000-0000-4000-8000-000000000002',other_vendor,'assigned');
 exception when others then
  if sqlerrm <> 'QF_VENDOR_ASSIGNMENT_VERIFICATION_REQUIRED' then raise; end if;
  rejected:=true;
 end;
 if rejected is not true then raise exception 'B5_UNVERIFIED_VENDOR_ASSIGNED'; end if;
 if exists(select 1 from public.lead_assignments where
   id='a0000000-0000-4000-8000-000000000002')
   then raise exception 'B5_UNVERIFIED_ASSIGNMENT_PERSISTED'; end if;

 -- Revocation affects new assignments immediately, not legitimate lifecycle
 -- completion of contact already underway for previously assigned leads.
 update qf_vendor_private.verification_consents
   set revoked_at=now() where case_id=(
     select c.id from qf_vendor_private.verification_cases c
      where c.vendor_id=good_vendor and c.case_version=1);
 rejected:=false;
 begin
  insert into public.lead_assignments(id,lead_id,vendor_id,lifecycle_status)
    values ('a0000000-0000-4000-8000-000000000003',
            '90000000-0000-4000-8000-000000000003',good_vendor,'assigned');
 exception when others then
  if sqlerrm <> 'QF_VENDOR_ASSIGNMENT_VERIFICATION_REQUIRED' then raise; end if;
  rejected:=true;
 end;
 if rejected is not true then raise exception 'B5_REVOKED_CONSENT_ASSIGNMENT_ACCEPTED'; end if;
 update public.lead_assignments
   set lifecycle_status='delivered'
  where id='a0000000-0000-4000-8000-000000000001';
 if (select lifecycle_status from public.lead_assignments
     where id='a0000000-0000-4000-8000-000000000001') <> 'delivered'
   then raise exception 'B5_HISTORIC_DELIVERY_TRANSITION_BLOCKED'; end if;

 -- A stale prior approval cannot win over a more recent Pending case.
 insert into qf_vendor_private.verification_cases
 (vendor_id,case_version,state,contact_status,identity_status,
  office_status,category_status,zone_status)
 values (good_vendor,2,'pending','pending','pending','pending','pending','pending');
 if public.qf_vendor_verification_case_ready(good_vendor) is true
   then raise exception 'B5_OLD_APPROVAL_OVERRIDE_LATEST'; end if;
 raise notice 'PASS assignment gate: unverified and revoked denied; existing delivery and latest-case supersession safe';
end $$;

do $$
begin
 if has_function_privilege('anon',
   'public.qf_owner_record_vendor_verification_decision(uuid,uuid,text,text)','EXECUTE')
   or has_function_privilege('authenticated',
   'public.qf_owner_record_vendor_verification_decision(uuid,uuid,text,text)','EXECUTE')
   or has_function_privilege('anon',
   'public.qf_vendor_owner_review_snapshot(uuid)','EXECUTE')
   or has_function_privilege('authenticated',
   'public.qf_vendor_owner_review_snapshot(uuid)','EXECUTE')
 then raise exception 'B5_BROWSER_OWNER_REVIEW_RPC_EXPOSED'; end if;
 if not has_function_privilege('service_role',
   'public.qf_owner_record_vendor_verification_decision(uuid,uuid,text,text)','EXECUTE')
 then raise exception 'B5_SERVICE_ROLE_OWNER_REVIEW_MISSING'; end if;
 if exists(select 1 from public.vendors where status='Approved'
   and user_id='00000000-0000-4000-8000-000000000001')
 then raise exception 'B5_PRIVATE_REVIEW_CHANGED_VENDOR_STATUS'; end if;
 raise notice 'PASS service-role Owner review boundary; vendor remains Pending';
end $$;
