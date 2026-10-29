-- ============================================================================
-- DO NOT APPLY TO STAGING/PRODUCTION
-- SOURCE-ONLY, NON-DEPLOYABLE SQL CANDIDATE.
--
-- Purpose: proposed hardening of public.is_admin() to additionally require
-- profiles.is_active IS TRUE, so deactivated admin accounts lose admin RLS
-- privileges immediately.
--
-- Reference: supabase/migrations/20260620000002_rls_policies.sql lines 10-13
-- (current definition, unmodified by this file).
--
-- This file is NOT a migration. It is not numbered, not wired into the
-- Supabase migration chain, and must not be copied into supabase/migrations/
-- without explicit review and a proper timestamped migration file.
-- ============================================================================

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'admin'
      and is_active is true
  );
$$;
