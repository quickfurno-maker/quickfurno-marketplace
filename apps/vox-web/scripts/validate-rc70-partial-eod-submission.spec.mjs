import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {indiaBusinessDate,readPendingEodSubmission as read,
 savePendingEodSubmission as save,clearPendingEodSubmission as clear} from "../lib/rc70PendingEodSubmission.mjs";
const NONCE="00000000-0000-4000-8000-000000000002";
const row={nonce:NONCE,businessDate:"2026-11-02"};
function mem(){
 const m=new Map();
 return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)};
}
test("same-tab original partial EOD nonce survives refresh and blocks cross-day or second nonce",()=>{
 const s=mem();assert.equal(save(s,row),true);
 assert.deepEqual(read(s).pending,row);
 assert.equal(save(s,{...row,nonce:"00000000-0000-4000-8000-000000000003"}),false);
 assert.equal(save(s,{...row,businessDate:"2026-11-03"}),false);
 assert.equal(clear(s,{...row,nonce:"00000000-0000-4000-8000-000000000004"}),false);
 assert.deepEqual(read(s).pending,row);
 assert.equal(clear(s,row),true);
 assert.equal(read(s).pending,null);
});
test("actual India timezone business date defined explicitly across UTC midnight",()=>{
 assert.equal(indiaBusinessDate(new Date("2026-11-01T19:00:00Z")),"2026-11-02");
 assert.equal(indiaBusinessDate(new Date("2026-11-02T18:29:00Z")),"2026-11-02");
 assert.equal(indiaBusinessDate(new Date("2026-11-02T18:31:00Z")),"2026-11-03");
});
test("storage error, corrupt state and forged nonce fail closed",()=>{
 for(const raw of ["{",JSON.stringify({nonce:NONCE,businessDate:"2026-11-02",role:"owner"}),
  JSON.stringify([{nonce:NONCE,businessDate:"2026-11-02"}]),
  JSON.stringify({nonce:"invalid",businessDate:"2026-11-02"})]){
  const m=mem();m.setItem("qf.vox.pending-partial-eod.v1",raw);
  assert.equal(read(m).available,false);
  assert.equal(save(m,row),false);
 }
 assert.equal(save(mem(),{...row,nonce:"garbage"}),false);
 assert.equal(read(null).available,false);
 assert.equal(save(null,row),false);
});
test("actual Staff submission form saves BEFORE Core and clears only verified receipt",()=>{
 const src=readFileSync(new URL("../app/team/eod-submissions/SubmitPartial.tsx",import.meta.url),"utf8");
 assert.ok(src.indexOf("savePendingEodSubmission(store(),item)")<src.indexOf('fetch("/api/eod-submissions"'));
 assert.ok(src.indexOf("clearPendingEodSubmission(store(),item)")>src.indexOf("Object.keys(data).sort()"));
 assert.match(src,/data\.completeness!=="PARTIAL_UNVERIFIED_TOTAL"/);
 assert.match(src,/data\.eventCount>100/);
 assert.match(src,/pending\.current\.businessDate!==businessDate/);
 assert.match(src,/disabled=\{busy\|\|!ready\|\|!available\|\|crossDate\}/);
});
