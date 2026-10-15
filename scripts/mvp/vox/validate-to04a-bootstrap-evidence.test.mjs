import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const data=JSON.parse(readFileSync(new URL("../../../ops/vox/certification/TO04A-HOLD.json",import.meta.url),"utf8"));
const packet=readFileSync(new URL("../../../docs/vox/VOX-TO04A-BOOTSTRAP-REVIEW.md",import.meta.url),"utf8");
test("no test may self-certify VOX staging or production",()=>{
 assert.equal(data.schema,"qf.vox.to04a.release-evidence.v1");
 assert.equal(data.status,"HOLD");
 assert.equal(data.productionActivationAuthorized,false);
 assert.equal(data.canonicalGrantChain,null);
 assert.equal(data.bootstrapIndependentReviewer,null);
});
test("human, DBA, Auth AAL2 and signed staging gates remain explicit failures",()=>{
 for(const key of ["migrationRecoveryDbaApproved","backupRestoreRehearsed",
  "actualSupabaseAuthAal2E2e","exactSubjectAndCityIdorTested",
  "signedCoreJarvisAgniCandidate","protectedHumanStagingApproval",
  "rollbackRehearsed","vendorLeadAndConsentRegressions",
  "externalMessageEgressAuthorized"])assert.equal(data[key],false,key);
});
test("one Core Admin, separately attested independent TL; never duplicate RPC chains",()=>{
 for(const fragment of ["Sole existing Core Superadmin","Separate named human reviewer",
 "same human","AAL1","replayed nonce","DO NOT MERGE OR SHIP BOTH",
 "Candidate A","Candidate B","original staging 86-migration",
 "cannot prove a human signature"])
  assert.ok(packet.toLowerCase().includes(fragment.toLowerCase()),fragment);
});
