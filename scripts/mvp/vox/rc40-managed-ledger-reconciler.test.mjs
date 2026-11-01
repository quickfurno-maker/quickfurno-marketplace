import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,writeFileSync,mkdtempSync,existsSync} from "node:fs";
import {createHash} from "node:crypto";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {reconcileManagedLedger,parseEvidence,renderStatements,runCli,DEFAULT_EVIDENCE,CAPTURE_SCHEMA,MISSING_SCHEMA,
 RECONCILE_SCHEMA,CAPTURE_METHODS} from "./rc40-managed-ledger-reconciler.mjs";
import {RC40_SCHEMA} from "./rc40-source-sql-digest-collector.mjs";
import {canonicalSqlDigest} from "./rc35-migration-inventory-reconcile.mjs";
import {evaluatePredeployGate} from "./rc38-staging-predeploy-gate.mjs";

const SHA="c".repeat(40);
const sha=t=>createHash("sha256").update(t).digest("hex");
const tmp=()=>mkdtempSync(join(tmpdir(),"rc40r-"));
const quiet=()=>({log(){},err(){}});
const seal=o=>{const {evidenceSha256,...b}=o;return {...b,evidenceSha256:sha(JSON.stringify(b))};};
const rejects=(fn,code)=>assert.throws(fn,e=>e.message.startsWith("RC40R_"+code),code);

// ---- actual drift: the committed 107/31 evidence, no managed capture exists yet
const realText=readFileSync(DEFAULT_EVIDENCE,"utf8");
test("actual drift: committed evidence is intact and reports all 31 managed versions as missing original SQL",()=>{
 const ev=parseEvidence(realText);
 assert.equal(ev.entries.length,107);
 assert.equal(ev.managedOnly.length,31);
 const {report,missing}=reconcileManagedLedger({evidenceText:realText,candidateSha:SHA});
 assert.equal(report.status,"INCOMPLETE");
 assert.equal(report.releaseGo,false);
 assert.equal(report.approvalClaimed,false);
 assert.equal(report.counts.managedMissing,31);
 assert.equal(report.counts.sourceUnmatched,107);
 assert.equal(report.matches.length,0);
 assert.equal(missing.schema,MISSING_SCHEMA);
 assert.equal(missing.count,31);
 assert.deepEqual(missing.items.map(i=>i.version),ev.managedOnly.map(m=>m.version).sort());
 for(const i of missing.items){
  assert.equal(i.template.statements,null); // no fabricated SQL
  assert.equal(i.template.statementsSha256,null);
  assert.equal(i.template.candidateSha,SHA);
 }
 assert.deepEqual(reconcileManagedLedger({evidenceText:realText,candidateSha:SHA}).report,report); // deterministic
});

test("actual drift: tampered committed evidence and bad candidate sha are rejected",()=>{
 const e=JSON.parse(realText);e.entries[0].canonicalSha256="0".repeat(64);
 rejects(()=>reconcileManagedLedger({evidenceText:JSON.stringify(e),candidateSha:SHA}),"EVIDENCE_TAMPERED");
 rejects(()=>reconcileManagedLedger({evidenceText:realText,candidateSha:"abc"}),"CANDIDATE_SHA_INVALID");
});

