import test from "node:test";
import assert from "node:assert/strict";
import {createRc10ReleaseEvidence} from "./rc10-release-evidence.mjs";
test("RC10 evidence includes both Core and finance workflow sources with deterministic hashes",()=>{
 const a=createRc10ReleaseEvidence(),b=createRc10ReleaseEvidence();
 assert.equal(a.schema,"qf.vox.rc10.release-evidence.v1");
 assert.equal(a.sourceDigestSha256,b.sourceDigestSha256);
 assert.equal(a.components.length,15);
 for(const f of a.components)assert.match(f.sha256,/^[a-f0-9]{64}$/,f.path);
});
test("source inventory cannot silently certify staging, production or money movement",()=>{
 const a=createRc10ReleaseEvidence();
 assert.equal(a.releaseDecision,"HOLD");
 assert.equal(a.artifactStatus,"UNSIGNED_SOURCE_INVENTORY_NOT_DEPLOYABLE");
 assert.equal(a.financeDetailFeature.stagingActivation,false);
 assert.equal(a.financeDetailFeature.productionActivation,false);
 assert.equal(a.financeDetailFeature.canRefund,false);
 assert.equal(a.financeDetailFeature.canGrantCredits,false);
 assert.equal(a.requiresIndependentDbaAppsec,true);
 assert.equal(a.requiresRealOwnerTlHumanKeys,true);
 assert.equal(a.requiresManagedRestoration,true);
});
