-- ============================================================================
-- VOX P0-6 STAGING MIGRATION CANDIDATE — DO NOT APPLY WITHOUT OWNER GATE.
-- Scope: public.is_admin() only. No policy rewrite. No owns_vendor() change.
-- Expected pre-change Staging state on 2026-10-29:
--   is_admin() = profile id = auth.uid() AND role = 'admin'
--   59 public RLS policies reference is_admin()
-- Rollback candidate:
--   ops/security/sql-candidates/vox_p0_5_is_admin_rollback_candidate.sql
-- ============================================================================

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'admin'
      and is_active is true
  );
$$;
