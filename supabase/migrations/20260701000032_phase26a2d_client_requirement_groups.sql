-- ============================================================================
-- QuickFurno — 20260701000032_phase26a2d_client_requirement_groups.sql
-- Phase 26A-2D: per-parent-category requirement groups, client-selected vendor
-- priority, and the 1-hour auto-fill foundation.
--
-- A client is capped at 3 vendors PER PARENT CATEGORY GROUP (Interior / Sofa /
-- Painting / Civil Work / …), not globally. A "requirement group" is one
-- client_phone_normalized + city + parent_category_group inside a 3-day window.
--
-- Additive + idempotent. No destructive DDL/DML on data. Auto matching stays
-- max 3; only admin recovery may exceed 3 (up to 9). Credit deduction is never
-- reimplemented — the group-aware assign RPC reuses deduct_vendor_credit /
-- restore_vendor_credit, exactly like the Phase 26A-2C smart RPC.
--   1) client_requirement_groups table.
--   2) additive columns on leads + lead_assignments (requirement_group_id etc).
--   3) refresh_requirement_group_counters(group) — recompute denormalised counts.
--   4) assign_vendor_to_requirement_group(...) — single-vendor, group-capped,
--      credit-safe assignment used by client-selected + auto-fill.
-- ============================================================================

-- 1) requirement group table --------------------------------------------------
create table if not exists public.client_requirement_groups (
  id uuid primary key default gen_random_uuid(),
  client_phone text not null,
  client_phone_normalized text not null,
  client_name text,
  city text not null,
  parent_category_group text not null,
  primary_service text,
  first_lead_id uuid null references public.leads(id) on delete set null,
  first_enquiry_at timestamptz not null default now(),
  first_selection_at timestamptz null,
  client_selection_deadline_at timestamptz null,
  normal_assignment_expires_at timestamptz not null default (now() + interval '3 days'),
  client_selected_vendor_count integer not null default 0,
  auto_assigned_vendor_count integer not null default 0,
  manual_assigned_vendor_count integer not null default 0,
  primary_assigned_count integer not null default 0,
  recovery_assigned_count integer not null default 0,
  total_assigned_count integer not null default 0,
  pending_primary_slots integer not null default 3,
  auto_fill_enabled boolean not null default false,
  auto_fill_status text not null default 'not_started',
  status text not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Additive re-apply of every column (repairs any partially-created table).
alter table public.client_requirement_groups
  add column if not exists client_phone text,
  add column if not exists client_phone_normalized text,
  add column if not exists client_name text,
  add column if not exists city text,
  add column if not exists parent_category_group text,
  add column if not exists primary_service text,
  add column if not exists first_lead_id uuid,
  add column if not exists first_enquiry_at timestamptz default now(),
  add column if not exists first_selection_at timestamptz,
  add column if not exists client_selection_deadline_at timestamptz,
  add column if not exists normal_assignment_expires_at timestamptz default (now() + interval '3 days'),
  add column if not exists client_selected_vendor_count integer default 0,
  add column if not exists auto_assigned_vendor_count integer default 0,
  add column if not exists manual_assigned_vendor_count integer default 0,
  add column if not exists primary_assigned_count integer default 0,
  add column if not exists recovery_assigned_count integer default 0,
  add column if not exists total_assigned_count integer default 0,
  add column if not exists pending_primary_slots integer default 3,
  add column if not exists auto_fill_enabled boolean default false,
  add column if not exists auto_fill_status text default 'not_started',
  add column if not exists status text default 'active',
  add column if not exists metadata jsonb default '{}'::jsonb,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

-- 2) additive columns on leads + lead_assignments -----------------------------
alter table public.leads
  add column if not exists requirement_group_id uuid references public.client_requirement_groups(id) on delete set null,
  add column if not exists parent_category_group text,
  add column if not exists selected_vendor_id uuid,
  add column if not exists selected_vendor_name text,
  add column if not exists assignment_intent text,
  add column if not exists client_selection_deadline_at timestamptz;

