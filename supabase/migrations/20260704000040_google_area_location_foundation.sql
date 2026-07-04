-- ============================================================================
-- QuickFurno — 20260704000040_google_area_location_foundation.sql
-- Phase 1: Structured Google / location data FOUNDATION.
--
-- ADDITIVE ONLY — `add column if not exists` + `create index if not exists`.
-- Never drops, never alters, never renames existing columns/data. Safe and
-- idempotent to re-run on the live database.
--
-- Purpose: give leads structured latitude/longitude + Google Place identity +
-- normalized area fields (today the client GPS is only appended to the free-text
-- requirement, not stored structurally), and give vendors matching Google Place /
-- normalized-area columns. This is the DATA foundation for later Google-area lead
-- matching. NOTHING in this phase changes matching, quality scoring, duplicate
-- detection, or the public UI. All columns are optional/nullable and the app
-- degrades gracefully (missing-column fallback) until this migration is applied.
-- ============================================================================

-- ── Leads: structured location + Google Place identity + normalized area ─────
alter table public.leads
  add column if not exists latitude                 double precision,
  add column if not exists longitude                double precision,
  add column if not exists location_accuracy_meters double precision,
  add column if not exists location_source          text,
  add column if not exists location_captured_at     timestamptz,
  add column if not exists google_place_id          text,
  add column if not exists formatted_address        text,
  add column if not exists area_normalized          text,
  add column if not exists sublocality              text,
  add column if not exists neighborhood             text,
  add column if not exists postal_code              text;

comment on column public.leads.location_source is
  'How the coordinates were captured: manual | browser_gps | google_place | reverse_geocode. Phase 1 foundation for Google-area matching.';
comment on column public.leads.area_normalized is
  'Normalized locality/area string (from Google Place / reverse geocode) for future area-based vendor matching. Phase 1 foundation.';

-- ── Vendors: Google Place identity + normalized area (matches lead columns) ──
alter table public.vendors
  add column if not exists google_place_id   text,
  add column if not exists formatted_address text,
  add column if not exists area_normalized   text,
  add column if not exists sublocality       text,
  add column if not exists neighborhood      text;

comment on column public.vendors.area_normalized is
  'Normalized locality/area string aligned with leads.area_normalized for future Google-area matching. Phase 1 foundation.';

-- ── Optional supporting indexes (idempotent) ────────────────────────────────
-- Speed up future area/city-based matching lookups. Additive only.
create index if not exists idx_leads_city_service    on public.leads   (city, service_required);
create index if not exists idx_leads_area_normalized on public.leads   (area_normalized);
create index if not exists idx_vendors_city          on public.vendors (city);
create index if not exists idx_vendors_area_normalized on public.vendors (area_normalized);
