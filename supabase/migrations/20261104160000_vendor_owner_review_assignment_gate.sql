-- QuickFurno Vendor Batch 5 — private Owner decision + new assignment gate.
-- SOURCE ONLY / DRAFT PR #484 / NOT DEPLOYED.
-- Requires 20261104140000 private verification schema and canonical assignment
-- authority. No existing assignment, credit, lead or vendor record is modified.
begin;

-- Preserve the existing evidence checklist, but prevent an expired or revoked
-- *older* approved case from qualifying after a newer review version exists.
-- This updates only the definition of the existing service-role read function.
create or replace function public.qf_vendor_verification_case_ready(
  p_vendor_id uuid
) returns boolean language sql stable security definer set search_path=pg_catalog
as $$
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
$$;
revoke all on function public.qf_vendor_verification_case_ready(uuid)
  from public,anon,authenticated;
grant execute on function public.qf_vendor_verification_case_ready(uuid) to service_role;

-- Owner-only projection: NO document URLs, raw IDs, image bytes, storage keys,
-- phone, GST number, unbounded comments or provider references ever leave it.
-- The API must separately verify a signed Owner AAL2 bearer before calling.
create or replace function public.qf_vendor_owner_review_snapshot(
  p_vendor_id uuid
) returns jsonb language plpgsql stable security definer
set search_path=pg_catalog as $$
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
$$;
revoke all on function public.qf_vendor_owner_review_snapshot(uuid)
  from public,anon,authenticated;
grant execute on function public.qf_vendor_owner_review_snapshot(uuid) to service_role;

-- The signed AAL2 Owner check occurs in VOX, and this service-only function
-- independently requires the permanent Owner's Core profile/app metadata.
-- Never updates private evidence flags or vendor business status. The reviewer
-- may record only a bounded decision state and immutable decision audit.
create or replace function public.qf_owner_record_vendor_verification_decision(
  p_vendor_id uuid,p_reviewer_user_id uuid,p_action text,p_reason_code text
) returns text language plpgsql security definer set search_path=pg_catalog
as $$
declare
  c qf_vendor_private.verification_cases%rowtype;
  v_state text;
  v_ok boolean;
begin
  if p_vendor_id is null or p_reviewer_user_id is null
     or p_action is null or p_action not in ('request_documents','request_correction','approve','reject')
     or p_reason_code is null
     or p_reason_code !~ '^[a-z][a-z0-9_]{2,63}$' then
    return 'denied';
  end if;
  if not exists (
     select 1 from public.profiles p
     join auth.users a on a.id=p.id
     where p.id=p_reviewer_user_id and p.role='admin' and p.is_active is true
       and a.raw_app_meta_data->>'admin_role'='Superadmin'
  ) then return 'owner_required'; end if;

  -- Serialize every review of this vendor; later versions always supersede
  -- earlier approvals. Reject conflicting or repeated final-state mutations.
  perform pg_advisory_xact_lock(hashtextextended('qf:vendor:review:'||p_vendor_id::text,721604));
  select * into c from qf_vendor_private.verification_cases v
    where v.vendor_id=p_vendor_id order by v.case_version desc limit 1 for update;
  if not found then return 'case_required'; end if;
  if c.state not in ('pending','documents_requested','under_review','needs_correction')
     or (c.expires_at is not null and c.expires_at<=now()) then
    return 'case_not_reviewable';
  end if;

  if p_action='approve' then
    -- No self-declared checkboxes: all independent evidence checks MUST match
    -- the reviewed private case before a signed Owner approval is inserted.
    select (
      c.contact_status='verified' and c.identity_status='verified'
      and c.office_status='verified' and c.category_status='verified'
      and c.zone_status='verified'
      and exists(select 1 from qf_vendor_private.verification_consents x
                 where x.case_id=c.id and x.revoked_at is null
                   and x.consented_at<=now())
      and exists(select 1 from qf_vendor_private.verification_evidence x
                 where x.case_id=c.id and x.evidence_type='identity_attestation'
                   and x.evidence_state='verified'
                   and x.scan_status in ('clean','not_applicable')
                   and x.reviewed_by is not null and x.reviewed_at is not null
                   and (x.processor_reference is not null or x.private_storage_key is not null)
                   and (x.expires_at is null or x.expires_at>now()))
      and exists(select 1 from qf_vendor_private.verification_evidence x
                 where x.case_id=c.id and x.evidence_type='office_proof'
                   and x.evidence_state='verified' and x.scan_status='clean'
                   and x.private_storage_key is not null
                   and x.reviewed_by is not null and x.reviewed_at is not null
                   and (x.expires_at is null or x.expires_at>now()))
    ) into v_ok;
    if v_ok is not true then return 'evidence_required'; end if;
    v_state:='approved';
  elsif p_action='reject' then v_state:='rejected';
  elsif p_action='request_correction' then v_state:='needs_correction';
  else v_state:='documents_requested';
  end if;
  if c.state=v_state then return 'case_not_reviewable'; end if;

  update qf_vendor_private.verification_cases v
    set state=v_state, reviewer_user_id=p_reviewer_user_id,
        reviewed_at=now(), updated_at=now()
    where v.id=c.id and v.state=c.state;
  if not found then raise exception 'QF_OWNER_REVIEW_CONCURRENT_CHANGE'; end if;
  insert into qf_vendor_private.verification_decisions
    (case_id,reviewer_user_id,action,from_state,to_state,reason_code)
  values (c.id,p_reviewer_user_id,p_action,c.state,v_state,p_reason_code);

  -- A positive decision is never trusted without re-running the complete
  -- private case-ready check *after* the immutable audit exists. A failed
  -- recheck rolls back both the case update and immutable insert.
  if p_action='approve'
     and public.qf_vendor_verification_case_ready(p_vendor_id) is not true then
    raise exception 'QF_OWNER_REVIEW_EVIDENCE_CHANGED';
  end if;
  return v_state;
