import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const read=p=>readFileSync(resolve(root,p),"utf8");

test("Auth->Core bridge has a hard-off constant and no route or source proof input",()=>{
 const b=read("services/vox/rc19VerifiedConversationWriter.ts");
 assert.match(b,/RC19_VERIFIED_CORE_WRITER_INSTALLED=false as const/);
 assert.match(b,/if\(!RC19_VERIFIED_CORE_WRITER_INSTALLED\)/);
 assert.match(b,/verifyVoxOperationsStaffBearer\(authorization\)/);
 assert.match(b,/executeRc8PgVendorConversationOperator\(\{/);
 assert.doesNotMatch(b,/sourceProof|DISPOSABLE_RC12_AB7B_PROOF|process\.env/);
 for(const blocker of ["independentDbaAppsecApproved:false","managedRestoreCertified:false",
 "staffAal2AndTeamOnboarded:false","consentMutationSerializationCertified:false",
 "nativeWriterRoleAndAb7bReviewed:false","stagingOperationalAcceptancePassed:false"])
  assert.ok(b.includes(blocker),blocker);
});
test("native Core still independently validates current consent, scope and revision",()=>{
 const c=read("services/vox/rc8PgVendorConversationOperator.ts");
 assert.match(c,/BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE READ WRITE/);
 assert.match(c,/CURRENT_STAFF_GRANT_OR_AAL2_DENIED/);
 assert.match(c,/CONVERSATION_OBJECT_GRANT_REVOKED/);
 assert.match(c,/CONSENT_DENIED/);
 assert.match(c,/CURRENT_SUBJECT_SCOPE_OR_STATE_DENIED/);
 assert.match(c,/FOR SHARE/);
 assert.match(c,/CORE_WRITER_RELEASE_GATE_CLOSED/);
});
test("signed EOD intent ties cryptographic pair to locked independent TL-reviewed 4-source report",()=>{
 const s=read("scripts/mvp/vox/rc8-pg-signed-intent-writer.mjs");
 assert.match(s,/request\.type==="EOD_OFFICIAL_RELEASE"/);
 assert.match(s,/vox_ab7f_four_source_eod_candidate_v1/);
 assert.match(s,/WHERE id=\$1::uuid FOR UPDATE/);
 assert.match(s,/row\.reviewer_id!==teamLeaderAuth\?\.userId/);
 assert.match(s,/Number\(row\.source_count\)!==4/);
 assert.match(s,/row\.source_digest!==request\.digest/);
 assert.match(s,/row\.published!==false/);
 assert.match(s,/EOD_CURRENT_FOUR_SOURCE_REVIEW_REQUIRED/);
 assert.match(s,/RC8_NATIVE_APPROVAL_GATE=Object\.freeze/);
 assert.match(s,/humanKeyCeremonyComplete:false/);
});
