-- VOX RC11 Finance PAY2: provider-agnostic append-only attempt-event evidence.
-- REVIEW ONLY. UNINSTALLED. No payment status, credits, refunds or provider calls.
-- No direct vendor/browser/service_role DML; a separately scoped trusted
-- evidence recorder role and reviewed one-transaction Core adapter are required.
BEGIN;
CREATE TABLE public.vox_rc11_payment_attempt_events_candidate_v1 (
 event_id uuid PRIMARY KEY,
 order_id uuid NOT NULL REFERENCES public.vendor_package_orders(id) ON DELETE RESTRICT,
 attempt_id uuid NOT NULL,
 attempt_sequence integer NOT NULL CHECK(attempt_sequence BETWEEN 1 AND 1000),
 environment text NOT NULL CHECK(environment IN ('TEST','LIVE')),
 event_kind text NOT NULL CHECK(event_kind IN
  ('REQUESTED','PROVIDER_RESPONSE_RECEIVED','PROVIDER_ERROR',
   'TIMEOUT_UNCERTAIN','RECONCILIATION_PENDING','RECONCILIATION_OBSERVED')),
 request_token_hash text NOT NULL CHECK(request_token_hash ~ '^[a-f0-9]{64}$'),
 event_digest text NOT NULL CHECK(event_digest ~ '^[a-f0-9]{64}$'),
 origin text NOT NULL CHECK(origin IN
  ('CORE_CHECKOUT','WEBHOOK_RECOVERY','SCHEDULED_RECONCILIATION','AUTHORIZED_OPERATOR')),
 observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(attempt_id,attempt_sequence),
 UNIQUE(attempt_id,event_digest),
 CHECK(observed_at<=recorded_at+interval '5 minutes')
);
-- Do not infer a paid, refunded, or captured settlement from these audit rows.
CREATE INDEX vox_rc11_attempt_order_recent_idx
 ON public.vox_rc11_payment_attempt_events_candidate_v1(order_id,recorded_at DESC,event_id);
CREATE INDEX vox_rc11_attempt_id_idx
 ON public.vox_rc11_payment_attempt_events_candidate_v1(attempt_id,attempt_sequence);
CREATE OR REPLACE FUNCTION public.qf_vox_rc11_payment_attempt_append_guard_candidate_v1()
 RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE prior record; parent_order record;
BEGIN
 SELECT id,payment_provider INTO parent_order
 FROM public.vendor_package_orders WHERE id=NEW.order_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'RC11_PAYMENT_ORDER_MISSING'; END IF;
 IF NOT ((NEW.environment='TEST' AND parent_order.payment_provider='razorpay_test')
      OR (NEW.environment='LIVE' AND parent_order.payment_provider='razorpay_live'))
 THEN RAISE EXCEPTION 'RC11_PAYMENT_ATTEMPT_PROVIDER_MODE_MISMATCH'; END IF;
 -- Never associate one attempt with multiple orders/environments/tokens.
 SELECT order_id,environment,request_token_hash,attempt_sequence,recorded_at
 INTO prior
 FROM public.vox_rc11_payment_attempt_events_candidate_v1
 WHERE attempt_id=NEW.attempt_id
 ORDER BY attempt_sequence DESC LIMIT 1 FOR UPDATE;
 IF FOUND THEN
  IF prior.order_id<>NEW.order_id OR prior.environment<>NEW.environment
     OR prior.request_token_hash<>NEW.request_token_hash
     OR NEW.attempt_sequence<>prior.attempt_sequence+1
  THEN RAISE EXCEPTION 'RC11_PAYMENT_ATTEMPT_CROSS_SCOPE_OR_SEQUENCE';END IF;
 ELSE
  IF NEW.attempt_sequence<>1 OR NEW.event_kind<>'REQUESTED'
  THEN RAISE EXCEPTION 'RC11_PAYMENT_FIRST_EVENT_REQUIRED'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER vox_rc11_payment_attempt_append_guard BEFORE INSERT
 ON public.vox_rc11_payment_attempt_events_candidate_v1
 FOR EACH ROW EXECUTE FUNCTION public.qf_vox_rc11_payment_attempt_append_guard_candidate_v1();
CREATE OR REPLACE FUNCTION public.qf_vox_rc11_payment_attempt_immutable_candidate_v1()
 RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'RC11_PAYMENT_ATTEMPT_APPEND_ONLY'; END $$;
CREATE TRIGGER vox_rc11_payment_attempt_immutable BEFORE UPDATE OR DELETE
 ON public.vox_rc11_payment_attempt_events_candidate_v1
 FOR EACH ROW EXECUTE FUNCTION public.qf_vox_rc11_payment_attempt_immutable_candidate_v1();
ALTER TABLE public.vox_rc11_payment_attempt_events_candidate_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vox_rc11_payment_attempt_events_candidate_v1 FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.vox_rc11_payment_attempt_events_candidate_v1
 FROM PUBLIC,anon,authenticated,service_role;
-- Reviewed Owner Core API may read bounded evidence once staging gates approve.
-- This grants no insert/update/delete, no browser access and no direct provider role.
GRANT SELECT ON TABLE public.vox_rc11_payment_attempt_events_candidate_v1 TO service_role;
REVOKE ALL ON FUNCTION public.qf_vox_rc11_payment_attempt_append_guard_candidate_v1()
 FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.qf_vox_rc11_payment_attempt_immutable_candidate_v1()
 FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
