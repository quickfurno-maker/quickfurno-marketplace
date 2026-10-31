import test from "node:test";import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {lintSqlAcl} from "./d-db-sql-acl-lint.mjs";
import {INVENTORY_SCHEMA,computeOrderedPin,evaluateReleasePreflight,collectPendingShas,assertReportNonExecuting}
 from "./d-db-release-preflight.mjs";

const repoRoot=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const sha=b=>createHash("sha256").update(Buffer.from(b)).digest("hex");
const codes=t=>lintSqlAcl(t).map(f=>f.code);

const GOOD_FN=`create or replace function public.vox_ok() returns int language sql stable security definer set search_path = public as $$ select 1 $$;
revoke all on function public.vox_ok() from public;
grant execute on function public.vox_ok() to authenticated;`;

test("lint: hardened function is clean; each ACL regression is caught",()=>{
 assert.deepEqual(codes(GOOD_FN),[]);
 assert.ok(codes(GOOD_FN.replace(/revoke[^;]*;/,"")).includes("FUNCTION_PUBLIC_EXECUTE_NOT_REVOKED"));
 assert.ok(codes(GOOD_FN.replace("set search_path = public","")).includes("SECDEF_WITHOUT_SEARCH_PATH"));
 assert.ok(codes(GOOD_FN.replace("to authenticated","to anon")).includes("ACL_GRANT_TO_PUBLIC_OR_ANON"));
 assert.ok(codes(GOOD_FN+"\nGRANT SELECT ON public.vox_t TO authenticated, PUBLIC;").includes("ACL_GRANT_TO_PUBLIC_OR_ANON"));
 assert.ok(codes("alter default privileges in schema public grant execute on functions to authenticated;").includes("ACL_ALTER_DEFAULT_PRIVILEGES"));
});

test("lint: legitimate grants and the word public in schema/table names are not false positives",()=>{
 assert.deepEqual(codes("grant usage on schema public to authenticated;\ngrant select on public.vox_t to authenticated;"),[]);
});

test("lint: comments cannot hide or fake statements; quoted/mixed-case is_admin is caught",()=>{
 assert.deepEqual(codes("-- grant all to anon;\n/* create function public.is_admin() */ select 1;"),[]);
 assert.ok(codes('CREATE OR REPLACE FUNCTION "public"."is_admin"() returns boolean language sql as $$ select true $$;').includes("P0_6_CONTENT"));
 assert.ok(codes("drop function if exists is_admin();").includes("P0_6_CONTENT"));
 assert.ok(codes(GOOD_FN.replace(/revoke[^;]*;/,"-- revoke all on function public.vox_ok() from public;")).includes("FUNCTION_PUBLIC_EXECUTE_NOT_REVOKED"));
});

test("lint: revoke must name the created function and revoke from PUBLIC",()=>{
 assert.ok(codes(GOOD_FN.replace("function public.vox_ok() from public","function public.vox_other() from public")).includes("FUNCTION_PUBLIC_EXECUTE_NOT_REVOKED"));
 assert.ok(codes(GOOD_FN.replace("from public;","from authenticated;")).includes("FUNCTION_PUBLIC_EXECUTE_NOT_REVOKED"));
 assert.deepEqual(codes(GOOD_FN.replace("revoke all on function public.vox_ok() from public","revoke all on function public.vox_ok() from public, anon")),[]);
});

// ---- preflight integration over a synthetic plan ----
const P="db/20270101000100_vox_a.sql",RB="db/rollback/20270101000100_vox_a_down.sql";
function planFor(files,extra={}){
 const sources=[{path:P,sha256:sha(files[P]),...extra}];
 const pin=computeOrderedPin(sources);
 return {schema:INVENTORY_SCHEMA,sources,orderedSourcePinSha256:pin,
  ledger:{versions:[{version:"20260101000000"}]},localVersions:["20260101000000"],
  consent:{canonical:{present:true,bindingPath:P,bindingSha256:sha(files[P])}},
  approvals:Object.fromEntries(["dba","appsec","owner"].map(r=>[r,{id:r+"-x",orderedSourcePinSha256:pin}]))};
}
const ev=(files,inv,pendingShas)=>evaluateReleasePreflight({inventory:inv,readBytes:p=>p in files?Buffer.from(files[p]):null,pendingShas});
const fc=r=>r.findings.map(f=>f.code);

