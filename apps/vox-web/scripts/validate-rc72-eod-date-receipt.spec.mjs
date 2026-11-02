import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(new URL(p,import.meta.url),"utf8");
test("Web BFF echoes exactly the India business date used for its Core command",()=>{
 const src=read("../lib/teamWorkflow.ts");
 const post=src.split("export async function submitMyPartialEod(")[1]?.split("export async function fetchTlEodQueue")[0]??"";
 assert.match(post,/const businessDate=today\(\)/);
 assert.match(post,/requestCore\("eod-submissions",\{nonce,businessDate\}\)/);
 assert.match(post,/status:200,reportId:x.reportId,businessDate/);
 assert.match(post,/x\.externalMessagesSent!==0/);
 assert.match(post,/x\.staffPrivilegesChanged!==false/);
});
test("browser fails closed if BFF/Core accepted another business date, original nonce stays locked",()=>{
 const src=read("../app/team/eod-submissions/SubmitPartial.tsx");
 assert.match(src,/data\.businessDate!==item.businessDate/);
 assert.match(src,/businessDate\|completeness\|eventCount\|ok\|reportId\|revision\|state\|status/);
 assert.ok(src.indexOf("data.businessDate!==item.businessDate")<
  src.indexOf("clearPendingEodSubmission(store(),item)"));
 assert.match(src,/pending\.current\.businessDate!==businessDate/);
 assert.match(src,/Core receipt unverified/);
});
