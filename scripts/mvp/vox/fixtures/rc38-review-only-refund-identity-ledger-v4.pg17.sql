-- RC38 REVIEW-ONLY, NON-DEPLOYABLE disposable PostgreSQL fixture. Apply AFTER
-- rc28 (events), rc35 and rc37 (v3 refund review). Not a Supabase migration,
-- outside the pinned migration family. Never touches credits, orders, wallets,
-- providers or refunds and does not activate refund handling.
--
-- Closes the RC37 gap: v3 trusted a caller-supplied refund_id/payment_id that no
-- durable row proved. v4 persists, per webhook event, the identity extracted from
-- the HMAC-verified envelope together with an application-computed HMAC-SHA256
-- over its canonical form (key NEVER stored or sent to PostgreSQL), and then:
--   * binds (provider_mode, refund_id) to exactly ONE payment_id, forever;
--   * rejects a new event of the same refund naming a different payment;
--   * lets the review function derive refund/payment from the durable row, so
--     the reviewer/caller can no longer assert them.
-- PostgreSQL enforces shape, uniqueness, immutability and serialization; only
-- the application holding the key can verify the MAC (see
-- lib/payments/vendorPackageRefundIdentityBinding.mjs).

CREATE TABLE public.qf_vendor_package_refund_identities_candidate_v4 (
  provider_mode text NOT NULL CHECK (provider_mode IN ('test','live')),
  refund_id text NOT NULL CHECK (refund_id ~ '^rfnd_[A-Za-z0-9]{4,64}$'),
  payment_id text NOT NULL CHECK (payment_id ~ '^pay_[A-Za-z0-9]{4,64}$'),
  first_event_id text NOT NULL,
  bound_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (provider_mode,refund_id),
  UNIQUE (provider_mode,refund_id,payment_id),
  FOREIGN KEY (provider_mode,first_event_id)
    REFERENCES public.qf_vendor_package_provider_events_candidate_v2 (provider_mode,event_id)
);
CREATE TABLE public.qf_vendor_package_refund_event_bindings_candidate_v4 (
  provider_mode text NOT NULL CHECK (provider_mode IN ('test','live')),
  event_id text NOT NULL,
  body_sha256 text NOT NULL CHECK (body_sha256 ~ '^[a-f0-9]{64}$'),
  event_type text NOT NULL CHECK (event_type IN ('refund.created','refund.processed','refund.failed')),
  refund_id text NOT NULL,
  payment_id text NOT NULL,
  provider_order_id text NOT NULL CHECK (provider_order_id ~ '^order_[A-Za-z0-9]{4,64}$'),
  identity_mac text NOT NULL CHECK (identity_mac ~ '^[a-f0-9]{64}$'),
  mac_key_id text NOT NULL CHECK (mac_key_id ~ '^[A-Za-z0-9_-]{1,32}$'),
  bound_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (provider_mode,event_id),
  FOREIGN KEY (provider_mode,event_id)
    REFERENCES public.qf_vendor_package_provider_events_candidate_v2 (provider_mode,event_id),
  FOREIGN KEY (provider_mode,refund_id,payment_id)
    REFERENCES public.qf_vendor_package_refund_identities_candidate_v4 (provider_mode,refund_id,payment_id)
);