test("preflight: clean hardened function plan is GO; same plan without REVOKE holds",()=>{
 let files={[P]:GOOD_FN};
 assert.equal(ev(files,planFor(files)).decision,"GO");
 files={[P]:GOOD_FN.replace(/revoke[^;]*;/,"")};
 const r=ev(files,planFor(files));
 assert.equal(r.decision,"HOLD");assert.ok(fc(r).includes("FUNCTION_PUBLIC_EXECUTE_NOT_REVOKED"));assert.equal(r.orderedPlan,null);
});

test("preflight: is_admin body under a clean path never GOes (content detection)",()=>{
 const files={[P]:"create or replace function public.is_admin() returns boolean language sql security definer set search_path=public as $$ select true $$;\nrevoke all on function public.is_admin() from public;"};
 const r=ev(files,planFor(files));
 assert.equal(r.decision,"HOLD");assert.equal(r.entries[0].pending,"P0_6");
 assert.ok(fc(r).includes("P0_6_CONTENT"));assert.equal(r.orderedPlan,null);
 assert.throws(()=>assertReportNonExecuting({...r,decision:"GO",findings:[]}),/CLAIMS_AUTHORITY/);
});

test("preflight: destructive DDL needs a canonical pinned rollback file",()=>{
 const down="create table public.vox_a (id int primary key);\n";
 const up="drop table public.legacy_old;\n";
 const files={[P]:up,[RB]:down};
 assert.ok(fc(ev(files,planFor(files))).includes("DESTRUCTIVE_DDL_NEEDS_ROLLBACK"));
 assert.ok(fc(ev(files,planFor(files,{rollback:{path:RB,sha256:"0".repeat(64)}}))).includes("DESTRUCTIVE_DDL_NEEDS_ROLLBACK"));
 assert.ok(fc(ev(files,planFor(files,{rollback:{path:"db/../"+RB,sha256:sha(down)}}))).includes("DESTRUCTIVE_DDL_NEEDS_ROLLBACK"));
 assert.equal(ev(files,planFor(files,{rollback:{path:RB,sha256:sha(down)}})).decision,"GO");
});

test("preflight: byte-identical copy of pending SQL under a clean path is blocked",()=>{
 const body="select 1; -- harmless-looking pending body\ncreate table public.vox_pending_copy (id int primary key);\n";
 const files={[P]:body};
 const r=ev(files,planFor(files),new Map([[sha(body),"CANDIDATE_23"]]));
 assert.equal(r.decision,"HOLD");assert.ok(fc(r).includes("PENDING_SQL_BYTE_IDENTICAL"));
 assert.equal(r.entries[0].pending,"CANDIDATE_23");assert.equal(r.orderedPlan,null);
});

// ---- against the real repo files (read-only; proves the 7+23 / P0-6 sets are untouched and caught) ----
test("repo: every real pending SQL file is hash-detected when copied to a clean path",()=>{
 const map=collectPendingShas(repoRoot);
 assert.ok(map.size>=30,`expected >=30 distinct pending SQL files, saw ${map.size}`);
 const classes=new Set(map.values());
 for(const c of ["QUARANTINED_7","CANDIDATE_23","SECURITY_CANDIDATE"])assert.ok(classes.has(c),c);
 const q=[...map.values()].filter(c=>c==="QUARANTINED_7").length;
 assert.equal(q,7,"quarantined set must remain exactly 7 files");
 const target=readFileSync(resolve(repoRoot,"ops/vox/quarantined-migrations/legacy-20261014/20261014010000_vox_v1_scoped_staff_authority.sql"));
 const files={[P]:target.toString("utf8")};
 const r=ev(files,planFor(files),map);
 assert.equal(r.decision,"HOLD");assert.ok(fc(r).includes("PENDING_SQL_BYTE_IDENTICAL"));
});

test("repo: real P0-6 forward and rollback candidates are flagged P0_6_CONTENT",()=>{
 for(const f of ["vox_p0_6_is_admin_staging_migration_candidate.sql","vox_p0_6_is_admin_staging_rollback_migration_candidate.sql"]){
  const t=readFileSync(resolve(repoRoot,"ops/security/sql-candidates",f),"utf8");
  assert.ok(codes(t).includes("P0_6_CONTENT"),f);
 }
});
