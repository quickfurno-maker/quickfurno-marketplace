// Offline D: simulate child-first attempts using actual immutable-event trigger
// bodies from source. Never run against Production or any managed database.
import {execFileSync} from "node:child_process";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const base=execFileSync(process.execPath,
 [resolve(root,"scripts/scale/step3b17-immutable-negative-generate.mjs")],{encoding:"utf8"});
if(!base.includes("STEP3B17_REAL_MIGRATION_IMMUTABLE_EVENT_RESTRICT_NEGATIVE_TEST_PASS"))
 throw Error("Original immutable rehearsal did not include expected guard");
const after=String.raw`
-- Only synthetic child rows: demonstrate root deletion remains forbidden even
-- after clearing OTHER restrictive references and ordinary assignments.
DELETE FROM public.assignment_operations;
DELETE FROM public.lead_assignments;
DO $phase18$
BEGIN
 IF (SELECT count(*) FROM public.assignment_operations) <> 0 OR
    (SELECT count(*) FROM public.lead_assignments) <> 0 THEN
   RAISE EXCEPTION 'FAIL_CHILD_FIRST_NOT_EXECUTED';
 END IF;
 IF (SELECT count(*) FROM public.lead_assignment_events WHERE
       assignment_id IS NOT NULL) <> 0 THEN
   RAISE EXCEPTION 'FAIL_EVENT_BACKREFERENCE_NOT_CLEARED';
 END IF;
 BEGIN
   DELETE FROM public.leads WHERE id='10000000-0000-0000-0000-000000000001';
   RAISE EXCEPTION 'FAIL_LEAD_ROOT_DELETE_AFTER_CHILD_CLEAR';
 EXCEPTION WHEN foreign_key_violation THEN NULL;
 END;
 BEGIN
   DELETE FROM public.vendors WHERE id='00000000-0000-0000-0000-000000000001';
   RAISE EXCEPTION 'FAIL_VENDOR_ROOT_DELETE_AFTER_CHILD_CLEAR';
 EXCEPTION WHEN foreign_key_violation THEN NULL;
 END;
 IF (SELECT count(*) FROM public.vendors) <> 29 OR
    (SELECT count(*) FROM public.leads) <> 74 OR
    (SELECT count(*) FROM public.lead_assignment_events) <> 73 THEN
   RAISE EXCEPTION 'FAIL_NEGATIVE_REHEARSAL_MUTATED_ROOTS';
 END IF;
END $phase18$;
\echo STEP3B18_CHILD_FIRST_WITH_IMMUTABLE_LINEAGE_NEGATIVE_PASS
`;
process.stdout.write(base+"\n"+after);
