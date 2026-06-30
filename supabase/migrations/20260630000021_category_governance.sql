-- ============================================================================
-- QuickFurno - Phase 14C (governance): Category taxonomy + audit fields
-- Migration suggestion only. Safe to run on the live DB (idempotent).
--
-- Purpose:
-- - Establish the canonical admin category taxonomy in public.service_categories:
--     Parents:  Interior, Sofa, Painter, Civil Work
--     Interior subcategories: Interior Designers, Carpenters, Modular Factory,
--                             Premium Interiors
-- - Add audit fields (created_by, updated_by; updated_at already exists).
-- - SOFT-deactivate the older demo categories (is_active=false) so they stop
--   appearing in dropdowns but old leads/vendors that reference their names are
--   never broken.
--
-- Governance / safety:
-- - Category writes are already admin-only via RLS ("categories admin write" =
--   public.is_admin()); public/anon can only read active rows.
-- - This migration uses ADD COLUMN IF NOT EXISTS / upsert / UPDATE only.
--   NO drop / delete / truncate. SOFT deactivate, never hard delete.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Schema: parent/subcategory support + audit fields.
-- (Defensive: some live DBs only have the base table id/name/slug/is_active.)
-- ----------------------------------------------------------------------------
alter table if exists public.service_categories add column if not exists parent_id uuid references public.service_categories(id) on delete set null;
alter table if exists public.service_categories add column if not exists sort_order integer default 100;
alter table if exists public.service_categories add column if not exists created_by text;
alter table if exists public.service_categories add column if not exists updated_by text;
alter table if exists public.service_categories add column if not exists created_at timestamptz not null default now();
alter table if exists public.service_categories add column if not exists updated_at timestamptz not null default now();

-- ----------------------------------------------------------------------------
-- Canonical PARENT categories (upsert + activate).
-- ----------------------------------------------------------------------------
insert into public.service_categories (name, slug, is_active, parent_id, sort_order, updated_by, updated_at)
values
  ('Interior',   'interior',   true, null, 10, 'system_seed', now()),
  ('Sofa',       'sofa',       true, null, 20, 'system_seed', now()),
  ('Painter',    'painter',    true, null, 30, 'system_seed', now()),
  ('Civil Work', 'civil-work', true, null, 40, 'system_seed', now())
on conflict (slug) do update
  set name = excluded.name, is_active = true, parent_id = null, sort_order = excluded.sort_order, updated_at = now();

-- ----------------------------------------------------------------------------
-- Interior SUBCATEGORIES (parent_id resolved from the Interior parent).
-- ----------------------------------------------------------------------------
do $$
declare v_interior uuid;
begin
  select id into v_interior from public.service_categories where slug = 'interior' limit 1;
  if v_interior is not null then
    insert into public.service_categories (name, slug, is_active, parent_id, sort_order, updated_by, updated_at)
    values
      ('Interior Designers', 'interior-designers', true, v_interior, 11, 'system_seed', now()),
      ('Carpenters',         'carpenters',         true, v_interior, 12, 'system_seed', now()),
      ('Modular Factory',    'modular-factory',    true, v_interior, 13, 'system_seed', now()),
      ('Premium Interiors',  'premium-interiors',  true, v_interior, 14, 'system_seed', now())
    on conflict (slug) do update
      set name = excluded.name, is_active = true, parent_id = v_interior, sort_order = excluded.sort_order, updated_at = now();
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- SOFT-deactivate older demo categories (keep the rows for data safety).
-- ----------------------------------------------------------------------------
update public.service_categories
set is_active = false, updated_by = 'system_seed', updated_at = now()
where slug in (
  'full-home-interior', 'modular-kitchen', 'wardrobe', 'carpentry',
  'false-ceiling', 'painting', 'home-renovation', 'custom-furniture',
  'interior-design', 'renovation'
)
and is_active is distinct from false;

create index if not exists idx_service_categories_parent_id on public.service_categories(parent_id);
create index if not exists idx_service_categories_is_active on public.service_categories(is_active);
