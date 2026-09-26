-- ============================================================================
-- QuickFurno — package governance by category / subcategory / city
-- Admin-controlled commercial source of truth. Additive; no historical rewrite.
-- Empty scope set means "all currently active" rows in that dimension.
-- ============================================================================
begin;

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
)returns jsonb
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

  select count(*) into v_expected from (select distinct unnest(v_category_ids)) x;
  select count(*) into v_actual
  from public.service_categories
  where id = any(v_category_ids);
  if v_actual <> v_expected then
    raise exception 'PACKAGE_CATEGORY_SCOPE_INVALID' using errcode = 'P0001';
  end if;

  select count(*) into v_expected from (select distinct unnest(v_city_ids)) x;
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

comment on table public.package_service_category_scopes is
  'Commercial package taxonomy scope. Zero rows for a package means all active service categories.';
comment on table public.package_city_scopes is
  'Commercial package city scope. Zero rows for a package means all active cities.';

-- Existing package rows intentionally receive no scope rows: they remain global
-- until an admin narrows them. Historical vendor_packages and order snapshots are
-- never rewritten by this migration.
commit;
