-- QuickFurno Batch 8: local ClamAV scan handoff, quarantine receipts.
-- SOURCE ONLY. NEVER APPLY TO MANAGED STAGING OR PRODUCTION FROM THIS PR.
-- No browser, vendor or VOX Owner role can mark uploaded evidence scan-clean.
-- Separate independent document authenticity review is still mandatory.
begin;

create table if not exists qf_vendor_private.verification_scan_receipts (
  id uuid primary key default gen_random_uuid(),
  evidence_id uuid not null unique references qf_vendor_private.verification_evidence(id) on delete restrict,
  case_id uuid not null references qf_vendor_private.verification_cases(id) on delete restrict,
  content_sha256 text not null check(content_sha256 ~ '^[0-9a-f]{64}$'),
  scanner_engine text not null check(scanner_engine='clamav_local'),
  scanner_build text not null check(scanner_build ~ '^[a-zA-Z0-9._-]{3,48}$'),
  verdict text not null check(verdict in ('clean','infected')),
  recorded_at timestamptz not null default now()
);
alter table qf_vendor_private.verification_scan_receipts enable row level security;
revoke all on qf_vendor_private.verification_scan_receipts from public,anon,authenticated;
-- Immutable: no overwriting the first result or erasing a malware finding.
drop trigger if exists verification_scan_receipts_immutable on qf_vendor_private.verification_scan_receipts;
create trigger verification_scan_receipts_immutable
 before update or delete on qf_vendor_private.verification_scan_receipts
 for each row execute function qf_vendor_private.block_decision_mutation();

-- Defense in depth: neither stale clean flags nor Owner review case decisions
-- can satisfy new assignment eligibility without an immutable genuine local
-- scanner receipt. Previously approved cases lacking this proof FAIL CLOSED.
create or replace function public.qf_vendor_verification_case_ready(
  p_vendor_id uuid
) returns boolean language sql stable security definer set search_path=pg_catalog
as $
  select exists (
    select 1 from qf_vendor_private.verification_cases c
    where c.vendor_id=p_vendor_id
      and c.case_version=(select max(n.case_version)
                          from qf_vendor_private.verification_cases n
                          where n.vendor_id=p_vendor_id)
      and c.state='approved'
      and c.contact_status='verified' and c.identity_status='verified'
      and c.office_status='verified' and c.category_status='verified'
      and c.zone_status='verified'
      and c.reviewer_user_id is not null and c.reviewed_at is not null
      and (c.expires_at is null or c.expires_at>now())
      and exists (
        select 1 from qf_vendor_private.verification_consents consent
         where consent.case_id=c.id and consent.revoked_at is null
           and consent.consented_at<=now()
      )
      and exists (
        select 1 from qf_vendor_private.verification_evidence identity_doc
         where identity_doc.case_id=c.id
           and identity_doc.evidence_type='identity_attestation'
           and identity_doc.evidence_state='verified'
           and identity_doc.scan_status in ('clean','not_applicable')
           and identity_doc.reviewed_by is not null
           and identity_doc.reviewed_at is not null
           and (identity_doc.processor_reference is not null
                or identity_doc.private_storage_key is not null)
           and (identity_doc.expires_at is null or identity_doc.expires_at>now())
      )
      and exists (
        select 1 from qf_vendor_private.verification_evidence office_doc
         where office_doc.case_id=c.id
           and office_doc.evidence_type='office_proof'
           and office_doc.evidence_state='verified'
           and office_doc.scan_status='clean'
           and exists (
             select 1 from qf_vendor_private.verification_scan_receipts scan
              where scan.evidence_id=office_doc.id
                and scan.case_id=office_doc.case_id
                and scan.content_sha256=office_doc.content_sha256
                and scan.scanner_engine='clamav_local'
                and scan.verdict='clean'
           )
           and office_doc.private_storage_key is not null
           and office_doc.reviewed_by is not null
           and office_doc.reviewed_at is not null
           and (office_doc.expires_at is null or office_doc.expires_at>now())
      )
      and exists (
        select 1 from qf_vendor_private.verification_decisions decision
         where decision.case_id=c.id
           and decision.action='approve'
           and decision.to_state='approved'
           and decision.reviewer_user_id=c.reviewer_user_id
      )
  );
$;
create or replace function public.qf_vendor_owner_review_snapshot(
  p_vendor_id uuid
) returns jsonb language plpgsql stable security definer
set search_path=pg_catalog as $
declare
  c qf_vendor_private.verification_cases%rowtype;
  v_consent boolean;
  v_identity boolean;
  v_office boolean;
  v_ready boolean;
