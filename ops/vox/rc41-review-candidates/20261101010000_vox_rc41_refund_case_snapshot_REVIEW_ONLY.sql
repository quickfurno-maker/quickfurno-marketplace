-- RC41 REVIEW-ONLY, NON-DEPLOYABLE candidate. NOT a Supabase migration and NOT applied
-- anywhere. Requires the RC28 provider-event ledger and RC38 refund-identity v4
-- candidate tables first. DBA/AppSec must review before any managed use.
-- Single STABLE read-only snapshot for ONE quarantined refund event, consumed by
-- app/api/vox/v1/finance/refund-intake/[providerMode]/[eventId]. It never writes.
--
-- Credits are pooled per vendor (vendors.remaining_credits), not stored per order.
-- Order attribution is therefore only claimed when UNAMBIGUOUS: the order must be the
-- vendor's only credit-bearing activated package order and the vendor's credit log must
-- hold nothing but package purchase / lead-assignment debit rows. Otherwise the function
-- RAISES so the case stays quarantined for human review; it never guesses.
CREATE FUNCTION public.qf_get_vendor_package_refund_case_snapshot_v1(
 p_event_id text,p_provider_mode text
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $f$
DECLARE
 e public.qf_vendor_package_provider_events_candidate_v2%ROWTYPE;
 b public.qf_vendor_package_refund_event_bindings_candidate_v4%ROWTYPE;
 o public.vendor_package_orders%ROWTYPE;
 n integer; v_remaining integer; v_debits jsonb;
BEGIN
 IF p_event_id IS NULL OR p_event_id !~ '^[A-Za-z0-9_-]{8,64}$'
    OR p_provider_mode IS NULL OR p_provider_mode NOT IN ('test','live') THEN
  RAISE EXCEPTION 'REFUND_CASE_INPUT_INVALID' USING ERRCODE='22023';
 END IF;
 SELECT * INTO e FROM public.qf_vendor_package_provider_events_candidate_v2
  WHERE provider_mode=p_provider_mode AND event_id=p_event_id;
 IF NOT FOUND OR e.event_type NOT LIKE 'refund.%' THEN
  RAISE EXCEPTION 'REFUND_CASE_EVENT_NOT_FOUND' USING ERRCODE='42501';
 END IF;
 SELECT * INTO b FROM public.qf_vendor_package_refund_event_bindings_candidate_v4
  WHERE provider_mode=p_provider_mode AND event_id=p_event_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'REFUND_IDENTITY_UNBOUND' USING ERRCODE='42501'; END IF;
 SELECT count(*) INTO n FROM public.vendor_package_orders WHERE provider_order_id=e.provider_order_id;
 IF n<>1 THEN RAISE EXCEPTION 'REFUND_CASE_ORDER_NOT_UNIQUE' USING ERRCODE='42501'; END IF;
 SELECT * INTO o FROM public.vendor_package_orders WHERE provider_order_id=e.provider_order_id;
 IF o.activation_status IS DISTINCT FROM 'activated' OR coalesce(o.credits_included,0)<=0 THEN
  RAISE EXCEPTION 'REFUND_CASE_ORDER_NOT_ACTIVATED' USING ERRCODE='42501';
 END IF;
 SELECT count(*) INTO n FROM public.vendor_package_orders
  WHERE vendor_id=o.vendor_id AND activation_status='activated' AND coalesce(credits_included,0)>0;
 IF n<>1 THEN RAISE EXCEPTION 'REFUND_CASE_CREDIT_ATTRIBUTION_AMBIGUOUS' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM public.vendor_credit_logs
   WHERE vendor_id=o.vendor_id AND change_type NOT IN ('package_purchase','lead_assignment_debit')) THEN
  RAISE EXCEPTION 'REFUND_CASE_CREDIT_ATTRIBUTION_AMBIGUOUS' USING ERRCODE='42501';
 END IF;
 IF EXISTS(SELECT 1 FROM public.vendor_credit_logs
   WHERE vendor_id=o.vendor_id AND change_type='lead_assignment_debit'
     AND (reference_type IS DISTINCT FROM 'lead_assignment' OR coalesce(credits_delta,0)<>-1
          OR reference_id IS NULL
          OR reference_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')) THEN
  RAISE EXCEPTION 'REFUND_CASE_DEBIT_SOURCE_INVALID' USING ERRCODE='42501';
 END IF;
 SELECT remaining_credits INTO v_remaining FROM public.vendors WHERE id=o.vendor_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'REFUND_CASE_VENDOR_NOT_FOUND' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('order_id',o.id,'vendor_id',o.vendor_id,
   'lead_id',l.reference_id::uuid,'credits',1) ORDER BY l.created_at,l.id),'[]'::jsonb)
  INTO v_debits FROM public.vendor_credit_logs l
  WHERE l.vendor_id=o.vendor_id AND l.change_type='lead_assignment_debit';
 IF jsonb_array_length(v_debits)>10000 THEN
  RAISE EXCEPTION 'REFUND_CASE_LEDGER_OVER_LIMIT' USING ERRCODE='42501';
 END IF;
 RETURN jsonb_build_object(
  'event',jsonb_build_object('event_id',e.event_id,'provider_mode',e.provider_mode,
   'body_sha256',e.body_sha256,'event_type',e.event_type,'payment_id',e.payment_id,
   'provider_order_id',e.provider_order_id,'status',e.status,'error_code',e.error_code),
  'identity',jsonb_build_object('event_id',b.event_id,'provider_mode',b.provider_mode,
   'body_sha256',b.body_sha256,'event_type',b.event_type,'refund_id',b.refund_id,
   'payment_id',b.payment_id,'provider_order_id',b.provider_order_id,
   'identity_mac',b.identity_mac,'mac_key_id',b.mac_key_id),
  'order',jsonb_build_object('id',o.id,'vendor_id',o.vendor_id,
   'provider_order_id',o.provider_order_id,'provider_payment_id',o.provider_payment_id),
  'ledger',jsonb_build_object('order_id',o.id,'vendor_id',o.vendor_id,
   'credits_granted',o.credits_included,'credits_remaining',v_remaining,'debits',v_debits));
END $f$;
REVOKE ALL ON FUNCTION public.qf_get_vendor_package_refund_case_snapshot_v1(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.qf_get_vendor_package_refund_case_snapshot_v1(text,text) TO service_role;
