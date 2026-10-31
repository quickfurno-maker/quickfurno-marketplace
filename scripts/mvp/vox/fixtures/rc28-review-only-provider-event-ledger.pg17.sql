-- RC28 REVIEW-ONLY, NON-DEPLOYABLE disposable PostgreSQL fixture.
-- Not a Supabase migration. The protected application continues ledger HARD-OFF.
-- Apply exclusively to disposable PG17 for proof; DBA/AppSec must review grants,
-- exact Razorpay event-id provenance, refund and consumed-credit policy.
CREATE TABLE public.qf_vendor_package_provider_events_candidate_v2 (
  provider_mode text NOT NULL CHECK (provider_mode IN ('test','live')),
  event_id text NOT NULL CHECK (event_id ~ '^[A-Za-z0-9_-]{8,64}$'),
  body_sha256 text NOT NULL CHECK (body_sha256 ~ '^[a-f0-9]{64}$'),
  event_type text NOT NULL CHECK (event_type IN ('payment.captured','payment.failed',
    'refund.created','refund.processed','refund.failed')),
  payment_id text NOT NULL CHECK (payment_id ~ '^pay_[A-Za-z0-9]{4,64}$'),
  provider_order_id text NOT NULL CHECK (provider_order_id ~ '^order_[A-Za-z0-9]{4,64}$'),
  status text NOT NULL DEFAULT 'available'
    CHECK (status IN ('available','claimed','completed','retryable','quarantined')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 25),
  claimed_at timestamptz,
  outcome text,
  error_code text,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (provider_mode,event_id),
  CONSTRAINT provider_event_completion_shape CHECK(
    (status='completed' AND outcome IS NOT NULL AND error_code IS NULL)
    OR (status IN ('retryable','quarantined') AND outcome IS NULL AND error_code IS NOT NULL)
    OR (status IN ('available','claimed') AND outcome IS NULL AND error_code IS NULL)
  )
);
ALTER TABLE public.qf_vendor_package_provider_events_candidate_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qf_vendor_package_provider_events_candidate_v2 FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.qf_vendor_package_provider_events_candidate_v2 FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON TABLE public.qf_vendor_package_provider_events_candidate_v2 TO service_role;

CREATE FUNCTION public.qf_record_vendor_package_razorpay_event_v2(
 p_event_id text,p_provider_mode text,p_body_sha256 text,
 p_event_type text,p_payment_id text,p_provider_order_id text
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $f$
DECLARE r public.qf_vendor_package_provider_events_candidate_v2%ROWTYPE;
BEGIN
 IF p_event_id IS NULL OR p_event_id !~ '^[A-Za-z0-9_-]{8,64}$' OR
    p_provider_mode NOT IN ('test','live') OR
    p_body_sha256 IS NULL OR p_body_sha256 !~ '^[a-f0-9]{64}$' OR
    p_event_type NOT IN ('payment.captured','payment.failed',
      'refund.created','refund.processed','refund.failed') OR
    p_payment_id IS NULL OR p_payment_id !~ '^pay_[A-Za-z0-9]{4,64}$' OR
    p_provider_order_id IS NULL OR p_provider_order_id !~ '^order_[A-Za-z0-9]{4,64}$'
 THEN RAISE EXCEPTION 'PROVIDER_EVENT_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 INSERT INTO public.qf_vendor_package_provider_events_candidate_v2 (
  provider_mode,event_id,body_sha256,event_type,payment_id,provider_order_id
 ) VALUES (p_provider_mode,p_event_id,p_body_sha256,p_event_type,p_payment_id,p_provider_order_id)
 ON CONFLICT DO NOTHING;
 SELECT * INTO STRICT r FROM public.qf_vendor_package_provider_events_candidate_v2
  WHERE provider_mode=p_provider_mode AND event_id=p_event_id FOR UPDATE;
 IF r.body_sha256<>p_body_sha256 OR r.event_type<>p_event_type OR
    r.payment_id<>p_payment_id OR r.provider_order_id<>p_provider_order_id
 THEN RETURN jsonb_build_object('event_id',p_event_id,'provider_mode',p_provider_mode,
  'status','conflict'); END IF;
 IF r.status='completed' THEN
  RETURN jsonb_build_object('event_id',p_event_id,'provider_mode',p_provider_mode,
   'status','replay','outcome',r.outcome);
 END IF;
 IF r.status='quarantined' THEN
  RETURN jsonb_build_object('event_id',p_event_id,'provider_mode',p_provider_mode,
   'status','quarantined','last_error_code',r.error_code);
 END IF;
 IF r.status='claimed' AND r.claimed_at>clock_timestamp()-interval '5 minutes'
 THEN RETURN jsonb_build_object('event_id',p_event_id,'provider_mode',p_provider_mode,
  'status','in_flight'); END IF;
 IF r.attempt_count>=25 THEN
  -- Unresolved provider settlement cannot be acknowledged automatically.
  -- Retain a manual-reconciliation record without creating new Core leases.
  UPDATE public.qf_vendor_package_provider_events_candidate_v2
   SET status='retryable',claimed_at=NULL,outcome=NULL,
       error_code='PROVIDER_EVENT_ATTEMPTS_EXHAUSTED',
       updated_at=clock_timestamp()
   WHERE provider_mode=p_provider_mode AND event_id=p_event_id;
  RETURN jsonb_build_object('event_id',p_event_id,'provider_mode',p_provider_mode,
   'status','needs_reconciliation','last_error_code','PROVIDER_EVENT_ATTEMPTS_EXHAUSTED');
 END IF;
 UPDATE public.qf_vendor_package_provider_events_candidate_v2
  SET status='claimed',attempt_count=r.attempt_count+1,claimed_at=clock_timestamp(),
      outcome=NULL,error_code=NULL,updated_at=clock_timestamp()
  WHERE provider_mode=p_provider_mode AND event_id=p_event_id;
 RETURN jsonb_build_object('event_id',p_event_id,'provider_mode',p_provider_mode,
  'status','claimed','attempt_count',r.attempt_count+1);