end;
$$;
revoke all on function public.qf_owner_record_vendor_verification_decision(uuid,uuid,text,text)
  from public,anon,authenticated;
grant execute on function public.qf_owner_record_vendor_verification_decision(uuid,uuid,text,text)
  to service_role;

-- New-assignment-only, universally applied. Existing assigned -> delivered /
-- accepted progress and cancellation transitions remain untouched, including
-- historical records entered before this source-only gate was ever deployed.
-- No new credits, lead cap, matching rank, package or provider semantics.
create or replace function public.qf_enforce_new_vendor_assignment_verification()
returns trigger language plpgsql security definer
set search_path=pg_catalog as $$
declare
  v_requires_gate boolean;
begin
  if tg_op='INSERT' then
    v_requires_gate:=true;
  else
    v_requires_gate:=new.vendor_id is distinct from old.vendor_id
      or new.lead_id is distinct from old.lead_id
      or (new.lifecycle_status in ('assigned','delivered','accepted')
          and coalesce(old.lifecycle_status,'') not in ('assigned','delivered','accepted'));
  end if;
  if v_requires_gate is not true then return new; end if;
  if new.vendor_id is null or
     public.qf_vendor_verification_case_ready(new.vendor_id) is not true then
    raise exception 'QF_VENDOR_ASSIGNMENT_VERIFICATION_REQUIRED' using errcode='P0001';
  end if;
  return new;
end;
$$;
revoke all on function public.qf_enforce_new_vendor_assignment_verification()
 from public,anon,authenticated,service_role;
drop trigger if exists trg_qf_vendor_new_assignment_verification on public.lead_assignments;
create trigger trg_qf_vendor_new_assignment_verification
before insert or update of vendor_id,lead_id,lifecycle_status
on public.lead_assignments for each row
execute function public.qf_enforce_new_vendor_assignment_verification();

-- Revoke browser execution even if a schema-wide default EXECUTE grant exists.
do $$
begin
 if has_function_privilege('anon','public.qf_owner_record_vendor_verification_decision(uuid,uuid,text,text)','EXECUTE')
    or has_function_privilege('authenticated','public.qf_owner_record_vendor_verification_decision(uuid,uuid,text,text)','EXECUTE')
    or has_function_privilege('anon','public.qf_vendor_owner_review_snapshot(uuid)','EXECUTE')
    or has_function_privilege('authenticated','public.qf_vendor_owner_review_snapshot(uuid)','EXECUTE')
    then raise exception 'QF_VENDOR_OWNER_REVIEW_BROWSER_EXPOSED'; end if;
 if not exists(select 1 from pg_trigger
    where tgrelid='public.lead_assignments'::regclass
      and tgname='trg_qf_vendor_new_assignment_verification'
      and not tgisinternal)
    then raise exception 'QF_VENDOR_ASSIGNMENT_GATE_TRIGGER_MISSING'; end if;
end $$;
commit;
