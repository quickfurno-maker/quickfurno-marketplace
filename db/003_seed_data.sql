-- ============================================================================
-- QuickFurno — 003_seed_data.sql
-- ============================================================================

-- ---- Packages -------------------------------------------------------------
insert into public.packages (name, lead_count, price_per_lead, total_price, display_price, validity_days)
values
  ('Starter Pack',  5,  250, 1250,  1250, 30),
  ('Growth Pack',  15,  229, 3435,  3499, 45),
  ('Pro Pack',     30,  219, 6570,  6499, 60),
  ('Premium Pack', 50,  209, 10450, 10499, 75)
on conflict do nothing;

-- ---- Service categories ---------------------------------------------------
insert into public.service_categories (name, slug) values
  ('Full Home Interior', 'full-home-interior'),
  ('Modular Kitchen',    'modular-kitchen'),
  ('Wardrobe',           'wardrobe'),
  ('Carpentry',          'carpentry'),
  ('False Ceiling',      'false-ceiling'),
  ('Painting',           'painting'),
  ('Home Renovation',    'home-renovation'),
  ('Custom Furniture',   'custom-furniture')
on conflict (slug) do nothing;

-- ---- Cities (QuickFurno launch markets) -----------------------------------
insert into public.cities (name, slug) values
  ('Pune',      'pune'),
  ('Mumbai',    'mumbai'),
  ('Bengaluru', 'bengaluru'),
  ('Hyderabad', 'hyderabad'),
  ('Delhi',     'delhi'),
  ('Nagpur',    'nagpur'),
  ('Nashik',    'nashik')
on conflict (slug) do nothing;

-- ---- App settings ---------------------------------------------------------
insert into public.app_settings (key, value) values
  ('max_vendors_per_lead',        '4'::jsonb),
  ('hide_zero_credit_vendors',    'true'::jsonb),
  ('duplicate_lead_window_days',  '30'::jsonb),
  ('bad_lead_report_window_hours','24'::jsonb)
on conflict (key) do update set value = excluded.value, updated_at = now();
