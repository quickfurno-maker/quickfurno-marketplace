-- ============================================================================
-- QuickFurno — 004_functions.sql
-- Business logic: credits, duplicate check, eligible vendors, atomic assignment
-- All credit-mutating logic is server-side and atomic.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- AUTH: create a profile row on signup (role from metadata, default vendor)
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, phone, role)
  values (
    new.id,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'phone',
    coalesce(new.raw_user_meta_data->>'role', 'vendor')
  )
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- SETTINGS helper
-- ----------------------------------------------------------------------------
create or replace function public.get_setting_int(p_key text, p_default int)
returns int language sql stable security definer set search_path = public as $$
  select coalesce((select (value #>> '{}')::int from public.app_settings where key = p_key), p_default);
$$;

-- ----------------------------------------------------------------------------
-- VISIBILITY: vendor is public only if approved + active + has credits + active pack
-- ----------------------------------------------------------------------------
create or replace function public.update_vendor_visibility(p_vendor_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_ok boolean;
begin
  select (
    v.status = 'Approved'
    and v.is_active
    and v.remaining_credits > 0
    and exists (
      select 1 from public.vendor_packages vp
      where vp.vendor_id = v.id
        and vp.status = 'Active'
        and (vp.expiry_date is null or vp.expiry_date > now())
    )
  )
  into v_ok
  from public.vendors v
  where v.id = p_vendor_id;

  update public.vendors set public_visibility = coalesce(v_ok, false) where id = p_vendor_id;
end; $$;

-- ----------------------------------------------------------------------------
-- CREDIT OPS
-- ----------------------------------------------------------------------------
create or replace function public.increment_vendor_credits(p_vendor_id uuid, p_credit_count int)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.vendors
  set total_credits = total_credits + p_credit_count,
      remaining_credits = remaining_credits + p_credit_count
  where id = p_vendor_id;
  perform public.update_vendor_visibility(p_vendor_id);
end; $$;

-- deduct exactly 1 credit; returns true if a credit was available & deducted
create or replace function public.deduct_vendor_credit(p_vendor_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_rem int; v_pkg uuid;
begin
  update public.vendors
  set remaining_credits = remaining_credits - 1
  where id = p_vendor_id and remaining_credits > 0
  returning remaining_credits into v_rem;

  if v_rem is null then
    return false;                          -- no credit available
  end if;

  -- FIFO: burn down the soonest-to-expire active package
  select id into v_pkg
  from public.vendor_packages
  where vendor_id = p_vendor_id and status = 'Active' and remaining_leads > 0
    and (expiry_date is null or expiry_date > now())
  order by expiry_date asc nulls last
  for update skip locked
  limit 1;

  if v_pkg is not null then
    update public.vendor_packages
    set remaining_leads = remaining_leads - 1,
        status = case when remaining_leads - 1 <= 0 then 'Consumed' else status end
    where id = v_pkg;
  end if;

  perform public.update_vendor_visibility(p_vendor_id);
  return true;
end; $$;

create or replace function public.restore_vendor_credit(p_vendor_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_pkg uuid;
begin
  update public.vendors set remaining_credits = remaining_credits + 1 where id = p_vendor_id;

  select id into v_pkg
  from public.vendor_packages
  where vendor_id = p_vendor_id and status in ('Active','Consumed')
  order by expiry_date desc nulls last
  limit 1;

  if v_pkg is not null then
    update public.vendor_packages
    set remaining_leads = remaining_leads + 1,
        status = case when status = 'Consumed' then 'Active' else status end
    where id = v_pkg;
  end if;

  perform public.update_vendor_visibility(p_vendor_id);
end; $$;

-- ----------------------------------------------------------------------------
-- DUPLICATE CHECK — returns the original lead id, or null
-- ----------------------------------------------------------------------------
create or replace function public.check_duplicate_lead(p_phone text, p_service text, p_city text)
returns uuid language sql stable security definer set search_path = public as $$
  select id
  from public.leads
  where phone = p_phone
    and service_required = p_service
    and city = p_city
    and is_duplicate = false
    and created_at > now() - (public.get_setting_int('duplicate_lead_window_days', 30) || ' days')::interval
  order by created_at desc
  limit 1;
$$;

-- ----------------------------------------------------------------------------
-- PUBLIC ELIGIBLE VENDORS — safe fields only (no phone/email)
-- ----------------------------------------------------------------------------
create or replace function public.get_public_eligible_vendors(p_city text, p_area text, p_service text)
returns table (
  id uuid,
  business_name text,
  city text,
  areas_covered text[],
  service_categories text[],
  experience text,
  portfolio_urls text[],
  profile_image_url text,
  rating numeric,
  completed_projects integer
)
language sql stable security definer set search_path = public as $$
  select v.id, v.business_name, v.city, v.areas_covered, v.service_categories,
         v.experience, v.portfolio_urls, v.profile_image_url, v.rating, v.completed_projects
  from public.vendors v
  where v.status = 'Approved'
    and v.is_active = true
    and v.public_visibility = true
    and v.remaining_credits > 0
    and v.city = p_city
    and p_service = any(v.service_categories)
    and (v.covers_full_city or (p_area is not null and p_area = any(v.areas_covered)))
  order by
    (case when p_area is not null and p_area = any(v.areas_covered) then 0 else 1 end),
    v.rating desc,
    v.completed_projects desc,
    random();
$$;

-- ----------------------------------------------------------------------------
-- CORE: atomic hybrid lead assignment (max 4, 1 credit each, no double-assign)
--   p_selected_vendor_ids : client-chosen vendors (validated against eligibility)
--   p_allow_duplicate     : admin override to assign a flagged duplicate
--   p_selected_type       : label for the selected vendors
-- ----------------------------------------------------------------------------
create or replace function public.assign_lead_to_vendors(
  p_lead_id             uuid,
  p_selected_vendor_ids uuid[] default '{}',
  p_allow_duplicate     boolean default false,
  p_selected_type       text default 'client_selected'
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_lead     public.leads%rowtype;
  v_max      int;
  v_target   uuid[] := '{}';
  v_selected uuid[] := '{}';
  v_vendor   uuid;
  v_slots    int;
  v_assigned uuid[] := '{}';
  v_skipped  uuid[] := '{}';
  v_ok       boolean;
  v_type     text;
begin
  v_max := public.get_setting_int('max_vendors_per_lead', 4);

  -- lock the lead row (serialises concurrent assignment attempts)
  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then
    raise exception 'LEAD_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- guard: too many selected
  if coalesce(array_length(p_selected_vendor_ids, 1), 0) > v_max then
    raise exception 'MAX_VENDORS_EXCEEDED' using errcode = 'P0001';
  end if;

  -- guard: already assigned
  if exists (select 1 from public.lead_assignments where lead_id = p_lead_id) then
    raise exception 'LEAD_ALREADY_ASSIGNED' using errcode = 'P0001';
  end if;

  -- guard: unapproved duplicate
  if v_lead.is_duplicate and not p_allow_duplicate then
    raise exception 'DUPLICATE_LEAD' using errcode = 'P0001';
  end if;

  -- 1) validate client-selected vendors against full eligibility
  select coalesce(array_agg(distinct t.vid), '{}')
  into v_selected
  from unnest(p_selected_vendor_ids) as t(vid)
  where exists (
    select 1 from public.vendors v
    where v.id = t.vid
      and v.status = 'Approved' and v.is_active and v.public_visibility
      and v.remaining_credits > 0
      and v.city = v_lead.city
      and v_lead.service_required = any(v.service_categories)
      and (v.covers_full_city or (v_lead.area is not null and v_lead.area = any(v.areas_covered)))
  );

  v_target := v_selected;
  if coalesce(array_length(v_target, 1), 0) > v_max then
    v_target := v_target[1:v_max];
  end if;

  -- 2) auto-fill remaining slots using the priority ordering
  v_slots := v_max - coalesce(array_length(v_target, 1), 0);
  if v_slots > 0 then
    v_target := v_target || array(
      select v.id
      from public.vendors v
      where v.status = 'Approved' and v.is_active and v.public_visibility
        and v.remaining_credits > 0
        and v.city = v_lead.city
        and v_lead.service_required = any(v.service_categories)
        and (v.covers_full_city or (v_lead.area is not null and v_lead.area = any(v.areas_covered)))
        and not (v.id = any(v_target))
      order by
        (case when v_lead.area is not null and v_lead.area = any(v.areas_covered) then 0 else 1 end),  -- 1 area
        (case when v_lead.service_required = any(v.service_categories) then 0 else 1 end),               -- 2 service
        (select count(*) from public.lead_assignments la                                                 -- 3 fewer recent
         where la.vendor_id = v.id and la.assigned_at > now() - interval '30 days') asc,
        v.rating desc,                                                                                    -- 4 rating
        v.last_assigned_at asc nulls first,                                                               -- 5 oldest assigned
        v.remaining_credits desc                                                                          -- 6 more credits
      limit v_slots
    );
  end if;

  -- 3) assign + deduct (per-vendor, atomic within this function)
  foreach v_vendor in array v_target loop
    v_ok := public.deduct_vendor_credit(v_vendor);
    if not v_ok then
      v_skipped := v_skipped || v_vendor;       -- lost its last credit mid-flight
      continue;
    end if;

    v_type := case when v_vendor = any(v_selected) then p_selected_type else 'auto_assigned' end;

    begin
      insert into public.lead_assignments (lead_id, vendor_id, assignment_type, credit_deducted)
      values (p_lead_id, v_vendor, v_type, true);
    exception when unique_violation then
      perform public.restore_vendor_credit(v_vendor);   -- undo the deduction we just made
      v_skipped := v_skipped || v_vendor;
      continue;
    end;

    update public.vendors set last_assigned_at = now() where id = v_vendor;

    -- WhatsApp alert to vendor (placeholder, picked up by Edge Function)
    insert into public.whatsapp_logs (recipient_type, recipient_id, phone, template_name, message)
    select 'vendor', v_vendor, ve.phone, 'new_lead_vendor',
           format('New %s lead in %s%s. Open your QuickFurno dashboard to view client details.',
                  v_lead.service_required, v_lead.city,
                  coalesce(' (' || v_lead.area || ')', ''))
    from public.vendors ve where ve.id = v_vendor;

    v_assigned := v_assigned || v_vendor;
  end loop;

  -- 4) no one took it
  if coalesce(array_length(v_assigned, 1), 0) = 0 then
    raise exception 'NO_ELIGIBLE_VENDORS' using errcode = 'P0001';
  end if;

  -- 5) finalise lead + client confirmation WhatsApp
  update public.leads set status = 'Assigned' where id = p_lead_id;

  insert into public.whatsapp_logs (recipient_type, recipient_id, phone, template_name, message)
  values ('client', p_lead_id, v_lead.phone, 'lead_received_client',
          format('Hi %s, your %s enquiry is received. Up to %s verified QuickFurno professionals will contact you shortly.',
                 v_lead.name, v_lead.service_required, coalesce(array_length(v_assigned, 1), 0)));

  return jsonb_build_object(
    'status', 'ok',
    'lead_id', p_lead_id,
    'assigned', to_jsonb(v_assigned),
    'skipped',  to_jsonb(v_skipped),
    'assigned_count', coalesce(array_length(v_assigned, 1), 0)
  );
end; $$;

-- ----------------------------------------------------------------------------
-- PACKAGE ASSIGNMENT after a paid payment (admin) — atomic
-- ----------------------------------------------------------------------------
create or replace function public.assign_package_to_vendor(
  p_vendor_id  uuid,
  p_package_id uuid,
  p_payment_id uuid
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_pkg public.packages%rowtype;
  v_pay public.payments%rowtype;
  v_vp  uuid;
begin
  select * into v_pay from public.payments where id = p_payment_id for update;
  if not found then raise exception 'PAYMENT_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_pay.payment_status <> 'Paid' then raise exception 'PAYMENT_NOT_PAID' using errcode = 'P0001'; end if;

  select * into v_pkg from public.packages where id = p_package_id;
  if not found then raise exception 'PACKAGE_NOT_FOUND' using errcode = 'P0002'; end if;

  insert into public.vendor_packages
    (vendor_id, package_id, expiry_date, total_leads, remaining_leads, price_paid, payment_status, status)
  values
    (p_vendor_id, p_package_id, now() + (v_pkg.validity_days || ' days')::interval,
     v_pkg.lead_count, v_pkg.lead_count, coalesce(v_pay.amount, v_pkg.total_price), 'Paid', 'Active')
  returning id into v_vp;

  perform public.increment_vendor_credits(p_vendor_id, v_pkg.lead_count);
  perform public.update_vendor_visibility(p_vendor_id);

  return jsonb_build_object('status', 'ok', 'vendor_package_id', v_vp, 'credits_added', v_pkg.lead_count);
end; $$;

-- ----------------------------------------------------------------------------
-- CRON helper: expire packages + drop visibility (schedule daily with pg_cron)
-- ----------------------------------------------------------------------------
create or replace function public.expire_vendor_packages()
returns void language plpgsql security definer set search_path = public as $$
declare v_vendor uuid;
begin
  update public.vendor_packages
  set status = 'Expired'
  where status = 'Active' and expiry_date is not null and expiry_date <= now();

  for v_vendor in select distinct vendor_id from public.vendors loop
    perform public.update_vendor_visibility(v_vendor);
  end loop;
end; $$;

-- ----------------------------------------------------------------------------
-- EXECUTE GRANTS — lock credit/assignment logic to the server (service_role).
-- Public/anon may only call the safe read helpers used by the website.
-- ----------------------------------------------------------------------------
revoke execute on function
  public.assign_lead_to_vendors(uuid, uuid[], boolean, text),
  public.assign_package_to_vendor(uuid, uuid, uuid),
  public.increment_vendor_credits(uuid, int),
  public.deduct_vendor_credit(uuid),
  public.restore_vendor_credit(uuid),
  public.update_vendor_visibility(uuid),
  public.expire_vendor_packages()
from public, anon, authenticated;

grant execute on function
  public.assign_lead_to_vendors(uuid, uuid[], boolean, text),
  public.assign_package_to_vendor(uuid, uuid, uuid),
  public.increment_vendor_credits(uuid, int),
  public.deduct_vendor_credit(uuid),
  public.restore_vendor_credit(uuid),
  public.update_vendor_visibility(uuid),
  public.expire_vendor_packages()
to service_role;

-- safe, public-facing helpers
grant execute on function
  public.get_public_eligible_vendors(text, text, text),
  public.check_duplicate_lead(text, text, text),
  public.get_setting_int(text, int)
to anon, authenticated, service_role;
