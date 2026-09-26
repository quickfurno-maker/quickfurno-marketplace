-- ============================================================================
-- QuickFurno — vendor package Razorpay TEST-mode payment authority
-- Source only. This migration does not contact Razorpay and does not enable live payments.
--
-- Invariants:
--   * vendor_package_orders is the immutable purchase snapshot;
--   * payments.id = vendor_package_orders.id is the stable payment identity;
--   * only service_role can bind/activate a package payment;
--   * credits flow only through qf_apply_vendor_credit_delta;
--   * activation is exact-once under duplicate/concurrent callbacks.
-- ============================================================================

begin;

alter table public.vendor_package_orders
  add column if not exists provider_amount_subunits bigint,
  add column if not exists provider_receipt text,
  add column if not exists provider_order_request_token uuid,
  add column if not exists provider_order_requested_at timestamptz;

create unique index if not exists uq_vendor_package_orders_provider_order
  on public.vendor_package_orders(provider_order_id)
  where provider_order_id is not null;

create unique index if not exists uq_vendor_package_orders_provider_payment
  on public.vendor_package_orders(provider_payment_id)
  where provider_payment_id is not null;

-- Orders are created by the server; vendors never need direct table writes.
revoke all on table public.vendor_package_orders from public, anon, authenticated;
grant all on table public.vendor_package_orders to service_role;
-- Expand only the order lifecycle vocabulary needed by verified completion.
alter table public.vendor_package_orders
  drop constraint if exists vendor_package_orders_order_status_check;
alter table public.vendor_package_orders
  add constraint vendor_package_orders_order_status_check
  check (order_status in ('created', 'completed', 'cancelled', 'expired'));


