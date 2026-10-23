// Source-only RLS prioritization. No session impersonation, managed SQL or simulated approvals.
import assert from "node:assert/strict";
import {readFileSync,writeFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const SOURCE="ops/vox/certification/STEP3B7-STAGING-RLS-READONLY-20261023.json";
const MATRIX="ops/vox/certification/STEP3B7-POLICY-DECISION-MATRIX-20261023.json";
const SHA=x=>createHash("sha256").update(readFileSync(resolve(ROOT,x))).digest("hex").toUpperCase();
const DATA=x=>JSON.parse(readFileSync(resolve(ROOT,x),"utf8"));
export function effectiveRlsReview(snapshot=DATA(SOURCE),matrix=DATA(MATRIX)){
 assert.equal(snapshot.policies.length,69);
 assert.equal(matrix.policies.length,69);
 const ids=new Set(matrix.policies.map(x=>x.id));
 const grouped=new Map();
 const decisions=snapshot.policies.map(x=>{
  const id=x.schemaname+"."+x.tablename+"."+x.policyname;
  assert.ok(ids.delete(id),"Policy mismatch/duplicate "+id);
  assert.equal(x.decision,"UNREVIEWED");
  assert.equal(x.effectiveAccessCertified,false);
  assert.equal(x.independentAppsecApproved,false);
  assert.equal(x.ownerStagingApproval,false);
  const write=x.cmd!=="SELECT";
  const existing=grouped.get(x.tablename)||[];
  existing.push(id);grouped.set(x.tablename,existing);
  const predicate=x.using_expression||"";
  const check=x.with_check_expression||"";
  return {id,table:x.tablename,command:x.cmd,permissive:x.permissive,
   helperAdmin:x.has_admin,helperVendor:x.has_vendor,
   priority:write?"P0_MUTATING_OR_ALL":"P1_READ_OR_HISTORY",
   sourceUsingSha256:createHash("sha256").update(predicate).digest("hex"),
   sourceWithCheckSha256:createHash("sha256").update(check).digest("hex"),
   testScenarios:[
    "active-in-scope-user-expected-allow-review",
    "inactive-admin-expected-deny",
    "cross-tenant-user-expected-deny",
    "revoked-or-stale-staff-session-expected-deny",
    ...(x.has_vendor?["suspended-vendor-new-work-denied","historical-invoice-dispute-read-model-review"]:[]),
    ...(write?["invalid-insert-update-with-check-denied","revoked-user-write-denied"]:[]),
    "verify-OR-AND-with-all-other-table-policies-and-grants"
   ],
   actualDatabaseTestRun:false,
   observedEffectivePermission:null,
   decision:"PENDING_INDEPENDENT_APPSEC",reviewer:null,signature:null};
 });
 assert.equal(ids.size,0);
 assert.equal(grouped.size,40);
 assert.equal(decisions.filter(x=>x.priority.startsWith("P0")).length,37);
 assert.equal(decisions.filter(x=>x.priority.startsWith("P1")).length,32);
 return {schema:"qf.vox.step3b9e.effective-rls-prep.v1",releaseStatus:"HOLD",
  snapshotSha256:SHA(SOURCE),matrixSha256:SHA(MATRIX),
  lastReadOnlyLiveObservation:{affectedPolicies:69,affectedTables:40,writeOrAll:37,
   affectedPoliciesOnTablesWithMultipleTotalPolicies:53,
   affectedWithRestrictiveTablePolicy:0,
   source:"2026-10-23 SELECT-only managed Staging pg_policies aggregation",
   completeness:"AGGREGATE_ONLY_NOT_FULL_POLICY_SET"},
  affectedTableGroups:[...grouped.entries()].map(([table,policyIds])=>({table,affectedPolicyCount:policyIds.length,
   affectedPolicyIds:policyIds,
   allTablePoliciesEnumerated:false,effectiveOrAndReproduced:false,
   perRoleGrantVerified:false,actualPositiveNegativeSqlEvidence:null,
   decision:"PENDING_INDEPENDENT_APPSEC"})),
  decisions,independentAppsecSigned:false,managedRlsChangesApproved:false,
  warning:"Per-table affected subset is NOT full effective-policy composition. Need all pg_policies, grants and tested sessions before authorization."
 };
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const output=effectiveRlsReview();
 writeFileSync(resolve(ROOT,"ops/vox/certification/STEP3B9E-EFFECTIVE-RLS-REVIEW-20261023.json"),JSON.stringify(output,null,2)+"\n");
 console.log("STEP3B9E_RLS_REVIEW 69 policies 40 tables 37 write/ALL 32 read, actual_tests=0, HOLD");
}
