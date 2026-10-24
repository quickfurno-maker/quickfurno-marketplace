\set ON_ERROR_STOP on
-- Only for isolated ephemeral PG17 localhost 127.0.0.1:55477. No managed DB URL accepted.
CREATE ROLE authenticated NOLOGIN;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $q$
  SELECT NULLIF(current_setting('qf.test_uid',true),'')::uuid
$q$;
CREATE TABLE public.profiles (id uuid PRIMARY KEY,role text NOT NULL,is_active boolean NOT NULL);
CREATE TABLE public.vendors (id uuid PRIMARY KEY,user_id uuid NOT NULL,status text NOT NULL,is_active boolean NOT NULL);
CREATE TABLE public.audit_logs (id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, event text NOT NULL);
CREATE TABLE public.vendor_new_work (id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,vendor_id uuid NOT NULL,subject text NOT NULL);
CREATE TABLE public.vendor_history (id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,vendor_id uuid NOT NULL,subject text NOT NULL);
INSERT INTO public.profiles VALUES
 ('00000000-0000-4000-8000-000000000001','admin',false),
 ('00000000-0000-4000-8000-000000000002','admin',true);
INSERT INTO public.vendors VALUES
 ('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000003','Suspended',false),
 ('00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000004','Approved',true);
INSERT INTO public.vendor_new_work(vendor_id,subject) VALUES
 ('00000000-0000-4000-8000-000000000011','held'),('00000000-0000-4000-8000-000000000012','allowed');
INSERT INTO public.vendor_history(vendor_id,subject) VALUES
 ('00000000-0000-4000-8000-000000000011','past'),('00000000-0000-4000-8000-000000000012','past');
CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $q$
 SELECT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.role='admin')
$q$;
CREATE OR REPLACE FUNCTION public.owns_vendor(p_vendor_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $q$
 SELECT EXISTS (SELECT 1 FROM public.vendors v WHERE v.id=p_vendor_id AND v.user_id=auth.uid())
$q$;
GRANT USAGE ON SCHEMA public,auth TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth,public TO authenticated;
GRANT SELECT,INSERT ON public.audit_logs TO authenticated;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT SELECT ON public.vendor_new_work,public.vendor_history TO authenticated;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_new_work ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_admin_read ON public.audit_logs FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY audit_admin_write ON public.audit_logs FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY vendor_new_work_read ON public.vendor_new_work FOR SELECT TO authenticated USING (public.owns_vendor(vendor_id));
CREATE POLICY vendor_history_read ON public.vendor_history FOR SELECT TO authenticated USING (public.owns_vendor(vendor_id));
\echo BEFORE_GUARDS_LEGACY_EFFECTIVE_RLS
SET ROLE authenticated;
SELECT set_config('qf.test_uid','00000000-0000-4000-8000-000000000001',false);
DO $q$ BEGIN IF NOT public.is_admin() THEN RAISE EXCEPTION 'expected legacy inactive admin to pass'; END IF; END $q$;
INSERT INTO public.audit_logs(event) VALUES('legacy_inactive_admin_insert_allowed');
SELECT set_config('qf.test_uid','00000000-0000-4000-8000-000000000003',false);
DO $q$ BEGIN IF NOT public.owns_vendor('00000000-0000-4000-8000-000000000011') THEN RAISE EXCEPTION 'expected legacy suspended vendor to pass'; END IF; END $q$;
DO $q$ BEGIN IF (SELECT count(*) FROM public.vendor_new_work) <> 1 THEN RAISE EXCEPTION 'legacy vendor new work unexpected'; END IF; END $q$;
RESET ROLE;
\i ops/vox/sql-review/STEP3B11B-HELPER-STATUS-GUARDS-REVIEW_ONLY.sql
-- OFFLINE MOCK ONLY: AppSec must explicitly approve any managed role grant.
GRANT EXECUTE ON FUNCTION public.owns_vendor_historical(uuid) TO authenticated;
-- Intentional offline-only historical policy split, not a decision about production vendor invoices:
DROP POLICY vendor_history_read ON public.vendor_history;
CREATE POLICY vendor_history_read ON public.vendor_history FOR SELECT TO authenticated USING (public.owns_vendor_historical(vendor_id));
\echo AFTER_GUARDS_PROPOSED_EFFECTIVE_RLS
SET ROLE authenticated;
SELECT set_config('qf.test_uid','00000000-0000-4000-8000-000000000001',false);
DO $q$ BEGIN IF public.is_admin() THEN RAISE EXCEPTION 'inactive admin retained access'; END IF; IF (SELECT count(*) FROM public.audit_logs) <> 0 THEN RAISE EXCEPTION 'inactive admin audit read leaked'; END IF; END $q$;
SELECT set_config('qf.test_uid','00000000-0000-4000-8000-000000000002',false);
DO $q$ BEGIN IF NOT public.is_admin() THEN RAISE EXCEPTION 'active admin blocked'; END IF; IF (SELECT count(*) FROM public.audit_logs) <> 1 THEN RAISE EXCEPTION 'active admin audit read blocked'; END IF; END $q$;
INSERT INTO public.audit_logs(event) VALUES('active_admin_allowed');
SELECT set_config('qf.test_uid','00000000-0000-4000-8000-000000000003',false);
DO $q$ BEGIN IF public.owns_vendor('00000000-0000-4000-8000-000000000011') THEN RAISE EXCEPTION 'suspended vendor new work access persisted'; END IF; IF (SELECT count(*) FROM public.vendor_new_work)<>0 THEN RAISE EXCEPTION 'suspended vendor sees new work'; END IF; IF (SELECT count(*) FROM public.vendor_history)<>1 THEN RAISE EXCEPTION 'suspended vendor historical-read exception unavailable'; END IF; END $q$;
SELECT set_config('qf.test_uid','00000000-0000-4000-8000-000000000004',false);
DO $q$ BEGIN IF NOT public.owns_vendor('00000000-0000-4000-8000-000000000012') THEN RAISE EXCEPTION 'active vendor wrongly denied'; END IF; IF (SELECT count(*) FROM public.vendor_new_work)<>1 THEN RAISE EXCEPTION 'approved vendor own new work denied'; END IF; IF (SELECT count(*) FROM public.vendor_history)<>1 THEN RAISE EXCEPTION 'approved vendor historical read denied'; END IF; END $q$;
SELECT set_config('qf.test_uid','00000000-0000-4000-8000-000000000099',false);
DO $q$ BEGIN IF (SELECT count(*) FROM public.vendor_new_work)<>0 OR (SELECT count(*) FROM public.vendor_history)<>0 THEN RAISE EXCEPTION 'cross-vendor data leaked'; END IF; END $q$;
RESET ROLE;
\echo STEP3B11B_EPHEMERAL_PG17_RLS_NEGATIVE_TEST_PASS
