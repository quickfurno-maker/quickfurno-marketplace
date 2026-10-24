\set ON_ERROR_STOP on
-- LOCAL EPHEMERAL PG17 ONLY: intentionally simplified FK model, NOT deployable production SQL.
-- Seed current aggregate counts without copying personal/sensitive production data.
CREATE TABLE public.vendors (id integer PRIMARY KEY, city text NOT NULL, user_id integer);
CREATE TABLE public.leads (id integer PRIMARY KEY, city text NOT NULL);
CREATE TABLE public.lead_assignments (id integer PRIMARY KEY, lead_id integer REFERENCES public.leads(id) ON DELETE CASCADE,
 vendor_id integer REFERENCES public.vendors(id) ON DELETE CASCADE);
CREATE TABLE public.lead_assignment_events (id integer PRIMARY KEY,
 lead_id integer REFERENCES public.leads(id) ON DELETE RESTRICT,
 vendor_id integer REFERENCES public.vendors(id) ON DELETE RESTRICT,
 assignment_id integer REFERENCES public.lead_assignments(id) ON DELETE SET NULL);
CREATE TABLE public.lead_delivery_logs (id integer PRIMARY KEY,
 lead_id integer REFERENCES public.leads(id) ON DELETE CASCADE,
 vendor_id integer REFERENCES public.vendors(id) ON DELETE CASCADE,
 assignment_id integer REFERENCES public.lead_assignments(id) ON DELETE SET NULL);
CREATE TABLE public.vendor_credit_logs (id integer PRIMARY KEY, vendor_id integer);
CREATE TABLE public.assignment_operations (id integer PRIMARY KEY,
 lead_id integer REFERENCES public.leads(id) ON DELETE RESTRICT);
CREATE TABLE public.lead_matching_runs (id integer PRIMARY KEY,
 lead_id integer REFERENCES public.leads(id) ON DELETE CASCADE);
CREATE TABLE public.client_notification_logs (id integer PRIMARY KEY,
 lead_id integer REFERENCES public.leads(id) ON DELETE CASCADE);
CREATE TABLE public.vendor_notifications (id integer PRIMARY KEY,
 vendor_id integer REFERENCES public.vendors(id) ON DELETE CASCADE);
CREATE TABLE public.vendor_dashboard_users (id integer PRIMARY KEY,
 vendor_id integer REFERENCES public.vendors(id) ON DELETE CASCADE,
 user_id integer NOT NULL);
CREATE TABLE public.auth_users (id integer PRIMARY KEY, staff_role text NOT NULL);
CREATE TABLE public.marketplace_runtime_settings (key text PRIMARY KEY, value text NOT NULL);
CREATE TABLE public.service_categories (id integer PRIMARY KEY, name text NOT NULL);
INSERT INTO public.vendors
 SELECT g, CASE WHEN g<=27 THEN 'Pune' ELSE 'Mumbai' END,
 CASE WHEN g<=9 THEN 100+g ELSE NULL END
 FROM generate_series(1,29) g;
INSERT INTO public.leads SELECT g,CASE WHEN g<=71 THEN 'Pune' ELSE 'Mumbai' END
 FROM generate_series(1,74) g;
INSERT INTO public.lead_assignments
 SELECT g, 1+((g-1)%35),1+((g-1)%29) FROM generate_series(1,71) g;
INSERT INTO public.lead_assignment_events
 SELECT g,1+((g-1)%35),1+((g-1)%29),CASE WHEN g<=71 THEN g ELSE NULL END
 FROM generate_series(1,73) g;
INSERT INTO public.lead_delivery_logs
 SELECT g,1+((g-1)%35),1+((g-1)%29),CASE WHEN g<=71 THEN g ELSE NULL END
 FROM generate_series(1,135) g;
INSERT INTO public.vendor_credit_logs SELECT g,1+((g-1)%29) FROM generate_series(1,81) g;
INSERT INTO public.assignment_operations SELECT g,1+((g-1)%74) FROM generate_series(1,36) g;
INSERT INTO public.lead_matching_runs SELECT g,1+((g-1)%74) FROM generate_series(1,36) g;
INSERT INTO public.client_notification_logs SELECT g,1+((g-1)%74) FROM generate_series(1,41) g;
INSERT INTO public.vendor_notifications SELECT g,1+((g-1)%29) FROM generate_series(1,15) g;
INSERT INTO public.vendor_dashboard_users SELECT g,1+((g-1)%29),101+((g-1)%9) FROM generate_series(1,8) g;
INSERT INTO public.auth_users SELECT g,'vendor' FROM generate_series(101,109) g;
INSERT INTO public.auth_users VALUES (1,'owner'),(2,'staff');
INSERT INTO public.marketplace_runtime_settings VALUES ('auto_assignment_mode','auto_suggest');
INSERT INTO public.service_categories VALUES (1,'Interior Services');

