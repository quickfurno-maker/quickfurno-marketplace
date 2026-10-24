-- STEP3B11B - REVIEW ONLY, never deploy to managed Supabase without independent AppSec.
-- Qualified reviewer must map 69 dependent policies; global owns_vendor change affects historical reads.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO pg_catalog, public, pg_temp
AS $qf$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role = 'admin'
      AND p.is_active IS TRUE
  );
$qf$;
CREATE OR REPLACE FUNCTION public.owns_vendor(p_vendor_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO pg_catalog, public, pg_temp
AS $qf$
  SELECT EXISTS (
    SELECT 1 FROM public.vendors v
    WHERE v.id = p_vendor_id
      AND v.user_id = auth.uid()
      AND v.status = 'Approved'
      AND v.is_active IS TRUE
  );
$qf$;
-- Historical read: optional domain-policy alternative; owner/DBA/AppSec decision still required.
CREATE OR REPLACE FUNCTION public.owns_vendor_historical(p_vendor_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO pg_catalog, public, pg_temp
AS $qf$
  SELECT EXISTS (
    SELECT 1 FROM public.vendors v
    WHERE v.id = p_vendor_id AND v.user_id = auth.uid()
  );
$qf$;
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.owns_vendor(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.owns_vendor_historical(uuid) FROM PUBLIC;
-- No managed grant or live SQL migration is authorized by this file.
