-- Step3B5 candidate for review ONLY; keep OUTSIDE supabase/migrations/ and VOX pinned candidates.
-- WARNING: ownership-only access may intentionally permit suspended vendors to see past invoices,
-- dispute messages or support cases. Policy-by-policy product/finance review required before deploy.
BEGIN;
CREATE OR REPLACE FUNCTION public.owns_vendor(p_vendor_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO pg_catalog, public, pg_temp
AS $qf$
 SELECT EXISTS (
  SELECT 1 FROM public.vendors v
  WHERE v.id=p_vendor_id AND v.user_id=auth.uid()
    AND v.is_active IS TRUE AND v.status='Approved'
 );
$qf$;
COMMIT;
