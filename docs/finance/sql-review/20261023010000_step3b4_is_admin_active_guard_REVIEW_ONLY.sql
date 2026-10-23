-- QuickFurno Step 3B4 INTERNAL SECURITY CANDIDATE ONLY, NOT A DEPLOYABLE MIGRATION.
-- High-impact change: public.is_admin() is referenced by 59 existing Staging RLS policies.
-- Advisory-only; requires AppSec review, owned migration, full RLS regression, independent approval.
-- The legacy Superadmin placeholder is NOT handled by this candidate.
-- The candidate MUST NOT be merged into the runnable supabase/migrations tree.
BEGIN;
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO pg_catalog, public, pg_temp
AS $qf$
  SELECT EXISTS (
    SELECT 1
      FROM public.profiles p
     WHERE p.id = auth.uid()
       AND p.role = 'admin'
       AND p.is_active IS TRUE
  );
$qf$;
-- Preserve currently required authenticated EXECUTE; broad revocation could break the marketplace.
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;
COMMIT;
