-- ============================================================================
-- QuickFurno - Phase 14B: City Source-of-Truth Cleanup
-- Migration suggestion only. Safe to run on the live DB (idempotent).
--
-- Purpose:
-- - The original demo seed (20260620000004_seed_data.sql) inserted 7 cities all
--   ACTIVE: Pune, Mumbai, Bengaluru, Hyderabad, Delhi, Nagpur, Nashik.
-- - The launched marketplace currently serves only Pune and Mumbai, so the
--   extra demo cities are DEACTIVATED here. After this, every city dropdown
--   (public enquiry, vendor registration, admin filters, eligibility checker)
--   shows only active cities = Pune + Mumbai.
--
-- This is NON-DESTRUCTIVE and FULLY REVERSIBLE:
-- - It only sets is_active = false (no drop / delete / truncate).
-- - An admin can re-activate any city anytime from Admin -> Cities & Locations
--   (Enable), and it will reappear everywhere automatically.
-- - Pune and Mumbai are explicitly kept ACTIVE.
--
-- Safety: matches by slug AND case-insensitive name so it works regardless of
-- how the rows were created. No-op if the rows do not exist.
-- ============================================================================

-- Deactivate the extra demo-seed cities (NOT Pune / Mumbai).
update public.cities
set is_active = false
where (
  slug in ('bengaluru', 'hyderabad', 'delhi', 'nagpur', 'nashik')
  or lower(name) in ('bengaluru', 'hyderabad', 'delhi', 'nagpur', 'nashik')
)
and is_active is distinct from false;

-- Ensure the launched cities stay active (safe no-op if already active / absent).
update public.cities
set is_active = true
where (slug in ('pune', 'mumbai') or lower(name) in ('pune', 'mumbai'))
and is_active is distinct from true;
