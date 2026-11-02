import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const source=readFileSync(new URL("../../../components/admin/LeadMatchingAuditPanels.tsx",import.meta.url),"utf8");
test("actual comment action is Core-authorized metadata under the persisted original-report guard",()=>{
 const comment=source.split("function addComment(")[1]?.split("function generateRecoveryRecommendation(")[0]??"";
 assert.match(comment,/runGovernedMetadata\(report,"Report comment added"/);
 assert.match(comment,/adminAddVendorLeadReportComment\(report.id,comment\)/);
 const guarded=source.split("function runGovernedMetadata(")[1]?.split("function updateStatus(")[0]??"";
 assert.match(guarded,/markBadLeadPending\(badLeadSessionStore\(\),report.id\)/);
 assert.ok(guarded.indexOf("markBadLeadPending(badLeadSessionStore(),report.id)")<
  guarded.indexOf("await write()"));
 assert.ok(guarded.indexOf("clearBadLeadPending(badLeadSessionStore(),report.id)")>
  guarded.indexOf("await write()"));
 assert.match(guarded,/if\(!result.ok\)/);
 assert.match(guarded,/recoveryNeedsReview.current.add\(report.id\)/);
 assert.doesNotMatch(comment,/adminApplyBadLeadRecovery/);
});
