-- VOX RC17-A Razorpay V2 transactional authority candidate.
-- REVIEW ONLY / UNINSTALLED / NEVER AUTO-APPLY. DO NOT DEPLOY.
-- Historical V1 file is immutable; any V1 delimiter/claim issue must be
-- independently adjudicated against managed schema and a true local replay.
-- Requires qualified DBA/AppSec and recoverable staging proof before approval.
BEGIN;
ALTER TABLE public.vendor_package_orders ADD COLUMN IF NOT EXISTS provider_mode text;
ALTER TABLE public.vendor_package_orders
 DROP CONSTRAINT IF EXISTS qf_razorpay_v2_mode_check;
ALTER TABLE public.vendor_package_orders
 ADD CONSTRAINT qf_razorpay_v2_mode_check CHECK (
  (payment_provider='razorpay' AND provider_mode IS NOT NULL AND provider_mode IN ('test','live'))
  OR (payment_provider IS DISTINCT FROM 'razorpay' AND provider_mode IS NULL)
 );
REVOKE ALL ON TABLE public.vendor_package_orders FROM PUBLIC,anon,authenticated;
GRANT ALL ON TABLE public.vendor_package_orders TO service_role;
create or replace function public.qf_claim_vendor_package_razorpay_order_v2(
  p_order_id uuid,
  p_request_token uuid,
  p_provider_mode text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_order public.vendor_package_orders%rowtype;
  v_pkg public.packages%rowtype;
  v_expected_amount bigint;
  v_expected_receipt text;
begin
  IF p_provider_mode IS NULL OR p_provider_mode NOT IN ('test','live') THEN
    RAISE EXCEPTION 'RAZORPAY_V2_MODE_REQUIRED' USING errcode='P0001';
  END IF;
  if p_request_token is null then
    raise exception 'PROVIDER_ORDER_REQUEST_TOKEN_REQUIRED' using errcode = 'P0001';
  end if;

  select * into v_order from public.vendor_package_orders
  where id = p_order_id for update;
  if not found then raise exception 'PACKAGE_ORDER_NOT_FOUND' using errcode = 'P0002'; end if;

  if v_order.order_status is distinct from 'created' or
     v_order.activation_status is distinct from 'not_activated' or
     v_order.payment_status is null or
     v_order.payment_status not in ('not_started','pending','failed') then
    raise exception 'PACKAGE_ORDER_NOT_PAYABLE' using errcode = 'P0001';
  end if;

  if v_order.provider_order_id is not null then
    if v_order.payment_provider is distinct from 'razorpay' or
       v_order.provider_mode is distinct from p_provider_mode then
      raise exception 'RAZORPAY_V2_BOUND_MODE_MISMATCH' using errcode='P0001';
    end if;
    return jsonb_build_object('status','already_bound','provider_order_id',v_order.provider_order_id);
  end if;
  -- An uncertain provider POST may have succeeded; never automatically retry it.
  if v_order.provider_order_request_token is not null then
    raise exception 'PROVIDER_ORDER_CREATION_UNCERTAIN' using errcode='P0001';
  end if;
  -- Only a pristine not-connected order can start a new provider claim.
  -- SQL NOT IN returns UNKNOWN for NULL; IS DISTINCT FROM also denies NULL.
  -- Bound/uncertain 'razorpay' orders were already handled above.
  if v_order.payment_provider is distinct from 'not_connected' or
     v_order.provider_mode is not null then
    raise exception 'RAZORPAY_V2_PROVIDER_OR_MODE_MISMATCH' using errcode='P0001';
  end if;

  if v_order.package_id is null or v_order.package_currency is distinct from 'INR' then
    raise exception 'PACKAGE_ORDER_SNAPSHOT_INVALID' using errcode = 'P0001';
  end if;

  select * into v_pkg from public.packages where id = v_order.package_id;
  if not found or v_pkg.is_active is distinct from true then
    raise exception 'PACKAGE_NOT_ACTIVE' using errcode = 'P0001';
  end if;
  if v_order.package_name is distinct from v_pkg.name
     or v_order.package_price is distinct from v_pkg.total_price
     or v_order.credits_included is distinct from v_pkg.lead_count
     or v_order.validity_days is distinct from v_pkg.validity_days then
    raise exception 'PACKAGE_SNAPSHOT_DRIFT' using errcode = 'P0001';
  end if;
  if v_order.package_price is null or v_order.package_price <= 0 then
    raise exception 'PACKAGE_PRICE_INVALID' using errcode = 'P0001';
  end if;

  v_expected_amount := round(v_order.package_price * 100)::bigint;
  v_expected_receipt := 'qfvp_' || replace(p_order_id::text, '-', '');
  update public.vendor_package_orders
     set provider_order_request_token = p_request_token,
         provider_order_requested_at = coalesce(provider_order_requested_at, now()),
         payment_status = 'pending',
         payment_provider = 'razorpay',
          provider_mode = p_provider_mode,
         payment_method = 'razorpay',
         failure_reason = null,
         updated_at = now()
   where id = p_order_id;

  return jsonb_build_object(
    'status','claimed',
    'order_id',p_order_id,
    'amount_subunits',v_expected_amount,
    'receipt',v_expected_receipt,
    'currency','INR'
  );
end;
$$;

revoke all on function public.qf_claim_vendor_package_razorpay_order_v2(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.qf_claim_vendor_package_razorpay_order_v2(uuid,uuid,text) to service_role;


create or replace function public.qf_release_vendor_package_razorpay_order_claim_v2(
  p_order_id uuid,
  p_request_token uuid,
  p_provider_mode text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  IF p_provider_mode IS NULL OR p_provider_mode NOT IN ('test','live') THEN
    RAISE EXCEPTION 'RAZORPAY_V2_MODE_REQUIRED' USING errcode='P0001';
  END IF;
  update public.vendor_package_orders
     set provider_order_request_token = null,
         payment_status = 'not_started',
         payment_provider = 'not_connected',
          provider_mode = null,
         payment_method = 'online_future',
         failure_reason = null,
         updated_at = now()
   where id = p_order_id
     and provider_order_id is null
     and provider_order_request_token = p_request_token
      and payment_provider='razorpay' and provider_mode=p_provider_mode
     and activation_status <> 'activated';
  if not found then raise exception 'RAZORPAY_V2_CLAIM_RELEASE_DENIED' using errcode='P0001'; end if;
end;
$$;

revoke all on function public.qf_release_vendor_package_razorpay_order_claim_v2(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.qf_release_vendor_package_razorpay_order_claim_v2(uuid,uuid,text) to service_role;


create or replace function public.qf_bind_vendor_package_razorpay_order_v2(
  p_order_id uuid,
  p_provider_order_id text,
  p_amount_subunits bigint,
  p_receipt text,
  p_request_token uuid,
  p_provider_mode text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_order public.vendor_package_orders%rowtype;
  v_pkg public.packages%rowtype;
  v_payment public.payments%rowtype;
  v_expected_amount bigint;
  v_expected_receipt text;
begin
  IF p_provider_mode IS NULL OR p_provider_mode NOT IN ('test','live') THEN
    RAISE EXCEPTION 'RAZORPAY_V2_MODE_REQUIRED' USING errcode='P0001';
  END IF;
  if coalesce(trim(p_provider_order_id), '') = '' then
    raise exception 'PROVIDER_ORDER_ID_REQUIRED' using errcode = 'P0001';
  end if;
  if p_request_token is null then
    raise exception 'PROVIDER_ORDER_REQUEST_TOKEN_REQUIRED' using errcode = 'P0001';
  end if;
  select * into v_order
  from public.vendor_package_orders
  where id = p_order_id
  for update;
  if not found then raise exception 'PACKAGE_ORDER_NOT_FOUND' using errcode = 'P0002'; end if;

  if v_order.payment_provider is distinct from 'razorpay' or
     v_order.provider_mode is distinct from p_provider_mode or
     (v_order.provider_order_id is null and v_order.provider_order_request_token is distinct from p_request_token) then
    raise exception 'RAZORPAY_V2_BIND_TOKEN_OR_MODE_MISMATCH' using errcode='P0001';
  end if;
  if v_order.order_status is distinct from 'created' or
     v_order.activation_status is distinct from 'not_activated' or
     v_order.payment_status is null or
     v_order.payment_status not in ('pending','failed') then
    raise exception 'PACKAGE_ORDER_NOT_PAYABLE' using errcode = 'P0001';
  end if;
  if v_order.package_id is null then
    raise exception 'PACKAGE_ORDER_PACKAGE_MISSING' using errcode = 'P0001';
  end if;
  if v_order.package_currency is distinct from 'INR' then
    raise exception 'PACKAGE_ORDER_CURRENCY_INVALID' using errcode = 'P0001';
  end if;

  select * into v_pkg from public.packages where id = v_order.package_id;
  if not found or v_pkg.is_active is distinct from true then
    raise exception 'PACKAGE_NOT_ACTIVE' using errcode = 'P0001';
  end if;

  if v_order.package_name is distinct from v_pkg.name
     or v_order.package_price is distinct from v_pkg.total_price
     or v_order.credits_included is distinct from v_pkg.lead_count
     or v_order.validity_days is distinct from v_pkg.validity_days then
    raise exception 'PACKAGE_SNAPSHOT_DRIFT' using errcode = 'P0001';
  end if;
  if v_order.package_price is null or v_order.package_price <= 0 then
    raise exception 'PACKAGE_PRICE_INVALID' using errcode = 'P0001';
  end if;
  v_expected_amount := round(v_order.package_price * 100)::bigint;
  v_expected_receipt := 'qfvp_' || replace(p_order_id::text, '-', '');
  if p_amount_subunits is distinct from v_expected_amount then
    raise exception 'PROVIDER_AMOUNT_MISMATCH' using errcode = 'P0001';
  end if;
  if p_receipt is distinct from v_expected_receipt or length(p_receipt) > 40 then
    raise exception 'PROVIDER_RECEIPT_MISMATCH' using errcode = 'P0001';
  end if;

  if v_order.provider_order_id is not null then
    if v_order.provider_order_id is distinct from p_provider_order_id
       or v_order.provider_amount_subunits is distinct from p_amount_subunits
       or v_order.provider_receipt is distinct from p_receipt then
      raise exception 'PACKAGE_ORDER_ALREADY_BOUND' using errcode = 'P0001';
    end if;
  else
    update public.vendor_package_orders
       set provider_order_id = p_provider_order_id,
           provider_amount_subunits = p_amount_subunits,
           provider_receipt = p_receipt,
           provider_order_request_token = null,
           payment_provider = 'razorpay',
            provider_mode = p_provider_mode,
           payment_method = 'razorpay',
           payment_status = 'pending',
           failure_reason = null,
           updated_at = now()
     where id = p_order_id;
  end if;
  insert into public.payments (
    id, vendor_id, package_id, amount, payment_method, payment_status, transaction_id
  ) values (
    p_order_id, v_order.vendor_id, v_order.package_id, v_order.package_price,
    'razorpay', 'Pending', null
  )
  on conflict (id) do nothing;

  select * into v_payment from public.payments where id = p_order_id for update;
  if not found then raise exception 'PAYMENT_BIND_FAILED' using errcode = 'P0001'; end if;
  if v_payment.vendor_id is distinct from v_order.vendor_id
     or v_payment.package_id is distinct from v_order.package_id
     or v_payment.amount is distinct from v_order.package_price
     or v_payment.payment_method is distinct from 'razorpay'
     or v_payment.payment_status is null
     or v_payment.payment_status not in ('Pending', 'Failed') then
    raise exception 'PAYMENT_BIND_DRIFT' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'status', case when v_order.provider_order_id is null then 'bound' else 'already_bound' end,
    'order_id', p_order_id,
    'provider_order_id', p_provider_order_id,
    'amount_subunits', p_amount_subunits,
    'currency', 'INR'
  );
end;
$$;

revoke all on function public.qf_bind_vendor_package_razorpay_order_v2(uuid,text,bigint,text,uuid,text) from public, anon, authenticated;
grant execute on function public.qf_bind_vendor_package_razorpay_order_v2(uuid,text,bigint,text,uuid,text) to service_role;

create or replace function public.qf_activate_vendor_package_order_v2(
  p_order_id uuid,
  p_provider_payment_id text,
  p_provider_mode text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_order public.vendor_package_orders%rowtype;
  v_payment public.payments%rowtype;
  v_vendor_package_id uuid;
  v_vendor public.vendors%rowtype;
  v_base timestamptz;
  v_expiry timestamptz;
  v_credit_result jsonb;
begin
  IF p_provider_mode IS NULL OR p_provider_mode NOT IN ('test','live') THEN
    RAISE EXCEPTION 'RAZORPAY_V2_MODE_REQUIRED' USING errcode='P0001';
  END IF;
  if coalesce(trim(p_provider_payment_id), '') = '' then
    raise exception 'PROVIDER_PAYMENT_ID_REQUIRED' using errcode = 'P0001';
  end if;

  select * into v_order
  from public.vendor_package_orders
  where id = p_order_id
  for update;
  if not found then raise exception 'PACKAGE_ORDER_NOT_FOUND' using errcode = 'P0002'; end if;

  if v_order.payment_provider is distinct from 'razorpay'
      or v_order.provider_mode is distinct from p_provider_mode
     or v_order.provider_order_id is null
     or v_order.provider_amount_subunits is null then
    raise exception 'PACKAGE_ORDER_NOT_BOUND' using errcode = 'P0001';
  end if;
  if v_order.activation_status = 'activated' then
    if v_order.provider_payment_id is distinct from p_provider_payment_id then
      raise exception 'PROVIDER_PAYMENT_ID_MISMATCH' using errcode = 'P0001';
    end if;
    return jsonb_build_object(
      'status', 'already_applied',
      'order_id', p_order_id,
      'credits_added', 0
    );
  end if;
  -- Provider capture does not revive a cancelled, expired or refunded order.
  -- Hold any refund-in-progress outcome for independent financial reconciliation.
  if v_order.order_status is distinct from 'created' or
     v_order.activation_status is distinct from 'not_activated' or
     v_order.payment_status is null or
     v_order.payment_status not in ('pending','failed') then
    raise exception 'PACKAGE_ORDER_LIFECYCLE_NOT_ACTIVATABLE' using errcode='P0001';
  end if;

  if v_order.package_id is null
     or v_order.package_price is null
     or v_order.package_price <= 0
     or coalesce(v_order.credits_included, 0) <= 0
     or coalesce(v_order.validity_days, 0) <= 0
     or v_order.package_currency is distinct from 'INR' then
    raise exception 'PACKAGE_ORDER_SNAPSHOT_INVALID' using errcode = 'P0001';
  end if;

  if v_order.provider_amount_subunits is distinct from round(v_order.package_price * 100)::bigint then
    raise exception 'PACKAGE_ORDER_AMOUNT_DRIFT' using errcode = 'P0001';
  end if;

  if v_order.provider_payment_id is not null
     and v_order.provider_payment_id is distinct from p_provider_payment_id then
    raise exception 'PROVIDER_PAYMENT_ID_MISMATCH' using errcode = 'P0001';
  end if;
  select * into v_payment
  from public.payments
  where id = p_order_id
  for update;
  if not found then raise exception 'PAYMENT_NOT_FOUND' using errcode = 'P0002'; end if;

  if v_payment.vendor_id is distinct from v_order.vendor_id
     or v_payment.package_id is distinct from v_order.package_id
     or v_payment.amount is distinct from v_order.package_price
     or v_payment.payment_method is distinct from 'razorpay' then
    raise exception 'PAYMENT_ORDER_MISMATCH' using errcode = 'P0001';
  end if;
  if v_payment.payment_status = 'Paid'
     and v_payment.transaction_id is distinct from p_provider_payment_id then
    raise exception 'PAYMENT_ID_MISMATCH' using errcode = 'P0001';
  end if;
  if v_payment.payment_status = 'Refunded' then
    raise exception 'PAYMENT_REFUNDED' using errcode = 'P0001';
  end if;
  -- A legacy/manual Paid row (even for the same payment ID) does not prove
  -- this Core transaction already granted package credits. Reconcile it
  -- independently; do not turn unknown ledger state into a second credit grant.
  if v_payment.payment_status is null or
     v_payment.payment_status not in ('Pending','Failed') or
     v_payment.transaction_id is not null then
    raise exception 'PACKAGE_PAYMENT_LEDGER_NOT_ACTIVATABLE' using errcode='P0001';
  end if;

  if exists (
    select 1 from public.vendor_credit_logs
    where reference_type = 'package_purchase'
      and reference_id = p_order_id::text
  ) then
    raise exception 'PACKAGE_ORDER_LEDGER_DRIFT' using errcode = 'P0001';
  end if;

  select * into v_vendor from public.vendors where id = v_order.vendor_id for update;
  if not found then raise exception 'VENDOR_NOT_FOUND' using errcode = 'P0002'; end if;

  v_base := greatest(now(), coalesce(v_vendor.package_expires_at, now()));
  v_expiry := v_base + make_interval(days => v_order.validity_days);
  update public.payments
     set payment_status = 'Paid',
         transaction_id = p_provider_payment_id
   where id = p_order_id;

  insert into public.vendor_packages (
    vendor_id, package_id, expiry_date, total_leads, remaining_leads,
    price_paid, payment_status, status
  ) values (
    v_order.vendor_id, v_order.package_id, v_expiry,
    v_order.credits_included, v_order.credits_included,
    v_order.package_price, 'Paid', 'Active'
  ) returning id into v_vendor_package_id;

  select public.qf_apply_vendor_credit_delta(
    v_order.vendor_id,
    v_order.credits_included,
    'package_purchase',
    format('Package purchase: %s', coalesce(v_order.package_name, '')),
    'package_purchase',
    p_order_id::text,
    'qf_activate_vendor_package_order_v2',
    false
  ) into v_credit_result;

  if coalesce(v_credit_result->>'status', '') <> 'applied' then
    raise exception 'PACKAGE_CREDIT_GRANT_NOT_APPLIED' using errcode = 'P0001';
  end if;
  update public.vendors
     set package_name = v_order.package_name,
         package_status = 'active',
         package_expires_at = v_expiry,
         paid_status = 'Paid'
   where id = v_order.vendor_id;

  perform public.update_vendor_visibility(v_order.vendor_id);

  update public.vendor_package_orders
     set order_status = 'completed',
         payment_status = 'paid',
         payment_method = 'razorpay',
         payment_provider = 'razorpay',
          provider_mode = p_provider_mode,
         provider_payment_id = p_provider_payment_id,
         paid_at = coalesce(paid_at, now()),
         activation_status = 'activated',
         activated_at = coalesce(activated_at, now()),
         failure_reason = null,
         updated_at = now()
   where id = p_order_id;

  return jsonb_build_object(
    'status', 'applied',
    'order_id', p_order_id,
    'vendor_package_id', v_vendor_package_id,
    'credits_added', v_order.credits_included,
    'expires_at', v_expiry
  );
end;
$$;
revoke all on function public.qf_activate_vendor_package_order_v2(uuid,text,text) from public, anon, authenticated;
grant execute on function public.qf_activate_vendor_package_order_v2(uuid,text,text) to service_role;


create or replace function public.qf_mark_vendor_package_payment_failed_v2(
  p_order_id uuid,
  p_provider_payment_id text,
  p_provider_mode text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_order public.vendor_package_orders%rowtype;
  v_payment public.payments%rowtype;
begin
  IF p_provider_mode IS NULL OR p_provider_mode NOT IN ('test','live') THEN
    RAISE EXCEPTION 'RAZORPAY_V2_MODE_REQUIRED' USING errcode='P0001';
  END IF;
  select * into v_order from public.vendor_package_orders
  where id = p_order_id for update;
  if not found then raise exception 'PACKAGE_ORDER_NOT_FOUND' using errcode = 'P0002'; end if;

  if v_order.payment_provider is distinct from 'razorpay'
      or v_order.provider_mode is distinct from p_provider_mode
     or v_order.provider_order_id is null then
    raise exception 'PACKAGE_ORDER_NOT_BOUND' using errcode = 'P0001';
  end if;
  if v_order.activation_status = 'activated' then
    return jsonb_build_object('status','ignored_activated','order_id',p_order_id);
  end if;
  -- Late failure notifications must never downgrade a known refunded order.
  if v_order.payment_status = 'refunded' then
    return jsonb_build_object('status','ignored_refunded','order_id',p_order_id);
  end if;
  if v_order.order_status is distinct from 'created' then
    return jsonb_build_object('status','ignored_closed','order_id',p_order_id);
  end if;

  select * into v_payment from public.payments where id = p_order_id for update;
  if not found then raise exception 'PAYMENT_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_payment.payment_status = 'Paid' then
    return jsonb_build_object('status','ignored_paid','order_id',p_order_id);
  end if;
  if v_payment.payment_status = 'Refunded' then
    return jsonb_build_object('status','ignored_refunded','order_id',p_order_id);
  end if;
  -- A missing or inconsistent financial status is not an ordinary failed
  -- attempt. Escalate for reconciliation rather than overwriting evidence.
  if v_order.payment_status is null or
     v_order.payment_status not in ('pending','failed') or
     v_payment.payment_status is null or
     v_payment.payment_status not in ('Pending','Failed') then
    raise exception 'PAYMENT_FAILURE_LEDGER_UNVERIFIED' using errcode='P0001';
  end if;

  update public.payments set payment_status = 'Failed'
  where id = p_order_id and payment_status not in ('Paid','Refunded');
  update public.vendor_package_orders
     set payment_status = 'failed',
         failure_reason = 'Razorpay failure observed. Reconcile before another payment attempt.',
         updated_at = now()
   where id = p_order_id;

  return jsonb_build_object(
    'status','marked_failed',
    'order_id',p_order_id,
    'provider_payment_id',nullif(trim(p_provider_payment_id),'')
  );
end;
$$;

revoke all on function public.qf_mark_vendor_package_payment_failed_v2(uuid,text,text) from public, anon, authenticated;
grant execute on function public.qf_mark_vendor_package_payment_failed_v2(uuid,text,text) to service_role;


-- SECURITY / AUTHORITY CHECKS (new V2 grants only).
DO $rc17$
DECLARE f text;
BEGIN
 FOREACH f IN ARRAY ARRAY[
  'qf_claim_vendor_package_razorpay_order_v2(uuid,uuid,text)',
  'qf_release_vendor_package_razorpay_order_claim_v2(uuid,uuid,text)',
  'qf_bind_vendor_package_razorpay_order_v2(uuid,text,bigint,text,uuid,text)',
  'qf_activate_vendor_package_order_v2(uuid,text,text)',
  'qf_mark_vendor_package_payment_failed_v2(uuid,text,text)'
 ] LOOP
  IF has_function_privilege('anon','public.'||f,'EXECUTE') OR
     has_function_privilege('authenticated','public.'||f,'EXECUTE') THEN
   RAISE EXCEPTION 'RC17_V2_BROWSER_RPC_AUTHORITY_EXPOSED: %',f;
  END IF;
 END LOOP;
 IF has_table_privilege('authenticated','public.vendor_package_orders','INSERT') OR
    has_table_privilege('authenticated','public.vendor_package_orders','UPDATE') OR
    has_table_privilege('authenticated','public.vendor_package_orders','DELETE') THEN
  RAISE EXCEPTION 'RC17_V2_BROWSER_ORDER_DML_EXPOSED';
 END IF;
END $rc17$;
COMMIT;