begin
  if p_vendor_id is null then return null; end if;
  select * into c from qf_vendor_private.verification_cases v
    where v.vendor_id=p_vendor_id
    order by v.case_version desc limit 1;
  if not found then
    return jsonb_build_object('casePresent',false,'readyForCoreApproval',false);
  end if;
  select exists(select 1 from qf_vendor_private.verification_consents x
                where x.case_id=c.id and x.revoked_at is null
                  and x.consented_at<=now()) into v_consent;
  select exists(select 1 from qf_vendor_private.verification_evidence x
                where x.case_id=c.id and x.evidence_type='identity_attestation'
                  and x.evidence_state='verified'
                  and x.reviewed_by is not null and x.reviewed_at is not null
                  and x.scan_status in ('clean','not_applicable')
                  and (x.processor_reference is not null or x.private_storage_key is not null)
                  and (x.expires_at is null or x.expires_at>now())) into v_identity;
  select exists(select 1 from qf_vendor_private.verification_evidence x
                where x.case_id=c.id and x.evidence_type='office_proof'
                  and x.evidence_state='verified' and x.scan_status='clean'
           and exists (
             select 1 from qf_vendor_private.verification_scan_receipts scan
              where scan.evidence_id=x.id
                and scan.case_id=x.case_id
                and scan.content_sha256=x.content_sha256
                and scan.scanner_engine='clamav_local'
                and scan.verdict='clean'
           )
                  and x.private_storage_key is not null
                  and x.reviewed_by is not null and x.reviewed_at is not null
                  and (x.expires_at is null or x.expires_at>now())) into v_office;
  v_ready:=public.qf_vendor_verification_case_ready(p_vendor_id);
  return jsonb_build_object(
    'casePresent',true, 'caseId',c.id, 'caseVersion',c.case_version,
    'state',c.state,
    'contactStatus',c.contact_status,
    'identityStatus',c.identity_status,
    'officeStatus',c.office_status,
    'categoryStatus',c.category_status,
    'zoneStatus',c.zone_status,
    'consentValid',v_consent,
    'identityEvidenceVerified',v_identity,
    'officeEvidenceVerified',v_office,
    'reviewed',c.reviewer_user_id is not null,
    'readyForCoreApproval',v_ready
  );
end;
$;

-- Worker-only, bounded fetch. Storage keys never leave the server-held service
-- role process and must not be copied into VOX or any public JSON response.
create or replace function public.qf_vendor_private_scan_queue()
returns jsonb language sql stable security definer set search_path=pg_catalog
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'evidenceId',q.id, 'caseId',q.case_id,
    'vendorId',q.vendor_id, 'caseVersion',q.case_version,
    'storageKey',q.private_storage_key,'sha256',q.content_sha256
  ) order by q.created_at,q.id),'[]'::jsonb)
  from (
    select e.id,e.case_id,c.vendor_id,c.case_version,
           e.private_storage_key,e.content_sha256,e.created_at
    from qf_vendor_private.verification_evidence e
    join qf_vendor_private.verification_cases c on c.id=e.case_id
    join public.vendors v on v.id=c.vendor_id
    where e.evidence_type in ('office_proof','category_proof')
      and e.scan_status='pending' and e.evidence_state='pending'
      and e.private_storage_key is not null
      and e.content_sha256 ~ '^[0-9a-f]{64}$'
      and e.private_storage_key ~ (
        '^vendors/'||c.vendor_id::text||
        '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](pdf|png|jpg)$'
      )
      and c.case_version=(select max(n.case_version)
        from qf_vendor_private.verification_cases n where n.vendor_id=c.vendor_id)
      and c.state in ('pending','documents_requested','needs_correction')
      and (c.expires_at is null or c.expires_at>now())
      and v.status='Pending' and v.is_active=false
      and v.accepting_leads=false and v.public_visibility=false
      and exists(select 1 from qf_vendor_private.verification_consents consent
        where consent.case_id=c.id and consent.revoked_at is null
          and consent.consented_at<=now())
      and not exists(select 1 from qf_vendor_private.verification_scan_receipts r
        where r.evidence_id=e.id)
    order by e.created_at,e.id
    limit 4
  ) q;
$$;
revoke all on function public.qf_vendor_private_scan_queue()
 from public,anon,authenticated;
