import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {ownerVendorReadGate,ownerVendorDecisionGate} from "../lib/ownerVendorReviewGate.ts";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const read=p=>readFileSync(resolve(root,p),"utf8");
const base=Object.freeze({
 VOX_STAFF_PORTAL_ENABLED:"staging",
 VOX_STAFF_VIEW_MODE:"owner",
 VOX_OWNER_VENDOR_REVIEW_ENABLED:"staging",
 VOX_OWNER_VENDOR_DECISION_ENABLED:"disabled"
});

test("VOX-G1 default OFF denies Owner read and decisions",()=>{
 assert.equal(ownerVendorReadGate({}),false);
 assert.equal(ownerVendorDecisionGate({}),false);
 assert.equal(ownerVendorDecisionGate({VOX_OWNER_VENDOR_DECISION_ENABLED:"staging"}),false);
});
test("VOX-G2 Owner Staging read is independent of decision write",()=>{
 assert.equal(ownerVendorReadGate(base),true);
 assert.equal(ownerVendorDecisionGate(base),false);
 assert.equal(ownerVendorDecisionGate({...base,VOX_OWNER_VENDOR_DECISION_ENABLED:"staging"}),true);
});
test("VOX-G3 Staff scoped and dual modes NEVER inherit Owner-only verification",()=>{
 for(const mode of ["disabled","scoped","dual","staff","OWNER",""]){
  assert.equal(ownerVendorReadGate({...base,VOX_STAFF_VIEW_MODE:mode}),false,mode);
  assert.equal(ownerVendorDecisionGate({...base,VOX_STAFF_VIEW_MODE:mode,
    VOX_OWNER_VENDOR_DECISION_ENABLED:"staging"}),false,mode);
 }
});
test("VOX-G4 each independent Owner feature flag is necessary",()=>{
 assert.equal(ownerVendorReadGate({...base,VOX_STAFF_PORTAL_ENABLED:"disabled"}),false);
 assert.equal(ownerVendorReadGate({...base,VOX_OWNER_VENDOR_REVIEW_ENABLED:"disabled"}),false);
 assert.equal(ownerVendorDecisionGate({...base,VOX_OWNER_VENDOR_DECISION_ENABLED:"disabled"}),false);
});
test("VOX-G5 Staff lanes require scoped/dual and separate Team feature gate",()=>{
 for(const path of ["apps/vox-web/lib/teamWorkflow.ts","apps/vox-web/lib/staffTime.ts"]){
  const code=read(path);
  assert.match(code,/\["scoped","dual"\]\.includes\(String\(process\.env\.VOX_STAFF_VIEW_MODE\)\)/);
  assert.match(code,/VOX_TEAM_WORKSPACE_ENABLED==="staging"/);
 }
 const bridge=read("apps/vox-web/lib/ownerVendorVerification.ts");
 assert.match(bridge,/ownerVendorReadGate\(process\.env\)/);
 assert.match(bridge,/ownerVendorDecisionGate\(process\.env\)/);
 assert.match(bridge,/verifiedMfaSession\(\)/);
 assert.match(bridge,/requiresSeparateCoreVendorApproval/);
 assert.doesNotMatch(bridge,/service_role|SUPABASE_SERVICE_ROLE_KEY|getPublicUrl/);
});
test("VOX-G6 no demo, direct finance/assignment or public document authority introduced",()=>{
 const gate=read("apps/vox-web/lib/ownerVendorReviewGate.ts");
 assert.doesNotMatch(gate,/assignLead|insert\s+into|update\s+vendors|fetch\(|service_role|createSignedUrl/);
 const bridge=read("apps/vox-web/lib/ownerVendorVerification.ts");
 assert.match(bridge,/canActivateLeads!==false/);
 assert.match(bridge,/canViewPrivateDocuments!==false/);
});
