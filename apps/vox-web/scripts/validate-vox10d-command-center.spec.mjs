import test from "node:test";import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const src=readFileSync(new URL("../app/team/command-center/page.tsx",import.meta.url),"utf8");
const home=readFileSync(new URL("../app/team/page.tsx",import.meta.url),"utf8");
test("command center reuses three independently authenticated Core readers",()=>{
 assert.match(src,/fetchStaffWorkQueuePreview/);
 assert.match(src,/fetchStaffNotifications/);
 assert.match(src,/fetchStaffEodPreview/);
 assert.match(src,/Promise\.all/);
});
test("one existing Staff session and no new Auth/provisioner",()=>{
 assert.doesNotMatch(src,/createClient\(|signUp\(|newAuth\(|service_role|SERVICE_ROLE_KEY/);
 assert.match(home,/href:"\/team\/command-center"/);
});
test("all existing governed operation routes represented",()=>{
 for(const path of ["/team/work-queue","/team/attention","/team/chat",
  "/team/notifications","/team/daily-report","/team/eod-submissions",
  "/team/eod-reviews","/acquisition","/vendor360","/service-desk"]){
  assert.equal(src.includes(path),true,path);
 }
});
test("Riya client action stays explicitly blocked",()=>{
 assert.match(src,/Client handover actions disabled/);
 assert.doesNotMatch(src,/sendWhatsApp\(|sendMessage\(|approveRiya\(/);
});
test("locked branches and no fabricated totals",()=>{
 assert.match(src,/Operations data is locked/);
 assert.match(src,/eod\.ok\?String\(eod\.eventsIncluded\)/);
 assert.match(src,/company-wide totals/i);
 assert.doesNotMatch(src,/Math\.random\(|mockData|fakeCount/);
});
