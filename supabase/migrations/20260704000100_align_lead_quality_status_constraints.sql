-- ============================================================================
-- QuickFurno — 20260704000100_align_lead_quality_status_constraints.sql
--
-- COMPATIBILITY FIX (additive only). The Lead Quality Engine + lead capture
-- write verification_status / status values that the LEGACY live check
-- constraints reject, causing:
--   new row for relation "leads" violates check constraint
--     "leads_verification_status_check"
--
-- This migration widens BOTH check constraints to a strict SUPERSET of the
-- legacy allowed values (nothing is removed) so both the old admin pipeline and
-- the current Lead Quality Engine values are accepted.
--
-- SAFE / NON-DESTRUCTIVE:
--   * add-only value sets (every legacy value is preserved),
--   * column TYPES are unchanged (still text), columns are NOT renamed,
--   * NO existing lead rows are read, updated, or deleted (a superset constraint
--     can never invalidate a row that already satisfied the narrower one; and
--     `col in (...)` passes for NULL),
--   * `drop constraint if exists` makes this idempotent + safe to re-run.
--
-- Application code is the source of truth for these strings and is NOT changed:
--   leadService.ts            → verification_status: 'Quality Pending','Manual Review'
--                               status:              'New','Duplicate'
--   leadQualityService.ts     → verification_status: 'Quality Checked','Manual Review','Rejected Quality'
--                               status:              'Quality Checked','Hot Lead',
--                                                    'Clarification Required','Nurture',
--                                                    'Rejected Quality','Duplicate'
-- ============================================================================

-- 1) verification_status --------------------------------------------------------
--    Legacy: Pending, Verified, Rejected
--    Added : Quality Pending, Quality Checked, Manual Review, Rejected Quality
alter table public.leads drop constraint if exists leads_verification_status_check;
alter table public.leads
  add constraint leads_verification_status_check check (verification_status in (
    -- legacy
    'Pending','Verified','Rejected',
    -- Lead Quality Engine
    'Quality Pending','Quality Checked','Manual Review','Rejected Quality'
  ));

-- 2) status ---------------------------------------------------------------------
--    Legacy: New, Verified, Assigned, Contacted, Site Visit Scheduled,
--            Quotation Sent, Converted, Won, Lost, Duplicate, Bad Lead
--    Added : Quality Checked, Hot Lead, Clarification Required, Nurture,
--            Rejected Quality
alter table public.leads drop constraint if exists leads_status_check;
alter table public.leads
  add constraint leads_status_check check (status in (
    -- legacy
    'New','Verified','Assigned','Contacted','Site Visit Scheduled',
    'Quotation Sent','Converted','Won','Lost','Duplicate','Bad Lead',
    -- Lead Quality Engine
    'Quality Checked','Hot Lead','Clarification Required','Nurture','Rejected Quality'
  ));
