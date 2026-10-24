import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
const base=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const sql=readFileSync(resolve(base,"ops/vox/sql-review/STEP3B15A-ALL-TEST-DATA-FK-INVENTORY-READ_ONLY.sql"),"utf8");
test("A01 inventory contains SELECT only, no database mutation syntax",()=>{
 const executable=sql.split("\n").filter(x=>!x.trim().startsWith("--")).join("\n");
 assert.doesNotMatch(executable,/^\s*(CREATE|ALTER|DROP|TRUNCATE|DELETE|INSERT|UPDATE|GRANT|REVOKE|CALL|DO|COPY|EXECUTE)\b/im);
 assert.match(sql,/READ ONLY/);
});
test("A02 enumerates FK deletion actions for all three dependency roots",()=>{
 for(const x of ["public.vendors","public.leads","public.lead_assignments"])
  assert.ok(sql.includes("'"+x+"'::regclass"),x);
 assert.match(sql,/pg_get_constraintdef/);
 assert.match(sql,/RESTRICT/);
 assert.match(sql,/CASCADE/);
});
test("A03 inventories potential non-FK vendor/lead text ID columns",()=>{
 assert.match(sql,/information_schema\.columns/);
 assert.match(sql,/vendor_id/);
 assert.match(sql,/lead_id/);
 assert.match(sql,/assignment_id/);
});
test("A04 inventories triggers and protects against hidden side effects",()=>{
 assert.match(sql,/pg_trigger/);
 assert.match(sql,/NOT t\.tgisinternal/);
});
test("A05 explicitly counts both city roots and catches third-city rows",()=>{
 for(const x of ["city='Pune'","city='Mumbai'","city NOT IN ('Pune','Mumbai')"])
  assert.ok(sql.includes(x),x);
});
test("A06 independent local purge rehearsal preserves config and Auth",()=>{
 const s=readFileSync(resolve(base,"scripts/scale/step3b14a-purge-rehearsal.sql"),"utf8");
 assert.match(s,/LOCAL EPHEMERAL PG17 ONLY/);
 assert.match(s,/ROLLBACK;/);
 assert.match(s,/STEP3B14A_LOCAL_PG17_EXACT_COUNT_PURGE_ROLLBACK_FK_SURVIVOR_TEST_PASS/);
 assert.doesNotMatch(s,/DELETE FROM public\.auth_users/);
});
