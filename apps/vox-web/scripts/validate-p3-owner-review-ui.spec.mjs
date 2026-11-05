import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {
 canOfferOwnerCaseApproval,isOwnerCaseEnvelope,isOwnerQueueEnvelope
} from "../lib/ownerReviewUiGuard.ts";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const read=p=>readFileSync(resolve(root,p),"utf8");
const id="11111111-1111-4111-8111-111111111111";
const row={
 vendorId:id,caseVersion:2,caseState:"pending",submittedAt:"2026-11-05T00:00:00Z",
 contactStatus:"verified",identityStatus:"pending",officeStatus:"pending",
 categoryStatus:"pending",zoneStatus:"pending",consentValid:true,
 pendingScanCount:0,rejectedScanCount:0
};
const envelope={ok:true,schema:"qf.vox.owner.vendor-review-bff.v1",limit:20,pending:[row]};
const full={
 vendorId:id,casePresent:true,caseVersion:2,caseState:"under_review",
 contactStatus:"verified",identityStatus:"verified",officeStatus:"verified",
 categoryStatus:"verified",zoneStatus:"verified",consentValid:true,
 identityEvidenceVerified:true,officeEvidenceVerified:true,
 readyForCoreApproval:true
};
const cEnv={ok:true,schema:"qf.vox.owner.vendor-case-bff.v1",case:full};
test("P3-UX1 exact 20-item queue contract, no PII or unknown extras",()=>{
 assert.equal(isOwnerQueueEnvelope(envelope),true);
 assert.equal(isOwnerQueueEnvelope({...envelope,pending:[]}),true);
 for(const bad of [
  {...envelope,pending:[{...row,phone:"+919876543210"}]},
  {...envelope,pending:[row,row]},
  {...envelope,pending:[{...row,caseVersion:0}]},
  {...envelope,pending:Array.from({length:21},()=>row)},
  {...envelope,pending:[{...row,privateDocumentUrl:"https://bad.example"}]},
  {...envelope,limit:100}, {...envelope,evil:true},
  {...envelope,pending:[{...row,submittedAt:"unknown"}]},
 ])assert.equal(isOwnerQueueEnvelope(bad),false);
});
test("P3-UX2 case envelope requires Core case schema, exact vendor and no private keys",()=>{
 assert.equal(isOwnerCaseEnvelope(cEnv,id),true);
 assert.equal(isOwnerCaseEnvelope(cEnv,"22222222-2222-4222-8222-222222222222"),false);
 for(const bad of [
  {...cEnv,case:{...full,storageKey:"vendors/private"}},
  {...cEnv,case:{...full,caseVersion:0}},
  {...cEnv,case:{...full,caseState:"credited"}},
  {...cEnv,case:{...full,identityStatus:"approved"}},
  {...cEnv,case:{...full,vendorId:"not-uuid"}},
  {...cEnv,adminRole:"Superadmin"}
 ])assert.equal(isOwnerCaseEnvelope(bad,id),false);
});
test("P3-UX3 no-case snapshot allowed only if all authority fields remain unset",()=>{
 const none={
  ...full,casePresent:false,caseVersion:null,caseState:null,
  contactStatus:null,identityStatus:null,officeStatus:null,
  categoryStatus:null,zoneStatus:null,consentValid:false,
  identityEvidenceVerified:false,officeEvidenceVerified:false,
  readyForCoreApproval:false
 };
 assert.equal(isOwnerCaseEnvelope({...cEnv,case:none},id),true);
 assert.equal(canOfferOwnerCaseApproval(none),false);
 assert.equal(isOwnerCaseEnvelope({...cEnv,case:{...none,readyForCoreApproval:true}},id),false);
});
test("P3-UX4 UI approval requires explicit Core readiness independently of five stages",()=>{
 assert.equal(canOfferOwnerCaseApproval(full),true);
 for(const changed of [
  {readyForCoreApproval:false},{consentValid:false},
  {identityEvidenceVerified:false},{officeEvidenceVerified:false},
  {contactStatus:"pending"},{identityStatus:"pending"},{officeStatus:"rejected"},
  {categoryStatus:"expired"},{zoneStatus:"pending"},
  {caseState:"approved"},{caseState:"rejected"},{caseVersion:0}
 ])assert.equal(canOfferOwnerCaseApproval({...full,...changed}),false,JSON.stringify(changed));
});
test("P3-UX5 Owner console auto-loads, validates BFF, and never fetches a document",()=>{
 const code=read("app/owner/vendors/verification/OwnerReviewConsole.tsx");
 assert.match(code,/useEffect\(\(\)=>\{void loadQueue\(\);\},\[loadQueue\]\)/);
 assert.match(code,/isOwnerQueueEnvelope\(data\)/);
 assert.match(code,/isOwnerCaseEnvelope\(data,id\)/);
 assert.match(code,/canOfferOwnerCaseApproval\(selected\)/);
 assert.match(code,/caseVersion:selected\.caseVersion/);
 assert.doesNotMatch(code,/\.storage\.|getPublicUrl|createSignedUrl|fetch\(["']https:\/\//);
});
test("P3-UX6 service Core and hard-off Owner flags preserved in server page",()=>{
 const page=read("app/owner/vendors/verification/page.tsx");
 assert.match(page,/ownerVendorReviewReadEnabled\(\)/);
 assert.match(page,/verifiedMfaSession\(\)/);
 assert.match(page,/ownerVendorDecisionEnabled\(\)/);
 assert.match(page,/withReturn\("\/login","\/owner\/vendors\/verification"\)/);
 const bridge=read("lib/ownerVendorVerification.ts");
 const gate=read("lib/ownerVendorReviewGate.ts");
 assert.match(gate,/VOX_OWNER_VENDOR_REVIEW_ENABLED==="staging"/);
 assert.match(gate,/VOX_OWNER_VENDOR_DECISION_ENABLED==="staging"/);
 assert.match(bridge,/ownerVendorReadGate\(process\.env\)/);
 assert.match(bridge,/ownerVendorDecisionGate\(process\.env\)/);
 assert.match(bridge,/OWNER_MFA_REQUIRED/);
});
