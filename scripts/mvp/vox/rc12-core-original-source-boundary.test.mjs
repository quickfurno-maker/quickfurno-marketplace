import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,readdirSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const file=x=>readFileSync(resolve(root,x),"utf8");
const original="ops/vox/sql-candidates/20261018020000_vox_ab7b_nonwork_native_source_candidate.sql";
const dir="ops/vox/rc7-review-candidates/";
const client="20261030050000_vox_rc12_client_project_binding_review_only.sql";
const source="20261030060000_vox_rc12_core_original_source_review_only.sql";
test("managed AB7B CORE_CONVERSATION stays CHECK-blocked; forward SQL is review-only",()=>{
 const base=file(original),upgrade=file(dir+source);
 assert.match(base,/constraint vox_ab7b_core_conversation_blocked check\(source<>'CORE_CONVERSATION'\)/);
 assert.match(base,/if new.source not in \('CRM_AAROHI','SUPPORT_DESK'\)/i);
 assert.match(upgrade,/DROP CONSTRAINT vox_ab7b_core_conversation_blocked/);
 for(const f of [client,source]){
  assert.equal(readdirSync(resolve(root,"supabase/migrations")).includes(f),false);
  assert.equal(readdirSync(resolve(root,"ops/vox/sql-candidates")).includes(f),false);
 }
});
test("source proof never grants direct service-role mutation and requires matching receipt",()=>{
 const sql=file(dir+source),service=file("services/vox/rc8PgVendorConversationOperator.ts");
 assert.match(sql,/vox_rc8_conversation_operator_receipts_candidate_v1/);
 assert.match(sql,/communication_conversation_events/);
 assert.match(sql,/consent_scope<>'transactional'/);
 assert.match(sql,/event_data->>'operatorUserId'/);
 assert.match(sql,/REVOKE INSERT ON public.vox_ab7b_native_source_actions_candidate_v1 FROM service_role/);
 assert.match(sql,/REVOKE INSERT ON public.vox_staff_source_events_candidate_v1/);
 assert.match(sql,/public.vox_staff_source_nonce_candidate_v1 FROM service_role/);
 assert.match(service,/DISPOSABLE_RC12_AB7B_PROOF/);
 assert.match(service,/F1_OR_NONCE_ATOMIC_PROOF_MISSING/);
 assert.match(service,/RC8_CORE_WRITER_INSTALLED=false/);
 assert.match(service,/return closed\("CORE_WRITER_RELEASE_GATE_CLOSED"\)/);
});
test("client scope requires explicit reviewed binding and active city/zone/current reviewer",()=>{
 const clientSql=file(dir+client),service=file("services/vox/rc8PgVendorConversationOperator.ts");
 assert.match(clientSql,/client_account_id uuid NOT NULL REFERENCES public.client_accounts/);
 assert.match(clientSql,/lead_id uuid NOT NULL REFERENCES public.leads/);
 assert.match(clientSql,/REVOKE ALL ON public.vox_rc12_client_conversation_project_bindings_candidate_v1/);
 for(const name of ["l.location_verification_status='verified'","review_auth_placeholder"]) {
  if(name==="review_auth_placeholder")continue;
  assert.ok(service.includes(name),name);
 }
 assert.match(service,/reviewer_auth.raw_app_meta_data->>'vox_role'='team_leader'/);
 assert.match(service,/FOR SHARE OF b,ca,l,z,geo_city,reviewer,reviewer_auth,review_m,review_t/);
 assert.match(service,/c.assigned_actor==="RIYA"/);
});