create or replace function public.qf_claim_vendor_package_razorpay_order_v1(
  p_order_id uuid,
  p_request_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $
declare
  v_order public.vendor_package_orders%rowtype;
  v_pkg public.packages%rowtype;
  v_expected_amount bigint;
  v_expected_receipt text;
begin
  if p_request_token is null then
    raise exception 'PROVIDER_ORDER_REQUEST_TOKEN_REQUIRED' using errcode = 'P0001';
  end if;

  select * into v_order from public.vendor_package_orders
  where id = p_order_id for update;
  if not found then raise exception 'PACKAGE_ORDER_NOT_FOUND' using errcode = 'P0002'; end if;

  if v_order.provider_order_id is not null then
    return jsonb_build_object('status','already_bound','provider_order_id',v_order.provider_order_id);
  end if;
  if v_order.provider_order_request_token is not null
     and v_order.provider_order_request_token is distinct from p_request_token then
    raise exception 'PROVIDER_ORDER_CREATION_UNCERTAIN' using errcode = 'P0001';
  end if;
  if v_order.provider_order_request_token is distinct from p_request_token then
    raise exception 'PROVIDER_ORDER_REQUEST_TOKEN_MISMATCH' using errcode = 'P0001';
  end if;

  if v_order.order_status <> 'created' or v_order.activation_status = 'activated' then
    raise exception 'PACKAGE_ORDER_NOT_PAYABLE' using errcode = 'P0001';
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
         payment_provider = 'razorpay_test',
         payment_method = 'razorpay_test',
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
$;

revoke all on function public.qf_claim_vendor_package_razorpay_order_v1(uuid,uuid) from public, anon, authenticated;
grant execute on function public.qf_claim_vendor_package_razorpay_order_v1(uuid,uuid) to service_role;

create or replace function public.qf_release_vendor_package_razorpay_order_claim_v1(
  p_order_id uuid,
  p_request_token uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $
begin
  update public.vendor_package_orders
     set provider_order_request_token = null,
         payment_status = 'not_started',
         payment_provider = 'not_connected',
         payment_method = 'online_future',
         failure_reason = null,
         updated_at = now()
   where id = p_order_id
     and provider_order_id is null
     and provider_order_request_token = p_request_token
     and activation_status <> 'activated';
end;
$;

revoke all on function public.qf_release_vendor_package_razorpay_order_claim_v1(uuid,uuid) from public, anon, authenticated;
grant execute on function public.qf_release_vendor_package_razorpay_order_claim_v1(uuid,uuid) to service_role;

create or replace function public.qf_bind_vendor_package_razorpay_order_v1(
  p_order_id uuid,
  p_provider_order_id text,
  p_amount_subunits bigint,
  p_receipt text,
  p_request_token uuid
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

  if v_order.order_status <> 'created' or v_order.activation_status = 'activated' then
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
           payment_provider = 'razorpay_test',
           payment_method = 'razorpay_test',
           payment_status = 'pending',
           failure_reason = null,
           updated_at = now()
     where id = p_order_id;
  end if;
  insert into public.payments (
    id, vendor_id, package_id, amount, payment_method, payment_status, transaction_id
  ) values (
    p_order_id, v_order.vendor_id, v_order.package_id, v_order.package_price,
    'razorpay_test', 'Pending', null
  )
  on conflict (id) do nothing;

  select * into v_payment from public.payments where id = p_order_id for update;
  if not found then raise exception 'PAYMENT_BIND_FAILED' using errcode = 'P0001'; end if;
  if v_payment.vendor_id is distinct from v_order.vendor_id
     or v_payment.package_id is distinct from v_order.package_id
     or v_payment.amount is distinct from v_order.package_price
     or v_payment.payment_method is distinct from 'razorpay_test'
     or v_payment.payment_status not in ('Pending', 'Failed', 'Paid') then
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

revoke all on function public.qf_bind_vendor_package_razorpay_order_v1(uuid,text,bigint,text,uuid) from public, anon, authenticated;
grant execute on function public.qf_bind_vendor_package_razorpay_order_v1(uuid,text,bigint,text,uuid) to service_role;
create or replace function public.qf_activate_vendor_package_order_v1(
  p_order_id uuid,
  p_provider_payment_id text
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
  if coalesce(trim(p_provider_payment_id), '') = '' then
    raise exception 'PROVIDER_PAYMENT_ID_REQUIRED' using errcode = 'P0001';
  end if;

  select * into v_order
  from public.vendor_package_orders
  where id = p_order_id
  for update;
  if not found then raise exception 'PACKAGE_ORDER_NOT_FOUND' using errcode = 'P0002'; end if;

  if v_order.payment_provider is distinct from 'razorpay_test'
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
     or v_payment.payment_method is distinct from 'razorpay_test' then
    raise exception 'PAYMENT_ORDER_MISMATCH' using errcode = 'P0001';
  end if;
  if v_payment.payment_status = 'Paid'
     and v_payment.transaction_id is distinct from p_provider_payment_id then
    raise exception 'PAYMENT_ID_MISMATCH' using errcode = 'P0001';
  end if;
  if v_payment.payment_status = 'Refunded' then
    raise exception 'PAYMENT_REFUNDED' using errcode = 'P0001';
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
    'qf_activate_vendor_package_order_v1',
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
         payment_method = 'razorpay_test',
         payment_provider = 'razorpay_test',
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
revoke all on function public.qf_activate_vendor_package_order_v1(uuid,text) from public, anon, authenticated;
grant execute on function public.qf_activate_vendor_package_order_v1(uuid,text) to service_role;

create or replace function public.qf_mark_vendor_package_payment_failed_v1(
  p_order_id uuid,
  p_provider_payment_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $
declare
  v_order public.vendor_package_orders%rowtype;
  v_payment public.payments%rowtype;
begin
  select * into v_order from public.vendor_package_orders
  where id = p_order_id for update;
  if not found then raise exception 'PACKAGE_ORDER_NOT_FOUND' using errcode = 'P0002'; end if;

  if v_order.payment_provider is distinct from 'razorpay_test'
     or v_order.provider_order_id is null then
    raise exception 'PACKAGE_ORDER_NOT_BOUND' using errcode = 'P0001';
  end if;
  if v_order.activation_status = 'activated' then
    return jsonb_build_object('status','ignored_activated','order_id',p_order_id);
  end if;

  select * into v_payment from public.payments where id = p_order_id for update;
  if not found then raise exception 'PAYMENT_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_payment.payment_status = 'Paid' then
    return jsonb_build_object('status','ignored_paid','order_id',p_order_id);
  end if;
  if v_payment.payment_status = 'Refunded' then
    return jsonb_build_object('status','ignored_refunded','order_id',p_order_id);
  end if;

  update public.payments set payment_status = 'Failed'
  where id = p_order_id and payment_status not in ('Paid','Refunded');
  update public.vendor_package_orders
     set payment_status = 'failed',
         failure_reason = 'Razorpay test payment failed. You can retry this order.',
         updated_at = now()
   where id = p_order_id;

  return jsonb_build_object(
    'status','marked_failed',
    'order_id',p_order_id,
    'provider_payment_id',nullif(trim(p_provider_payment_id),'')
  );
end;
$;

revoke all on function public.qf_mark_vendor_package_payment_failed_v1(uuid,text) from public, anon, authenticated;
grant execute on function public.qf_mark_vendor_package_payment_failed_v1(uuid,text) to service_role;


-- Fail closed if either financial authority is exposed to browser roles.
do $$
begin
  if has_function_privilege('anon', 'public.qf_bind_vendor_package_razorpay_order_v1(uuid,text,bigint,text,uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.qf_bind_vendor_package_razorpay_order_v1(uuid,text,bigint,text,uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.qf_activate_vendor_package_order_v1(uuid,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.qf_activate_vendor_package_order_v1(uuid,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.qf_claim_vendor_package_razorpay_order_v1(uuid,uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.qf_release_vendor_package_razorpay_order_claim_v1(uuid,uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.qf_mark_vendor_package_payment_failed_v1(uuid,text)', 'EXECUTE') then
    raise exception 'VENDOR_PACKAGE_PAYMENT_AUTHORITY_EXPOSED';
  end if;

  if has_table_privilege('authenticated', 'public.vendor_package_orders', 'INSERT')
     or has_table_privilege('authenticated', 'public.vendor_package_orders', 'UPDATE')
     or has_table_privilege('authenticated', 'public.vendor_package_orders', 'DELETE') then
    raise exception 'VENDOR_PACKAGE_ORDER_BROWSER_WRITE_EXPOSED';
  end if;
end $$;

commit;