alter table public.lead_assignments
  add column if not exists requirement_group_id uuid references public.client_requirement_groups(id) on delete set null,
  add column if not exists assignment_source text,
  add column if not exists assignment_metadata jsonb default '{}'::jsonb;

-- 3) indexes ------------------------------------------------------------------
create index if not exists idx_crg_identity
  on public.client_requirement_groups (client_phone_normalized, city, parent_category_group, status);
create index if not exists idx_crg_autofill_due
  on public.client_requirement_groups (auto_fill_status, client_selection_deadline_at);
create index if not exists idx_crg_status
  on public.client_requirement_groups (status);
create index if not exists idx_leads_requirement_group
  on public.leads (requirement_group_id);
create index if not exists idx_lead_assignments_requirement_group
  on public.lead_assignments (requirement_group_id);

-- 4) RLS ----------------------------------------------------------------------
alter table public.client_requirement_groups enable row level security;
grant select on public.client_requirement_groups to authenticated;
grant select, insert, update, delete on public.client_requirement_groups to service_role;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'client_requirement_groups' and policyname = 'client_requirement_groups admin all'
  ) then
    execute 'create policy "client_requirement_groups admin all" on public.client_requirement_groups for all to authenticated using (public.is_admin()) with check (public.is_admin())';
  end if;
end $$;