-- Guard against every destructive operation changing live counts without authorization.
-- A single count mismatch must abort the transaction, even on a locally seeded mock.
BEGIN;
INSERT INTO public.leads VALUES (75,'Pune');
DO $guard$ BEGIN
 IF (SELECT count(*) FROM public.leads)=74 THEN
  RAISE EXCEPTION 'expected simulated new lead to change count';
 END IF;
END $guard$;
ROLLBACK;
DO $guard$ BEGIN
 IF (SELECT count(*) FROM public.leads)<>74 THEN RAISE EXCEPTION 'rollback was not complete'; END IF;
END $guard$;
\echo 3B14A_RACE_GUARD_ROLLBACK_PASS

-- With all roots and child records simulated, demonstrate named FK RESTRICT forces
-- explicit child-first deletes and cannot be satisfied by a blind vendors DELETE.
BEGIN;
SAVEPOINT unsafe_delete;
DO $block$
DECLARE rejected boolean:=false;
BEGIN
 BEGIN DELETE FROM public.vendors WHERE id=1;
 EXCEPTION WHEN foreign_key_violation THEN rejected:=true;
 END;
 IF NOT rejected THEN RAISE EXCEPTION 'unsafe delete did not fail on RESTRICT'; END IF;
END $block$;
ROLLBACK TO unsafe_delete;
ROLLBACK;
\echo 3B14A_RESTRICT_FK_BLOCKS_BLIND_DELETE_PASS

-- The replay is never run against a managed database. Includes exact aggregate
-- assertions and logical survivor checks. Auth remains untouched until separately approved.
BEGIN;
SELECT id FROM public.vendors ORDER BY id FOR UPDATE;
SELECT id FROM public.leads ORDER BY id FOR UPDATE;
DO $preflight$
BEGIN
 IF (SELECT count(*) FROM public.vendors)<>29 OR
    (SELECT count(*) FROM public.leads)<>74 OR
    (SELECT count(*) FROM public.vendors WHERE city='Pune')<>27 OR
    (SELECT count(*) FROM public.vendors WHERE city='Mumbai')<>2 OR
    (SELECT count(*) FROM public.lead_assignments)<>71 OR
    (SELECT count(*) FROM public.lead_assignment_events)<>73 OR
    (SELECT count(*) FROM public.vendor_credit_logs)<>81
 THEN RAISE EXCEPTION 'aggregate preflight changed: refuse purge'; END IF;
END $preflight$;
DELETE FROM public.lead_assignment_events;
DELETE FROM public.assignment_operations;
DELETE FROM public.vendor_credit_logs;
DELETE FROM public.lead_delivery_logs;
DELETE FROM public.lead_assignments;
DELETE FROM public.vendor_notifications;
DELETE FROM public.vendor_dashboard_users;
DELETE FROM public.leads;
DELETE FROM public.vendors;
DO $postflight$
BEGIN
 IF (SELECT count(*) FROM public.vendors)<>0 OR
    (SELECT count(*) FROM public.leads)<>0 OR
    (SELECT count(*) FROM public.lead_assignment_events)<>0 OR
    (SELECT count(*) FROM public.lead_assignments)<>0 OR
    (SELECT count(*) FROM public.lead_delivery_logs)<>0 OR
    (SELECT count(*) FROM public.assignment_operations)<>0 OR
    (SELECT count(*) FROM public.vendor_credit_logs)<>0 OR
    (SELECT count(*) FROM public.lead_matching_runs)<>0 OR
    (SELECT count(*) FROM public.client_notification_logs)<>0
 THEN RAISE EXCEPTION 'orphaned synthetic test data after wipe'; END IF;
 IF (SELECT count(*) FROM public.auth_users)<>11 OR
    (SELECT count(*) FROM public.auth_users WHERE staff_role IN ('owner','staff'))<>2
 THEN RAISE EXCEPTION 'Auth accounts changed'; END IF;
 IF (SELECT value FROM public.marketplace_runtime_settings WHERE key='auto_assignment_mode')<>'auto_suggest' OR
    (SELECT count(*) FROM public.service_categories)<>1 THEN
  RAISE EXCEPTION 'unrelated business configuration was modified';
 END IF;
END $postflight$;
COMMIT;
\echo STEP3B14A_LOCAL_PG17_EXACT_COUNT_PURGE_ROLLBACK_FK_SURVIVOR_TEST_PASS
