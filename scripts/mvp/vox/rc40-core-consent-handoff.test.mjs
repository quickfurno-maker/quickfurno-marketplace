import test from "node:test";
import assert from "node:assert/strict";
import {mkdirSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
import {build} from "esbuild";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
mkdirSync(resolve(root,"test-results"),{recursive:true});
const outfile=resolve(root,"test-results/vox-rc40-consent-handoff-bundle.mjs");
await build({entryPoints:[resolve(root,"services/vox/rc6TransactionalConsentProof.ts")],
 bundle:true,platform:"node",format:"esm",target:"node20",outfile,logLevel:"silent"});
const {proveRc40ConsentDecisionHandoff}=await import(pathToFileURL(outfile).href+"?t="+Date.now());
const CONV="00000000-0000-4000-8000-0000000000c1";
const SUBJ="00000000-0000-4000-8000-000000000001";
const HASH="a".repeat(64);
const req={conversationId:CONV,destinationHash:HASH,expectedRevision:3,
 principal:{type:"vendor",id:SUBJ}};
const row=(o={})=>({id:CONV,tenant_id:"quickfurno",channel:"whatsapp",destination_hash:HASH,
 subject_type:"vendor",subject_id:SUBJ,revision:3,...o});
function client(over={}){
 const queries=[];
 const query=async(sql,values=[])=>{
  queries.push({sql,values});
  if(over.throwOn&&sql.startsWith(over.throwOn))throw new Error("synthetic");
  if(sql.includes("communication_conversations"))return {rows:over.conv??[row()]};
  if(sql.includes("communication_suppressions"))return {rows:over.suppressions??[]};
  if(sql.includes("communication_preferences"))return {rows:over.preferences??[]};
  return {rows:[]};
 };
 return {query,queries};
}
const noWrite=pg=>assert.equal(pg.queries.some(q=>/\b(COMMIT|INSERT|DELETE|UPDATE|TRUNCATE)\b/.test(q.sql)),false);
test("allow returns frozen bounded NOT_A_WRITER evidence in one read-only tx",async()=>{
 const pg=client();const r=await proveRc40ConsentDecisionHandoff(pg,req);
 assert.equal(r.kind,"allow");assert.equal(r.writer,"NOT_A_WRITER");
 assert.equal(r.evidence.writer,"NOT_A_WRITER");
 assert.equal(r.evidence.consentScope,"transactional");assert.equal(r.evidence.conversationRevision,3);
 assert.equal(r.evidence.revisionBinding,"CONVERSATION_REVISION_AND_POLICY_VERSION");
 assert.match(r.evidence.evidenceDigest,/^[a-f0-9]{64}$/);
 assert.equal(JSON.stringify(r).includes(HASH),false,"no destination hash leaks");
 assert.ok(Object.isFrozen(r)&&Object.isFrozen(r.evidence)&&Object.isFrozen(r.evidence.principal));
 assert.equal(r.transactionCommitted,false);assert.equal(r.providerMessagesSent,0);
 assert.match(pg.queries[0].sql,/SERIALIZABLE READ ONLY/);
 assert.match(pg.queries[1].sql,/pg_advisory_xact_lock/);
 assert.deepEqual(pg.queries[1].values,[HASH,"whatsapp"]);
 assert.match(pg.queries[2].sql,/communication_conversations/);
 assert.equal(pg.queries.at(-1).sql,"ROLLBACK");noWrite(pg);
});
test("forged / cross-conversation / stale bindings are BLOCKED before any consent read",async()=>{
 const cases=[
  [{conv:[]},"CONVERSATION_NOT_FOUND"],
  [{conv:[row({id:"00000000-0000-4000-8000-0000000000c2"})]},"CONVERSATION_IDENTITY_MISMATCH"],
  [{conv:[row({destination_hash:"b".repeat(64)})]},"DESTINATION_HASH_MISMATCH"],
  [{conv:[row({subject_id:"00000000-0000-4000-8000-000000000002"})]},"PRINCIPAL_BINDING_MISMATCH"],
  [{conv:[row({subject_type:"client"})]},"PRINCIPAL_BINDING_MISMATCH"],
  [{conv:[row({revision:4})]},"STALE_CONVERSATION_REVISION"],
  [{conv:[row({channel:"sms"})]},"CONVERSATION_SCOPE_MISMATCH"],
  [{conv:[row(),row()]},"CONVERSATION_NOT_FOUND"]];
 for(const [o,reason] of cases){
  const pg=client(o);const r=await proveRc40ConsentDecisionHandoff(pg,req);
  assert.equal(r.kind,"blocked");assert.equal(r.reason,reason);
  assert.equal(r.consentAllowed,false);assert.equal(r.evidence,null);
  assert.equal(pg.queries.some(q=>/communication_(suppressions|preferences)/.test(q.sql)),false);
  assert.equal(pg.queries.at(-1).sql,"ROLLBACK");noWrite(pg);
 }
});
test("invalid input never opens a transaction",async()=>{
 const pg=client();
 for(const bad of [null,undefined,{},{...req,destinationHash:"x"},{...req,conversationId:"x"},
  {...req,expectedRevision:-1},{...req,expectedRevision:1.5},
  {...req,principal:{type:"admin",id:SUBJ}},{...req,principal:{type:"vendor",id:"x"}},{...req,principal:null}]){
  const r=await proveRc40ConsentDecisionHandoff(pg,bad);
  assert.equal(r.kind,"blocked");assert.equal(r.reason,"HANDOFF_INPUT_INVALID");
 }
 assert.equal(pg.queries.length,0);
});
test("same-transaction suppression and blocked preference deny with no evidence",async()=>{
 let pg=client({suppressions:[{id:SUBJ,scope:"transactional",reason:"user_stop",
  policy_version:"qf-consent-v1",is_active:true,expires_at:null,deactivated_at:null}]});
 let r=await proveRc40ConsentDecisionHandoff(pg,req);
 assert.equal(r.kind,"deny");assert.equal(r.evidence,null);
 assert.equal(pg.queries.filter(q=>q.sql.includes("communication_preferences")).length,0);
 pg=client({preferences:[{id:SUBJ,state:"blocked",policy_version:"qf-consent-v1",
  consented_at:null,withdrawn_at:"2026-10-30T09:00:00.000000Z"}]});
 r=await proveRc40ConsentDecisionHandoff(pg,req);
 assert.equal(r.kind,"deny");assert.equal(r.consentAllowed,false);
});
test("D2-C integrity violation is BLOCKED; infra failure and rollback failure are unavailable",async()=>{
 const a={id:SUBJ,scope:"global",reason:"admin",policy_version:"qf-consent-v1",
  is_active:true,expires_at:null,deactivated_at:null};
 let r=await proveRc40ConsentDecisionHandoff(client({suppressions:[a,{...a}]}),req);
 assert.equal(r.kind,"blocked");assert.equal(r.reason,"CONSENT_AUTHORITY_INTEGRITY");
 for(const t of ["BEGIN","SELECT pg_advisory","SELECT id::text AS id,tenant_id","SELECT id::text AS id,scope"]){
  const pg=client({throwOn:t});r=await proveRc40ConsentDecisionHandoff(pg,req);
  assert.equal(r.kind,"unavailable");assert.equal(r.consentAllowed,false);
  assert.equal(pg.queries.at(-1).sql,"ROLLBACK");
 }
 r=await proveRc40ConsentDecisionHandoff(client({throwOn:"ROLLBACK"}),req);
 assert.equal(r.kind,"unavailable");assert.equal(r.reason,"ROLLBACK_UNVERIFIED");
 assert.equal(r.evidence,null);
});
