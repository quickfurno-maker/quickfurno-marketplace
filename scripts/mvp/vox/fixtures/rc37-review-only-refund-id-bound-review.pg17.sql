-- RC37 REVIEW-ONLY, NON-DEPLOYABLE disposable PostgreSQL fixture. Apply AFTER
-- rc28-review-only-provider-event-ledger.pg17.sql. Not a Supabase migration.
-- Closes the RC35 event-bound ambiguity: refund.created / refund.processed /
-- refund.failed events of ONE provider refund have different event ids, so the
-- event-keyed review could record a second, different decision. This binds ONE
-- immutable decision to (provider_mode, refund_id). Never touches credits,
-- orders, wallets, providers or refunds. refund_id comes from the HMAC-verified
-- webhook envelope; the ledger does not store it yet (see route comment).
CREATE TABLE public.qf_vendor_package_refund_reviews_by_refund_candidate_v3 (
  provider_mode text NOT NULL CHECK (provider_mode IN ('test','live')),
  refund_id text NOT NULL CHECK (refund_id ~ '^rfnd_[A-Za-z0-9]{4,64}$'),
  event_id text NOT NULL,
  payment_id text NOT NULL CHECK (payment_id ~ '^pay_[A-Za-z0-9]{4,64}$'),
  reviewer_id uuid NOT NULL,
  decision text NOT NULL CHECK (decision IN
    ('escalated_for_policy_decision','evidence_matched_for_human_authorization')),
  reviewable_credits integer CHECK (reviewable_credits BETWEEN 0 AND 1000000),
  reviewed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (provider_mode,refund_id),
  FOREIGN KEY (provider_mode,event_id)
    REFERENCES public.qf_vendor_package_provider_events_candidate_v2 (provider_mode,event_id),
  CONSTRAINT refund_review_v3_credit_shape CHECK (
    (decision='escalated_for_policy_decision' AND reviewable_credits IS NULL) OR
    (decision='evidence_matched_for_human_authorization' AND reviewable_credits IS NOT NULL))
);
ALTER TABLE public.qf_vendor_package_refund_reviews_by_refund_candidate_v3 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qf_vendor_package_refund_reviews_by_refund_candidate_v3 FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.qf_vendor_package_refund_reviews_by_refund_candidate_v3 FROM PUBLIC;
GRANT SELECT, INSERT ON TABLE public.qf_vendor_package_refund_reviews_by_refund_candidate_v3 TO service_role;

CREATE FUNCTION public.qf_review_vendor_package_refund_intake_v3(
 p_event_id text,p_provider_mode text,p_body_sha256 text,p_reviewer_id uuid,
 p_decision text,p_reviewable_credits integer,p_refund_id text,p_payment_id text
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $f$
DECLARE e public.qf_vendor_package_provider_events_candidate_v2%ROWTYPE;
        v public.qf_vendor_package_refund_reviews_by_refund_candidate_v3%ROWTYPE;
BEGIN
 IF p_reviewer_id IS NULL OR p_decision IS NULL OR p_decision NOT IN
    ('escalated_for_policy_decision','evidence_matched_for_human_authorization') OR
    (p_decision='escalated_for_policy_decision' AND p_reviewable_credits IS NOT NULL) OR
    (p_decision='evidence_matched_for_human_authorization' AND
      (p_reviewable_credits IS NULL OR p_reviewable_credits NOT BETWEEN 0 AND 1000000)) OR
    p_refund_id IS NULL OR p_refund_id !~ '^rfnd_[A-Za-z0-9]{4,64}$' OR
    p_payment_id IS NULL OR p_payment_id !~ '^pay_[A-Za-z0-9]{4,64}$'
 THEN RAISE EXCEPTION 'REFUND_REVIEW_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 SELECT * INTO e FROM public.qf_vendor_package_provider_events_candidate_v2
  WHERE provider_mode=p_provider_mode AND event_id=p_event_id FOR UPDATE;
 IF NOT FOUND OR e.body_sha256 IS DISTINCT FROM p_body_sha256 OR
    e.event_type NOT LIKE 'refund.%' OR e.status<>'quarantined' OR
    e.error_code IS DISTINCT FROM 'REFUND_REVIEW_REQUIRED' OR
    e.payment_id IS DISTINCT FROM p_payment_id
 THEN RAISE EXCEPTION 'REFUND_INTAKE_NOT_REVIEWABLE' USING ERRCODE='42501'; END IF;
 -- Serialize concurrent first reviews of the SAME refund across event ids.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_provider_mode||':'||p_refund_id,0));
 INSERT INTO public.qf_vendor_package_refund_reviews_by_refund_candidate_v3
  (provider_mode,refund_id,event_id,payment_id,reviewer_id,decision,reviewable_credits)
 VALUES (p_provider_mode,p_refund_id,p_event_id,p_payment_id,p_reviewer_id,p_decision,p_reviewable_credits)
 ON CONFLICT (provider_mode,refund_id) DO NOTHING;
 SELECT * INTO STRICT v FROM public.qf_vendor_package_refund_reviews_by_refund_candidate_v3
  WHERE provider_mode=p_provider_mode AND refund_id=p_refund_id;
 -- First decision wins for the whole refund. Only the identical retry of the
 -- SAME event is idempotent; a different event/decision/reviewer is reported.
 RETURN jsonb_build_object('event_id',p_event_id,'provider_mode',p_provider_mode,
  'refund_id',p_refund_id,
  'status',CASE WHEN v.event_id=p_event_id AND v.payment_id=p_payment_id AND
     v.reviewer_id=p_reviewer_id AND v.decision=p_decision AND
     v.reviewable_credits IS NOT DISTINCT FROM p_reviewable_credits
    THEN 'reviewed' ELSE 'review_conflict' END,
  'decision',v.decision,'reviewable_credits',v.reviewable_credits);
END $f$;
REVOKE ALL ON FUNCTION public.qf_review_vendor_package_refund_intake_v3(
 text,text,text,uuid,text,integer,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.qf_review_vendor_package_refund_intake_v3(
 text,text,text,uuid,text,integer,text,text) TO service_role;
