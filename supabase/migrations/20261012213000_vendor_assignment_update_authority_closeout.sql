-- VL-01 vendor assignment authority closeout (SOURCE ONLY until separately approved rollout).
-- Historical owner-update RLS + table UPDATE grant allowed a vendor's authenticated
-- PostgREST role to update financially and routing-sensitive columns on their own
-- assignment. Core owns the complete assignment state transition. Vendor acknowledgement
-- is performed by the existing Core RPC/service, never direct row UPDATE.
--
-- Review scope before applying: service-role Core administrative write paths must remain
-- functional; no historical assignment/wallet mutations are part of this migration.
BEGIN;

REVOKE UPDATE ON TABLE public.lead_assignments FROM anon, authenticated;

DROP POLICY IF EXISTS "assign owner update" ON public.lead_assignments;

-- Preserve the owner SELECT RLS policy, admin SELECT, and all service-role paths.
DO $vl01$
BEGIN
  IF has_table_privilege('authenticated', 'public.lead_assignments', 'UPDATE')
     OR has_table_privilege('anon', 'public.lead_assignments', 'UPDATE') THEN
    RAISE EXCEPTION 'VL01_ASSIGNMENT_AUTH_ROLE_UPDATE_STILL_GRANTED';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'lead_assignments'
      AND policyname = 'assign owner update'
  ) THEN
    RAISE EXCEPTION 'VL01_ASSIGNMENT_OWNER_UPDATE_POLICY_STILL_EXISTS';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'lead_assignments'
      AND policyname = 'assign owner read' AND cmd = 'SELECT'
  ) THEN
    RAISE EXCEPTION 'VL01_ASSIGNMENT_OWNER_READ_POLICY_MISSING';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.lead_assignments', 'UPDATE') THEN
    RAISE EXCEPTION 'VL01_CORE_SERVICE_ROLE_UPDATE_UNAVAILABLE';
  END IF;
END;
$vl01$;

COMMIT;
