-- ============================================================================
-- VOX P0-6 STAGING ROLLBACK MIGRATION CANDIDATE — DO NOT APPLY WITHOUT GATE.
-- Restores the exact public.is_admin() body observed on managed Staging
-- immediately before the proposed P0-6 forward migration.
-- This is intended to become a NEW later migration if rollback is required;
-- never delete/rewrite an already-applied migration-history row.
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
  );
$$;
