import test from "node:test";import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";import {dirname,resolve} from "node:path";
import {CORE_CONVERSATION_BINDING,CORE_CONVERSATION_DENY_REASONS,
 authorizeCoreConversationSourceRow,evaluateCoreConversationSourceRow}
 from "../../../contracts/vox/ab7kCoreConversationConsentBinding.mjs";
// SOURCE-SHAPE tests of the RC3 contract scaffold (#444). Not PG17, not executed by the author.
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const read=p=>readFileSync(resolve(root,p),"utf8");
const strip=s=>s.replace(/--[^\n]*/g,"");
const U=n=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const CONV=U(1),USER=U(2),TEAM=U(3),CITY=U(4),SUBJ=U(5),NONCE=U(6);
const HASH="a".repeat(64);
// A test-only signed-off binding to exercise the logic; production export stays unsigned.
const SIGNED={...CORE_CONVERSATION_BINDING,signedOff:true};
const req=(o={})=>({conversationId:CONV,nonce:NONCE,revision:3,...o});
function mk(over={}){
 const calls={send:0,consent:[],load:0};
 const staff={userId:USER,teamId:TEAM,cityId:CITY,active:true,revoked:false,
  profileRole:null,teamActive:true,expiresAtMs:Date.now()+3600e3,aal:"aal2",
  staffRole:"operations_manager",departments:["client_success"],
  conversationGrantIds:[CONV],...over.staff};
 const conv={id:CONV,tenantId:"quickfurno",channel:"whatsapp",destinationHash:HASH,
  subjectType:"client",subjectId:SUBJ,subjectTeamId:TEAM,subjectCityId:CITY,
  state:"OPEN",revision:3,...over.conv};
 const deps={
  loadCurrentStaff:async()=>staff,
  loadCoreConversation:async()=>{calls.load++;
   return over.second&&calls.load>1?{...conv,...over.second}:conv;},
  isNonceUnused:async()=>over.nonceUnused??true,
  authorizeConsent:async i=>{calls.consent.push(i);
   if(over.consentThrows)throw new Error("db");
   return Object.hasOwn(over,"consent")?over.consent:{kind:"allow",scope:"transactional"};},
  sendProviderMessage:()=>{calls.send++;},...over.deps};
 return {deps,calls};
}
const run=(o,r=req(),b=SIGNED)=>{const m=mk(o);
 return evaluateCoreConversationSourceRow(r,m.deps,b).then(x=>({x,...m}));};
const reasonOf=async(o,r,b)=>(await run(o,r,b)).x.reason;

