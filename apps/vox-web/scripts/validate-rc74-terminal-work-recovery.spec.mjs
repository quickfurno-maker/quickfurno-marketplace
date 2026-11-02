import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const ui=readFileSync(new URL("../app/team/work-queue/WorkActionControl.tsx",import.meta.url),"utf8");
test("actual Core terminal state cannot hide a preserved original pending nonce",()=>{
 const branch=ui.split('if(options.length===0)return')[1]?.split('const needsReason=')[0]??"";
 assert.match(branch,/role="status"/);
 assert.match(branch,/\{message\?<p>\{message\}<\/p>:null\}/);
 assert.match(branch,/\{uncertain\?<p>/);
 assert.match(branch,/Team Leader must reconcile its Core receipt/);
 assert.match(branch,/No new command was sent/);
 assert.match(branch,/\{expired\?<Link href=/);
 assert.doesNotMatch(branch,/fetch\(|clearPendingWork\(|savePendingWork\(|router\.refresh\(/);
});
test("true Core result is still the only way to clear the same-tab command nonce",()=>{
 assert.ok(ui.indexOf("isVerifiedWorkReceipt(body")<ui.indexOf("clearPendingWork(tabStore()"));
 assert.ok(ui.indexOf("savePendingWork(tabStore()")<ui.indexOf('fetch("/api/work-transitions"'));
 assert.match(ui,/if\(!clearPendingWork\(tabStore\(\),itemId,pending.current.nonce\)\)/);
 assert.match(ui,/if\(options.length===0\)return/);
});
