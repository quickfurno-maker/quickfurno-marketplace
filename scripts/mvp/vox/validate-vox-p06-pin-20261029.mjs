import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {resolve} from "node:path";

const ROOT=resolve(import.meta.dirname,"../../..");
const load=(path)=>readFileSync(resolve(ROOT,path),"utf8");
const filename="20261029160138_vox_p06_is_admin_active_status_hardening.sql";
const sql=load("supabase/migrations/"+filename);
const candidate=load("ops/security/sql-candidates/vox_p0_6_is_admin_staging_migration_candidate.sql");
const rollback=load("ops/security/sql-candidates/vox_p0_6_is_admin_staging_rollback_migration_candidate.sql");
const ledger=JSON.parse(load("supabase/staging-history/qf-post-g1-migration-ledger-20260929.json"));
const expectedHash="a77179ee0f1026986c0048945bf821a34e4303c1d6364381312a9e6108933c1b";
let passed=0;
function test(name,fn){fn();console.log("PASS",name);passed++;}
test("only forward SQL function body equals reviewed candidate",()=>{
 const body=(s)=>s.slice(s.indexOf("create or replace function public.is_admin()")).replace(/\r\n?/g,"\n").trim();
 assert.equal(body(sql),body(candidate));
});
test("no other database objects or table mutations",()=>{
 assert.equal((sql.match(/create or replace function/gi)||[]).length,1);
 assert.doesNotMatch(sql,/\balter table\b|\bupdate\s+public|\bdelete\s+from|\binsert\s+into|\bgrant\b|\brevoke\b/i);
});
test("new active-state predicate is fail closed",()=>assert.match(sql,/\band is_active is true\b/i));
test("definer properties preserved",()=>{
 for(const clause of ["returns boolean","language sql","stable","security definer","set search_path = public"])
 assert.ok(sql.includes(clause),clause);
});
test("rollback only original role predicate",()=>{
 assert.match(rollback,/create or replace function public\.is_admin\(\)/);
 assert.doesNotMatch(rollback,/and is_active is true/i);
});
test("P0-6 is final exact migration pin",()=>{
 assert.equal(ledger.records.length,45);
 const r=ledger.records.at(-1);
 assert.equal(r.version,"20261029160138");
 assert.equal(r.name,"vox_p06_is_admin_active_status_hardening");
 assert.equal(r.filename,filename);
 assert.equal(r.path,"supabase/migrations/"+filename);
 assert.equal(r.canonicalSha256,expectedHash);
});
test("hash matches exact current migration bytes",()=>{
 const hash=createHash("sha256").update(sql.replace(/\r\n?/g,"\n")).digest("hex");
 assert.equal(hash,expectedHash);
});
test("remote deployment not invented",()=>{
 const r=ledger.records.at(-1);
 assert.deepEqual(r.exactVersionPresence,{staging:false,production:false});
 assert.match(r.evidence,/NO_REMOTE_APPLY/);
 assert.equal(ledger.databaseMutationAuthorized,false);
 assert.equal(ledger.productionDeploymentAuthorized,false);
});
test("legacy pin guards retained",()=>{
 assert.equal(ledger.safety.exactPinsRequired,true);
 assert.equal(ledger.safety.unlistedMigrationForbidden,true);
 assert.equal(ledger.safety.hashDriftForbidden,true);
 assert.equal(ledger.safety.genericFutureMigrationAllowanceForbidden,true);
 assert.equal(ledger.safety.legacyManifestRewritten,false);
});
console.log("VOX_P06_PIN_QA_PASS "+passed+"/"+passed);
