import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const src=p=>readFileSync(resolve(root,p),"utf8");
const actions=src("app/actions.ts");
const admin=src("services/adminService.ts");
const credit=src("services/badLeadRecoveryService.ts");
const section=actions.split("export const adminApplyBadLeadRecovery = async (")[1]?.split("export const adminAddVendorLeadReportComment")[0]??"";
test("credit mutator is permanently hard OFF until reviewed installation",()=>{
 assert.match(credit,/export const RC43_BAD_LEAD_ATOMIC_RPC_INSTALLED=false as const/);
 assert.match(credit,/if\(!RC43_BAD_LEAD_ATOMIC_RPC_INSTALLED\s*\|\|/);
 assert.match(credit,/QF_VOX_BAD_LEAD_CREDIT_ONLY_ATOMIC_ENABLED/);
});
test("real admin action binds current verified Owner AAL2 to superadmin actor BEFORE credit RPC",()=>{
 assert.match(section,/asAdmin\(async \(actor\) =>/);
 assert.match(section,/auth\.getSession\(\)/);
 assert.match(section,/verifyVoxOwnerBearer\("Bearer " \+ session\.access_token\) !== actor/);
 assert.ok(section.indexOf("verifyVoxOwnerBearer(")<section.indexOf("badLeadRecovery.applyBadLeadRecovery("));
 assert.match(section,/catch \{ return fail\(appError\("UNAUTHORIZED"\)\); \}/);
});
test("approval is human decision only, with reviewer, no money and no silent partial update",()=>{
 const scope=admin.split("export async function approveBadLeadReport(")[1]?.split("export async function rejectBadLeadReport(")[0]??"";
 assert.match(scope,/if \(!actorUserId\) throw appError\("UNAUTHORIZED"\)/);
 assert.match(scope,/status: "Approved"/);
 assert.match(scope,/reviewed_by: actorUserId/);
 assert.match(scope,/\.eq\("status", "Pending"\)\.select\("id"\)\.maybeSingle\(\)/);
 assert.match(scope,/if \(approved\.error\) throw approved\.error/);
 assert.match(scope,/if \(!approved\.data\) throw appError/);
 assert.doesNotMatch(scope,/vendor_credit_logs|remaining_credits|refund|razorpay|qf_approve_credit_restoration_v2/i);
});
test("rejection requires authenticated actor and does not touch a ledger",()=>{
 const scope=admin.split("export async function rejectBadLeadReport(")[1]?.split("export async function getPendingBadLeadReports(")[0]??"";
 assert.match(scope,/if \(!actorUserId\) throw appError\("UNAUTHORIZED"\)/);
 assert.match(scope,/reviewed_by: actorUserId/);
 assert.match(scope,/\.in\("status",\["Pending","Under Review"\]\)/);
 assert.match(scope,/if\(!data\) throw appError/);
 assert.doesNotMatch(scope,/vendor_credit_logs|remaining_credits|razorpay|qf_approve_credit_restoration_v2/i);
});
test("all active Admin handlers pass the authenticated actor into review decisions",()=>{
 assert.match(actions,/asAdmin\(\(actor\) => admin\.approveBadLeadReport\(id, note, actor\)\)/);
 assert.match(actions,/asAdmin\(\(actor\) => admin\.rejectBadLeadReport\(id, note, actor\)\)/);
});
