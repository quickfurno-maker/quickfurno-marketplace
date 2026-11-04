import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const read=(p)=>readFileSync(resolve(root,p),"utf8");
const sql=read("ops/vox/sql-review/STEP3B18C-AUTH-AND-IMMUTABLE-READ_ONLY.sql");
const py=read("scripts/scale/step3b18-local-backup-audit.py");
const gen=read("scripts/scale/step3b18-childfirst-negative-generate.mjs");
const ci=read("scripts/scale/step3b18-childfirst-negative-ci.sh");
const local=read("scripts/scale/run-step3b18-childfirst-negative-pg17.py");
const generated=execFileSync(process.execPath,
 [resolve(root,"scripts/scale/step3b18-childfirst-negative-generate.mjs")],
 {encoding:"utf8"});
test("I1 read-only inventory contains only SELECT statements",()=>{
 const executable=sql.split("\n").filter(l=>!l.trim().startsWith("--")).join("\n");
 assert.doesNotMatch(executable,/^\s*(CREATE|ALTER|DELETE|UPDATE|INSERT|DROP|TRUNCATE|GRANT|REVOKE|CALL|DO|COPY|EXECUTE)\b/im);
 assert.match(sql,/FROM auth\.sessions/);assert.match(sql,/FROM pg_trigger/);
});
test("I2 user-id inventory is aggregate only, without raw identifiers",()=>{
 assert.match(sql,/COUNT\(DISTINCT v\.user_id\)/);
 assert.match(sql,/non_vendor_auth_users/);
 assert.doesNotMatch(sql,/^SELECT\s+user_id\b/im);
});
test("I3 Backup checker ties archive, private evidence and SHA",()=>{
 for(const c of ["sha256","archive.stat().st_size","pg_restore","selected_orphan_refs",
  "restored_vendor_auth_links","full_database_restore_verified"])
  assert.ok(py.includes(c),c);
});
test("I4 checker never claims whole Supabase restoration",()=>{
 assert.match(py,/"full_supabase_restore_certified":False/);
 assert.match(py,/"production_deletion_authorized":False/);
 for(const c of ["POSTGIS_3_3_7","VAULT_0_3_1","PITR_RESTORE"])
  assert.ok(py.includes(c),c);
});
test("I5 checker does not access a managed Supabase endpoint",()=>{
 assert.doesNotMatch(py,/postgresql:\/\/|connect\(|pooler\.supabase|db\.yqpgcsduqbxulrlzwzap/);
 assert.doesNotMatch(py,/unlink\(|rmtree\(|\.write_text\(|DELETE\s+FROM/);
});
test("I6 child-first rehearsal uses prior governed actual-trigger generator",()=>{
 assert.match(gen,/step3b17-immutable-negative-generate\.mjs/);
 assert.match(gen,/DELETE FROM public\.assignment_operations/);
 assert.match(gen,/DELETE FROM public\.lead_assignments/);
 assert.match(gen,/WHEN foreign_key_violation THEN NULL/);
});
test("I7 child-first fails if any synthetic root/event changes",()=>{
 assert.match(generated,/STEP3B18_CHILD_FIRST_WITH_IMMUTABLE_LINEAGE_NEGATIVE_PASS/);
 assert.match(generated,/FAIL_NEGATIVE_REHEARSAL_MUTATED_ROOTS/);
 assert.match(generated,/public\.lead_assignment_events\) <> 73/);
 assert.doesNotMatch(generated,/DISABLE TRIGGER|DROP CONSTRAINT|session_replication_role|TRUNCATE CASCADE/i);
});
test("I8 network-none runner cannot address production",()=>{
 assert.match(ci,/--network none/);
 assert.match(ci,/PortBindings/);
 assert.match(ci,/STEP3B18_CHILD_FIRST_WITH_IMMUTABLE_LINEAGE_NEGATIVE_PASS/);
 assert.doesNotMatch(ci,/supabase\.co|pooler\.supabase|PGHOSTADDR|yqpgcsduqbxulrlzwzap/i);
});
test("I9 local runner isolates and wipes synthetic scratch cluster",()=>{
 assert.match(local,/127\.0\.0\.1/);
 assert.match(local,/SCRATCH/);assert.match(local,/shutil\.rmtree/);
 assert.match(local,/STEP3B18_CHILD_FIRST_WITH_IMMUTABLE_LINEAGE_NEGATIVE_PASS/);
});
test("I10 separate Auth API plan is not implemented as raw SQL",()=>{
 assert.doesNotMatch(sql,/\bdelete\s+from\s+auth\./i);
 assert.doesNotMatch(py,/admin\.deleteUser|delete_user\(/i);
});