grant execute on function public.qf_vendor_private_scan_queue() to service_role;

-- A scan result is recorded ONLY after a verified backend scanner compared
-- the downloaded bytes to the original SHA256 and received an actual ClamAV
-- verdict. This RPC is a narrow internal storage ledger, not a scan engine.
create or replace function public.qf_vendor_record_private_scan(
  p_evidence_id uuid,p_expected_sha256 text,p_verdict text,p_scanner_build text
) returns text
language plpgsql security definer set search_path=pg_catalog
as $$
declare
  v_vendor_id uuid;
  v_case_id uuid;
  v_eligible boolean;
begin
  if p_evidence_id is null or p_expected_sha256 is null
    or p_expected_sha256 !~ '^[0-9a-f]{64}$'
    or p_verdict is null or p_verdict not in ('clean','infected')
    or p_scanner_build is null
    or p_scanner_build !~ '^[a-zA-Z0-9._-]{3,48}$'
    then return 'denied';end if;

  select c.vendor_id,c.id into v_vendor_id,v_case_id
   from qf_vendor_private.verification_evidence e
    join qf_vendor_private.verification_cases c on c.id=e.case_id
   where e.id=p_evidence_id;
  if v_vendor_id is null then return 'denied';end if;

  perform pg_advisory_xact_lock(
    hashtextextended('qf:vendor:private-case:'||v_vendor_id::text,721630)
  );
  select exists(
    select 1 from qf_vendor_private.verification_evidence e
    join qf_vendor_private.verification_cases c on c.id=e.case_id
    join public.vendors v on v.id=c.vendor_id
    where e.id=p_evidence_id and c.id=v_case_id
      and e.evidence_type in ('office_proof','category_proof')
      and e.scan_status='pending' and e.evidence_state='pending'
      and e.content_sha256=p_expected_sha256
      and e.private_storage_key ~ (
        '^vendors/'||v_vendor_id::text||
        '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](pdf|png|jpg)$')
      and c.case_version=(select max(n.case_version)
        from qf_vendor_private.verification_cases n where n.vendor_id=c.vendor_id)
      and c.state in ('pending','documents_requested','needs_correction')
      and (c.expires_at is null or c.expires_at>now())
      and v.status='Pending' and v.is_active=false
      and v.accepting_leads=false and v.public_visibility=false
      and exists(select 1 from qf_vendor_private.verification_consents consent
       where consent.case_id=c.id and consent.revoked_at is null
        and consent.consented_at<=now())
      and not exists(select 1 from qf_vendor_private.verification_scan_receipts receipt
       where receipt.evidence_id=e.id)
  ) into v_eligible;
  if not v_eligible then return 'denied';end if;

  -- The identical vendor advisory lock serializes this check with evidence
  -- intake and consent version changes made through the governed Core RPCs.
  insert into qf_vendor_private.verification_scan_receipts
    (evidence_id,case_id,content_sha256,scanner_engine,scanner_build,verdict)
  values(p_evidence_id,v_case_id,p_expected_sha256,'clamav_local',
         p_scanner_build,p_verdict);

  update qf_vendor_private.verification_evidence
    set scan_status=case when p_verdict='clean' then 'clean' else 'rejected' end,
        evidence_state=case when p_verdict='clean' then 'pending' else 'rejected' end
    where id=p_evidence_id and scan_status='pending' and evidence_state='pending';

  if not found then raise exception 'VENDOR_SCAN_RESULT_CONFLICT'
    using errcode='40001';end if;
  return case when p_verdict='clean' then 'clean' else 'rejected' end;
end;
$$;
revoke all on function public.qf_vendor_record_private_scan(uuid,text,text,text)
 from public,anon,authenticated;
grant execute on function public.qf_vendor_record_private_scan(uuid,text,text,text)
 to service_role;

do $$
begin
 if has_function_privilege('anon','public.qf_vendor_private_scan_queue()','EXECUTE')
  or has_function_privilege('authenticated','public.qf_vendor_private_scan_queue()','EXECUTE')
  or has_function_privilege('anon',
        'public.qf_vendor_record_private_scan(uuid,text,text,text)','EXECUTE')
  or has_function_privilege('authenticated',
        'public.qf_vendor_record_private_scan(uuid,text,text,text)','EXECUTE')
 then raise exception 'PRIVATE_SCAN_BROWSER_GRANT';end if;
end;
$$;
commit;
