-- Phase 26A Step 1: consent-gated auto lead matching foundation.
-- Dashboard delivery only. WhatsApp remains preview/log only.

create table if not exists public.lead_matching_runs (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  run_status text not null default 'started',
  consent_confirmed boolean not null default false,
  max_vendors integer not null default 3,
  eligible_vendor_count integer not null default 0,
  selected_vendor_ids uuid[] not null default '{}',
  assigned_vendor_ids uuid[] not null default '{}',
  failure_reason text,
  matching_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.lead_delivery_logs (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  assignment_id uuid null references public.lead_assignments(id) on delete set null,
  delivery_channel text not null default 'vendor_dashboard',
  delivery_status text not null default 'pending',
  contact_shared boolean not null default false,
  credit_deducted boolean not null default false,
  whatsapp_preview_message text,
  whatsapp_status text not null default 'preview_only',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.client_notification_logs (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  notification_type text not null default 'assigned_vendors_preview',
  channel text not null default 'dashboard_preview',
  status text not null default 'preview_created',
  message text,
  vendor_snapshot jsonb not null default '[]'::jsonb,
  whatsapp_status text not null default 'preview_only',
  created_at timestamptz not null default now()
);

create index if not exists idx_lead_matching_runs_lead_created
  on public.lead_matching_runs(lead_id, created_at desc);
create index if not exists idx_lead_delivery_logs_lead_vendor
  on public.lead_delivery_logs(lead_id, vendor_id);
create index if not exists idx_lead_delivery_logs_assignment
  on public.lead_delivery_logs(assignment_id);
create index if not exists idx_client_notification_logs_lead_created
  on public.client_notification_logs(lead_id, created_at desc);

alter table public.lead_matching_runs enable row level security;
alter table public.lead_delivery_logs enable row level security;
alter table public.client_notification_logs enable row level security;

grant select on public.lead_matching_runs to authenticated;
grant select on public.lead_delivery_logs to authenticated;
grant select on public.client_notification_logs to authenticated;
grant select, insert, update, delete on public.lead_matching_runs to service_role;
grant select, insert, update, delete on public.lead_delivery_logs to service_role;
grant select, insert, update, delete on public.client_notification_logs to service_role;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'lead_matching_runs' and policyname = 'lead_matching_runs admin all'
  ) then
    execute 'create policy "lead_matching_runs admin all" on public.lead_matching_runs for all to authenticated using (public.is_admin()) with check (public.is_admin())';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'lead_delivery_logs' and policyname = 'lead_delivery_logs vendor read'
  ) then
    execute 'create policy "lead_delivery_logs vendor read" on public.lead_delivery_logs for select to authenticated using (public.owns_vendor(vendor_id) or public.is_admin())';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'lead_delivery_logs' and policyname = 'lead_delivery_logs admin all'
  ) then
    execute 'create policy "lead_delivery_logs admin all" on public.lead_delivery_logs for all to authenticated using (public.is_admin()) with check (public.is_admin())';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'client_notification_logs' and policyname = 'client_notification_logs admin all'
  ) then
    execute 'create policy "client_notification_logs admin all" on public.client_notification_logs for all to authenticated using (public.is_admin()) with check (public.is_admin())';
  end if;
end $$;

