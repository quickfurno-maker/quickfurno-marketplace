-- QuickFurno Batch 7 — bounded, sanitized Owner-only vendor review queue.
-- SOURCE ONLY; this is NOT applied to managed Staging or Production.
-- Depends on 20261104140000 vendor private cases and 20261104163000 intake.
begin;
create or replace function public.qf_vox_owner_vendor_review_queue()
returns jsonb
language sql stable security definer set search_path = pg_catalog
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'vendorId', queue.vendor_id,
        'caseVersion', queue.case_version,
        'caseState', queue.state,
        'submittedAt', queue.created_at,
        'contactStatus', queue.contact_status,
        'identityStatus', queue.identity_status,
        'officeStatus', queue.office_status,
        'categoryStatus', queue.category_status,
        'zoneStatus', queue.zone_status,
        'consentValid', queue.consent_valid,
        'pendingScanCount', queue.pending_scans,
        'rejectedScanCount', queue.rejected_scans
      ) order by queue.created_at,queue.vendor_id
    ),
    '[]'::jsonb
  )
  from (
    select c.vendor_id, c.case_version, c.state,c.created_at,
           c.contact_status,c.identity_status,c.office_status,
           c.category_status,c.zone_status,
           exists(
             select 1 from qf_vendor_private.verification_consents consent
              where consent.case_id=c.id and consent.revoked_at is null
                and consent.consented_at<=now()
           ) as consent_valid,
           (select count(*)::integer
              from qf_vendor_private.verification_evidence ev
              where ev.case_id=c.id and ev.scan_status='pending') as pending_scans,
           (select count(*)::integer
              from qf_vendor_private.verification_evidence ev
              where ev.case_id=c.id and ev.scan_status='rejected') as rejected_scans
      from qf_vendor_private.verification_cases c
     where c.state in ('pending','documents_requested','under_review','needs_correction')
       and c.case_version=(
          select max(latest.case_version)
            from qf_vendor_private.verification_cases latest
           where latest.vendor_id=c.vendor_id
       )
       and exists (
         select 1 from public.vendors v
          where v.id=c.vendor_id and v.status='Pending'
            and v.is_active=false and v.accepting_leads=false
            and v.public_visibility=false
       )
     order by c.created_at asc,c.vendor_id asc
     limit 20
  ) as queue;
$$;

-- No browser-role execution; VOX authenticates Owner MFA/AAL2 and calls only
-- through server-held service-role RPC. No evidence storage keys, names,
-- raw phone, Aadhaar, GST, provider details or links in the projection.
revoke all on function public.qf_vox_owner_vendor_review_queue()
  from public,anon,authenticated;
grant execute on function public.qf_vox_owner_vendor_review_queue()
  to service_role;

do $$
begin
  if has_function_privilege('anon',
      'public.qf_vox_owner_vendor_review_queue()','EXECUTE')
     or has_function_privilege('authenticated',
      'public.qf_vox_owner_vendor_review_queue()','EXECUTE')
     or not has_function_privilege('service_role',
      'public.qf_vox_owner_vendor_review_queue()','EXECUTE')
  then
    raise exception 'QF_VOX_VENDOR_PRIVATE_QUEUE_ACL_UNSAFE';
  end if;
end $$;
commit;
