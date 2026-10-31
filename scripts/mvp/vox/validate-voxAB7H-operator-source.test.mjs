import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const service=readFileSync(new URL("../../../services/jarvisOperatorCommandService.ts",import.meta.url),"utf8");
const sql=readFileSync(new URL("../../../ops/vox/sql-candidates/20261018110000_vox_ab7h_signed_operator_atomic_candidate.sql",import.meta.url),"utf8");
test("AB7H source requires staging gate and exact signed command digest",()=>{
 assert.match(service,/VOX_AB7H_SIGNED_OPERATOR_ATOMIC_ENABLED==="staging"/);
 assert.match(service,/createHash\("sha256"\)\.update\(rawBody\)/);
 assert.match(service,/qf_vox_ab7h_signed_operator_atomic_candidate_v1/);
});
test("AB7H signed PAUSE and TAKEOVER route to atomic branch before legacy",()=>{
 assert.match(service,/return applyAb7hSignedAtomicConversation\(command,actorId,rawBody\)/);
 assert.match(service,/takeOverConversation\(args.command,actorId,args.rawBody\)/);
 assert.match(service,/pauseConversation\(args.command,actorId,args.rawBody\)/);
});
test("AB7H SQL never grants insertion of independent review to service role",()=>{
 assert.match(sql,/revoke all on public.vox_ab7h_operator_review_candidate_v1/);
 assert.match(sql,/service_role;/);
 assert.match(sql,/qf_vox_ab7h_signed_operator_atomic_candidate_v1/);
 assert.match(sql,/AB7H_INDEPENDENT_SIGNED_REVIEW_REQUIRED/);
});
