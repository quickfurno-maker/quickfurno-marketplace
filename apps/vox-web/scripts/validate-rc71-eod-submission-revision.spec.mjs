import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(new URL(p,import.meta.url),"utf8");
test("real EOD Web Core adapter carries revision after validated Core receipt and enforces state parity",()=>{
 const src=read("../lib/teamWorkflow.ts");
 const body=src.split("export async function submitMyPartialEod(")[1]?.split("export async function fetchTlEodQueue")[0]??"";
 assert.match(body,/x\.state==="PENDING_REVIEW"&&x\.revision!==0/);
 assert.match(body,/x\.state!=="PENDING_REVIEW"&&x\.revision!==1/);
 assert.match(body,/revision:x\.revision as 0\|1/);
 assert.match(body,/x\.externalMessagesSent!==0/);
 assert.match(body,/x\.staffPrivilegesChanged!==false/);
});
test("actual Staff browser requires the revision before clearing original nonce",()=>{
 const src=read("../app/team/eod-submissions/SubmitPartial.tsx");
 assert.match(src,/completeness\|eventCount\|nonce\|ok\|reportId\|revision\|state\|status/);
 assert.match(src,/data\.state==="PENDING_REVIEW"&&data\.revision!==0/);
 assert.match(src,/data\.state!=="PENDING_REVIEW"&&data\.revision!==1/);
 assert.ok(src.indexOf('data.revision!==1')<src.indexOf('clearPendingEodSubmission(store(),item)'));
});
