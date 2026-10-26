import test from "node:test";import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const file=p=>readFileSync(new URL("../../../app/api/vox/v1/"+p+"/route.ts",import.meta.url),"utf8");
test("RC1 work queue checks fresh Core Staff identity AND exact grants before both empty and populated responses",()=>{
 const s=file("work-queue");
 const early=s.indexOf("if(!verifiedProspectIds.length");
 const first=s.indexOf("unchangedAuthorizedStaffScope(scope,refreshed)");
 const candidates=s.indexOf('from("vox_work_items_candidate_v1")');
 const last=s.lastIndexOf("unchangedAuthorizedStaffScope(scope,refreshed)");
 const response=s.lastIndexOf("return send(result,200)");
 assert.ok(early>=0&&first>early&&first<candidates);
 assert.ok(last>candidates&&response>last);
 assert.match(s,/WORK_QUEUE_SCOPE_REVOKED_DURING_READ/);
});
test("RC1 internal notification inbox rechecks current Staff/Team/grants after Core RPC",()=>{
 const s=file("staff-notifications");
 const rpc=s.indexOf('rpc("qf_vox_staff_notification_inbox_v1"');
 const current=s.indexOf("const refreshed=await getVerifiedScopedStaff(");
 const response=s.indexOf('schema:"qf.vox.staff.work-notifications.inbox.v1"');
 assert.ok(rpc>0&&current>rpc&&response>current);
 assert.match(s,/NOTIFICATION_SCOPE_REVOKED_DURING_READ/);
 assert.match(s,/unchangedNotificationScope\(staff,refreshed\)/);
});