-- 5) recompute denormalised counters from lead_assignments --------------------
create or replace function public.refresh_requirement_group_counters(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total    int;
  v_client   int;
  v_auto     int;
  v_manual   int;
  v_primary  int;
  v_recovery int;
begin
  select count(distinct vendor_id) into v_total
  from public.lead_assignments where requirement_group_id = p_group_id;

  select count(distinct vendor_id) into v_client
  from public.lead_assignments
  where requirement_group_id = p_group_id and assignment_source = 'client_selected_vendor';

  select count(distinct vendor_id) into v_auto
  from public.lead_assignments
  where requirement_group_id = p_group_id and assignment_source in ('auto_fill', 'auto_assigned');

  v_manual   := greatest(coalesce(v_total, 0) - coalesce(v_client, 0) - coalesce(v_auto, 0), 0);
  v_primary  := least(coalesce(v_total, 0), 3);
  v_recovery := greatest(coalesce(v_total, 0) - 3, 0);

  update public.client_requirement_groups set
    total_assigned_count         = coalesce(v_total, 0),
    client_selected_vendor_count = coalesce(v_client, 0),
    auto_assigned_vendor_count   = coalesce(v_auto, 0),
    manual_assigned_vendor_count = v_manual,
    primary_assigned_count       = v_primary,
    recovery_assigned_count      = v_recovery,
    pending_primary_slots        = greatest(3 - v_primary, 0),
    updated_at                   = now()
  where id = p_group_id;
end;
$$;

grant execute on function public.refresh_requirement_group_counters(uuid) to service_role;

-- 6) group-aware, credit-safe single-vendor assignment ------------------------
-- Assigns ONE vendor to a requirement group. HARD marketplace safety is never
-- bypassed (approved + active + package + credits + city). Parent-category
-- compatibility is enforced by the caller (TypeScript) before calling; the
-- group cap and duplicate protection are enforced here. Credits move only
-- through the existing deduct/restore primitives. Never exceeds 9 (and the
-- caller passes 3 for all normal / client-selected / auto-fill paths).
create or replace function public.assign_vendor_to_requirement_group(
  p_group_id          uuid,
  p_lead_id           uuid,
  p_vendor_id         uuid,
  p_assignment_source text default 'auto_fill',
  p_total_limit       int  default 3,
  p_assignment_type   text default 'auto_assigned'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead     public.leads%rowtype;
  v_row      public.vendors%rowtype;
  v_limit    int;
  v_existing int;
  v_type     text;
  v_has_active_package boolean;
  v_ok       boolean;
begin
  v_limit := least(greatest(coalesce(p_total_limit, 3), 1), 9);
  v_type  := case
               when p_assignment_type in ('client_selected', 'auto_assigned', 'admin_assigned')
               then p_assignment_type else 'auto_assigned'
             end;

  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then
    raise exception 'LEAD_NOT_FOUND' using errcode = 'P0002';
  end if;

  perform 1 from public.client_requirement_groups where id = p_group_id for update;
  if not found then
    raise exception 'REQUIREMENT_GROUP_NOT_FOUND' using errcode = 'P0002';
  end if;

  select count(distinct vendor_id) into v_existing
  from public.lead_assignments where requirement_group_id = p_group_id;
  if v_existing >= v_limit then
    return jsonb_build_object('status', 'group_full', 'assigned', false,
      'vendor_id', p_vendor_id, 'group_id', p_group_id, 'assigned_count', v_existing);
  end if;

  select * into v_row from public.vendors where id = p_vendor_id for update;
  if not found then
    return jsonb_build_object('status', 'vendor_not_found', 'assigned', false,
      'vendor_id', p_vendor_id, 'group_id', p_group_id);
  end if;

  select exists (
    select 1 from public.vendor_packages vp
    where vp.vendor_id = p_vendor_id
      and lower(coalesce(vp.status, '')) in ('active', 'trial')
      and coalesce(vp.remaining_leads, 0) > 0
      and (vp.expiry_date is null or vp.expiry_date > now())
  ) into v_has_active_package;

  v_has_active_package := v_has_active_package
    or lower(coalesce(v_row.package_status, '')) in ('active', 'trial')
    or lower(coalesce(v_row.paid_status, '')) in ('paid', 'trial', 'active', 'premium', 'priority');

  -- HARD marketplace safety — never bypassed.
  if v_row.status <> 'Approved'
    or coalesce(v_row.is_active, false) is not true
    or coalesce(v_row.remaining_credits, 0) <= 0
    or not v_has_active_package
    or v_row.city is distinct from v_lead.city
  then
    return jsonb_build_object('status', 'vendor_not_eligible', 'assigned', false,
      'vendor_id', p_vendor_id, 'group_id', p_group_id);
  end if;

  if exists (
    select 1 from public.lead_assignments
    where requirement_group_id = p_group_id and vendor_id = p_vendor_id
  ) then
    return jsonb_build_object('status', 'already_in_group', 'assigned', false,
      'vendor_id', p_vendor_id, 'group_id', p_group_id);
  end if;

  if exists (
    select 1 from public.lead_assignments where lead_id = p_lead_id and vendor_id = p_vendor_id
  ) then
    return jsonb_build_object('status', 'already_assigned_to_lead', 'assigned', false,
      'vendor_id', p_vendor_id, 'group_id', p_group_id);
  end if;

  v_ok := public.deduct_vendor_credit(p_vendor_id);   -- reuse existing primitive
  if not v_ok then
    return jsonb_build_object('status', 'credit_deduction_failed', 'assigned', false,
      'vendor_id', p_vendor_id, 'group_id', p_group_id);
  end if;

  begin
    insert into public.lead_assignments (
      lead_id, vendor_id, assignment_type, credit_deducted,
      requirement_group_id, assignment_source, assignment_metadata
    ) values (
      p_lead_id, p_vendor_id, v_type, true,
      p_group_id, p_assignment_source, jsonb_build_object('source', p_assignment_source)
    );
  exception when unique_violation then
    perform public.restore_vendor_credit(p_vendor_id);
    return jsonb_build_object('status', 'duplicate_on_insert', 'assigned', false,
      'vendor_id', p_vendor_id, 'group_id', p_group_id);
  end;

  update public.vendors set last_assigned_at = now() where id = p_vendor_id;
  update public.leads set status = 'Assigned' where id = p_lead_id;

  perform public.refresh_requirement_group_counters(p_group_id);

  return jsonb_build_object('status', 'ok', 'assigned', true,
    'vendor_id', p_vendor_id, 'group_id', p_group_id, 'assigned_count', v_existing + 1);
end;
$$;

grant execute on function public.assign_vendor_to_requirement_group(uuid, uuid, uuid, text, int, text) to service_role;