END $f$;

CREATE FUNCTION public.qf_complete_vendor_package_razorpay_event_v2(
 p_event_id text,p_provider_mode text,p_body_sha256 text,p_attempt_count integer,
 p_disposition text,p_outcome text,p_error_code text
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $f$
DECLARE r public.qf_vendor_package_provider_events_candidate_v2%ROWTYPE;
BEGIN
 SELECT * INTO r FROM public.qf_vendor_package_provider_events_candidate_v2
  WHERE provider_mode=p_provider_mode AND event_id=p_event_id FOR UPDATE;
 IF NOT FOUND OR r.body_sha256 IS DISTINCT FROM p_body_sha256 OR
    r.status<>'claimed' OR r.attempt_count IS DISTINCT FROM p_attempt_count
 THEN RAISE EXCEPTION 'PROVIDER_EVENT_COMPLETION_FENCE_DENIED'
  USING ERRCODE='42501'; END IF;
 -- RC35: refund intake only ever quarantines for bounded human review.
 IF r.event_type LIKE 'refund.%' AND NOT (p_disposition='quarantined' AND
    p_outcome IS NULL AND p_error_code='REFUND_REVIEW_REQUIRED')
 THEN RAISE EXCEPTION 'PROVIDER_EVENT_COMPLETION_SHAPE_DENIED'
   USING ERRCODE='22023'; END IF;
 IF p_disposition='completed' AND p_error_code IS NULL AND
   ((r.event_type='payment.captured' AND p_outcome IN ('activated','already_activated')) OR
    (r.event_type='payment.failed' AND p_outcome IN ('failed_recorded','failure_ignored')))
 THEN
  UPDATE public.qf_vendor_package_provider_events_candidate_v2 SET
   status='completed',outcome=p_outcome,error_code=NULL,updated_at=clock_timestamp()
   WHERE provider_mode=p_provider_mode AND event_id=p_event_id;
 ELSIF p_disposition IN ('quarantined','retryable') AND p_outcome IS NULL AND
   p_error_code ~ '^[A-Z][A-Z0-9_]{2,80}$'
 THEN
  UPDATE public.qf_vendor_package_provider_events_candidate_v2 SET
   status=p_disposition,outcome=NULL,error_code=p_error_code,updated_at=clock_timestamp()
   WHERE provider_mode=p_provider_mode AND event_id=p_event_id;
 ELSE RAISE EXCEPTION 'PROVIDER_EVENT_COMPLETION_SHAPE_DENIED'
   USING ERRCODE='22023'; END IF;
 RETURN jsonb_build_object('event_id',p_event_id,'provider_mode',p_provider_mode,
  'status',p_disposition,'outcome',p_outcome,'error_code',p_error_code);
END $f$;
REVOKE ALL ON FUNCTION public.qf_record_vendor_package_razorpay_event_v2(
 text,text,text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.qf_complete_vendor_package_razorpay_event_v2(
 text,text,text,integer,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.qf_record_vendor_package_razorpay_event_v2(
 text,text,text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.qf_complete_vendor_package_razorpay_event_v2(
 text,text,text,integer,text,text,text) TO service_role;
