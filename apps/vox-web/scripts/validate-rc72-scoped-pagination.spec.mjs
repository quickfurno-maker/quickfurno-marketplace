import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {PAGE_SIZE,scopedQueuePage} from "../app/components/scopedQueuePage.mjs";
const rows=Array.from({length:52},(_,i)=>({id:String(i+1),title:"Core "+(i+1),state:i%2?"active":"pending"}));
test("genuine scoped queue shows 20 per page and preserves original Core order without inventing records",()=>{
 assert.equal(PAGE_SIZE,20);
 assert.deepEqual(scopedQueuePage(rows,1).rows,rows.slice(0,20));
 assert.deepEqual(scopedQueuePage(rows,2).rows,rows.slice(20,40));
 assert.deepEqual(scopedQueuePage(rows,3).rows,rows.slice(40,52));
 assert.deepEqual(scopedQueuePage(rows,50).rows,rows.slice(40,52));
 assert.equal(scopedQueuePage(rows,50).page,3);
 assert.equal(scopedQueuePage([],1).pages,1);
 assert.deepEqual(scopedQueuePage(rows,0).rows,[]);
});
test("filtering remains within the bounded authorized rows; pagination never requests extra Core records",()=>{
 const filtered=rows.filter(r=>r.state==="active");
 assert.equal(filtered.length,26);
 assert.deepEqual(scopedQueuePage(filtered,2).rows,filtered.slice(20));
 const src=readFileSync(new URL("../app/components/ScopedQueue.tsx",import.meta.url),"utf8");
 assert.match(src,/scopedQueuePage\(filtered,page\)/);
 assert.match(src,/setPage\(1\)/);
 assert.match(src,/Page \{view.page\} of \{view.pages\}/);
 assert.match(src,/disabled=\{view.page<=1\}/);
 assert.match(src,/disabled=\{view.page>=view.pages\}/);
 assert.doesNotMatch(src,/fetch\(|localStorage|sessionStorage/);
 assert.match(src,/Pages do not fetch additional records/);
});
