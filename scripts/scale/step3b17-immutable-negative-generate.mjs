// Generates a negative-only PostgreSQL 17 rehearsal from the ACTUAL immutable
// trigger functions in the governed migration. Synthetic rows only; never
// invoke against Production or a managed Supabase database.
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import assert from "node:assert/strict";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const migration=readFileSync(resolve(root,"supabase/migrations/20260723000500_qf_mvp_assignment_universal_enforcement.sql"),"utf8");
const fn=(name)=>{
 const expression=new RegExp("create or replace function public\\."+name+"\\(\\)[\\s\\S]*?\\$\\$;", "i");
 const m=migration.match(expression);
 assert.ok(m,"Immutable function absent: "+name);
 return m[0]+"\n";
};
const mutable=fn("qf_prevent_lead_assignment_event_mutation");
const truncate=fn("qf_prevent_lead_assignment_event_truncate");
assert.match(mutable,/if tg_op = 'DELETE' then/);
assert.match(mutable,/QF_LEAD_ASSIGNMENT_EVENTS_IMMUTABLE/);
assert.match(mutable,/if new\.assignment_id is distinct from old\.assignment_id/);
assert.match(truncate,/QF_LEAD_ASSIGNMENT_EVENTS_TRUNCATE_FORBIDDEN/);
const db=String.raw`
\set ON_ERROR_STOP on
CREATE TABLE public.vendors(id uuid PRIMARY KEY);
CREATE TABLE public.leads(id uuid PRIMARY KEY);
CREATE TABLE public.lead_assignments(
 id uuid PRIMARY KEY,
 lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
 vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE
);
CREATE TABLE public.lead_assignment_events(
 id uuid PRIMARY KEY,
 lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE RESTRICT,
 vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE RESTRICT,
 assignment_id uuid REFERENCES public.lead_assignments(id) ON DELETE SET NULL,
 operation_id uuid,
 action text NOT NULL
);
CREATE TABLE public.assignment_operations(
 id uuid PRIMARY KEY,
 lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE RESTRICT
);
`+mutable+truncate+String.raw`
CREATE TRIGGER trg_lead_assignment_events_immutable
 BEFORE UPDATE OR DELETE ON public.lead_assignment_events
 FOR EACH ROW EXECUTE FUNCTION public.qf_prevent_lead_assignment_event_mutation();
CREATE TRIGGER trg_lead_assignment_events_no_truncate
 BEFORE TRUNCATE ON public.lead_assignment_events
 FOR EACH STATEMENT EXECUTE FUNCTION public.qf_prevent_lead_assignment_event_truncate();
INSERT INTO public.vendors
 SELECT ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid FROM generate_series(1,29) n;
INSERT INTO public.leads
 SELECT ('10000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid FROM generate_series(1,74) n;
INSERT INTO public.lead_assignments
 SELECT ('20000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
 ('10000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
 ('00000000-0000-0000-0000-'||lpad((1+(n-1)%29)::text,12,'0'))::uuid
 FROM generate_series(1,71) n;
INSERT INTO public.lead_assignment_events
 SELECT ('30000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
 ('10000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
 ('00000000-0000-0000-0000-'||lpad((1+(n-1)%29)::text,12,'0'))::uuid,
 CASE WHEN n<=71 THEN ('20000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid ELSE NULL END,
 NULL::uuid, 'synthetic_assignment_event'
 FROM generate_series(1,73) n;
INSERT INTO public.assignment_operations
 SELECT ('40000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
 ('10000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid
 FROM generate_series(1,36) n;

DO $case$
BEGIN
 BEGIN
  DELETE FROM public.lead_assignment_events WHERE id='30000000-0000-0000-0000-000000000001';
  RAISE EXCEPTION 'FAIL_EVENT_DELETE_WAS_ALLOWED';
 EXCEPTION WHEN SQLSTATE 'P0001' THEN
  IF SQLERRM <> 'QF_LEAD_ASSIGNMENT_EVENTS_IMMUTABLE' THEN RAISE; END IF;
 END;
 BEGIN
  UPDATE public.lead_assignment_events SET action='forged' WHERE id='30000000-0000-0000-0000-000000000001';
  RAISE EXCEPTION 'FAIL_EVENT_REWRITE_WAS_ALLOWED';
 EXCEPTION WHEN SQLSTATE 'P0001' THEN
  IF SQLERRM <> 'QF_LEAD_ASSIGNMENT_EVENTS_IMMUTABLE' THEN RAISE; END IF;
 END;
 BEGIN
  TRUNCATE public.lead_assignment_events;
  RAISE EXCEPTION 'FAIL_EVENT_TRUNCATE_WAS_ALLOWED';
 EXCEPTION WHEN SQLSTATE 'P0001' THEN
  IF SQLERRM <> 'QF_LEAD_ASSIGNMENT_EVENTS_TRUNCATE_FORBIDDEN' THEN RAISE; END IF;
 END;
 BEGIN
  DELETE FROM public.vendors WHERE id='00000000-0000-0000-0000-000000000001';
  RAISE EXCEPTION 'FAIL_VENDOR_DELETE_ALLOWED_WITH_EVENT_RESTRICT';
 EXCEPTION WHEN foreign_key_violation THEN NULL;
 END;
 BEGIN
  DELETE FROM public.leads WHERE id='10000000-0000-0000-0000-000000000001';
  RAISE EXCEPTION 'FAIL_LEAD_DELETE_ALLOWED_WITH_EVENT_RESTRICT';
 EXCEPTION WHEN foreign_key_violation THEN NULL;
 END;
 IF (SELECT count(*) FROM public.vendors)<>29 OR
    (SELECT count(*) FROM public.leads)<>74 OR
    (SELECT count(*) FROM public.lead_assignment_events)<>73 OR
    (SELECT count(*) FROM public.lead_assignments)<>71 THEN
    RAISE EXCEPTION 'FAIL_NEGATIVE_TEST_MUTATED_ROOTS';
 END IF;
END $case$;
-- The ONLY allowed lineage update is clearing an assignment back-reference;
-- it must leave the canonical immutable event, lead and vendor references.
DELETE FROM public.lead_assignments WHERE id='20000000-0000-0000-0000-000000000001';
DO $check$
BEGIN
 IF NOT EXISTS (
 SELECT 1 FROM public.lead_assignment_events
 WHERE id='30000000-0000-0000-0000-000000000001'
 AND assignment_id IS NULL
 AND lead_id='10000000-0000-0000-0000-000000000001'
 AND vendor_id='00000000-0000-0000-0000-000000000001'
 AND action='synthetic_assignment_event'
 ) THEN RAISE EXCEPTION 'FAIL_CLEARED_BACKREFERENCE_CONTRACT'; END IF;
 IF (SELECT count(*) FROM public.lead_assignments)<>70 OR
    (SELECT count(*) FROM public.assignment_operations)<>36 THEN
     RAISE EXCEPTION 'FAIL_TEST_ROW_COUNTS';
 END IF;
END $check$;
\echo STEP3B17_REAL_MIGRATION_IMMUTABLE_EVENT_RESTRICT_NEGATIVE_TEST_PASS
`;
process.stdout.write(db);
