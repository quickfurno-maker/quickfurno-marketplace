import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,readdirSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {executeRc8PgPendingSignedIntentProduction,RC8_APPROVAL_WRITER_INSTALLED,
 RC8_NATIVE_APPROVAL_GATE} from "./rc8-pg-signed-intent-writer.mjs";
import {createRc8OwnerAclReplayPlan} from "./rc8-owner-acl-replay-plan.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const read=x=>readFileSync(resolve(root,x),"utf8");
const dir="ops/vox/rc7-review-candidates/";
test("production approval entry cannot obtain a database transaction or enrol fake signers",async()=>{
 let invoked=0;
 const response=await executeRc8PgPendingSignedIntentProduction({
  acquireClient:()=>{invoked++;throw Error("must never begin");},
  approvedRegistryFingerprints:["forged"],request:{type:"EOD_OFFICIAL_RELEASE"}
 });
 assert.equal(RC8_APPROVAL_WRITER_INSTALLED,false);
 assert.ok(Object.values(RC8_NATIVE_APPROVAL_GATE).every(x=>x===false));
 assert.equal(response.reason,"NATIVE_RELEASE_GATE_CLOSED");
 assert.equal(invoked,0);
});
test("Core vendor write remains hard-off for production; provider operations absent",()=>{
 const core=read("services/vox/rc8PgVendorConversationOperator.ts");
 assert.match(core,/RC8_CORE_WRITER_INSTALLED=false/);
 assert.match(core,/return closed\("CORE_WRITER_RELEASE_GATE_CLOSED"\)/);
 assert.match(core,/authorizeConversationalWhatsAppConsent/);
 assert.match(core,/decideCommunicationConsent/);
 assert.match(core,/BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE READ WRITE/);
 assert.match(core,/pg_advisory_xact_lock/);
 assert.match(core,/WHERE c.id=\$1::uuid/);
 assert.match(core,/FOR UPDATE OF c/);
 assert.match(core,/FOR SHARE OF b,ca,l,z,geo_city,reviewer,reviewer_auth,review_m,review_t/);
 assert.match(core,/DISPOSABLE_RC12_AB7B_PROOF/);
 assert.match(core,/UPDATE public.communication_conversations/);
 assert.match(core,/INSERT INTO public.communication_conversation_events/);
 assert.doesNotMatch(core,/\.send\(|providerFetch\(|sendWhatsApp/);
 const original=read("ops/vox/sql-candidates/20261018020000_vox_ab7b_nonwork_native_source_candidate.sql");
 assert.match(original,/constraint vox_ab7b_core_conversation_blocked check\(source<>'CORE_CONVERSATION'\)/);
});
test("review-only candidates never enter deployable or pinned 30-file inventory",()=>{
 for(const f of ["20261030010000_vox_rc8_signed_intent_transaction_review_only.sql",
  "20261030020000_vox_rc8_conversation_operator_review_only.sql"]){
  assert.ok(read(dir+f).includes("NOT a managed migration")||
    read(dir+f).includes("NOT a managed migration and NOT an AB7B"));
  assert.equal(readdirSync(resolve(root,"supabase/migrations")).includes(f),false);
  assert.equal(readdirSync(resolve(root,"ops/vox/sql-candidates")).includes(f),false);
 }
 const intent=read(dir+"20261030010000_vox_rc8_signed_intent_transaction_review_only.sql");
 const conv=read(dir+"20261030020000_vox_rc8_conversation_operator_review_only.sql");
 assert.match(intent,/FORCE ROW LEVEL SECURITY/);
 assert.match(intent,/FROM PUBLIC,anon,authenticated,service_role/);
 assert.match(conv,/REVOKE ALL/);
 assert.match(conv,/canonical_source_ready boolean NOT NULL DEFAULT false CHECK\(canonical_source_ready=false\)/);
});
test("no production route or worker imports the native draft writers",()=>{
 const routeDir=resolve(root,"app/api/vox/v1");
 const walk=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(f=>{
  const p=resolve(dir,f.name);
  return f.isDirectory()?walk(p):f.name.endsWith(".ts")?[p]:[];
 });
 for(const file of walk(routeDir)){
  const src=readFileSync(file,"utf8");
  assert.doesNotMatch(src,/rc8PgSignedIntentWriter|rc8PgVendorConversationOperator/,file);
 }
});
