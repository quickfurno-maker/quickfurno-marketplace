import test from "node:test";import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {assessRehearsal,runRehearsal,FORWARD,ROLLBACK} from "./d-db-p0-6-pg17-rehearsal.mjs";
import {pendingClass} from "./d-db-release-preflight.mjs";

const U=n=>[8,4,4,4,12].map(k=>String(n).repeat(k)).join("-");
const base=()=>({acl:"{postgres=X/postgres,authenticated=X/postgres}",
 grantees:["authenticated:EXECUTE","postgres:EXECUTE"],owner:"postgres",secdef:true,volatility:"s",
 config:["search_path=public"],srcmd5:"a",def:"d0",policies:["p1","p2"],
 behavior:[{id:U(1),is_admin:true},{id:U(2),is_admin:true},{id:U(3),is_admin:false},{id:U(4),is_admin:false}]});
const fwd=()=>({...base(),srcmd5:"b",def:"d1",
 behavior:[{id:U(1),is_admin:true},{id:U(2),is_admin:false},{id:U(3),is_admin:false},{id:U(4),is_admin:false}]});
const good=()=>({baseline:base(),forward:fwd(),rolledBack:base(),restoredForward:fwd(),restoredBaseline:base(),restoredRolledBack:base()});

test("assessRehearsal: consistent snapshots prove",()=>assert.deepEqual(assessRehearsal(good()),[]));

test("assessRehearsal: each ACL / rollback / restore drift is detected",()=>{
 const cases={
  "ACL drifted":g=>{g.forward.acl="{=X/postgres}";g.forward.grantees=["PUBLIC:EXECUTE","authenticated:EXECUTE","postgres:EXECUTE"]},
  "anon grant":g=>{g.baseline.grantees=[...g.baseline.grantees,"anon:EXECUTE"];g.forward.grantees=g.baseline.grantees},
  "body unchanged":g=>{g.forward.srcmd5="a"},
  "not byte-identical":g=>{g.rolledBack.def="other"},
  "rollback ACL":g=>{g.rolledBack.acl="{postgres=X/postgres}"},
  "forward restore":g=>{g.restoredForward.srcmd5="z"},
  "baseline restore":g=>{g.restoredBaseline.policies=["p1"]},
  "restored then rollback":g=>{g.restoredRolledBack.def="x"},
  "inactive admin allowed":g=>{g.forward.behavior[1].is_admin=true},
  "active admin denied":g=>{g.forward.behavior[0].is_admin=false},
  "security invoker":g=>{g.forward.secdef=false},
  "search_path":g=>{g.forward.config=null},
  "policies":g=>{g.forward.policies=["p1"]}
 };
 for(const [name,mut] of Object.entries(cases)){
  const g=good();mut(g);
  assert.ok(assessRehearsal(g).length>0,name);
 }
});

test("rehearsal refuses managed credentials before touching docker",()=>{
 const r=runRehearsal({env:{SUPABASE_DB_URL:"postgres://redacted"}});
 assert.equal(r.code,64);assert.ok(!r.stderr.includes("postgres://"));
});

test("candidate SQL paths are review-only to the release preflight",()=>{
 for(const p of [FORWARD,ROLLBACK,"Ops//Security/./sql-candidates/20270101000000_x.sql"])
  assert.equal(pendingClass(p),"SECURITY_CANDIDATE",p);
});

test("preflight pending classification survives case, slash and dot-segment evasion",()=>{
 assert.equal(pendingClass("OPS/VOX/Quarantined-Migrations/a/20270101000000_x.sql"),"QUARANTINED_7");
 assert.equal(pendingClass("ops//vox/sql-candidates/20270101000000_x.sql"),"CANDIDATE_23");
 assert.equal(pendingClass("./ops/vox/identity-attestation-overlay/20270101000000_x.sql"),"REVIEW_ONLY_OVERLAY");
 assert.equal(pendingClass("db/20270101000000_VOX_P0_6_admin.sql"),"P0_6");
 assert.equal(pendingClass("db/p0-6/20270101000000_x.sql"),"P0_6");
 assert.equal(pendingClass("db/20270101000000_vox_a.sql"),null);
});

test("assessRehearsal: NULL proacl or PUBLIC/anon EXECUTE on any restored state fails",()=>{
 for(const name of ["restoredBaseline","restoredForward","restoredRolledBack","rolledBack"]){
  let g=good();g[name].acl=null;
  assert.ok(assessRehearsal(g).some(m=>m.startsWith(name+": proacl is NULL")),name);
  g=good();g[name].grantees=[...g[name].grantees,"PUBLIC:EXECUTE"];
  assert.ok(assessRehearsal(g).some(m=>m.startsWith(name+": PUBLIC/anon")),name);
 }
});

// Real Docker PG17 run; skipped when Docker is not available or the daemon is down.
const dockerUp=spawnSync("docker",["info"],{stdio:"ignore"}).status===0;
test("real PG17: forward/rollback/ACL/dump-restore rehearsal is proven",{skip:!dockerUp&&"docker daemon unavailable",timeout:240000},()=>{
 const env={...process.env};for(const k of ["DATABASE_URL","SUPABASE_DB_URL","SUPABASE_SERVICE_ROLE_KEY","SUPABASE_ACCESS_TOKEN","PGPASSWORD"])delete env[k];
 const r=runRehearsal({env});
 const rep=JSON.parse(r.stdout);
 assert.deepEqual(rep.failures,[]);assert.equal(r.code,0);
 assert.equal(rep.decision,"HOLD");assert.equal(rep.candidatePromoted,false);
 assert.equal(rep.status,"HOLD");assert.match(rep.serverVersionNum,/^17\d{4}$/);
});
