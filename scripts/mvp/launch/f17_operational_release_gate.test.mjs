import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {evaluateF17,REQUIRED_REAL_EVIDENCE} from "./f17_operational_release_gate.mjs";
const observed=JSON.parse(readFileSync(new URL("../../../docs/launch/qf-f17-actual-operational-evidence-20261107.json",import.meta.url),"utf8"));
test("F17-01 actual read-only stage status remains HOLD",()=>{
 const x=evaluateF17(observed);
 assert.equal(x.releaseVerdict,"HOLD");assert.equal(x.mayDeployStaging,false);
 assert.equal(x.maySendOtp,false);assert.equal(x.mayDeployProduction,false);
 for(const n of REQUIRED_REAL_EVIDENCE)assert.ok(x.blockers.includes(n),n);
});
test("F17-02 empty inputs fail closed",()=>{
 for(const x of [undefined,null,[],false,4,"bad",{}]){
  const v=evaluateF17(x);assert.equal(v.mayDeployStaging,false);assert.equal(v.releaseVerdict,"HOLD");
 }
});
test("F17-03 RED does not automatically fail account identity",()=>{
 const x=evaluateF17(observed);
 assert.ok(!x.blockers.includes("F17_VENDOR_META_QUALITY_UNVERIFIED"));
 assert.ok(!x.blockers.includes("F17_VENDOR_META_ACCOUNT_AUTHORITY"));
});
test("F17-04 wrong cross-WABA fails",()=>{
 const x=structuredClone(observed);
 x.meta.vendor.waba=x.meta.client.waba;
 assert.ok(evaluateF17(x).blockers.includes("F17_VENDOR_META_ACCOUNT_AUTHORITY"));
});
test("F17-05 stale old Core never passes",()=>{
 const x=structuredClone(observed);x.stagingCore.imageAttested=true;
 assert.ok(evaluateF17(x).blockers.includes("F17_LIVE_CORE_STILL_OLD_OR_UNATTESTED"));
});
test("F17-06 new candidate not implied by local build",()=>{
 const x=structuredClone(observed);
 x.artifacts.candidateSha256="sha256:"+"a".repeat(64);
 assert.ok(evaluateF17(x).blockers.includes("F17_SIGNED_IMMUTABLE_CANDIDATE"));
});
test("F17-07 restore from old dump not current managed backup",()=>{
 const x=structuredClone(observed);x.database.restoreOnIsolatedDatabasePassed=true;
 assert.ok(evaluateF17(x).blockers.includes("F17_MANAGED_CURRENT_DB_AUTH_STORAGE_RECOVERY"));
});
test("F17-08 Http 405 not enough for configured Auth Hook",()=>{
 const x=structuredClone(observed);
 x.hooks.supabaseAuthHookUrl="https://staging-core.quickfurno.in/api/auth/hooks/supabase-send-sms";
 assert.ok(evaluateF17(x).blockers.includes("F17_REGISTERED_SUPABASE_AUTH_HOOK_URL"));
});
test("F17-09 wrong hook host rejected",()=>{
 const x=structuredClone(observed);x.hooks.supabaseAuthHookRegistered=true;
 x.hooks.supabaseAuthHookEnabled=true;x.hooks.supabaseAuthHookUrl="https://vox.quickfurno.in/api/auth/hooks/supabase-send-sms";
 assert.ok(evaluateF17(x).blockers.includes("F17_REGISTERED_SUPABASE_AUTH_HOOK_URL"));
});
test("F17-10 owner GO still non-automated when all facts forged green",()=>{
 const x=structuredClone(observed);
 x.github={...x.github,originalProtectedF1F5F6F7Green:true,
  approvedReleaseHead:"a".repeat(40)};
 x.stagingCore={...x.stagingCore,currentImage:"qf-staging:new",imageAttested:true,
  sourceSha:"a".repeat(40),senderClassification:"RIYA_CLIENT",vendorPairExact:true,
  clientTokenPresent:true,vendorTokenPresent:true,signingSecretsPresent:true};
 x.meta.vendor={...x.meta.vendor,registeredCallbackVerified:true,
  registeredCallbackHost:"staging-core.quickfurno.in",
  registeredCallbackPath:"/api/webhooks/whatsapp/meta"};
 x.hooks={supabaseAuthHookRegistered:true,supabaseAuthHookEnabled:true,
  supabaseAuthHookUrl:"https://staging-core.quickfurno.in/api/auth/hooks/supabase-send-sms",
  signedCallbacksNegativeE2ePassed:true,verifiedSource:"actual-staging"};
 x.database={...x.database,sqlContentParityVerified:true,
  freshDbAuthStorageSnapshotVerified:true,storageObjectBytesVerified:true};
 x.artifacts={...x.artifacts,signedImmutableImageVerified:true,
  candidateSha256:"sha256:"+"a".repeat(64),candidateSourceSha:"a".repeat(40)};
 x.security.exposedStagingKeysRotatedAndRevoked=true;
 x.security.oldTokensInvalidatedVerified=true;
 x.owner={stagingChangeApproved:true,rollbackOperatorConfirmed:true};
 const v=evaluateF17(x);
 assert.equal(v.allRequiredFactsSatisfied,true);
 assert.equal(v.releaseVerdict,"HOLD");assert.equal(v.mayDeployStaging,false);
 assert.equal(v.maySendOtp,false);assert.equal(v.mayDeployProduction,false);
});
test("F17-11 leaked credentials require rotation + revocation",()=>{
 const x=structuredClone(observed);
 x.security.exposedStagingKeysRotatedAndRevoked=true;
 assert.ok(evaluateF17(x).blockers.includes("F17_ROTATE_EXPOSED_STAGING_KEYS"));
});
test("F17-12 deferred ClamAV approvals fail closed",()=>{
 const x=structuredClone(observed);
 x.security.scanDependentApprovalAndCreditsFailClosed=false;
 assert.ok(evaluateF17(x).blockers.includes("F17_DEFERRED_DOCUMENT_SCAN_SAFETY"));
});