CREATE FUNCTION public.qf_refund_identity_v4_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $f$
BEGIN RAISE EXCEPTION 'REFUND_IDENTITY_LEDGER_IMMUTABLE' USING ERRCODE='42501'; END $f$;
DO $do$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['qf_vendor_package_refund_identities_candidate_v4',
                          'qf_vendor_package_refund_event_bindings_candidate_v4'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC',t);
  EXECUTE format('GRANT SELECT, INSERT ON TABLE public.%I TO service_role',t);
  EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.qf_refund_identity_v4_immutable()',t||'_row_immutable',t);
  EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.qf_refund_identity_v4_immutable()',t||'_truncate_immutable',t);
 END LOOP;
END $do$;

-- Backward-safe guard on the RC37 v3 table: a v3 insert may never contradict a
-- durable v4 identity. Refunds with no v4 identity behave exactly as in RC37.
CREATE FUNCTION public.qf_refund_review_v3_identity_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $f$
BEGIN
 IF EXISTS (SELECT 1 FROM public.qf_vendor_package_refund_identities_candidate_v4 i
             WHERE i.provider_mode=NEW.provider_mode AND i.refund_id=NEW.refund_id
               AND i.payment_id<>NEW.payment_id) OR
    EXISTS (SELECT 1 FROM public.qf_vendor_package_refund_event_bindings_candidate_v4 b
             WHERE b.provider_mode=NEW.provider_mode AND b.event_id=NEW.event_id
               AND (b.refund_id<>NEW.refund_id OR b.payment_id<>NEW.payment_id))
 THEN RAISE EXCEPTION 'REFUND_IDENTITY_MISMATCH' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $f$;
CREATE TRIGGER qf_refund_review_v3_identity_guard
 BEFORE INSERT ON public.qf_vendor_package_refund_reviews_by_refund_candidate_v3
 FOR EACH ROW EXECUTE FUNCTION public.qf_refund_review_v3_identity_guard();

-- Lock order everywhere: event row FOR UPDATE, then the per-refund advisory lock
-- (same key as the RC37 v3 review) so v3, bind and v4 review all serialize.
CREATE FUNCTION public.qf_bind_vendor_package_refund_identity_v4(
 p_event_id text,p_provider_mode text,p_body_sha256 text,p_refund_id text,
 p_payment_id text,p_identity_mac text,p_mac_key_id text
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $f$
DECLARE e public.qf_vendor_package_provider_events_candidate_v2%ROWTYPE;
        i public.qf_vendor_package_refund_identities_candidate_v4%ROWTYPE;
        b public.qf_vendor_package_refund_event_bindings_candidate_v4%ROWTYPE;
        rv public.qf_vendor_package_refund_reviews_by_refund_candidate_v3%ROWTYPE;
BEGIN
 IF p_event_id IS NULL OR p_provider_mode IS NULL OR p_provider_mode NOT IN ('test','live') OR
    p_body_sha256 IS NULL OR p_body_sha256 !~ '^[a-f0-9]{64}$' OR
    p_refund_id IS NULL OR p_refund_id !~ '^rfnd_[A-Za-z0-9]{4,64}$' OR
    p_payment_id IS NULL OR p_payment_id !~ '^pay_[A-Za-z0-9]{4,64}$' OR
    p_identity_mac IS NULL OR p_identity_mac !~ '^[a-f0-9]{64}$' OR
    p_mac_key_id IS NULL OR p_mac_key_id !~ '^[A-Za-z0-9_-]{1,32}$'
 THEN RAISE EXCEPTION 'REFUND_IDENTITY_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 SELECT * INTO e FROM public.qf_vendor_package_provider_events_candidate_v2
  WHERE provider_mode=p_provider_mode AND event_id=p_event_id FOR UPDATE;
 IF NOT FOUND OR e.body_sha256 IS DISTINCT FROM p_body_sha256 OR
    e.event_type NOT LIKE 'refund.%' OR e.payment_id IS DISTINCT FROM p_payment_id
 THEN RAISE EXCEPTION 'REFUND_IDENTITY_EVENT_MISMATCH' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_provider_mode||':'||p_refund_id,0));
 SELECT * INTO b FROM public.qf_vendor_package_refund_event_bindings_candidate_v4
  WHERE provider_mode=p_provider_mode AND event_id=p_event_id;
 IF FOUND THEN
  RETURN jsonb_build_object('event_id',p_event_id,'provider_mode',p_provider_mode,
   'refund_id',b.refund_id,'payment_id',b.payment_id,'identity_mac',b.identity_mac,
   'mac_key_id',b.mac_key_id,
   'status',CASE WHEN b.refund_id=p_refund_id AND b.payment_id=p_payment_id AND
     b.body_sha256=p_body_sha256 AND b.identity_mac=p_identity_mac AND
     b.mac_key_id=p_mac_key_id THEN 'bound' ELSE 'identity_conflict' END);
 END IF;
 SELECT * INTO i FROM public.qf_vendor_package_refund_identities_candidate_v4
  WHERE provider_mode=p_provider_mode AND refund_id=p_refund_id;
 IF NOT FOUND THEN
  -- A pre-existing v3 review may already pin this refund to another payment.
  SELECT * INTO rv FROM public.qf_vendor_package_refund_reviews_by_refund_candidate_v3
   WHERE provider_mode=p_provider_mode AND refund_id=p_refund_id;
  IF FOUND AND rv.payment_id<>p_payment_id THEN
   RETURN jsonb_build_object('event_id',p_event_id,'provider_mode',p_provider_mode,
    'refund_id',p_refund_id,'status','identity_conflict');
  END IF;
  INSERT INTO public.qf_vendor_package_refund_identities_candidate_v4
   (provider_mode,refund_id,payment_id,first_event_id)
  VALUES (p_provider_mode,p_refund_id,p_payment_id,p_event_id);
 ELSIF i.payment_id<>p_payment_id THEN
  RETURN jsonb_build_object('event_id',p_event_id,'provider_mode',p_provider_mode,
   'refund_id',p_refund_id,'status','identity_conflict');
 END IF;
 INSERT INTO public.qf_vendor_package_refund_event_bindings_candidate_v4
  (provider_mode,event_id,body_sha256,event_type,refund_id,payment_id,
   provider_order_id,identity_mac,mac_key_id)
 VALUES (p_provider_mode,p_event_id,p_body_sha256,e.event_type,p_refund_id,p_payment_id,
   e.provider_order_id,p_identity_mac,p_mac_key_id);
 RETURN jsonb_build_object('event_id',p_event_id,'provider_mode',p_provider_mode,
  'refund_id',p_refund_id,'payment_id',p_payment_id,'identity_mac',p_identity_mac,
  'mac_key_id',p_mac_key_id,'status','bound');
