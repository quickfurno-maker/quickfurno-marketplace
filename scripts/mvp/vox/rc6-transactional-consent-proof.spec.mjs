import test from "node:test";
import assert from "node:assert/strict";
import {proveRc6TransactionalConsent,RC6_CONVERSATION_WRITER_INSTALLED} from "../../../services/vox/rc6TransactionalConsentProof.ts";
const ID="00000000-0000-4000-8000-000000000001";
const HASH="a".repeat(64);
const subject={destinationHash:HASH,subjectType:"client",subjectId:ID};
const now="2026-10-30T09:00:00.000000Z";
function client(over={}){
 const queries=[];
 const query=async(sql,values=[])=>{
   queries.push({sql,values});
   if(over.throwOn && sql.startsWith(over.throwOn))throw new Error("synthetic SQL failure");
   if(sql.includes("communication_suppressions"))return {rows:over.suppressions??[]};
   if(sql.includes("communication_preferences"))return {rows:over.preferences??[]};
   return {rows:[]};
 };
 return {query,queries};
}
test("always denied writer installation and production SOURCE gate",()=>{
 assert.equal(RC6_CONVERSATION_WRITER_INSTALLED,false);
});
test("canonical D2-C runs on same PG connection under D2-D destination lock; no mutation",async()=>{
 const pg=client();
 const r=await proveRc6TransactionalConsent(pg,subject);
 assert.equal(r.kind,"allow");
 assert.equal(r.consentAllowed,true);assert.equal(r.transactionCommitted,false);
 assert.equal(r.sourceRowsWritten,0);assert.equal(r.providerMessagesSent,0);
 assert.equal(pg.queries.length,5);
 assert.match(pg.queries[0].sql,/BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE READ ONLY/);
 assert.match(pg.queries[1].sql,/pg_advisory_xact_lock\(hashtextextended\('dst\|'/);
 assert.deepEqual(pg.queries[1].values,[HASH,"whatsapp"]);
 assert.match(pg.queries[2].sql,/communication_suppressions/);
 assert.match(pg.queries[3].sql,/communication_preferences/);
 assert.equal(pg.queries[4].sql,"ROLLBACK");
 assert.equal(pg.queries.some(q=>/\b(COMMIT|INSERT|DELETE|UPDATE|TRUNCATE)\b/.test(q.sql)),false);
});
test("same-transaction suppression denies and never reads a preference",async()=>{
 const pg=client({suppressions:[{id:ID,scope:"transactional",reason:"user_stop",
   policy_version:"qf-consent-v1",is_active:true,expires_at:null,deactivated_at:null}]});
 const r=await proveRc6TransactionalConsent(pg,subject);
 assert.equal(r.kind,"deny");assert.equal(r.consentAllowed,false);
 assert.equal(pg.queries.filter(q=>q.sql.includes("communication_preferences")).length,0);
 assert.equal(pg.queries.at(-1).sql,"ROLLBACK");
});
test("exact blocked preference denies; D2-C not reimplemented in SQL",async()=>{
 const pg=client({preferences:[{id:ID,state:"blocked",policy_version:"qf-consent-v1",
   consented_at:null,withdrawn_at:now}]});
 assert.equal((await proveRc6TransactionalConsent(pg,subject)).kind,"deny");
 assert.equal(pg.queries.at(-1).sql,"ROLLBACK");
});
test("D2-C integrity error fails closed (duplicate active suppressions)",async()=>{
 const active={id:ID,scope:"global",reason:"admin",policy_version:"qf-consent-v1",
   is_active:true,expires_at:null,deactivated_at:null};
 const pg=client({suppressions:[active,{...active}]});
 const r=await proveRc6TransactionalConsent(pg,subject);
 assert.equal(r.kind,"deny");
 assert.equal(r.sourceRowsWritten,0);
});
test("read failure and rollback failure never allow",async()=>{
 for(const err of ["SELECT id","SELECT pg_advisory_xact_lock","BEGIN TRANSACTION"]){
   const pg=client({throwOn:err});
   const r=await proveRc6TransactionalConsent(pg,subject);
   assert.equal(r.kind,"unavailable");
   assert.equal(pg.queries.at(-1).sql,"ROLLBACK");
 }
 const pg=client({throwOn:"ROLLBACK"});
 const r=await proveRc6TransactionalConsent(pg,subject);
 assert.equal(r.kind,"unavailable");assert.equal(r.reason,"ROLLBACK_UNVERIFIED");
});
test("bad actor data and client inputs never acquire a lock or open a transaction",async()=>{
 const pg=client();
 for(const bad of [{...subject,destinationHash:"broken"},{...subject,subjectType:"unknown"},
   {...subject,subjectId:"not-uuid"},null,{},undefined]){
   const r=await proveRc6TransactionalConsent(pg,bad);
   assert.equal(r.kind,"unavailable");
 }
 assert.equal(pg.queries.length,0);
});
