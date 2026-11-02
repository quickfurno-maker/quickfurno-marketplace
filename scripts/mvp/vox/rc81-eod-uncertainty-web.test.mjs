import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const web=readFileSync(new URL("../../../apps/vox-web/lib/teamWorkflow.ts",import.meta.url),"utf8");
const submit=readFileSync(new URL("../../../apps/vox-web/app/team/eod-submissions/SubmitPartial.tsx",import.meta.url),"utf8");
const review=readFileSync(new URL("../../../apps/vox-web/app/team/eod-reviews/ReviewDecision.tsx",import.meta.url),"utf8");
test("Web BFF preserves only exact verified Core uncertainty for both EOD operations",()=>{
 for(const field of ['path==="eod-submissions"','path==="eod-reviews"',
  '"EOD_SUBMISSION_OUTCOME_UNKNOWN"','"EOD_REVIEW_OUTCOME_UNKNOWN"',
  'exact(v,["ok","error","committed","retrySameNonceOnly"])',
  "v.committed===null","v.retrySameNonceOnly===true"])
  assert.ok(web.includes(field),field);
 assert.ok(web.indexOf("if(response.status===503")<web.indexOf("if(!body||typeof body"));
});
test("both browser checkpoints retain original nonce when Core may have committed",()=>{
 assert.match(submit,/data\.error==="EOD_SUBMISSION_OUTCOME_UNKNOWN"/);
 assert.match(review,/doc\.error==="EOD_REVIEW_OUTCOME_UNKNOWN"/);
 assert.ok(submit.includes("savePendingEodSubmission(store(),item)"));
 assert.ok(review.includes("savePendingTlReview(store(),record)"));
 assert.ok(submit.indexOf("savePendingEodSubmission(store(),item)")<
  submit.indexOf('fetch("/api/eod-submissions"'));
 assert.ok(review.indexOf("savePendingTlReview(store(),record)")<
  review.indexOf('fetch("/api/eod-reviews"'));
});