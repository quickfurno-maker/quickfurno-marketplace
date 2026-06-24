-- ============================================================================
-- QuickFurno — 20260624000009_vendor_onboarding.sql
-- Richer vendor onboarding capture from the guided registration wizard. All
-- columns are nullable/additive so existing vendor rows and the app keep working
-- even before this migration runs (vendorService.registerVendor falls back
-- gracefully if a column is missing). Idempotent — safe to re-run.
--
-- Note: existing columns already cover several wizard fields and are reused —
--   service areas      -> areas_covered (text[])  (used by lead matching RPC)
--   matching services  -> service_categories (text[]) (used by lead matching)
--   latitude/longitude -> base_latitude / base_longitude (migration 007)
--   verification status -> status
--   enabled/disabled    -> is_active
-- ============================================================================
alter table public.vendors
  add column if not exists whatsapp_number          text,
  add column if not exists selected_category         text,
  add column if not exists selected_subcategories    text[],
  add column if not exists custom_service_area       text,
  add column if not exists location_permission_status text,
  add column if not exists business_type             text,
  add column if not exists years_experience          text,
  add column if not exists team_size                 text,
  add column if not exists monthly_capacity          text,
  add column if not exists starting_price            text,
  add column if not exists paid_status               text default 'Unpaid',
  add column if not exists source_url                text,
  add column if not exists utm_source                text,
  add column if not exists utm_medium                text,
  add column if not exists utm_campaign              text;