END $f$;

-- Reviewer-facing read: authoritative identity for ONE event, from durable rows.
CREATE FUNCTION public.qf_get_vendor_package_refund_identity_v4(
 p_event_id text,p_provider_mode text
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $f$
DECLARE b public.qf_vendor_package_refund_event_bindings_candidate_v4%ROWTYPE;
BEGIN
 SELECT * INTO b FROM public.qf_vendor_package_refund_event_bindings_candidate_v4
  WHERE provider_mode=p_provider_mode AND event_id=p_event_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'REFUND_IDENTITY_UNBOUND' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('event_id',b.event_id,'provider_mode',b.provider_mode,
  'body_sha256',b.body_sha256,'event_type',b.event_type,'refund_id',b.refund_id,
  'payment_id',b.payment_id,'provider_order_id',b.provider_order_id,
  'identity_mac',b.identity_mac,'mac_key_id',b.mac_key_id);
END $f$;

CREATE FUNCTION public.qf_review_vendor_package_refund_intake_v4(
 p_event_id text,p_provider_mode text,p_body_sha256 text,p_reviewer_id uuid,
 p_decision text,p_reviewable_credits integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $f$
DECLARE e public.qf_vendor_package_provider_events_candidate_v2%ROWTYPE;
        b public.qf_vendor_package_refund_event_bindings_candidate_v4%ROWTYPE;
        v public.qf_vendor_package_refund_reviews_by_refund_candidate_v3%ROWTYPE;
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
 SELECT * INTO b FROM public.qf_vendor_package_refund_event_bindings_candidate_v4
  WHERE provider_mode=p_provider_mode AND event_id=p_event_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'REFUND_IDENTITY_UNBOUND' USING ERRCODE='42501'; END IF;
 IF b.body_sha256<>e.body_sha256 OR b.payment_id<>e.payment_id OR b.event_type<>e.event_type
 THEN RAISE EXCEPTION 'REFUND_IDENTITY_EVENT_MISMATCH' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_provider_mode||':'||b.refund_id,0));
 INSERT INTO public.qf_vendor_package_refund_reviews_by_refund_candidate_v3
  (provider_mode,refund_id,event_id,payment_id,reviewer_id,decision,reviewable_credits)
 VALUES (p_provider_mode,b.refund_id,p_event_id,b.payment_id,p_reviewer_id,p_decision,p_reviewable_credits)
 ON CONFLICT (provider_mode,refund_id) DO NOTHING;
 SELECT * INTO STRICT v FROM public.qf_vendor_package_refund_reviews_by_refund_candidate_v3
  WHERE provider_mode=p_provider_mode AND refund_id=b.refund_id;
 RETURN jsonb_build_object('event_id',p_event_id,'provider_mode',p_provider_mode,
  'refund_id',b.refund_id,'payment_id',b.payment_id,
  'identity_mac',b.identity_mac,'mac_key_id',b.mac_key_id,
  'status',CASE WHEN v.event_id=p_event_id AND v.payment_id=b.payment_id AND
     v.reviewer_id=p_reviewer_id AND v.decision=p_decision AND
     v.reviewable_credits IS NOT DISTINCT FROM p_reviewable_credits
    THEN 'reviewed' ELSE 'review_conflict' END,
  'decision',v.decision,'reviewable_credits',v.reviewable_credits);
END $f$;

REVOKE ALL ON FUNCTION public.qf_refund_identity_v4_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.qf_refund_review_v3_identity_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.qf_bind_vendor_package_refund_identity_v4(
 text,text,text,text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.qf_get_vendor_package_refund_identity_v4(text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.qf_review_vendor_package_refund_intake_v4(
 text,text,text,uuid,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.qf_bind_vendor_package_refund_identity_v4(
 text,text,text,text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.qf_get_vendor_package_refund_identity_v4(text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.qf_review_vendor_package_refund_intake_v4(
 text,text,text,uuid,text,integer) TO service_role;
