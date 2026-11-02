-- RC75 REVIEW-ONLY SQL candidate. DO NOT install on managed Staging or Production.
-- Verified Owner AAL2, independent DBA/AppSec and reviewed grants are mandatory.
-- Intent: one transaction covering report status and assignment reporting flag.
-- No vendor wallet, LEAD credit, money refund, payment, assignment or provider send.
BEGIN;
CREATE OR REPLACE FUNCTION public.qf_vox_rc75_bad_lead_status_atomic_candidate_v1(
 p_report_id uuid,p_status text,p_admin_notes text,p_reviewed_by uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog,public
AS $function$
DECLARE v_assignment uuid; v_flagged uuid; v_report uuid;
BEGIN
 IF p_report_id IS NULL OR p_reviewed_by IS NULL OR
    p_status IS NULL OR p_status NOT IN
    ('Under Review','Valid','Invalid','Resolved','Rejected') THEN
  RAISE EXCEPTION 'INVALID_BAD_LEAD_REVIEW_INPUT' USING ERRCODE='22023';
 END IF;
 SELECT lead_assignment_id INTO v_assignment
 FROM public.bad_lead_reports WHERE id=p_report_id FOR UPDATE;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'BAD_LEAD_REPORT_NOT_FOUND' USING ERRCODE='P0002';
 END IF;
 IF p_status='Valid' AND v_assignment IS NULL THEN
  RAISE EXCEPTION 'BAD_LEAD_ORIGINAL_ASSIGNMENT_MISSING' USING ERRCODE='P0002';
 END IF;
 -- Lock linked assignment BEFORE touching the report to ensure a missing row
 -- cannot create any partial report status change.
 IF p_status='Valid' THEN
  SELECT id INTO v_flagged FROM public.lead_assignments
   WHERE id=v_assignment FOR UPDATE;
  IF NOT FOUND OR v_flagged IS DISTINCT FROM v_assignment THEN
   RAISE EXCEPTION 'BAD_LEAD_ASSIGNMENT_NOT_FOUND' USING ERRCODE='P0002';
  END IF;
 END IF;
 UPDATE public.bad_lead_reports SET
  status=p_status, reviewed_by=p_reviewed_by,
  reviewed_at=transaction_timestamp(),updated_at=transaction_timestamp(),
  admin_notes=COALESCE(NULLIF(btrim(p_admin_notes),''),admin_notes)
 WHERE id=p_report_id RETURNING id INTO v_report;
 IF v_report IS DISTINCT FROM p_report_id THEN
  RAISE EXCEPTION 'BAD_LEAD_REPORT_UPDATE_FAILED' USING ERRCODE='P0002';
 END IF;
 IF p_status='Valid' THEN
  v_flagged:=NULL; -- do not mistake the earlier SELECT result for UPDATE success
  UPDATE public.lead_assignments SET is_bad_lead_reported=true
   WHERE id=v_assignment RETURNING id INTO v_flagged;
  IF v_flagged IS DISTINCT FROM v_assignment THEN
   RAISE EXCEPTION 'BAD_LEAD_ASSIGNMENT_UPDATE_FAILED' USING ERRCODE='P0002';
  END IF;
 END IF;
 RETURN jsonb_build_object('ok',true,'schema','qf.vox.rc75.badlead.status.review.v1',
  'reportId',p_report_id,'status',p_status,'assignmentFlagged',p_status='Valid',
  'leadCreditsIssued',0,'providerMessagesSent',0);
END
$function$;
REVOKE ALL ON FUNCTION public.qf_vox_rc75_bad_lead_status_atomic_candidate_v1(uuid,text,text,uuid) FROM PUBLIC;
COMMIT;
