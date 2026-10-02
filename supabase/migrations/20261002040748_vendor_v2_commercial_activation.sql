-- QuickFurno V2 — vendor commercial activation authority
-- Forward-only production migration for package scoping + Razorpay test/live runtime.
-- Core remains the only authority for package, payment, credits and expiry.
begin;

-- ---------------------------------------------------------------------------
-- Package governance
-- ---------------------------------------------------------------------------
alter table public.packages
  add column if not exists description text,
  add column if not exists sort_order integer not null default 100,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists updated_by text;

create table if not exists public.package_service_category_scopes (
  package_id uuid not null references public.packages(id) on delete cascade,
  service_category_id uuid not null references public.service_categories(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (package_id, service_category_id)
);

create table if not exists public.package_city_scopes (
  package_id uuid not null references public.packages(id) on delete cascade,
  city_id uuid not null references public.cities(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (package_id, city_id)
);

create index if not exists idx_package_category_scope_category
  on public.package_service_category_scopes(service_category_id, package_id);
create index if not exists idx_package_city_scope_city
  on public.package_city_scopes(city_id, package_id);
create index if not exists idx_packages_active_sort
  on public.packages(is_active, sort_order, lead_count);

alter table public.package_service_category_scopes enable row level security;
alter table public.package_city_scopes enable row level security;
revoke all on table public.package_service_category_scopes from public, anon, authenticated;
revoke all on table public.package_city_scopes from public, anon, authenticated;
grant all on table public.package_service_category_scopes to service_role;
grant all on table public.package_city_scopes to service_role;

create or replace function public.qf_admin_upsert_package_v1(
  p_package_id uuid,
  p_name text,
  p_lead_count integer,
  p_total_price numeric,
  p_validity_days integer,
  p_description text,
  p_sort_order integer,
  p_is_active boolean,
  p_category_ids uuid[],
  p_city_ids uuid[],
  p_updated_by text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_id uuid := coalesce(p_package_id, gen_random_uuid());
  v_name text := nullif(trim(p_name), '');
  v_category_ids uuid[] := coalesce(p_category_ids, array[]::uuid[]);
  v_city_ids uuid[] := coalesce(p_city_ids, array[]::uuid[]);
  v_expected integer;
  v_actual integer;
begin
  if v_name is null
     or coalesce(p_lead_count, 0) <= 0
     or coalesce(p_total_price, -1) < 0
     or coalesce(p_validity_days, 0) <= 0
     or coalesce(p_sort_order, 0) < 0 then
    raise exception 'PACKAGE_VALIDATION_FAILED' using errcode = 'P0001';
  end if;

  select count(*) into v_expected from (select distinct unnest(v_category_ids)) s;
  select count(*) into v_actual from public.service_categories where id = any(v_category_ids);
  if v_actual <> v_expected then
    raise exception 'PACKAGE_CATEGORY_SCOPE_INVALID' using errcode = 'P0001';
  end if;

  select count(*) into v_expected from (select distinct unnest(v_city_ids)) s;
  select count(*) into v_actual from public.cities where id = any(v_city_ids);
  if v_actual <> v_expected then
    raise exception 'PACKAGE_CITY_SCOPE_INVALID' using errcode = 'P0001';
  end if;

  insert into public.packages (
    id, name, lead_count, price_per_lead, total_price, display_price,
    validity_days, is_active, description, sort_order, updated_at, updated_by
  ) values (
    v_id, v_name, p_lead_count,
    round((p_total_price / p_lead_count)::numeric, 2),
    p_total_price, p_total_price, p_validity_days,
    coalesce(p_is_active, true), nullif(trim(p_description), ''),
    p_sort_order, now(), nullif(trim(p_updated_by), '')
  )
  on conflict (id) do update set
    name = excluded.name,
    lead_count = excluded.lead_count,
    price_per_lead = excluded.price_per_lead,
    total_price = excluded.total_price,
    display_price = excluded.display_price,
    validity_days = excluded.validity_days,
    is_active = excluded.is_active,
    description = excluded.description,
    sort_order = excluded.sort_order,
    updated_at = now(),
    updated_by = excluded.updated_by;

  delete from public.package_service_category_scopes where package_id = v_id;
  insert into public.package_service_category_scopes(package_id, service_category_id)
  select v_id, id from (select distinct unnest(v_category_ids) as id) s;

  delete from public.package_city_scopes where package_id = v_id;
  insert into public.package_city_scopes(package_id, city_id)
  select v_id, id from (select distinct unnest(v_city_ids) as id) s;

  return jsonb_build_object('status', 'ok', 'package_id', v_id);
end;
$$;
revoke all on function public.qf_admin_upsert_package_v1(
  uuid,text,integer,numeric,integer,text,integer,boolean,uuid[],uuid[],text
) from public, anon, authenticated;
grant execute on function public.qf_admin_upsert_package_v1(
  uuid,text,integer,numeric,integer,text,integer,boolean,uuid[],uuid[],text
) to service_role;

-- ---------------------------------------------------------------------------
-- Razorpay provider binding. Runtime mode is explicit and audited per order.
-- ---------------------------------------------------------------------------
alter table public.vendor_package_orders
  add column if not exists provider_amount_subunits bigint,
  add column if not exists provider_receipt text,
  add column if not exists provider_order_request_token uuid,
  add column if not exists provider_order_requested_at timestamptz,
  add column if not exists provider_mode text;

alter table public.vendor_package_orders
  drop constraint if exists vendor_package_orders_provider_mode_check;
alter table public.vendor_package_orders
  add constraint vendor_package_orders_provider_mode_check
  check (provider_mode is null or provider_mode in ('test','live'));

create unique index if not exists uq_vendor_package_orders_provider_order
  on public.vendor_package_orders(provider_order_id)
  where provider_order_id is not null;
create unique index if not exists uq_vendor_package_orders_provider_payment
  on public.vendor_package_orders(provider_payment_id)
  where provider_payment_id is not null;

revoke all on table public.vendor_package_orders from public, anon, authenticated;
grant all on table public.vendor_package_orders to service_role;

create or replace function public.qf_claim_vendor_package_razorpay_order_v2(
  p_order_id uuid,
  p_request_token uuid,
  p_provider_mode text
) returns jsonb
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
  if p_request_token is null then
    raise exception 'PROVIDER_ORDER_REQUEST_TOKEN_REQUIRED' using errcode = 'P0001';
  end if;
  if p_provider_mode not in ('test','live') then
    raise exception 'PROVIDER_MODE_INVALID' using errcode = 'P0001';
  end if;

  select * into v_order from public.vendor_package_orders where id = p_order_id for update;
  if not found then raise exception 'PACKAGE_ORDER_NOT_FOUND' using errcode = 'P0002'; end if;

  if v_order.provider_order_id is not null then
    if v_order.provider_mode is distinct from p_provider_mode then
      raise exception 'PROVIDER_MODE_MISMATCH' using errcode = 'P0001';
    end if;
    return jsonb_build_object('status','already_bound','provider_order_id',v_order.provider_order_id);
  end if;

  if v_order.provider_order_request_token is not null
     and v_order.provider_order_request_token is distinct from p_request_token then
    raise exception 'PROVIDER_ORDER_CREATION_UNCERTAIN' using errcode = 'P0001';
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
         provider_mode = p_provider_mode,
         payment_status = 'pending',
         payment_provider = 'razorpay',
         payment_method = 'razorpay',
         failure_reason = null,
         updated_at = now()
   where id = p_order_id;

  return jsonb_build_object(
    'status','claimed',
    'order_id',p_order_id,
    'amount_subunits',v_expected_amount,
    'receipt',v_expected_receipt,
    'currency','INR',
    'provider_mode',p_provider_mode
  );
end;
$$;

create or replace function public.qf_release_vendor_package_razorpay_order_claim_v2(
  p_order_id uuid,
  p_request_token uuid,
  p_provider_mode text
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  update public.vendor_package_orders
     set provider_order_request_token = null,
         payment_status = 'not_started',
         payment_provider = 'not_connected',
         payment_method = 'online_future',
         provider_mode = null,
         failure_reason = null,
         updated_at = now()
   where id = p_order_id
     and provider_order_id is null
     and provider_order_request_token = p_request_token
     and provider_mode = p_provider_mode
     and activation_status <> 'activated';
end;
$$;

create or replace function public.qf_bind_vendor_package_razorpay_order_v2(
  p_order_id uuid,
  p_provider_order_id text,
  p_amount_subunits bigint,
  p_receipt text,
  p_request_token uuid,
  p_provider_mode text
) returns jsonb
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
  if p_provider_mode not in ('test','live') then
    raise exception 'PROVIDER_MODE_INVALID' using errcode = 'P0001';
  end if;

  select * into v_order from public.vendor_package_orders where id = p_order_id for update;
  if not found then raise exception 'PACKAGE_ORDER_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_order.order_status <> 'created' or v_order.activation_status = 'activated' then
    raise exception 'PACKAGE_ORDER_NOT_PAYABLE' using errcode = 'P0001';
  end if;
  if v_order.provider_mode is distinct from p_provider_mode then
    raise exception 'PROVIDER_MODE_MISMATCH' using errcode = 'P0001';
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
  ) on conflict (id) do nothing;

  select * into v_payment from public.payments where id = p_order_id for update;
  if not found then raise exception 'PAYMENT_BIND_FAILED' using errcode = 'P0001'; end if;
  if v_payment.vendor_id is distinct from v_order.vendor_id
     or v_payment.package_id is distinct from v_order.package_id
     or v_payment.amount is distinct from v_order.package_price
     or v_payment.payment_method is distinct from 'razorpay'
     or v_payment.payment_status not in ('Pending','Failed','Paid') then
    raise exception 'PAYMENT_BIND_DRIFT' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'status', case when v_order.provider_order_id is null then 'bound' else 'already_bound' end,
    'order_id', p_order_id,
    'provider_order_id', p_provider_order_id,
    'amount_subunits', p_amount_subunits,
    'currency','INR',
    'provider_mode',p_provider_mode
  );
end;
$$;

create or replace function public.qf_activate_vendor_package_order_v2(
  p_order_id uuid,
  p_provider_payment_id text,
  p_provider_mode text
) returns jsonb
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
  if p_provider_mode not in ('test','live') then
    raise exception 'PROVIDER_MODE_INVALID' using errcode = 'P0001';
  end if;

  select * into v_order from public.vendor_package_orders where id = p_order_id for update;
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
    return jsonb_build_object('status','already_applied','order_id',p_order_id,'credits_added',0);
  end if;

  if v_order.package_id is null
     or v_order.package_price is null
     or v_order.package_price <= 0
     or coalesce(v_order.credits_included,0) <= 0
     or coalesce(v_order.validity_days,0) <= 0
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

  select * into v_payment from public.payments where id = p_order_id for update;
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
    format('Package purchase: %s', coalesce(v_order.package_name,'')),
    'package_purchase',
    p_order_id::text,
    'qf_activate_vendor_package_order_v2',
    false
  ) into v_credit_result;

  if coalesce(v_credit_result->>'status','') <> 'applied' then
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
         provider_payment_id = p_provider_payment_id,
         provider_status = 'captured',
         paid_at = coalesce(paid_at, now()),
         activation_status = 'activated',
         activated_at = coalesce(activated_at, now()),
         failure_reason = null,
         updated_at = now()
   where id = p_order_id;

  return jsonb_build_object(
    'status','applied',
    'order_id',p_order_id,
    'vendor_package_id',v_vendor_package_id,
    'credits_added',v_order.credits_included,
    'expires_at',v_expiry,
    'provider_mode',p_provider_mode
  );
end;
$$;

create or replace function public.qf_mark_vendor_package_payment_failed_v2(
  p_order_id uuid,
  p_provider_payment_id text,
  p_provider_mode text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_order public.vendor_package_orders%rowtype;
  v_payment public.payments%rowtype;
begin
  select * into v_order from public.vendor_package_orders where id = p_order_id for update;
  if not found then raise exception 'PACKAGE_ORDER_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_order.payment_provider is distinct from 'razorpay'
     or v_order.provider_mode is distinct from p_provider_mode
     or v_order.provider_order_id is null then
    raise exception 'PACKAGE_ORDER_NOT_BOUND' using errcode = 'P0001';
  end if;
  if v_order.activation_status = 'activated' then
    return jsonb_build_object('status','ignored_activated','order_id',p_order_id);
  end if;

  select * into v_payment from public.payments where id = p_order_id for update;
  if not found then raise exception 'PAYMENT_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_payment.payment_status in ('Paid','Refunded') then
    return jsonb_build_object('status','ignored_terminal','order_id',p_order_id);
  end if;

  update public.payments set payment_status = 'Failed'
   where id = p_order_id and payment_status not in ('Paid','Refunded');
  update public.vendor_package_orders
     set payment_status = 'failed',
         provider_status = 'failed',
         failure_reason = 'Razorpay payment failed. You can retry this order.',
         updated_at = now()
   where id = p_order_id;

  return jsonb_build_object(
    'status','marked_failed',
    'order_id',p_order_id,
    'provider_payment_id',nullif(trim(p_provider_payment_id),''),
    'provider_mode',p_provider_mode
  );
end;
$$;

-- No browser role may execute financial/package mutation authority.
revoke all on function public.qf_claim_vendor_package_razorpay_order_v2(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.qf_release_vendor_package_razorpay_order_claim_v2(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.qf_bind_vendor_package_razorpay_order_v2(uuid,text,bigint,text,uuid,text) from public, anon, authenticated;
revoke all on function public.qf_activate_vendor_package_order_v2(uuid,text,text) from public, anon, authenticated;
revoke all on function public.qf_mark_vendor_package_payment_failed_v2(uuid,text,text) from public, anon, authenticated;

grant execute on function public.qf_claim_vendor_package_razorpay_order_v2(uuid,uuid,text) to service_role;
grant execute on function public.qf_release_vendor_package_razorpay_order_claim_v2(uuid,uuid,text) to service_role;
grant execute on function public.qf_bind_vendor_package_razorpay_order_v2(uuid,text,bigint,text,uuid,text) to service_role;
grant execute on function public.qf_activate_vendor_package_order_v2(uuid,text,text) to service_role;
grant execute on function public.qf_mark_vendor_package_payment_failed_v2(uuid,text,text) to service_role;

comment on table public.package_service_category_scopes is
  'Commercial package category scope. Zero rows for a package means all active categories.';
comment on table public.package_city_scopes is
  'Commercial package city scope. Zero rows for a package means all active cities.';
comment on column public.vendor_package_orders.provider_mode is
  'Razorpay credential/runtime mode used to create this provider order: test or live. Immutable after binding.';

do $$
begin
  if has_function_privilege('anon', 'public.qf_activate_vendor_package_order_v2(uuid,text,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.qf_activate_vendor_package_order_v2(uuid,text,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.qf_bind_vendor_package_razorpay_order_v2(uuid,text,bigint,text,uuid,text)', 'EXECUTE')
     or has_table_privilege('authenticated', 'public.vendor_package_orders', 'INSERT')
     or has_table_privilege('authenticated', 'public.vendor_package_orders', 'UPDATE')
     or has_table_privilege('authenticated', 'public.package_service_category_scopes', 'INSERT')
     or has_table_privilege('authenticated', 'public.package_city_scopes', 'INSERT') then
    raise exception 'VENDOR_V2_COMMERCIAL_AUTHORITY_EXPOSED';
  end if;
end $$;

commit;
