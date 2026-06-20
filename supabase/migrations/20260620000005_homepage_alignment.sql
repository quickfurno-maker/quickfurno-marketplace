-- ============================================================================
-- QuickFurno — 005_homepage_alignment.sql
-- Aligns the schema with the conversion-focused homepage + admin workflow.
-- Safe to run on an existing database (idempotent where possible).
-- ============================================================================

-- 1) Extend lead workflow statuses (admin pipeline) ---------------------------
--    Adds Verified / Converted / Bad Lead while keeping the originals.
alter table public.leads drop constraint if exists leads_status_check;
alter table public.leads
  add constraint leads_status_check check (status in (
    'New','Verified','Assigned','Contacted','Site Visit Scheduled',
    'Quotation Sent','Converted','Won','Lost','Duplicate','Bad Lead'
  ));

-- 2) Vendor pitch / message captured at registration --------------------------
alter table public.vendors add column if not exists message text;

-- 3) Canonical service categories (must match lib/config.ts SERVICES) ----------
--    Deactivate anything not in the canonical set, then upsert the canonical 8.
update public.service_categories set is_active = false
where slug not in (
  'full-home-interior','modular-kitchen','wardrobe','carpentry',
  'false-ceiling','painting','home-renovation','custom-furniture'
);

insert into public.service_categories (name, slug, is_active) values
  ('Full Home Interior', 'full-home-interior', true),
  ('Modular Kitchen',    'modular-kitchen',    true),
  ('Wardrobe',           'wardrobe',           true),
  ('Carpentry',          'carpentry',          true),
  ('False Ceiling',      'false-ceiling',      true),
  ('Painting',           'painting',           true),
  ('Home Renovation',    'home-renovation',    true),
  ('Custom Furniture',   'custom-furniture',   true)
on conflict (slug) do update set name = excluded.name, is_active = true;
