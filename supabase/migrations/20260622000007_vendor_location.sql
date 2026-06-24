-- ============================================================================
-- QuickFurno — 20260622000007_vendor_location.sql
-- Vendor base location capture (browser GPS) for future nearest-client lead
-- matching by category + area + radius. All columns are nullable and additive
-- so existing vendor rows keep working. Idempotent — safe to re-run.
-- TODO: these fields will be used later for nearest-client lead assignment
--       (Haversine distance vs. service_radius_km). Not wired into the
--       assignment RPC yet.
-- ============================================================================
alter table public.vendors
  add column if not exists base_latitude            numeric,
  add column if not exists base_longitude           numeric,
  add column if not exists location_accuracy_meters numeric,
  add column if not exists location_source          text,
  add column if not exists location_captured_at      timestamptz,
  add column if not exists service_radius_km          numeric default 10,
  add column if not exists base_area                  text,
  add column if not exists base_pincode               text;
