import test from "node:test";import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtempSync,mkdirSync,writeFileSync,existsSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";import {join,resolve,dirname} from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {INVENTORY_SCHEMA,computeOrderedPin,evaluateReleasePreflight,assertReportNonExecuting,
 pendingClass,parseArgs,run} from "./d-db-release-preflight.mjs";

const here=dirname(fileURLToPath(import.meta.url));
const CLI=resolve(here,"d-db-release-preflight.mjs");
const sha=s=>createHash("sha256").update(Buffer.from(s)).digest("hex");
const sql=(create,refs=[])=>`begin;\ncreate table public.${create} (id int primary key, note text default 'padding-padding');\n${refs.map(r=>`select 1 from public.${r};`).join("\n")}\ncommit;\n`;
const A="db/20270101000100_vox_a.sql",B="db/20270101000200_vox_b.sql",C="db/20270101000300_vox_consent.sql";

/** Self-consistent synthetic world: 3 clean sources, matching ledger/local inventory, approvals, consent. */
function world(mut=()=>{}){
 const files={[A]:sql("vox_a"),[B]:sql("vox_b",["vox_a"]),[C]:sql("vox_consent",["vox_b"])};
 const w={files,inv:null};
 mut(w,"pre");
 const sources=Object.keys(files).sort().map(p=>({path:p,sha256:sha(files[p])}));
 const pin=computeOrderedPin(sources);
 const inv={schema:INVENTORY_SCHEMA,sources,orderedSourcePinSha256:pin,
  ledger:{versions:[{version:"20260101000000",name:"base"}]},
  localVersions:["20260101000000"],
  consent:{canonical:{present:true,bindingPath:C,bindingSha256:sha(files[C])}},
  approvals:Object.fromEntries(["dba","appsec","owner"].map(r=>[r,{id:r+"-reviewer",orderedSourcePinSha256:pin}]))};
 w.inv=inv;w.pin=pin;
 mut(w,"post");
 return w;
}
const evalW=w=>evaluateReleasePreflight({inventory:w.inv,readBytes:p=>p in w.files?Buffer.from(w.files[p]):null});
const codes=r=>r.findings.map(f=>f.code);

test("clean synthetic inventory is GO and emits path+sha only",()=>{
 const r=evalW(world());
 assert.equal(r.decision,"GO");assert.deepEqual(r.findings,[]);
 assert.equal(r.orderedPlan.length,3);
 assert.deepEqual(Object.keys(r.orderedPlan[0]).sort(),["order","path","sha256","version"]);
 assert.equal(r.executesSql,false);assert.equal(r.emitsSql,false);assert.equal(r.managedCalls,false);
 assert.equal(assertReportNonExecuting(r),true);
 assert.ok(!JSON.stringify(r).includes("create table"));
});

test("report is deterministic",()=>{
 assert.equal(evalW(world()).reportSha256,evalW(world()).reportSha256);
});

test("SHA drift of a pinned file blocks",()=>{
 const w=world();w.files[B]+="-- tampered\n";
 const r=evalW(w);
 assert.equal(r.decision,"HOLD");assert.ok(codes(r).includes("SOURCE_SHA_MISMATCH"));assert.equal(r.orderedPlan,null);
});

test("ordered pin: unset holds, wrong blocks, reordered list blocks",()=>{
 let w=world((x,ph)=>{if(ph==="post")delete x.inv.orderedSourcePinSha256});
 assert.ok(codes(evalW(w)).includes("ORDERED_PIN_UNSET"));
 w=world((x,ph)=>{if(ph==="post")x.inv.orderedSourcePinSha256="0".repeat(64)});
 assert.ok(codes(evalW(w)).includes("ORDERED_PIN_MISMATCH"));
 w=world();w.inv.sources.reverse();
 const r=evalW(w);
 assert.ok(codes(r).includes("ORDERED_PIN_MISMATCH"));assert.ok(codes(r).includes("VERSION_ORDER_VIOLATION"));
});

test("missing source file and unpinned source fail closed",()=>{
 let w=world();delete w.files[A];
 assert.ok(codes(evalW(w)).includes("SOURCE_MISSING"));
 w=world();delete w.inv.sources[0].sha256;
 const r=evalW(w);assert.ok(codes(r).includes("SOURCE_PIN_MISSING"));assert.equal(r.decision,"HOLD");
});

