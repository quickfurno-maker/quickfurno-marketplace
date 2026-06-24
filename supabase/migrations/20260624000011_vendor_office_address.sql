-- ============================================================================
-- QuickFurno — 20260624000011_vendor_office_address.sql
-- Detailed office / business address captured by the onboarding wizard (Step 3).
-- ADDITIVE ONLY — `add column if not exists`, never drops/alters existing data.
-- Safe + idempotent to re-run. Column names match the live public.vendors table
-- exactly (office_ prefix; line1/line2 with no underscore before the digit).
--
-- city / latitude / longitude / areas_covered / custom_service_area already exist
-- (migrations 009 + 010 + 007). office_city / office_latitude / office_longitude
-- are the address-specific copies saved alongside them.
-- ============================================================================
alter table public.vendors
  add column if not exists office_address_line1 text,
  add column if not exists office_address_line2 text,
  add column if not exists office_landmark      text,
  add column if not exists office_city          text,
  add column if not exists office_state         text,
  add column if not exists office_pincode       text,
  add column if not exists office_latitude      numeric,
  add column if not exists office_longitude     numeric;
