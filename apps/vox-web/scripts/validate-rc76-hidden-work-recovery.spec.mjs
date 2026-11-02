import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(new URL(p,import.meta.url),"utf8");
test("only authorized, action-gated Staff work queue shows missing original nonce notice",()=>{
 const page=read("../app/team/work-queue/page.tsx");
 const notice=read("../app/team/work-queue/PendingWorkNotice.tsx");
 assert.match(page,/actionUiEnabled\?<PendingWorkNotice visibleWorkItemIds=\{result.items.map\(item=>item.workItemId\)\}/);
 assert.match(notice,/readPendingWork\(storage\)/);
 assert.match(notice,/ids.filter\(id=>!visibleWorkItemIds.includes\(id\)\)/);
 assert.match(notice,/outside this bounded authorized Core queue/);
 assert.match(notice,/Local storage does not prove that Core committed/);
 assert.doesNotMatch(notice,/fetch\(|savePendingWork\(|clearPendingWork\(|crypto\.randomUUID\(/);
});
test("private-mode storage failure gives explicit blocking warning",()=>{
 const notice=read("../app/team/work-queue/PendingWorkNotice.tsx");
 assert.match(notice,/if\(!available\)return <p role="alert"/);
 assert.match(notice,/Do not submit a new command without human Core reconciliation/);
});