test("missing and misordered dependencies block",()=>{
 let w=world((x,ph)=>{if(ph==="pre")x.files[B]=sql("vox_b",["vox_ghost"])});
 assert.ok(codes(evalW(w)).includes("MISSING_DEPENDENCY"));
 w=world((x,ph)=>{if(ph==="pre")x.files[A]=sql("vox_a",["vox_b"])});
 assert.ok(codes(evalW(w)).includes("DEPENDENCY_ORDER_VIOLATION"));
 w=world((x,ph)=>{if(ph==="post")x.inv.sources[1].dependsOn=["db/nope.sql"]});
 assert.ok(codes(evalW(w)).includes("MISSING_DEPENDENCY"));
 w=world((x,ph)=>{if(ph==="post")x.inv.sources[0].dependsOn=[C]});
 assert.ok(codes(evalW(w)).includes("DEPENDENCY_ORDER_VIOLATION"));
});

test("declared externalObjects satisfy a reference; undeclared do not",()=>{
 const mut=(x,ph)=>{if(ph==="pre")x.files[B]=sql("vox_b",["vox_managed_thing"])};
 assert.ok(codes(evalW(world(mut))).includes("MISSING_DEPENDENCY"));
 const w=world(mut);w.inv.externalObjects=["vox_managed_thing"];
 assert.equal(evalW(w).decision,"GO");
});

test("ledger diff: version already applied / behind head block",()=>{
 let w=world();w.inv.ledger.versions.push({version:"20270101000200",name:"x"});w.inv.localVersions.push("20270101000200");
 assert.ok(codes(evalW(w)).includes("VERSION_ALREADY_IN_LEDGER"));
 w=world();w.inv.ledger.versions.push({version:"20270201000000",name:"x"});w.inv.localVersions.push("20270201000000");
 assert.ok(codes(evalW(w)).includes("VERSION_BEHIND_LEDGER_HEAD"));
});

test("managed staging-only and source-only mismatches each hold, with exact diff",()=>{
 let w=world();w.inv.ledger.versions.push({version:"20260901000000",name:"managed_only"});
 let r=evalW(w);
 assert.equal(r.decision,"HOLD");assert.ok(codes(r).includes("STAGING_ONLY_VERSION_MISMATCH"));
 assert.deepEqual(r.ledgerDiff.stagingOnly,["20260901000000"]);
 w=world();w.inv.localVersions.push("20260801000000");
 r=evalW(w);
 assert.ok(codes(r).includes("SOURCE_ONLY_VERSION_MISMATCH"));assert.deepEqual(r.ledgerDiff.sourceOnly,["20260801000000"]);
 assert.equal(r.orderedPlan,null);
});

test("missing ledger or local inventory holds; malformed ledger blocks",()=>{
 let w=world();delete w.inv.ledger;
 assert.ok(codes(evalW(w)).includes("LEDGER_EVIDENCE_MISSING"));
 w=world();delete w.inv.localVersions;
 assert.ok(codes(evalW(w)).includes("LOCAL_VERSION_INVENTORY_MISSING"));
 w=world();w.inv.ledger.versions.push({version:"bad"});
 assert.ok(codes(evalW(w)).includes("LEDGER_MALFORMED"));
 w=world();w.inv.ledger.versions.push({version:"20260101000000"});
 assert.ok(codes(evalW(w)).includes("LEDGER_MALFORMED"));
});

test("canonical consent missing, false, unbound or wrong-sha never GO",()=>{
 let w=world();delete w.inv.consent;
 let r=evalW(w);assert.equal(r.decision,"HOLD");assert.ok(codes(r).includes("CANONICAL_CONSENT_MISSING"));
 w=world();w.inv.consent.canonical.present=false;
 assert.ok(codes(evalW(w)).includes("CANONICAL_CONSENT_MISSING"));
 w=world();w.inv.consent.canonical.bindingPath="db/other.sql";
 assert.ok(codes(evalW(w)).includes("CANONICAL_CONSENT_BINDING_NOT_IN_PLAN"));
 w=world();w.inv.consent.canonical.bindingSha256="1".repeat(64);
 assert.ok(codes(evalW(w)).includes("CANONICAL_CONSENT_BINDING_SHA_MISMATCH"));
});

