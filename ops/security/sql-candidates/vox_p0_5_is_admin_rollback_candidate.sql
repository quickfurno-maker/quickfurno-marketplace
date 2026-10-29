-- ============================================================================
-- DO NOT APPLY TO STAGING/PRODUCTION
-- SOURCE-ONLY rollback candidate for the P0-2 is_admin() active-profile change.
-- Restores the exact managed-Staging behavior observed read-only on 2026-10-29.
-- ============================================================================

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'admin'
  );
$$;
