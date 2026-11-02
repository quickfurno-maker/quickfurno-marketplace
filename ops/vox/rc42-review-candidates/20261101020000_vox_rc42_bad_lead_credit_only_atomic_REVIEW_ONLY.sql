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
-- RC56 review-only broader constraint: all evidence types share the SAME
-- original consumed assignment. The narrower RC42 index would not prevent
-- a separate manual/reconciliation flow from granting a second remedy.
-- Refuse activation if historical active duplicates exist; do not clean,
-- overwrite, merge or silently pick a winning credit restoration.
DO $$
BEGIN
 IF EXISTS(
  SELECT original_assignment_id FROM public.credit_restoration_approvals
  WHERE original_assignment_id IS NOT NULL
    AND status IN ('requested','approved','applied')
  GROUP BY original_assignment_id HAVING count(*)>1
 ) THEN
  RAISE EXCEPTION 'RC56_CROSS_EVIDENCE_RESTORATION_COLLISION_REVIEW_REQUIRED';
 END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS vox_rc56_all_evidence_once_per_original_assignment
 ON public.credit_restoration_approvals(original_assignment_id)
 WHERE original_assignment_id IS NOT NULL
  AND status IN ('requested','approved','applied');
-- Never accept a pre-existing same-name but non-unique, invalid, incomplete
-- or wrong-column index as a successful IF NOT EXISTS installation.
DO $$
DECLARE index_safe boolean;
BEGIN
 SELECT i.indisunique AND i.indisvalid AND i.indisready AND
   i.indnkeyatts=1 AND i.indexprs IS NULL AND i.indpred IS NOT NULL AND
   a.attname='original_assignment_id' AND am.amname='btree' AND
   position('original_assignment_id IS NOT NULL' in
     pg_get_expr(i.indpred,i.indrelid))>0 AND
   position('requested' in pg_get_expr(i.indpred,i.indrelid))>0 AND
   position('approved' in pg_get_expr(i.indpred,i.indrelid))>0 AND
   position('applied' in pg_get_expr(i.indpred,i.indrelid))>0 AND
   position('evidence_type' in pg_get_expr(i.indpred,i.indrelid))=0
 INTO index_safe
 FROM pg_index i
 JOIN pg_class idx ON idx.oid=i.indexrelid
 JOIN pg_namespace n ON n.oid=idx.relnamespace
 JOIN pg_class t ON t.oid=i.indrelid
 JOIN pg_am am ON am.oid=idx.relam
 JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=i.indkey[0]
 WHERE n.nspname='public' AND t.relname='credit_restoration_approvals'
  AND idx.relname='vox_rc56_all_evidence_once_per_original_assignment';
 IF NOT coalesce(index_safe,false) THEN
  RAISE EXCEPTION 'RC57_CROSS_EVIDENCE_INDEX_DEFINITION_UNTRUSTED';
 END IF;
END $$;
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
 -- An original assignment can have a PREEXISTING approved restoration under
 -- another evidence type (manual admin request/reconciliation). That also
 -- consumed its one legitimate compensation: never restore an extra LEAD
 -- credit merely because the record was not named bad_lead_report.
 SELECT * INTO prior FROM public.credit_restoration_approvals
 WHERE original_assignment_id=a.id
  AND status IN ('requested','approved','applied')
 ORDER BY id LIMIT 1 FOR UPDATE;
 IF FOUND THEN
  IF prior.evidence_type<>'bad_lead_report' THEN
   RETURN jsonb_build_object('status','rejected',
    'reason_code','existing_other_restoration_requires_review');
  END IF;
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
 -- An already_applied response is NOT evidence of a newly restored credit.
 -- The enclosing transaction must abort, including the inserted approval,
 -- rather than falsely reporting one additional LEAD credit.
 IF coalesce(credit->>'status','') <> 'applied' OR
    nullif(credit->>'ledger_id','') IS NULL THEN
  RAISE EXCEPTION 'RC60_CANONICAL_CREDIT_NOT_NEWLY_APPLIED' USING ERRCODE='P0001';
 END IF;
 -- Both the real canonical function and the fixture must durably mark the
 -- exact newly created approval applied and bind its ledger id in this TX.
 PERFORM 1 FROM public.credit_restoration_approvals
  WHERE id=approval_id AND original_assignment_id=a.id
   AND vendor_id=a.vendor_id AND status='applied'
   AND restoration_ledger_id=(credit->>'ledger_id')::uuid;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'RC60_CANONICAL_LEDGER_RECEIPT_MISMATCH' USING ERRCODE='P0001';
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
