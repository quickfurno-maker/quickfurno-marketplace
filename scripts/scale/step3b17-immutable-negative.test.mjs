import test from "node:test";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const generated=execFileSync(process.execPath,[resolve(root,"scripts/scale/step3b17-immutable-negative-generate.mjs")],{encoding:"utf8"});
const migration=readFileSync(resolve(root,"supabase/migrations/20260723000500_qf_mvp_assignment_universal_enforcement.sql"),"utf8");
test("T1 generator embeds same immutable DELETE guard from governed migration",()=>{
 assert.match(migration,/create or replace function public\.qf_prevent_lead_assignment_event_mutation\(\)/);
 assert.match(generated,/QF_LEAD_ASSIGNMENT_EVENTS_IMMUTABLE/);
 assert.match(generated,/if tg_op = 'DELETE'/);
});
test("T2 TRUNCATE guard comes from governed migration",()=>{
 assert.match(generated,/QF_LEAD_ASSIGNMENT_EVENTS_TRUNCATE_FORBIDDEN/);
 assert.match(generated,/CREATE TRIGGER trg_lead_assignment_events_no_truncate/);
});
test("T3 RESTRICTs preserve lead/vendor lineage after deletion is denied",()=>{
 assert.match(generated,/lead_id uuid NOT NULL REFERENCES public\.leads\(id\) ON DELETE RESTRICT/);
 assert.match(generated,/vendor_id uuid NOT NULL REFERENCES public\.vendors\(id\) ON DELETE RESTRICT/);
 assert.match(generated,/WHEN foreign_key_violation THEN NULL/);
});
test("T4 only nullable assignment backref gets cleared",()=>{
 assert.match(generated,/assignment_id uuid REFERENCES public\.lead_assignments\(id\) ON DELETE SET NULL/);
 assert.match(generated,/AND assignment_id IS NULL/);
 assert.match(generated,/AND vendor_id='00000000-0000-0000-0000-000000000001'/);
});
test("T5 count guards are synthetic, audit rows never cleared",()=>{
 assert.match(generated,/generate_series\(1,29\)/);
 assert.match(generated,/generate_series\(1,74\)/);
 assert.match(generated,/generate_series\(1,73\)/);
 assert.match(generated,/FAIL_NEGATIVE_TEST_MUTATED_ROOTS/);
 assert.doesNotMatch(generated,/DISABLE TRIGGER|DROP CONSTRAINT|TRUNCATE CASCADE|session_replication_role/i);
});
test("T6 network-none CI has no Production hostname",()=>{
 const ci=readFileSync(resolve(root,"scripts/scale/step3b17-immutable-negative-ci.sh"),"utf8");
 assert.match(ci,/--network none/);
 assert.match(ci,/PortBindings/);
 assert.match(ci,/postgres:17/);
 assert.doesNotMatch(ci,/supabase\.co|pooler\.supabase|yqpgcsduqbxulrlzwzap|PGPASSWORD=/i);
});
test("T7 no actual Production script receives this SQL",()=>{
 const gen=readFileSync(resolve(root,"scripts/scale/step3b17-immutable-negative-generate.mjs"),"utf8");
 assert.doesNotMatch(gen,/execute_sql|supabase-js|PGHOSTADDR|DATABASE_URL|PROD_DB_PASSWORD/);
 assert.match(gen,/synthetic/i);
});
test("T8 generator requires actual governed migration to exist",()=>{
 assert.match(migration,/trg_lead_assignment_events_immutable/);
 assert.match(migration,/trg_lead_assignment_events_no_truncate/);
 assert.match(generated,/STEP3B17_REAL_MIGRATION_IMMUTABLE_EVENT_RESTRICT_NEGATIVE_TEST_PASS/);
});
