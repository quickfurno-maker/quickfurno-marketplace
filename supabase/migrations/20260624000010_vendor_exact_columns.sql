-- ============================================================================
-- QuickFurno — 20260624000010_vendor_exact_columns.sql
-- Ensures the exact columns the vendor registration wizard writes to exist on
-- public.vendors. ADDITIVE ONLY — uses `add column if not exists`, never drops
-- the table, never deletes data. Safe + idempotent to re-run.
--
-- This is the column set that fixes "Supabase only receiving old vendor fields":
-- the wizard now writes latitude/longitude/verification_status (and the 009
-- columns) by these exact names.
-- ============================================================================
alter table public.vendors
  add column if not exists whatsapp_number            text,
  add column if not exists location_permission_status text,
  add column if not exists latitude                   numeric,
  add column if not exists longitude                  numeric,
  add column if not exists business_type              text,
  add column if not exists team_size                  text,
  add column if not exists monthly_capacity           text,
  add column if not exists starting_price             text,
  add column if not exists paid_status                text default 'Unpaid',
  add column if not exists verification_status        text default 'Pending',
  add column if not exists source_url                 text,
  add column if not exists utm_source                 text,
  add column if not exists utm_medium                 text,
  add column if not exists utm_campaign               text;

-- service_radius_km already added by 007_vendor_location.sql; the remaining
-- columns (business_name, owner_name, phone, email, city, areas_covered,
-- covers_full_city, service_categories, experience, portfolio_urls, gst_number,
-- message, status, is_active, public_visibility) come from earlier migrations.