test("production export is hard-bound to the UNSIGNED binding and always denies",async()=>{
 assert.equal(CORE_CONVERSATION_BINDING.signedOff,false);
 assert.equal(Object.isFrozen(CORE_CONVERSATION_BINDING),true);
 const {deps,calls}=mk();
 const r=await authorizeCoreConversationSourceRow(req(),deps);
 assert.equal(r.ok,false);assert.equal(r.reason,"BINDING_NOT_SIGNED_OFF");
 assert.equal(r.mayWriteSourceRow,false);assert.equal(calls.send,0);
});
test("signed-off shape passes only with full proof and still never writes or sends",async()=>{
 const {x,calls}=await run({});
 assert.equal(x.ok,true);assert.equal(x.mayWriteSourceRow,false);
 assert.equal(x.requireSameTransactionConsentRecheck,true);
 assert.equal(x.providerMessagesSent,0);assert.equal(calls.send,0);
 // consent was asked about Core-row facts, not request facts
 assert.deepEqual(calls.consent,[{destinationHash:HASH,subjectType:"client",subjectId:SUBJ}]);
});
test("missing consent authority / suppressed / revoked / not granted all deny",async()=>{
 for(const consent of [{kind:"deny",code:"CONSENT_SUPPRESSED",retryable:false},
  {kind:"deny",code:"CONSENT_NOT_GRANTED",retryable:false},
  {kind:"invalid",code:"CONSENT_AUTHORITY_INTEGRITY",retryable:false},
  {kind:"allow"},{kind:"allow",scope:"marketing"},
  {kind:"allow",scope:"transactional",code:"x"},null,undefined,"allow",true])
  assert.equal(await reasonOf({consent}),"CONSENT_NOT_ALLOWED",JSON.stringify(consent));
 assert.equal(await reasonOf({consent:{kind:"unavailable",code:"CONSENT_AUTHORITY_UNAVAILABLE",retryable:true}}),
  "CONSENT_AUTHORITY_UNAVAILABLE");
 assert.equal(await reasonOf({consentThrows:true}),"CONSENT_AUTHORITY_UNAVAILABLE");
 assert.equal(await reasonOf({deps:{authorizeConsent:undefined}}),"REQUEST_SHAPE_INVALID");
});
test("client-submitted consent/self-assertion or extra fields are rejected",async()=>{
 for(const extra of [{consent:true},{optIn:true},{allowed:true},{destinationHash:HASH},
  {teamId:TEAM},{actorId:USER},{channel:"whatsapp"}])
  assert.equal(await reasonOf({},req(extra)),"REQUEST_SHAPE_INVALID",Object.keys(extra)[0]);
 assert.equal(await reasonOf({},{conversationId:CONV,nonce:NONCE}),"REQUEST_SHAPE_INVALID");
 assert.equal(await reasonOf({},req({revision:0})),"REQUEST_SHAPE_INVALID");
 assert.equal(await reasonOf({},req({conversationId:"x"})),"REQUEST_SHAPE_INVALID");
 assert.equal(await reasonOf({},null),"REQUEST_SHAPE_INVALID");
});
test("wrong role / department / profile role / AAL / revoked / expired staff deny",async()=>{
 for(const role of ["support_agent","acquisition_agent","vendor_success_agent",
  "team_leader","auditor","client_success_agent",undefined])
  assert.equal(await reasonOf({staff:{staffRole:role}}),"STAFF_ROLE_OR_DEPARTMENT_MISMATCH",String(role));
 assert.equal(await reasonOf({staff:{departments:["service_support"]}}),"STAFF_ROLE_OR_DEPARTMENT_MISMATCH");
 assert.equal(await reasonOf({staff:{profileRole:"admin"}}),"STAFF_NOT_CURRENT");
 assert.equal(await reasonOf({staff:{active:false}}),"STAFF_NOT_CURRENT");
 assert.equal(await reasonOf({staff:{revoked:true}}),"STAFF_NOT_CURRENT");
 assert.equal(await reasonOf({staff:{teamActive:false}}),"STAFF_NOT_CURRENT");
 assert.equal(await reasonOf({staff:{expiresAtMs:Date.now()-1}}),"STAFF_NOT_CURRENT");
 assert.equal(await reasonOf({staff:{aal:"aal1"}}),"STAFF_AAL2_REQUIRED");
 assert.equal(await reasonOf({staff:{conversationGrantIds:[U(99)]}}),"OBJECT_GRANT_MISSING");
 assert.equal(await reasonOf({deps:{loadCurrentStaff:async()=>null}}),"STAFF_NOT_CURRENT");
});
test("wrong team / city (resolved from subject at mutation time) deny",async()=>{
 assert.equal(await reasonOf({conv:{subjectTeamId:U(77)}}),"TEAM_OR_CITY_MISMATCH");
 assert.equal(await reasonOf({conv:{subjectCityId:U(78)}}),"TEAM_OR_CITY_MISMATCH");
 assert.equal(await reasonOf({conv:{subjectCityId:null}}),"TEAM_OR_CITY_MISMATCH");
 assert.equal(await reasonOf({staff:{teamId:U(79)}}),"TEAM_OR_CITY_MISMATCH");
});
test("replayed nonce denies before touching Core conversation or consent",async()=>{
 const {x,calls}=await run({nonceUnused:false});
 assert.equal(x.reason,"NONCE_REPLAY");assert.equal(calls.load,0);assert.equal(calls.consent.length,0);
});
test("forged / stale / ineligible conversation denies",async()=>{
 assert.equal(await reasonOf({deps:{loadCoreConversation:async()=>null}}),"CONVERSATION_NOT_FOUND_OR_FORGED");
 assert.equal(await reasonOf({conv:{id:U(55)}}),"CONVERSATION_NOT_FOUND_OR_FORGED");
 assert.equal(await reasonOf({conv:{revision:4}}),"CONVERSATION_STALE_OR_INELIGIBLE");
 assert.equal(await reasonOf({conv:{state:"HUMAN"}}),"CONVERSATION_STALE_OR_INELIGIBLE");
 assert.equal(await reasonOf({conv:{tenantId:"other"}}),"CONVERSATION_STALE_OR_INELIGIBLE");
 assert.equal(await reasonOf({conv:{subjectType:"unknown"}}),"CONVERSATION_STALE_OR_INELIGIBLE");
 assert.equal(await reasonOf({conv:{subjectId:null}}),"CONVERSATION_STALE_OR_INELIGIBLE");
 assert.equal(await reasonOf({conv:{channel:"sms"}}),"CHANNEL_UNSUPPORTED");
 assert.equal(await reasonOf({conv:{destinationHash:"short"}}),"CHANNEL_UNSUPPORTED");
 assert.equal(await reasonOf({second:{destinationHash:"b".repeat(64)}}),"CORE_CHANGED_DURING_CHECK");
 assert.equal(await reasonOf({second:{revision:4}}),"CORE_CHANGED_DURING_CHECK");
});
test("every denial is closed-set, never sends, never writes",async()=>{
 const cases=[{consent:null},{staff:{aal:"x"}},{nonceUnused:false},{conv:{revision:9}}];
 for(const c of cases){const {x,calls}=await run(c);
  assert.equal(x.ok,false);assert.ok(CORE_CONVERSATION_DENY_REASONS.includes(x.reason));
  assert.equal(x.mayWriteSourceRow,false);assert.equal(x.providerMessagesSent,0);
  assert.equal(calls.send,0);}
});
test("role mapping is one of the six canonical roles and not a consumed lane role",()=>{
 const m=/staff_role in \(([^)]*)\)/.exec(strip(read(
  "ops/vox/quarantined-migrations/legacy-20261014/20261014050000_vox_v1_team_leader_review_policy.sql")));
 const roles=m[1].split(",").map(x=>x.trim().replace(/'/g,""));
 assert.ok(roles.includes(CORE_CONVERSATION_BINDING.staffRole));
 assert.equal(roles.length,6);
 assert.ok(!["acquisition_agent","support_agent"].includes(CORE_CONVERSATION_BINDING.staffRole));
 const dept=strip(read("ops/vox/sql-candidates/20261015010000_vox_to02b_staff_department_governance.sql"));
 assert.match(dept,new RegExp(`'${CORE_CONVERSATION_BINDING.department}'`));
});
test("scaffold has no I/O, no send path and does not touch the SQL block",()=>{
 const src=read("contracts/vox/ab7kCoreConversationConsentBinding.mjs");
 const code=src.replace(/\/\*[\s\S]*?\*\//g,"").replace(/\/\/[^\n]*/g,"");
 for(const bad of [/\bimport\b/,/\bfetch\b/,/supabase/i,/process\.env/,/communication_suppressions/,
  /communication_preferences/,/sendProviderMessage|\.send\(/])
  assert.equal(bad.test(code),false,String(bad));
 const sql=strip(read("ops/vox/sql-candidates/20261018020000_vox_ab7b_nonwork_native_source_candidate.sql"));
 assert.match(sql,/constraint vox_ab7b_core_conversation_blocked check\(source<>'CORE_CONVERSATION'\)/);
 assert.match(sql,/new\.source not in \('CRM_AAROHI','SUPPORT_DESK'\)/);
});
test("authority is the existing D2-C coordinator and the AB7F writer actor is admin, not Staff",()=>{
 const svc=read("services/outboundConsentEnforcementService.ts");
 assert.match(svc,/export async function authorizeConversationalWhatsAppConsent/);
 assert.match(svc,/scope: "transactional"/);
 const f=strip(read("ops/vox/sql-candidates/20261018070000_vox_ab7f_conversation_atomic_operator_candidate.sql"));
 const g=strip(read("ops/vox/sql-candidates/20261018020000_vox_ab7b_nonwork_native_source_candidate.sql"));
 // Disjoint actor populations: why the existing native writer cannot feed this source.
 assert.match(f,/p\.role='admin'/);assert.match(g,/p\.role is null/);
 assert.equal(/communication_suppressions|communication_preferences/.test(f),false,
  "AB7F RPC performs no in-transaction consent check");
});