create or replace function public.assign_lead_to_paid_vendors_phase26a(
  p_lead_id uuid,
  p_vendor_ids uuid[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead public.leads%rowtype;
  v_max int;
  v_vendor uuid;
  v_row public.vendors%rowtype;
  v_assignment_id uuid;
  v_pkg_id uuid;
  v_before int;
  v_after int;
  v_has_active_package boolean;
  v_assigned jsonb := '[]'::jsonb;
  v_assigned_ids uuid[] := '{}';
  v_skipped uuid[] := '{}';
begin
  v_max := least(public.get_setting_int('max_vendors_per_lead', 3), 3);

  select * into v_lead
  from public.leads
  where id = p_lead_id
  for update;

  if not found then
    raise exception 'LEAD_NOT_FOUND' using errcode = 'P0002';
  end if;

  if coalesce(v_lead.is_duplicate, false) then
    return jsonb_build_object(
      'status', 'skipped_duplicate',
      'lead_id', p_lead_id,
      'assigned', '[]'::jsonb,
      'skipped', '[]'::jsonb,
      'assigned_count', 0
    );
  end if;

  if exists (select 1 from public.lead_assignments where lead_id = p_lead_id) then
    select coalesce(
      jsonb_agg(jsonb_build_object('vendor_id', vendor_id, 'assignment_id', id)),
      '[]'::jsonb
    )
    into v_assigned
    from public.lead_assignments
    where lead_id = p_lead_id;

    select coalesce(array_agg(vendor_id), '{}')
    into v_assigned_ids
    from public.lead_assignments
    where lead_id = p_lead_id;

    return jsonb_build_object(
      'status', 'already_assigned',
      'lead_id', p_lead_id,
      'assigned', v_assigned,
      'skipped', '[]'::jsonb,
      'assigned_count', coalesce(array_length(v_assigned_ids, 1), 0)
    );
  end if;

  for v_vendor in
    select vendor_id
    from (
      select distinct on (item.vendor_id) item.vendor_id, item.ordinality
      from unnest(coalesce(p_vendor_ids, '{}')) with ordinality as item(vendor_id, ordinality)
      where item.vendor_id is not null
      order by item.vendor_id, item.ordinality
    ) deduped
    order by ordinality
    limit v_max
  loop
    select * into v_row
    from public.vendors
    where id = v_vendor
    for update;

    if not found then
      v_skipped := v_skipped || v_vendor;
      continue;
    end if;

    select exists (
      select 1
      from public.vendor_packages vp
      where vp.vendor_id = v_vendor
        and lower(coalesce(vp.status, '')) in ('active', 'trial')
        and coalesce(vp.remaining_leads, 0) > 0
        and (vp.expiry_date is null or vp.expiry_date > now())
    )
    into v_has_active_package;

    v_has_active_package := v_has_active_package
      or lower(coalesce(v_row.package_status, '')) in ('active', 'trial')
      or lower(coalesce(v_row.paid_status, '')) in ('paid', 'trial', 'active', 'premium', 'priority');

    if v_row.status <> 'Approved'
      or coalesce(v_row.is_active, false) is not true
      or coalesce(v_row.remaining_credits, 0) <= 0
      or not v_has_active_package
      or v_row.city is distinct from v_lead.city
      or not (
        v_lead.service_required = any(coalesce(v_row.service_categories, '{}'))
        or v_lead.service_required = v_row.selected_category
      )
      or (
        coalesce(v_row.covers_full_city, false) is not true
        and v_lead.area is not null
        and coalesce(array_length(v_row.areas_covered, 1), 0) > 0
        and not (v_lead.area = any(v_row.areas_covered))
      )
    then
      v_skipped := v_skipped || v_vendor;
      continue;
    end if;

    v_before := coalesce(v_row.remaining_credits, 0);

    select id into v_pkg_id
    from public.vendor_packages
    where vendor_id = v_vendor
      and lower(coalesce(status, '')) in ('active', 'trial')
      and coalesce(remaining_leads, 0) > 0
      and (expiry_date is null or expiry_date > now())
    order by expiry_date asc nulls last
    for update skip locked
    limit 1;

    update public.vendors
    set remaining_credits = remaining_credits - 1,
        last_assigned_at = now()
    where id = v_vendor and remaining_credits > 0
    returning remaining_credits into v_after;

    if v_after is null then
      v_skipped := v_skipped || v_vendor;
      continue;
    end if;

    if v_pkg_id is not null then
      update public.vendor_packages
      set remaining_leads = remaining_leads - 1,
          status = case when remaining_leads - 1 <= 0 then 'Consumed' else status end
      where id = v_pkg_id;
    end if;

    begin
      insert into public.lead_assignments (lead_id, vendor_id, assignment_type, credit_deducted)
      values (p_lead_id, v_vendor, 'auto_assigned', true)
      returning id into v_assignment_id;
    exception when unique_violation then
      update public.vendors
      set remaining_credits = remaining_credits + 1
      where id = v_vendor;

      if v_pkg_id is not null then
        update public.vendor_packages
        set remaining_leads = remaining_leads + 1,
            status = case when status = 'Consumed' then 'Active' else status end
        where id = v_pkg_id;
      end if;

      v_skipped := v_skipped || v_vendor;
      continue;
    end;

    begin
      insert into public.vendor_credit_logs (
        vendor_id,
        change_type,
        credits_before,
        credits_delta,
        credits_after,
        reason,
        updated_by
      )
      values (
        v_vendor,
        'correction',
        v_before,
        -1,
        v_after,
        'Auto lead dashboard delivery',
        'phase26a_auto_matching'
      );
    exception when undefined_table or check_violation then
      null;
    end;

    v_assigned_ids := v_assigned_ids || v_vendor;
    v_assigned := v_assigned || jsonb_build_array(
      jsonb_build_object(
        'vendor_id', v_vendor,
        'assignment_id', v_assignment_id,
        'credits_before', v_before,
        'credits_after', v_after
      )
    );
  end loop;

  if coalesce(array_length(v_assigned_ids, 1), 0) > 0 then
    update public.leads set status = 'Assigned' where id = p_lead_id;
  end if;

  return jsonb_build_object(
    'status', case when coalesce(array_length(v_assigned_ids, 1), 0) > 0 then 'ok' else 'no_eligible_vendors' end,
    'lead_id', p_lead_id,
    'assigned', v_assigned,
    'skipped', to_jsonb(v_skipped),
    'assigned_count', coalesce(array_length(v_assigned_ids, 1), 0)
  );
end;
$$;

grant execute on function public.assign_lead_to_paid_vendors_phase26a(uuid, uuid[]) to service_role;
