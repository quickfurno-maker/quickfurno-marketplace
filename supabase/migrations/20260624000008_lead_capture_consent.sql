-- ============================================================================
-- QuickFurno — 20260624000008_lead_capture_consent.sql
-- Adds tracking-readiness + consent capture to client leads. All columns are
-- nullable and additive so existing rows and the app keep working even before
-- this migration is applied (leadService.createLead falls back gracefully if a
-- column is missing). Idempotent — safe to re-run.
-- ============================================================================
alter table public.leads
  add column if not exists source_url        text,
  add column if not exists utm_source        text,
  add column if not exists utm_medium        text,
  add column if not exists utm_campaign      text,
  add column if not exists utm_term          text,
  add column if not exists utm_content       text,
  -- Consent the client gave at submit time.
  add column if not exists location_consent  boolean default false,
  add column if not exists share_consent     boolean default false;