test("approvals missing or bound to a stale pin hold and withhold the plan",()=>{
 let w=world();delete w.inv.approvals.appsec;
 let r=evalW(w);assert.ok(codes(r).includes("APPROVAL_MISSING"));assert.equal(r.orderedPlan,null);
 w=world();w.inv.approvals.dba.orderedSourcePinSha256="2".repeat(64);
 assert.ok(codes(evalW(w)).includes("APPROVAL_NOT_BOUND_TO_PIN"));
});

test("P0-6, quarantined 7, candidate 23 and overlay SQL can never GO even if fully pinned and approved",()=>{
 const paths={
  P0_6:"db/20270101000050_vox_p0_6_admin_rls.sql",
  CANDIDATE_23:"ops/vox/sql-candidates/20270101000060_vox_x_candidate.sql",
  QUARANTINED_7:"ops/vox/quarantined-migrations/legacy-20261014/20270101000070_vox_y.sql",
  REVIEW_ONLY_OVERLAY:"ops/vox/identity-attestation-overlay/20270101000080_vox_z.sql"
 };
 for(const [cls,p] of Object.entries(paths)){
  assert.equal(pendingClass(p),cls);
  const w=world((x,ph)=>{if(ph==="pre")x.files[p]=sql("vox_pending_"+cls.toLowerCase())});
  const r=evalW(w);
  assert.equal(r.decision,"HOLD",cls);assert.equal(r.blocked,true);
  assert.ok(codes(r).includes("PENDING_SQL_NOT_ENABLEABLE"),cls);
  assert.equal(r.orderedPlan,null);
 }
 assert.throws(()=>assertReportNonExecuting({...evalW(world()),decision:"GO",entries:[{pending:"P0_6"}]}),/CLAIMS_AUTHORITY/);
});

test("path traversal, bad names and duplicates block",()=>{
 let w=world();w.inv.sources[0].path="../escape/20270101000100_vox_a.sql";
 assert.ok(codes(evalW(w)).includes("SOURCE_PATH_INVALID"));
 w=world();w.inv.sources[0].path="db/not_a_migration.sql";
 assert.ok(codes(evalW(w)).includes("SOURCE_NAME_INVALID"));
 w=world();w.inv.sources.push({...w.inv.sources[0]});
 assert.ok(codes(evalW(w)).includes("DUPLICATE_PATH"));
});

test("invalid inventory fails closed without throwing",()=>{
 for(const inventory of [null,{},{schema:INVENTORY_SCHEMA,sources:[]},{schema:"x",sources:[1]}]){
  const r=evaluateReleasePreflight({inventory,readBytes:()=>null});
  assert.equal(r.decision,"HOLD");assert.ok(codes(r).includes("INVENTORY_INVALID"));
 }
});

test("tampered report is rejected",()=>{
 const r=evalW(world());
 assert.throws(()=>assertReportNonExecuting({...r,emitsSql:true}),/CLAIMS_AUTHORITY/);
 assert.throws(()=>assertReportNonExecuting({...r,decision:"HOLD",orderedPlan:r.orderedPlan}),/CLAIMS_AUTHORITY/);
 assert.throws(()=>assertReportNonExecuting({...r,findings:[]}) && assertReportNonExecuting({...r,blocked:true}),/CLAIMS_AUTHORITY/);
});

test("CLI args reject dangerous flags and require inventory",()=>{
 for(const f of ["apply","execute","push","repair","go","yes","db-url","linked","force","install"])
  assert.match(parseArgs(["--inventory","x.json","--"+f,"1"]).error,/FORBIDDEN_FLAG/);
 assert.equal(parseArgs([]).error,"INVENTORY_REQUIRED");
 assert.ok(parseArgs(["--bogus","1"]).error);
});

test("CLI refuses when managed credentials are in the environment",()=>{
 const r=run(["--inventory","x.json"],{env:{DATABASE_URL:"postgres://redacted"}});
 assert.equal(r.code,64);assert.match(r.stderr,/DATABASE_URL/);assert.ok(!r.stderr.includes("postgres://"));
});