// ---- synthetic independent data at full 107/31 scale
// 31 managed migrations authored independently of the source files. 10 are byte-identical to a source file (EXACT);
// the other 21 are consolidations declared as aliases of the remaining 97 source files.
function synth(){
 const managedOnly=[],cap=[],entries=[];
 const stmts=i=>["create table if not exists managed_"+i+"(id int)","comment on table managed_"+i+" is 'm"+i+"'"];
 const mk=i=>{
  const version="2026"+String(1000000000+i).slice(1).padStart(10,"0");
  return {version,name:"managed_"+i,statements:stmts(i)};
 };
 const ms=Array.from({length:31},(_,i)=>mk(i));
 let n=0;
 const src=(digest)=>{
  const k=n++;
  const e={file:"2027"+String(1000000000+k).slice(1).padStart(10,"0")+"_src_"+k+".sql",version:"2027"+String(1000000000+k).slice(1).padStart(10,"0"),
   bytes:10+k,sha256:digest,canonicalSha256:digest,attestation:"UNATTESTED"};
  entries.push(e);return e;
 };
 const capEntry=(m,extra={})=>{
  const b=renderStatements(m.statements);
  return {version:m.version,name:m.name,statements:m.statements,statementsSha256:canonicalSqlDigest(b),bytes:b.length,...extra};
 };
 ms.forEach((m,i)=>{
  managedOnly.push({version:m.version,name:m.name,sqlDigest:null,note:"NOT_GUESSED"});
  if(i<10){src(canonicalSqlDigest(renderStatements(m.statements)));cap.push(capEntry(m));}
 });
 const aliasGroups=ms.slice(10).map(()=>[]);
 for(let k=0;k<97;k++)aliasGroups[k%21].push(src(sha("independent-source-"+k)));
 ms.slice(10).forEach((m,j)=>cap.push(capEntry(m,{aliasOf:aliasGroups[j].map(e=>({file:e.file,canonicalSha256:e.canonicalSha256}))})));
 const sorted=[...entries].sort((a,b)=>a.file<b.file?-1:1);
 const evidence=seal({schema:RC40_SCHEMA,releaseGo:false,connectsToManaged:false,executesSql:false,managedWrites:false,readsSecrets:false,
  guessesManagedSql:false,appendOnly:true,prevEvidenceSha256:null,driftCounts:{sourceOnly:107,stagingOnly:31,common:55,sourceSql:162},
  sourceOnlyDigestSetSha256:sha(sorted.map(e=>e.version+":"+e.canonicalSha256).join("\n")),
  counts:{collected:107,attested:0,unattested:107},complete:false,expectedEvidenceSchemas:[],entries:sorted,
  unattestedFiles:sorted.map(e=>e.file),managedOnly});
 const capture={schema:CAPTURE_SCHEMA,candidateSha:SHA,capturedBy:"independent-dba-1",captureMethod:CAPTURE_METHODS[0],readOnly:true,entries:cap};
 return {evidence,capture,entries:sorted};
}
const run=(s,capMut,evMut)=>{
 const capture=structuredClone(s.capture);if(capMut)capMut(capture);
 let evidence=structuredClone(s.evidence);if(evMut){evMut(evidence);evidence=seal(evidence);}
 return reconcileManagedLedger({evidenceText:JSON.stringify(evidence),captureText:JSON.stringify(capture),candidateSha:SHA});
};

test("synthetic full success: 31 managed and 107 source-only all matched, exact and alias",()=>{
 const s=synth();
 const {report,missing}=run(s);
 assert.equal(report.status,"RECONCILED_COMPLETE");
 assert.deepEqual(report.counts,{managedOnly:31,managedMatched:31,managedMissing:0,sourceOnly:107,sourceMatched:107,sourceUnmatched:0});
 assert.equal(report.matches.filter(m=>m.matchType==="EXACT").length,10);
 assert.equal(report.matches.filter(m=>m.matchType==="ALIAS").length,21);
 assert.equal(missing.count,0);
 assert.equal(report.releaseGo,false);
 assert.equal(report.approvalClaimed,false);
 assert.equal(report.candidateSha,SHA);
 assert.equal(run(s).report.reconciliationSha256,report.reconciliationSha256);
});

test("partial capture yields INCOMPLETE with one template per still-missing version",()=>{
 const s=synth();
 const {report,missing}=run(s,c=>{c.entries=c.entries.slice(0,20);});
 assert.equal(report.status,"INCOMPLETE");
 assert.equal(report.counts.managedMissing,11);
 assert.equal(missing.count,11);
 assert.equal(new Set(missing.items.map(i=>i.version)).size,11);
 assert.ok(report.counts.sourceUnmatched>0);
});

