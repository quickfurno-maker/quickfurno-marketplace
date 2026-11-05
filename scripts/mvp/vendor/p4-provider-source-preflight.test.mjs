import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {assessP4ProviderObservation,localProviderObservation} from "./p4-provider-source-preflight.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const obs=JSON.parse(readFileSync(resolve(root,"docs/vox/QF-P4-PROVIDER-READONLY-OBSERVATION-20261105.json"),"utf8"));
const copy=()=>structuredClone(obs);
test("P4-P1 real JARVIS clean+EICAR controls unavailable, hard HOLD",()=>{
 const out=localProviderObservation();
 assert.equal(out.scannerActualBehaviorObserved,false);
 assert.equal(out.verifiedProviderChecks,0);
 assert.equal(out.requiredProviderChecks,15);
 assert.equal(out.releaseDecision,"HOLD");
 assert.ok(out.blockers.includes("REAL_CLAMAV_CLEAN_EICAR_NOT_OBSERVED"));
 assert.ok(out.blockers.includes("GOOGLE_PLACES_BILLING_NOT_CERTIFIED"));
});
test("P4-P2 unverified live WhatsApp OTP, private storage and Owner MFA are never treated as ready",()=>{
 const out=localProviderObservation();
 for(const field of ["canSendWhatsapp","canEnablePrivateEvidence","canEnableVendorSignup",
  "canDeploy","actualProviderCertification","managedStorageCertified","ownerActualAal2Certified"])
  assert.equal(out[field],false,field);
 assert.equal(out.providerMessagesSent,0);
 assert.equal(out.credentialsExposed,false);
});
test("P4-P3 a forged provider observation or unauthorized action fails closed",()=>{
 for(const action of [
  s=>{s.secretsRead=true;},s=>{s.providerMessagesSent=1;},
  s=>{s.managedSystemsChanged=1;},s=>{s.releaseDecision="GO";},
  s=>{s.authz.stagingGoApproved=true;},s=>{delete s.whatsapp.signedHook;},
 ]){
  const x=copy();action(x);
  assert.throws(()=>assessP4ProviderObservation(x),/P4_PROVIDER_/);
 }
});
test("P4-P4 even all separately mocked provider flags don't authorize managed rollout",()=>{
 const x=copy();
 x.scanner.certified=true;x.scanner.behaviorObserved=true;
 for(const category of ["whatsapp","googlePlaces","privateStorage","owner"])
  for(const name of Object.keys(x[category]))x[category][name]="verified";
 const out=assessP4ProviderObservation(x);
 assert.equal(out.verifiedProviderChecks,15);
 assert.equal(out.canSendWhatsapp,false);
 assert.equal(out.canDeploy,false);
 assert.ok(out.blockers.includes("SEPARATE_OWNER_APPROVAL_AND_RECOVERY_REQUIRED"));
});
test("P4-P5 actual vendor OTP and private form source retain independent OFF switches",()=>{
 const r=p=>readFileSync(resolve(root,p),"utf8");
 const otp=r("app/api/vendor/onboarding/request-otp/route.ts");
 const complete=r("app/api/vendor/onboarding/complete/route.ts");
 const evidence=r("app/api/vendor/private-evidence/route.ts");
 const owner=r("apps/vox-web/lib/ownerVendorVerification.ts");
 for(const flag of ["QF_VENDOR_OTP_REQUEST_MODE","QF_VENDOR_WHATSAPP_PROVIDER_CERTIFIED","QF_VENDOR_SHARED_SIGNED_HOOK_CERTIFIED"])
  assert.match(otp,new RegExp(flag));
 assert.match(complete,/QF_VENDOR_ATOMIC_SIGNUP_MODE/);
 assert.match(complete,/QF_VENDOR_OTP_VERIFY_MODE/);
 assert.match(evidence,/QF_VENDOR_PRIVATE_EVIDENCE_MODE/);
 assert.match(evidence,/QF_VENDOR_PRIVATE_BUCKET_CERTIFIED/);
 assert.match(owner,/VOX_OWNER_VENDOR_REVIEW_ENABLED/);
 assert.match(owner,/VOX_OWNER_VENDOR_DECISION_ENABLED/);
});
