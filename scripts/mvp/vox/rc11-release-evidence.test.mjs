import test from "node:test";
import assert from "node:assert/strict";
import {rc11ReleaseEvidence} from "./rc11-release-evidence.mjs";
test("RC11 includes exact source evidence for revocation, native finance, core and Web",()=>{
 const a=rc11ReleaseEvidence(),b=rc11ReleaseEvidence();
 assert.equal(a.schema,"qf.vox.rc11.release-evidence.v1");
 assert.equal(a.sourceDigestSha256,b.sourceDigestSha256);
 assert.equal(a.entries.length,23);
 assert.equal(new Set(a.entries.map(x=>x.purpose)).size,a.entries.length);
 for(const e of a.entries)assert.match(e.sha256,/^[a-f0-9]{64}$/,e.path);
});
test("no source success can certify incomplete managed, payment, identity or signing gates",()=>{
 const m=rc11ReleaseEvidence();
 assert.equal(m.releaseDecision,"HOLD");
 assert.equal(m.artifactStatus,"UNSIGNED_NOT_DEPLOYABLE");
 for(const k of ["signedOfficialEodEnabled","coreConversationCanonicalSourceInstalled",
  "humanSignerRegistryVerified","independentDbaAppsecReviewed",
  "managedRecoveryAndPitrCertified","managedStagingAllFeaturesAccepted",
  "productionActivationAuthorized"])
  assert.equal(m[k],false,k);
 for(const k of ["managedSourceInstalled","approvedWriterRoleInstalled",
  "allProviderEventsCaptured","providerSettlementVerified","refundsAndCreditsEnabled"])
  assert.equal(m.financeAttemptEvents[k],false,k);
 assert.equal(m.financeAttemptEvents.schemaReviewOnly,true);
});
