import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(new URL(p,import.meta.url),"utf8");
test("actual Team Leader queue displays unresolved same-tab original decisions not present among 16 pending",()=>{
 const page=read("../app/team/eod-reviews/page.tsx");
 const notice=read("../app/team/eod-reviews/PendingReviewNotice.tsx");
 assert.match(page,/PendingReviewNotice visibleReportIds=\{r.pending.map\(item=>item.reportId\)\}/);
 assert.ok(page.indexOf("PendingReviewNotice visibleReportIds")>page.indexOf("!r.ok?"));
 assert.match(notice,/readPendingTlReviews\(store\)/);
 assert.match(notice,/ids.filter\(id=>!visibleReportIds.includes\(id\)\)/);
 assert.match(notice,/no longer in the bounded pending queue/);
 assert.match(notice,/Local checkpoints are not proof that Core committed/);
 assert.doesNotMatch(notice,/fetch\(|clearPendingTlReview\(|savePendingTlReview\(|crypto\.randomUUID\(/);
});
test("unavailable/corrupt storage visibly fails closed",()=>{
 const notice=read("../app/team/eod-reviews/PendingReviewNotice.tsx");
 assert.match(notice,/readPendingTlReviews\(store\)/);
 assert.match(notice,/if\(!available\)return <p className="voxFlowError" role="alert">/);
 assert.match(notice,/Do not send another decision before manual Core reconciliation/);
});