test("forged, duplicate, ambiguous, unknown and mispinned captures are rejected",()=>{
 const s=synth();
 rejects(()=>run(s,c=>{c.entries[0].statementsSha256="f".repeat(64);}),"CAPTURE_DIGEST_FORGED");
 rejects(()=>run(s,c=>{c.entries[0].statements[0]="drop table x";}),"CAPTURE_DIGEST_FORGED");
 rejects(()=>run(s,c=>{c.entries[0].bytes+=1;}),"CAPTURE_BYTES_MISMATCH");
 rejects(()=>run(s,c=>{c.entries.push(structuredClone(c.entries[0]));}),"CAPTURE_DUPLICATE_VERSION");
 rejects(()=>run(s,c=>{ // identical bytes under a second version
  const m=s.evidence.managedOnly[1];const e=structuredClone(c.entries[0]);e.version=m.version;e.name=m.name;c.entries[1]=e;}),"CAPTURE_DUPLICATE_DIGEST");
 rejects(()=>run(s,c=>{c.entries[0].version="20990101000000";}),"CAPTURE_UNKNOWN_VERSION");
 rejects(()=>run(s,c=>{c.entries[0].name="renamed";}),"CAPTURE_NAME_MISMATCH");
 rejects(()=>run(s,c=>{c.candidateSha="d".repeat(40);}),"CANDIDATE_SHA_MISMATCH");
 rejects(()=>run(s,c=>{c.readOnly=false;}),"CAPTURE_NOT_READ_ONLY");
 rejects(()=>run(s,c=>{c.captureMethod="repo_copy";}),"CAPTURE_METHOD_NOT_ALLOWED");
 rejects(()=>run(s,c=>{delete c.capturedBy;}),"CAPTURE_CAPTURED_BY_MISSING");
 rejects(()=>run(s,c=>{c.entries[0].statements=[];}),"CAPTURE_STATEMENTS_INVALID");
 rejects(()=>run(s,c=>{c.entries[0].statements[0]="postgres://u:pw@host/db";}),"SECRET_IN_INPUT");
 // exact match that also declares an alias is ambiguous
 rejects(()=>run(s,c=>{c.entries[0].aliasOf=[{file:s.entries[50].file,canonicalSha256:s.entries[50].canonicalSha256}];}),"AMBIGUOUS_EXACT_AND_ALIAS");
 // two aliases claiming one source file
 rejects(()=>run(s,c=>{const a=c.entries[10].aliasOf[0];c.entries[11].aliasOf.push({...a});}),"AMBIGUOUS_SOURCE_CLAIM");
 // alias claiming a source file already matched exactly
 rejects(()=>run(s,c=>{const ex=s.entries.find(e=>e.canonicalSha256===c.entries[0].statementsSha256);
  c.entries[10].aliasOf.push({file:ex.file,canonicalSha256:ex.canonicalSha256});}),"AMBIGUOUS_SOURCE_CLAIM");
 rejects(()=>run(s,c=>{c.entries[10].aliasOf[0].canonicalSha256="1".repeat(64);}),"ALIAS_DIGEST_FORGED");
 rejects(()=>run(s,c=>{c.entries[10].aliasOf[0].file="20300101000000_not_source_only.sql";}),"ALIAS_FILE_NOT_SOURCE_ONLY");
 rejects(()=>run(s,c=>{c.entries[10].aliasOf.push({...c.entries[10].aliasOf[0]});}),"CAPTURE_ALIAS_DUPLICATE_FILE");
 // captured statements matching no source file and declaring no alias
 rejects(()=>run(s,c=>{delete c.entries[10].aliasOf;}),"MANAGED_ENTRY_UNMATCHED");
});

test("tampered or inconsistent source evidence is rejected",()=>{
 const s=synth();
 const ev=structuredClone(s.evidence);ev.entries[3].canonicalSha256="9".repeat(64);
 rejects(()=>reconcileManagedLedger({evidenceText:JSON.stringify(ev),candidateSha:SHA}),"EVIDENCE_TAMPERED");
 rejects(()=>run(s,null,e=>{e.entries[3].canonicalSha256=e.entries[4].canonicalSha256;}),"EVIDENCE_DUPLICATE_DIGEST");
 rejects(()=>run(s,null,e=>{e.entries[3].canonicalSha256="9".repeat(64);}),"EVIDENCE_DIGEST_SET_MISMATCH");
 rejects(()=>run(s,null,e=>{e.releaseGo=true;}),"EVIDENCE_NOT_OFFLINE");
 rejects(()=>run(s,null,e=>{e.managedOnly[0].sqlDigest="a".repeat(64);}),"EVIDENCE_MANAGED_DIGEST_PRESENT");
});

