import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(new URL(p,import.meta.url),"utf8");
test("Core receipt echoes the exact verified incoming nonce without accepting arbitrary body keys",()=>{
 const route=read("../../../app/api/vox/v1/eod-submissions/route.ts");
 assert.match(route,/Object.keys\(parsed\).sort\(\).join\("\|"\)!=="businessDate\|nonce"/);
 assert.match(route,/p_nonce:parsed.nonce/);
 assert.match(route,/reportId:r.report_id,nonce:parsed.nonce,businessDate:parsed.businessDate/);
 assert.match(route,/externalMessagesSent:0,staffPrivilegesChanged:false/);
});
test("real BFF rejects mismatching Core original nonce before clearing browser EOD checkpoint",()=>{
 const bff=read("../lib/teamWorkflow.ts");
 const part=bff.split("export async function submitMyPartialEod(")[1]?.split("export async function fetchTlEodQueue")[0]??"";
 assert.match(part,/requestCore\("eod-submissions",\{nonce,businessDate\}\)/);
 assert.match(part,/x.nonce!==nonce/);
 assert.match(part,/status:200,reportId:x.reportId,nonce,businessDate/);
 const browser=read("../app/team/eod-submissions/SubmitPartial.tsx");
 assert.match(browser,/data.nonce!==item.nonce/);
 assert.ok(browser.indexOf("data.nonce!==item.nonce")<browser.indexOf("clearPendingEodSubmission(store(),item)"));
 assert.match(browser,/savePendingEodSubmission\(store\(\),item\)/);
});
