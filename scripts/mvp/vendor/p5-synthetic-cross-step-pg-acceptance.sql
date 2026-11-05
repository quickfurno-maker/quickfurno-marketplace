-- Phase 5 synthetic *cross-step* journey invariants, after the seven SQL
-- migrations and all existing PG17 positive/negative acceptance files.
-- Disposable networkless PostgreSQL ONLY. No user/customer data or provider.
-- Does not claim a true WhatsApp delivery, ClamAV scan, Auth AAL2 or Staging UAT.
DO $$
DECLARE
 v_ready uuid:='10000000-0000-4000-8000-000000000008';
 v_revoked uuid:='10000000-0000-4000-8000-000000000006';
 ready_state text;
 revocation_state text;
 v_doc uuid;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.vendors WHERE id=v_ready)
   THEN RAISE EXCEPTION 'P5_SYNTHETIC_VENDOR_NOT_PRESENT'; END IF;
 IF NOT public.qf_vendor_verification_case_ready(v_ready)
   THEN RAISE EXCEPTION 'P5_SYNTHETIC_SCANNED_CASE_NOT_READY'; END IF;
 SELECT v.status INTO ready_state FROM public.vendors v WHERE v.id=v_ready;
 IF ready_state IS DISTINCT FROM 'Pending' THEN
   RAISE EXCEPTION 'P5_SYNTHETIC_CASE_APPROVAL_AUTO_ACTIVATED_VENDOR'; END IF;
 IF EXISTS (
    SELECT 1 FROM public.vendors v WHERE v.id=v_ready AND
     (v.is_active IS DISTINCT FROM false
      OR v.accepting_leads IS DISTINCT FROM false
      OR v.public_visibility IS DISTINCT FROM false
      OR coalesce(v.remaining_credits,0)<>0)
 ) THEN RAISE EXCEPTION 'P5_SYNTHETIC_PENDING_VENDOR_GAINED_OPERATIONS'; END IF;
 -- The only permitted clean proof is linked to its immutable scanner receipt.
 SELECT e.id INTO v_doc
 FROM qf_vendor_private.verification_evidence e
 JOIN qf_vendor_private.verification_cases c ON c.id=e.case_id
 WHERE c.vendor_id=v_ready
   AND e.evidence_type='office_proof' AND e.scan_status='clean'
 LIMIT 1;
 IF v_doc IS NULL OR NOT EXISTS (
   SELECT 1 FROM qf_vendor_private.verification_scan_receipts r
   WHERE r.evidence_id=v_doc AND r.verdict='clean'
     AND r.content_sha256=repeat('e',64)
 ) THEN RAISE EXCEPTION 'P5_SYNTHETIC_CLEAN_CASE_MISSING_IMMUTABLE_RECEIPT'; END IF;
 -- A different synthetic vendor revoked consent during private intake.
 SELECT v.status INTO revocation_state FROM public.vendors v WHERE v.id=v_revoked;
 IF revocation_state IS DISTINCT FROM 'Pending' THEN
   RAISE EXCEPTION 'P5_SYNTHETIC_REVOKED_VENDOR_AUTO_ACTIVATED'; END IF;
 IF public.qf_vendor_verification_case_ready(v_revoked) THEN
   RAISE EXCEPTION 'P5_SYNTHETIC_REVOKED_CONSENT_READY_FOR_APPROVAL'; END IF;
 IF EXISTS (
   SELECT 1 FROM qf_vendor_private.verification_cases c
   LEFT JOIN qf_vendor_private.verification_consents k ON k.case_id=c.id
   WHERE c.vendor_id=v_revoked AND k.revoked_at IS NULL
 ) THEN RAISE EXCEPTION 'P5_SYNTHETIC_REVOKED_CONSENT_MISSING'; END IF;
 -- Approval of private evidence does not itself dispatch any live Core lead.
 IF EXISTS (SELECT 1 FROM public.lead_assignments a WHERE a.vendor_id=v_ready) THEN
   RAISE EXCEPTION 'P5_SYNTHETIC_REVIEW_AUTO_ASSIGNED_LEAD'; END IF;
 RAISE NOTICE 'PASS P5 cross-step: OTP-to-Pending, revocation, private clean scan receipt, Owner decision, separate business activation and no auto assignments';
END $$;
