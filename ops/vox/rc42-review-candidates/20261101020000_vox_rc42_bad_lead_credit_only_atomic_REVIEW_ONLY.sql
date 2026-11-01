-- RC42 review-only candidate. UNINSTALLED; NOT in managed migration manifests.
-- Bad lead: one LEAD credit to vendor, never cash or monetary wallet credit.
-- Independent DBA/AppSec, authentic Owner AAL2 and managed recovery required.
BEGIN;
DO $$
BEGIN
 IF EXISTS(SELECT original_assignment_id FROM public.credit_restoration_approvals
 WHERE evidence_type='bad_lead_report' AND status IN ('requested','approved','applied')
 GROUP BY original_assignment_id HAVING count(*)>1)
 THEN RAISE EXCEPTION 'RC42_DUPLICATE_HISTORICAL_BAD_LEAD_APPROVALS_REVIEW_REQUIRED'; END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS vox_rc42_bad_lead_once_per_original_assignment
 ON public.credit_restoration_approvals(original_assignment_id)
 WHERE evidence_type='bad_lead_report' AND status IN ('requested','approved','applied');
CREATE OR REPLACE FUNCTION public.qf_vox_rc42_bad_lead_credit_only_atomic_candidate_v1(
 p_report_id uuid,p_actor_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path='' SET lock_timeout='3000ms'
AS $$
DECLARE
 r public.bad_lead_reports%ROWTYPE;
 a public.lead_assignments%ROWTYPE;
 prior public.credit_restoration_approvals%ROWTYPE;
 approval_id uuid;
 credit jsonb;
BEGIN
 IF p_report_id IS NULL OR p_actor_id IS NULL THEN
  RETURN jsonb_build_object('status','rejected','reason_code','invalid_input');
 END IF;
 -- DB defense in depth; authenticated AAL2 additionally required at HTTP boundary.
 PERFORM 1 FROM public.profiles p JOIN auth.users u ON u.id=p.id
 WHERE p.id=p_actor_id AND p.role='admin' AND p.is_active=true
  AND u.raw_app_meta_data->>'admin_role'='Superadmin' FOR SHARE OF p,u;
 IF NOT FOUND THEN
  RETURN jsonb_build_object('status','rejected','reason_code','verified_owner_required');
 END IF;
 SELECT * INTO r FROM public.bad_lead_reports WHERE id=p_report_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('status','rejected','reason_code','report_not_found'); END IF;
 IF r.status NOT IN ('Approved','Valid') THEN
  RETURN jsonb_build_object('status','rejected','reason_code','human_approval_required');
 END IF;
 -- All reports for the same assignment serialize on this original assignment.
 SELECT * INTO a FROM public.lead_assignments
  WHERE id=r.lead_assignment_id AND vendor_id=r.vendor_id FOR UPDATE;
 IF NOT FOUND OR a.lead_id IS NULL OR a.credit_deducted IS DISTINCT FROM true
 THEN RETURN jsonb_build_object('status','rejected','reason_code','original_consumed_assignment_required'); END IF;
 IF a.lifecycle_status NOT IN ('assigned','delivered','accepted','invalid') THEN
  RETURN jsonb_build_object('status','rejected','reason_code','assignment_not_recoverable');
 END IF;
 SELECT * INTO prior FROM public.credit_restoration_approvals
 WHERE original_assignment_id=a.id AND evidence_type='bad_lead_report'
  AND status IN ('requested','approved','applied') FOR UPDATE;
 IF FOUND THEN
  IF prior.status='applied' AND prior.restoration_ledger_id IS NOT NULL THEN
   RETURN jsonb_build_object('status','already_applied','original_assignment_id',a.id,
    'lead_credits_restored',0,'credit_restoration_approval_id',prior.id,
    'cash_refunded_minor_units',0);
  END IF;
  RETURN jsonb_build_object('status','rejected','reason_code','existing_approval_requires_review');
 END IF;
 INSERT INTO public.credit_restoration_approvals (
  original_assignment_id,vendor_id,lead_id,evidence_type,evidence_reference,
  reason_code,requested_by,status,approved_by,decided_at,idempotency_key
 ) VALUES (a.id,a.vendor_id,a.lead_id,'bad_lead_report',r.id::text,
  coalesce(r.reason_code,r.report_type,'bad_lead_validated'),p_actor_id,
  'approved',p_actor_id,clock_timestamp(),
  'bad_lead_assignment:'||a.id::text||':credit_only') RETURNING id INTO approval_id;
 credit := public.qf_approve_credit_restoration_v2(
  approval_id,p_actor_id,'human_approved_bad_lead_credit_only');
 IF coalesce(credit->>'status','') NOT IN ('applied','already_applied') THEN
  RAISE EXCEPTION 'RC42_CREDIT_MUTATION_NOT_ATOMIC' USING ERRCODE='P0001';
 END IF;
 UPDATE public.bad_lead_reports SET recovery_recommendation='restore_credit',
  recovery_status='applied',credit_restored=true,
  credit_restoration_approval_id=approval_id,reviewed_by=p_actor_id,
  reviewed_at=coalesce(reviewed_at,clock_timestamp()),
  recovery_applied_at=clock_timestamp(),updated_at=clock_timestamp()
 WHERE id=r.id;
 RETURN jsonb_build_object('status','applied','original_assignment_id',a.id,
  'lead_credits_restored',1,'credit_restoration_approval_id',approval_id,
  'cash_refunded_minor_units',0,'automatic_replacement_created',false);
END $$;
REVOKE ALL ON FUNCTION public.qf_vox_rc42_bad_lead_credit_only_atomic_candidate_v1(uuid,uuid)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.qf_vox_rc42_bad_lead_credit_only_atomic_candidate_v1(uuid,uuid)
 TO service_role;
COMMIT;
