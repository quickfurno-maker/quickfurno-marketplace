import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,cpSync,readdirSync} from "node:fs";
import {dirname,join} from "node:path";
import {tmpdir} from "node:os";
import {fileURLToPath} from "node:url";
import {buildStagedDryRun,validateRollbackManifest,protectedDigestIndex,runCli} from "./rc38-migration-staged-dryrun.mjs";
import {canonicalSqlDigest} from "./rc35-migration-inventory-reconcile.mjs";

const here=dirname(fileURLToPath(import.meta.url));
const fx=join(here,"fixtures/rc37-migration-evidence");
const managedText=()=>readFileSync(join(fx,"managed.json"),"utf8");
const aliases=()=>JSON.parse(readFileSync(join(fx,"aliases.json"),"utf8"));
const deltaFile="20261102000000_fix_delta_append.sql";
const deltaSha=()=>canonicalSqlDigest(readFileSync(join(fx,"source",deltaFile)));
const rollback=(o={})=>[{version:"20261102000000",forwardSha256:deltaSha(),rollbackSha256:"a".repeat(64),
 transactional:true,reviewedBy:"fixture-dba",basis:"synthetic fixture",...o}];
const args=(o={})=>({managedText:managedText(),sourceDir:join(fx,"source"),aliasInput:aliases(),...o});
const tmp=()=>mkdtempSync(join(tmpdir(),"rc38-"));
const quiet={log(){},err(){}};
const codes=p=>p.blockedReasons.map(b=>b.code);

test("sample is deterministic, staged, pending rollback review and never GO",()=>{
 const a=buildStagedDryRun(args()),b=buildStagedDryRun(args());
 assert.equal(a.planSha256,b.planSha256);
 assert.equal(a.releaseGo,false);
 assert.equal(a.planStatus,"CANDIDATE_PENDING_EXTERNAL_REVIEW");
 assert.equal(a.connectsToManaged,false);assert.equal(a.executesSql,false);assert.equal(a.promotesProtectedSql,false);
 assert.equal(a.counts.verifiedApplied,3);
 assert.deepEqual(a.stages.map(s=>s.file),[deltaFile]);
 assert.equal(a.stages[0].rollback.status,"BLOCKED");
 assert.equal(a.stages[0].forward.executes,false);
 assert.deepEqual(codes(a),["ROLLBACK_REVIEW_MISSING"]);
 assert.ok(a.blockedReasons[0].requiredExternalInput.includes("20261102000000"));
 assert.ok(a.externalInputsRequired.some(x=>x.forBlockers.includes("ALWAYS")));
 assert.equal(a.dryRun.rollback.fullRollbackPossible,false);
 assert.equal(a.dryRun.chainConsistent,true);
});

test("reviewed rollback manifest yields rollback+recovery candidates, still not a GO",()=>{
 const p=buildStagedDryRun(args({rollbackInput:rollback()}));
 assert.equal(p.planStatus,"CANDIDATE_READY_FOR_INDEPENDENT_DBA_DECISION");
 assert.equal(p.releaseGo,false);
 assert.equal(p.requiresIndependentDbaDecision,true);
 const s=p.stages[0];
 assert.equal(s.rollback.status,"REVIEWED_CANDIDATE");
 assert.equal(s.rollback.toState.stateSha256,s.fromState.stateSha256);
 assert.equal(s.recovery.status,"RETRY_OR_ROLLBACK_FROM_PRIOR_STATE");
 assert.equal(p.dryRun.rollback.returnsToBase,true);
 assert.equal(p.dryRun.failureInjection[0].resultingState.stateSha256,p.baseState.stateSha256);
 assert.notEqual(p.dryRun.forward.finalState.stateSha256,p.baseState.stateSha256);
 assert.deepEqual(p.blockedReasons,[]);
});

test("non-transactional stage blocks recovery",()=>{
 const p=buildStagedDryRun(args({rollbackInput:rollback({transactional:false})}));
 assert.equal(p.planStatus,"CANDIDATE_PENDING_EXTERNAL_REVIEW");
 assert.deepEqual(codes(p),["STAGE_NOT_ATTESTED_TRANSACTIONAL"]);
 assert.equal(p.dryRun.failureInjection[0].outcome,"RECOVERY_BLOCKED");
});

test("rollback manifest must bind to the recomputed forward digest",()=>{
 assert.throws(()=>buildStagedDryRun(args({rollbackInput:rollback({forwardSha256:"b".repeat(64)})})),/RC38_ROLLBACK_FORWARD_DIGEST_MISMATCH/);
 assert.throws(()=>buildStagedDryRun(args({rollbackInput:rollback({rollbackSha256:deltaSha()})})),/ROLLBACK_DIGEST_EQUALS_FORWARD/);
 assert.throws(()=>buildStagedDryRun(args({rollbackInput:rollback({version:"20269999000000"})})),/ROLLBACK_VERSION_NOT_A_CANDIDATE/);
 assert.throws(()=>buildStagedDryRun(args({rollbackInput:[...rollback(),...rollback()]})),/ROLLBACK_DUPLICATE/);
 assert.throws(()=>buildStagedDryRun(args({rollbackInput:rollback({reviewedBy:" "})})),/ROLLBACK_ATTESTATION_MISSING/);
 assert.throws(()=>buildStagedDryRun(args({rollbackInput:rollback({transactional:"yes"})})),/TRANSACTIONAL_FLAG_MISSING/);
 assert.throws(()=>buildStagedDryRun(args({rollbackInput:rollback({rollbackSha256:"zz"})})),/DIGEST_MALFORMED/);
 assert.throws(()=>validateRollbackManifest({},[]),/ROLLBACK_MANIFEST_SHAPE/);
 assert.throws(()=>buildStagedDryRun(args({rollbackInput:JSON.stringify(rollback({basis:"postgresql://u:p@h/db"}))})),/SECRET_IN_INPUT/);
});