test("CLI: exclusive outputs, exit codes 0/2/1, no overwrite",()=>{
 const d=tmp(),s=synth();
 const ev=join(d,"ev.json"),cap=join(d,"cap.json");
 writeFileSync(ev,JSON.stringify(s.evidence));writeFileSync(cap,JSON.stringify(s.capture));
 assert.equal(runCli(["--candidate-sha",SHA,"--evidence",ev,"--capture",cap,"--out",join(d,"r.json"),"--missing-out",join(d,"m.json")],quiet()),0);
 const r=JSON.parse(readFileSync(join(d,"r.json"),"utf8"));
 assert.equal(r.schema,RECONCILE_SCHEMA);
 assert.equal(runCli(["--candidate-sha",SHA,"--evidence",ev,"--capture",cap,"--out",join(d,"r.json"),"--missing-out",join(d,"m2.json")],quiet()),1);
 assert.equal(existsSync(join(d,"m2.json")),false);
 // real evidence, no capture: incomplete -> exit 2 and one template per 31 versions on disk
 assert.equal(runCli(["--candidate-sha",SHA,"--out",join(d,"r3.json"),"--missing-out",join(d,"m3.json")],quiet()),2);
 assert.equal(JSON.parse(readFileSync(join(d,"m3.json"),"utf8")).items.length,31);
 // --require-complete rejects and leaves no files
 assert.equal(runCli(["--candidate-sha",SHA,"--require-complete","--out",join(d,"r4.json"),"--missing-out",join(d,"m4.json")],quiet()),1);
 assert.equal(existsSync(join(d,"r4.json")),false);
 // forged capture -> exit 1, no files
 const forged=structuredClone(s.capture);forged.entries[0].statementsSha256="e".repeat(64);
 writeFileSync(join(d,"f.json"),JSON.stringify(forged));
 assert.equal(runCli(["--candidate-sha",SHA,"--evidence",ev,"--capture",join(d,"f.json"),"--out",join(d,"r5.json"),"--missing-out",join(d,"m5.json")],quiet()),1);
 assert.equal(existsSync(join(d,"r5.json")),false);
 assert.equal(runCli(["--out",join(d,"x.json")],quiet()),1);
});

// ---- predeploy gate integration (optional input; never approves by itself)
const gate=(text,expectedSha=SHA)=>evaluatePredeployGate({now:Date.now(),expectedSha,headSha:SHA,sourceSqlReconciliationText:text});
const codes=g=>g.blockedReasons.map(b=>b.code).filter(c=>c.startsWith("SOURCE_SQL_RECONCILIATION"));

test("predeploy gate: reconciliation input is optional and, when supplied, blocks unless complete, intact and pinned",()=>{
 const s=synth();
 assert.deepEqual(codes(gate(undefined)),[]);
 const complete=JSON.stringify(run(s).report);
 const g=gate(complete);
 assert.deepEqual(codes(g),[]);
 assert.equal(g.verdict,"NO_GO_BLOCKED"); // other evidence still absent: reconciliation alone never approves
 assert.equal(g.deploys,false);
 const incomplete=JSON.stringify(reconcileManagedLedger({evidenceText:realText,candidateSha:SHA}).report);
 assert.deepEqual(codes(gate(incomplete)),["SOURCE_SQL_RECONCILIATION_INCOMPLETE"]);
 assert.deepEqual(codes(gate(complete,"d".repeat(40))),["SOURCE_SQL_RECONCILIATION_SHA_MISMATCH"]);
 const t=JSON.parse(complete);t.counts.managedMissing=0;t.candidateSha="e".repeat(40);
 assert.deepEqual(codes(gate(JSON.stringify(t))),["SOURCE_SQL_RECONCILIATION_TAMPERED"]);
 assert.deepEqual(codes(gate("{")),["SOURCE_SQL_RECONCILIATION_MALFORMED"]);
 assert.notEqual(g.bindingSha256,gate(undefined).bindingSha256); // supplied evidence is bound into the signed binding
});
