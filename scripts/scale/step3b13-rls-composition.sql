\set ON_ERROR_STOP on
-- Phase3B13 extended real local PostgreSQL17 compositional RLS tests.
-- Must run only AFTER step3b11b-pg17-rls-isolated.sql in ephemeral PG scratch.
-- Never apply to managed Supabase or real vendor tables.
CREATE TABLE public.vendor_actions (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 vendor_id uuid NOT NULL,
 subject text NOT NULL
);
INSERT INTO public.vendor_actions(vendor_id,subject) VALUES
('00000000-0000-4000-8000-000000000011','suspended-legacy'),
('00000000-0000-4000-8000-000000000012','active-allowed');
ALTER TABLE public.vendor_actions ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON public.vendor_actions TO authenticated;
GRANT USAGE,SELECT ON SEQUENCE public.vendor_actions_id_seq TO authenticated;
CREATE POLICY vendor_actions_select ON public.vendor_actions FOR SELECT TO authenticated
 USING (public.owns_vendor(vendor_id));
CREATE POLICY vendor_actions_insert ON public.vendor_actions FOR INSERT TO authenticated
 WITH CHECK (public.owns_vendor(vendor_id));
CREATE POLICY vendor_actions_update ON public.vendor_actions FOR UPDATE TO authenticated
 USING (public.owns_vendor(vendor_id))
 WITH CHECK (public.owns_vendor(vendor_id));
-- Demonstrate how one permissive SELECT policy defeats a strict sibling via OR.
CREATE POLICY temporary_insecure_or ON public.vendor_actions FOR SELECT TO authenticated
 USING (vendor_id='00000000-0000-4000-8000-000000000011');
\echo STEP3B13_TEMPORARY_OR_POLICY_DEMONSTRATION
SET ROLE authenticated;
SELECT set_config('qf.test_uid','00000000-0000-4000-8000-000000000003',false);
DO $q$ BEGIN
 IF (SELECT count(*) FROM public.vendor_actions)<>1 THEN
  RAISE EXCEPTION 'permissive OR demonstration did not permit suspended vendor read';
 END IF;
END $q$;
RESET ROLE;
DROP POLICY temporary_insecure_or ON public.vendor_actions;
\echo STEP3B13_EFFECTIVE_DENIAL_AFTER_OR_REMOVAL
SET ROLE authenticated;
SELECT set_config('qf.test_uid','00000000-0000-4000-8000-000000000003',false);
DO $q$ BEGIN
 IF (SELECT count(*) FROM public.vendor_actions)<>0 THEN
  RAISE EXCEPTION 'suspended vendor still has SELECT through multi-policy composition';
 END IF;
END $q$;
-- Rejected INSERT must actually raise permission error.
DO $q$ DECLARE denied boolean:=false; BEGIN
 BEGIN
  INSERT INTO public.vendor_actions(vendor_id,subject)
   VALUES('00000000-0000-4000-8000-000000000011','blocked-suspended');
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'suspended vendor INSERT unexpectedly allowed'; END IF;
END $q$;
SELECT set_config('qf.test_uid','00000000-0000-4000-8000-000000000004',false);
INSERT INTO public.vendor_actions(vendor_id,subject)
 VALUES('00000000-0000-4000-8000-000000000012','allowed-current');
DO $q$ BEGIN
 IF (SELECT count(*) FROM public.vendor_actions)<>2 THEN
  RAISE EXCEPTION 'active vendor cannot read expected own rows';
 END IF;
END $q$;
-- UPDATE WITH CHECK must prevent changing tenant ownership.
DO $q$ DECLARE denied boolean:=false; BEGIN
 BEGIN
  UPDATE public.vendor_actions
   SET vendor_id='00000000-0000-4000-8000-000000000011'
   WHERE subject='allowed-current';
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'tenant reassignment permitted despite WITH CHECK'; END IF;
END $q$;
UPDATE public.vendor_actions SET subject='active-owned-updated' WHERE subject='allowed-current';
DO $q$ BEGIN
 IF (SELECT count(*) FROM public.vendor_actions WHERE subject='active-owned-updated')<>1 THEN
  RAISE EXCEPTION 'legitimate active vendor UPDATE failed';
 END IF;
END $q$;
RESET ROLE;
CREATE ROLE anon NOLOGIN;
GRANT USAGE ON SCHEMA public TO anon;
DO $q$ BEGIN
 IF has_table_privilege('anon','public.vendor_actions','SELECT') THEN
  RAISE EXCEPTION 'anon accidentally granted protected table read';
 END IF;
 IF has_function_privilege('anon','public.is_admin()','EXECUTE') THEN
  RAISE EXCEPTION 'anon can call admin SECURITY DEFINER helper';
 END IF;
 IF has_function_privilege('anon','public.owns_vendor_historical(uuid)','EXECUTE') THEN
  RAISE EXCEPTION 'anon can call historical ownership helper';
 END IF;
END $q$;
\echo STEP3B13_COMPOSITIONAL_RLS_REAL_PG17_PASS