test("CLI end to end: GO exit 0, HOLD exit 2, --out refuses ops/ and overwrite",()=>{
 const dir=mkdtempSync(join(tmpdir(),"ddb-"));
 try{
  const w=world();
  mkdirSync(join(dir,"db"),{recursive:true});
  for(const [p,t] of Object.entries(w.files))writeFileSync(join(dir,p),t);
  const goPath=join(dir,"inv-go.json");writeFileSync(goPath,JSON.stringify(w.inv));
  const clean={...process.env};for(const k of ["DATABASE_URL","SUPABASE_DB_URL","SUPABASE_SERVICE_ROLE_KEY","SUPABASE_ACCESS_TOKEN","PGPASSWORD"])delete clean[k];
  let p=spawnSync(process.execPath,[CLI,"--inventory",goPath,"--root",dir],{env:clean,encoding:"utf8"});
  assert.equal(p.status,0,p.stderr);assert.equal(JSON.parse(p.stdout).decision,"GO");
  // migrations-dir derived local inventory must override the inventory field
  mkdirSync(join(dir,"mig"));writeFileSync(join(dir,"mig","20260101000000_base.sql"),"select 1;");
  writeFileSync(join(dir,"mig","20260202000000_extra.sql"),"select 1;");
  p=spawnSync(process.execPath,[CLI,"--inventory",goPath,"--root",dir,"--migrations-dir","mig"],{env:clean,encoding:"utf8"});
  assert.equal(p.status,2);assert.ok(JSON.parse(p.stdout).findings.some(f=>f.code==="SOURCE_ONLY_VERSION_MISMATCH"));
  // --out
  const out=join(dir,"report.json");
  p=spawnSync(process.execPath,[CLI,"--inventory",goPath,"--root",dir,"--out",out],{env:clean,encoding:"utf8"});
  assert.equal(p.status,0);assert.ok(existsSync(out));
  p=spawnSync(process.execPath,[CLI,"--inventory",goPath,"--root",dir,"--out",out],{env:clean,encoding:"utf8"});
  assert.equal(p.status,70);// wx refuses overwrite
  const repoOps=resolve(here,"../../../ops/vox/ddb-should-not-exist.json");
  p=spawnSync(process.execPath,[CLI,"--inventory",goPath,"--root",dir,"--out",repoOps],{env:clean,encoding:"utf8"});
  assert.equal(p.status,64);assert.ok(!existsSync(repoOps));
 }finally{rmSync(dir,{recursive:true,force:true})}
});

test("non-canonical paths are refused: dot/double-slash/backslash/drive/control/pipe spellings",()=>{
 for(const bad of ["./db/20270101000100_vox_a.sql","db//20270101000100_vox_a.sql","db/./20270101000100_vox_a.sql",
  "db\\20270101000100_vox_a.sql","C:db/20270101000100_vox_a.sql","db/x\n2|y/20270101000100_vox_a.sql","db/a|b/20270101000100_vox_a.sql","db/ /20270101000100_vox_a.sql","db/"]){
  const w=world();w.inv.sources[0].path=bad;
  assert.ok(codes(evalW(w)).includes("SOURCE_PATH_INVALID"),JSON.stringify(bad));
 }
});

test("pin preimage cannot be forged by a path carrying a fake second row",()=>{
 const w=world();
 const fake=`db/20270101000100_vox_a.sql|${w.inv.sources[0].sha256}\n2|${B}`;
 const forged={...w.inv.sources[0],path:fake+"/20270101000100_vox_a.sql"};
 const r=evalW({...w,inv:{...w.inv,sources:[forged]}});
 assert.ok(codes(r).includes("SOURCE_PATH_INVALID"));assert.equal(r.decision,"HOLD");assert.equal(r.orderedPlan,null);
});

test("case-variant duplicate path blocks; non-canonical or non-string dependsOn never satisfies a dependency",()=>{
 let w=world();w.inv.sources.push({...w.inv.sources[0],path:"DB/20270101000100_vox_a.sql"});
 assert.ok(codes(evalW(w)).includes("DUPLICATE_PATH"));
 w=world((x,ph)=>{if(ph==="post")x.inv.sources[1].dependsOn=[{toString:()=>A}]});
 assert.ok(codes(evalW(w)).includes("MISSING_DEPENDENCY"));
 w=world((x,ph)=>{if(ph==="post")x.inv.sources[1].dependsOn=["./"+A]});
 assert.ok(codes(evalW(w)).includes("MISSING_DEPENDENCY"));
});