test("evidence gaps hold every stage: no alias means no staging and blocked reasons",()=>{
 const p=buildStagedDryRun(args({aliasInput:undefined}));
 assert.equal(p.planStatus,"NO_GO_BLOCKED");
 assert.deepEqual(p.stages,[]);
 assert.ok(p.heldCandidates.some(c=>c.file===deltaFile));
 assert.ok(codes(p).some(c=>c.startsWith("RECONCILIATION_")));
 assert.ok(codes(p).includes("STAGE_HELD_BY_EVIDENCE_BLOCKERS"));
 assert.equal(p.releaseGo,false);
});

test("managed export without statements (declared digest only) blocks with required external data",()=>{
 const m=JSON.parse(managedText());
 m.migrations=m.migrations.map(e=>({version:e.version,name:e.name}));
 const p=buildStagedDryRun(args({managedText:JSON.stringify(m),aliasInput:undefined}));
 assert.equal(p.planStatus,"NO_GO_BLOCKED");
 assert.equal(p.stages.length,0);
 assert.ok(codes(p).includes("EVIDENCE_MANAGED_SQL_NOT_IMPORTED"));
 assert.ok(p.externalInputsRequired.some(x=>/managed ledger export containing statements/.test(x.input)));
});

test("protected SQL copied under another name is never staged",()=>{
 const repo=tmp();
 mkdirSync(join(repo,"ops/vox/quarantined-migrations/legacy"),{recursive:true});
 const prot="create table protected_thing(id int);\n";
 writeFileSync(join(repo,"ops/vox/quarantined-migrations/legacy/20261014010000_q.sql"),prot);
 const src=tmp();
 cpSync(join(fx,"source"),src,{recursive:true});
 writeFileSync(join(src,"20261103000000_innocent_name.sql"),prot);
 const p=buildStagedDryRun(args({sourceDir:src,repoRootDir:repo}));
 const hit=p.blockedReasons.find(b=>b.code==="PROTECTED_SQL_NOT_STAGEABLE");
 assert.equal(hit.subject,"20261103000000_innocent_name.sql");
 assert.equal(p.planStatus,"NO_GO_BLOCKED");
 assert.equal(p.stages.length,0);
 assert.equal(p.promotesProtectedSql,false);
 assert.ok(!JSON.stringify(p.heldCandidates).includes("innocent_name"));
});

test("protected path roots are classified by path as well",()=>{
 const repo=tmp(),dir=join(repo,"ops/vox/sql-candidates");
 mkdirSync(dir,{recursive:true});
 writeFileSync(join(dir,"20261103000000_cand.sql"),"select 1;\n");
 const m=JSON.stringify({migrations:[{version:"20261101000001",name:"x",statements:["select 2"]}]});
 const p=buildStagedDryRun({managedText:m,sourceDir:dir,repoRootDir:repo});
 assert.ok(codes(p).includes("PROTECTED_SQL_NOT_STAGEABLE"));
 assert.equal(p.stages.length,0);
});

test("real repo protected index covers the 7 quarantined and 23 pinned candidates",()=>{
 const idx=protectedDigestIndex();
 const all=[...idx.values()].flat();
 assert.equal(all.filter(p=>p.startsWith("ops/vox/quarantined-migrations/")).length,7);
 assert.equal(all.filter(p=>p.startsWith("ops/vox/sql-candidates/")).length,23);
});

test("module never opens connections or executes",()=>{
 const src=readFileSync(join(here,"rc38-migration-staged-dryrun.mjs"),"utf8");
 assert.doesNotMatch(src,/child_process|node:net|node:http|node:tls|fetch\(|\bpg\b|spawn|exec\(/);
});

test("CLI: sample exits 2 (pending), usage 1, tampered input 1; --out writes plan",()=>{
 assert.equal(runCli(["--sample"],quiet),2);
 assert.equal(runCli([],quiet),1);
 const d=tmp(),out=join(d,"plan.json");
 assert.equal(runCli(["--sample","--out",out],quiet),2);
 const plan=JSON.parse(readFileSync(out,"utf8"));
 assert.equal(plan.releaseGo,false);
 const rb=join(d,"rb.json");writeFileSync(rb,JSON.stringify(rollback()));
 assert.equal(runCli(["--managed",join(fx,"managed.json"),"--source-dir",join(fx,"source"),
  "--aliases",join(fx,"aliases.json"),"--rollbacks",rb],quiet),0);
 writeFileSync(rb,JSON.stringify(rollback({forwardSha256:"c".repeat(64)})));
 assert.equal(runCli(["--managed",join(fx,"managed.json"),"--source-dir",join(fx,"source"),
  "--aliases",join(fx,"aliases.json"),"--rollbacks",rb],quiet),1);
 assert.ok(readdirSync(d).length>=1);
});
