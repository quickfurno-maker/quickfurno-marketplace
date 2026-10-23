// Read-only policy evidence transformation; no DB client, migrations or releases.
import assert from "node:assert/strict";
import {readFileSync,writeFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const input=resolve(ROOT,"ops/vox/certification/STEP3B7-STAGING-RLS-READONLY-20261023.json");
const output=resolve(ROOT,"ops/vox/certification/STEP3B7-POLICY-DECISION-MATRIX-20261023.json");
function category(p){
 const name=p.tablename.toLowerCase();
 if(["INSERT","UPDATE","DELETE","ALL"].includes(p.cmd))return "MUTATION_REVIEW";
 if(/payment|package|invoice|refund/.test(name))return "FINANCE_HISTORY_REVIEW";
 if(/support|report|notification|whatsapp|activity_log|delivery_log/.test(name))return "HISTORIC_VENDOR_READ_REVIEW";
 if(/lead_assign|lead_status/.test(name))return "LEAD_ACCESS_REVIEW";
 return "GENERAL_READ_REVIEW";
}
export function auditPolicyEvidence(data){
 assert.equal(data.schema,"qf.step3b7.staging-rls.metadata.v1");
 assert.equal(data.managedChangeAuthorized,false);
 assert.equal(data.independentAppsecApproved,false);
 const all=data.policies;
 assert.equal(all.length,69);
 const admin=all.filter(x=>x.has_admin),vendor=all.filter(x=>x.has_vendor);
 assert.equal(admin.length,59);assert.equal(vendor.length,22);
 assert.equal(all.filter(x=>x.has_admin&&x.has_vendor).length,12);
 const ids=new Set(), matrix=all.map(row=>{
  const id=[row.schemaname,row.tablename,row.policyname].join(".");
  assert.ok(!ids.has(id),"DUPLICATE_POLICY_ID");ids.add(id);
  assert.ok(["ALL","SELECT","INSERT","UPDATE","DELETE"].includes(row.cmd));
  assert.ok(typeof row.using_expression==="string"&&typeof row.with_check_expression==="string");
  const text=[row.using_expression,row.with_check_expression].join(" ");
  const mentionsStatus=/(is_active|status|suspend)/i.test(text);
  const kind=category(row);
  return {id,cmd:row.cmd,permissive:row.permissive,roles:row.roles,
   referencesAdmin:row.has_admin,referencesVendor:row.has_vendor,
   accessClass:kind,visibleStatusTerms:mentionsStatus,
   crossPolicyOrAndAnalyzed:false,
   policyDecision:"PENDING_INDEPENDENT_APPSEC_AND_DOMAIN_OWNER",
   signedReviewer:null,approvedMigrationSha:null,
   effectiveRlsNegativeTestPassed:false,
   managedPolicyChangeAuthorized:false};
 });
 return {schema:"qf.step3b7.rls.policy-review.v1",
  capturedFrom:"2026-10-23 STAGING SELECT-only pg_policies",
  distinctPolicies:69,adminReferences:59,vendorReferences:22,overlap:12,
  signedIndependentAppsec:false,allPoliciesReviewed:false,
  actualManagedRlsCertified:false,managedMigrationAuthorized:false,
  releaseStatus:"HOLD",policies:matrix};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const evidence=JSON.parse(readFileSync(input,"utf8"));
 const result=auditPolicyEvidence(evidence);
 writeFileSync(output,JSON.stringify(result,null,2)+"\n");
 console.log("STEP3B7_POLICY_MATRIX_BUILD "+result.policies.length+"/69 REVIEW_PENDING");
}
