import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {assessBetaVendorReadiness} from "../../lib/vendors/betaVendorReadinessEvidence.ts";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const complete=Object.freeze({
 status:"Approved",isActive:true,publicVisible:true,acceptingLeads:true,
 authIdentityLinked:true,credits:3,googlePlaceServerVerified:true,
 serviceZoneServerVerified:true,officeLocationStatus:"verified",
 approvedServiceCategories:1,identityAttestedByApprovedProvider:true,
 aadhaarConsentAttested:true,ownerApprovalRecorded:true,
});
test("D1 no evidence is ever treated as onboarding ready",()=>{
 const r=assessBetaVendorReadiness({});
 assert.equal(r.ready,false);assert.equal(r.blockers.length,13);
 assert.equal(r.mode,"ADVISORY_ONLY");
});
test("D2 complete independently attested synthetic evidence can be marked planning-ready",()=>{
 const r=assessBetaVendorReadiness(complete);
 assert.equal(r.ready,true);assert.equal(r.blockers.length,0);
});
test("D3 each mandatory field independently denies onboarding",()=>{
 for(const [key,value] of Object.entries(complete)){
  const broken={...complete,[key]:typeof value==="boolean"?false:
    typeof value==="number"?0:null};
  assert.equal(assessBetaVendorReadiness(broken).ready,false,key);
 }
});
test("D4 negative, fractional and nonnumeric credits always deny",()=>{
 for(const credits of [-1,0,0.5,NaN,Infinity]){
  assert.ok(assessBetaVendorReadiness({...complete,credits}).blockers.includes("INSUFFICIENT_CREDITS"));
 }
});
test("D5 a generic Verified vendor flag cannot replace approved identity attestation",()=>{
 const r=assessBetaVendorReadiness({...complete,identityAttestedByApprovedProvider:false});
 assert.equal(r.ready,false);
 assert.ok(r.blockers.includes("IDENTITY_ATTESTATION_MISSING"));
});
test("D6 no Aadhaar identifiers, documents, OTP or tokens are logged by the pure gate",()=>{
 const src=readFileSync(resolve(root,"lib/vendors/betaVendorReadinessEvidence.ts"),"utf8");
 assert.doesNotMatch(src,/aadhaar_number|aadhaarNumber|aadhaarOtp|aadhaarDocument|rawAadhaar|authToken|documentUrl/);
 assert.doesNotMatch(src,/adminClient|fetch\(|console\.log|insert\(|update\(/);
});
