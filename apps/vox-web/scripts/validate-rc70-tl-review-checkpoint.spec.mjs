import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {readPendingTlReviews as read,savePendingTlReview as save,
 clearPendingTlReview as clear} from "../lib/rc70PendingTlReview.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const record={reportId:id(1),nonce:id(2),decision:"ACKNOWLEDGED"};
function store(){
 const m=new Map();
 return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),
 removeItem:k=>m.delete(k),raw:m};
}
test("original Team Leader decision and nonce survive refresh; only exact receipt may clear",()=>{
 const s=store();
 assert.equal(save(s,record),true);
 assert.deepEqual(read(s).records,[record]);
 assert.equal(save(s,{...record,nonce:id(3)}),false);
 assert.equal(save(s,{...record,decision:"REJECTED"}),false);
 assert.equal(clear(s,{...record,nonce:id(3)}),false);
 assert.deepEqual(read(s).records,[record]);
 assert.equal(save(s,record),true);
 assert.equal(clear(s,record),true);
 assert.deepEqual(read(s).records,[]);
});
test("different report decisions never overwrite each other; invalid/corrupt data fails closed",()=>{
 const s=store();
 assert.equal(save(s,record),true);
 const reject={reportId:id(4),nonce:id(5),decision:"REJECTED"};
 assert.equal(save(s,reject),true);
 assert.equal(clear(s,record),true);
 assert.deepEqual(read(s).records,[reject]);
 for(const malformed of [{...record,decision:"REFUND"},{...record,nonce:"not-uuid"},
 {...record,role:"owner"}]){
  assert.equal(save(s,malformed),false);
 }
 for(const value of ["{","{}".repeat(3000),JSON.stringify([{...record,nonce:id(5),decision:"REJECTED"},record])]){
  const t=store();t.setItem("qf.vox.pending-tl-review.v1",value);
  assert.equal(read(t).available,false);
  assert.equal(save(t,record),false);
 }
 const denied={getItem(){throw Error("storage denied");},setItem(){throw Error("storage denied");}};
 assert.equal(read(denied).available,false);
 assert.equal(save(denied,record),false);
 assert.equal(read(null).available,false);
});
test("actual TL review form stores nonce BEFORE HTTP and verifies exact Core receipt before cleanup",()=>{
 const ui=readFileSync(new URL("../app/team/eod-reviews/ReviewDecision.tsx",import.meta.url),"utf8");
 assert.ok(ui.indexOf("savePendingTlReview(store(),record)")<ui.indexOf('fetch("/api/eod-reviews"'));
 assert.ok(ui.indexOf("clearPendingTlReview(store(),record)")>ui.indexOf("Object.keys(doc).sort()"));
 assert.match(ui,/doc\.reportId!==reportId/);
 assert.match(ui,/doc\.revision!==1/);
 assert.match(ui,/doc\.state!==decision/);
 assert.match(ui,/lockedDecision!==null&&lockedDecision!=="REJECTED"/);
 assert.match(ui,/lockedDecision!==null&&lockedDecision!=="ACKNOWLEDGED"/);
 assert.match(ui,/Partial|partial/);
});
