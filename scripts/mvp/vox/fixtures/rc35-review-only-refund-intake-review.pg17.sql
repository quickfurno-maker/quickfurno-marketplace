-- RC35 REVIEW-ONLY, NON-DEPLOYABLE disposable PostgreSQL fixture. Apply AFTER
-- rc28-review-only-provider-event-ledger.pg17.sql. Not a Supabase migration.
-- Records one IMMUTABLE bounded reviewer decision per quarantined refund intake
-- event. It never touches credits, orders, wallets, providers or refunds.
CREATE TABLE public.qf_vendor_package_refund_intake_reviews_candidate_v2 (
  provider_mode text NOT NULL,
  event_id text NOT NULL,
  reviewer_id uuid NOT NULL,
  decision text NOT NULL CHECK (decision IN
    ('escalated_for_policy_decision','evidence_matched_for_human_authorization')),
  reviewable_credits integer CHECK (reviewable_credits BETWEEN 0 AND 1000000),
  reviewed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (provider_mode,event_id),
  FOREIGN KEY (provider_mode,event_id)
    REFERENCES public.qf_vendor_package_provider_events_candidate_v2 (provider_mode,event_id),
  CONSTRAINT refund_review_credit_shape CHECK (
    (decision='escalated_for_policy_decision' AND reviewable_credits IS NULL) OR
    (decision='evidence_matched_for_human_authorization' AND reviewable_credits IS NOT NULL))
);
ALTER TABLE public.qf_vendor_package_refund_intake_reviews_candidate_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qf_vendor_package_refund_intake_reviews_candidate_v2 FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.qf_vendor_package_refund_intake_reviews_candidate_v2 FROM PUBLIC;
GRANT SELECT, INSERT ON TABLE public.qf_vendor_package_refund_intake_reviews_candidate_v2 TO service_role;

CREATE FUNCTION public.qf_review_vendor_package_refund_intake_v2(
 p_event_id text,p_provider_mode text,p_body_sha256 text,p_reviewer_id uuid,
 p_decision text,p_reviewable_credits integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $f$
DECLARE e public.qf_vendor_package_provider_events_candidate_v2%ROWTYPE;
        v public.qf_vendor_package_refund_intake_reviews_candidate_v2%ROWTYPE;
BEGIN
 IF p_reviewer_id IS NULL OR p_decision IS NULL OR p_decision NOT IN
    ('escalated_for_policy_decision','evidence_matched_for_human_authorization') OR
    (p_decision='escalated_for_policy_decision' AND p_reviewable_credits IS NOT NULL) OR
    (p_decision='evidence_matched_for_human_authorization' AND
      (p_reviewable_credits IS NULL OR p_reviewable_credits NOT BETWEEN 0 AND 1000000))
 THEN RAISE EXCEPTION 'REFUND_REVIEW_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 SELECT * INTO e FROM public.qf_vendor_package_provider_events_candidate_v2
  WHERE provider_mode=p_provider_mode AND event_id=p_event_id FOR UPDATE;
 IF NOT FOUND OR e.body_sha256 IS DISTINCT FROM p_body_sha256 OR
    e.event_type NOT LIKE 'refund.%' OR e.status<>'quarantined' OR
    e.error_code IS DISTINCT FROM 'REFUND_REVIEW_REQUIRED'
 THEN RAISE EXCEPTION 'REFUND_INTAKE_NOT_REVIEWABLE' USING ERRCODE='42501'; END IF;
 INSERT INTO public.qf_vendor_package_refund_intake_reviews_candidate_v2
  (provider_mode,event_id,reviewer_id,decision,reviewable_credits)
 VALUES (p_provider_mode,p_event_id,p_reviewer_id,p_decision,p_reviewable_credits)
 ON CONFLICT DO NOTHING;
 SELECT * INTO STRICT v FROM public.qf_vendor_package_refund_intake_reviews_candidate_v2
  WHERE provider_mode=p_provider_mode AND event_id=p_event_id;
 -- First decision wins and is immutable. An identical retry (for example after
 -- an unknown COMMIT) is idempotent; anything else is reported, never applied.
 RETURN jsonb_build_object('event_id',p_event_id,'provider_mode',p_provider_mode,
  'status',CASE WHEN v.reviewer_id=p_reviewer_id AND v.decision=p_decision AND
     v.reviewable_credits IS NOT DISTINCT FROM p_reviewable_credits
    THEN 'reviewed' ELSE 'review_conflict' END,
  'decision',v.decision,'reviewable_credits',v.reviewable_credits);
END $f$;
REVOKE ALL ON FUNCTION public.qf_review_vendor_package_refund_intake_v2(
 text,text,text,uuid,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.qf_review_vendor_package_refund_intake_v2(
 text,text,text,uuid,text,integer) TO service_role;
