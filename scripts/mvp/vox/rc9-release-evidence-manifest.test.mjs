import test from "node:test";
import assert from "node:assert/strict";
import {rc9EvidenceManifest} from "./rc9-release-evidence-manifest.mjs";
test("all protected critical source assets have deterministic hashes",()=>{
 const a=rc9EvidenceManifest(),b=rc9EvidenceManifest();
 assert.equal(a.schema,"qf.vox.rc9.release-evidence.v1");
 assert.equal(a.sourceDigestSha256,b.sourceDigestSha256);
 assert.equal(a.files.length,11);
 for(const file of a.files){assert.equal(file.status,"SOURCE_PRESENT",file.path);
  assert.match(file.sha256,/^[a-f0-9]{64}$/)}
});
test("release HOLD cannot become GO through source flags or a synthetic human signer",()=>{
 const m=rc9EvidenceManifest();
 assert.equal(m.releaseDecision,"HOLD");assert.equal(m.signatureStatus,"UNSIGNED_NOT_PRODUCTION_ATTESTED");
 for(const k of ["canonicalCoreConversationSqlHardOff","nativeConversationProductionHardOff",
  "signedApprovalProductionHardOff","reviewSqlUndeployable"])
  assert.equal(m.gates[k],true,k);
 for(const k of ["independentDbaAppsecDecision","humanOwnerAndTeamLeaderAal2Certified",
  "humanEd25519KeysEnrolled","managedRecoveryAndPitrCertified",
  "managedStagingIntegratedAcceptance","managedProductionAuthorized"])
  assert.equal(m.gates[k],false,k);
 assert.equal(m.blockers.length,6);
});
