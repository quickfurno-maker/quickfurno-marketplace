import test from "node:test";
import assert from "node:assert/strict";
import {readPendingTlReviews,savePendingTlReview,clearPendingTlReview} from "../lib/rc70PendingTlReview.mjs";
const ids=["11111111-1111-4111-8111-111111111111","22222222-2222-4222-8222-222222222222","33333333-3333-4333-8333-333333333333"];
const row=i=>({reportId:ids[i],nonce:ids[i],decision:"ACKNOWLEDGED"});
const memory=()=>{const m=new Map();return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)};};
test("saving current Team Leader EOD nonce cannot silently lose another unresolved report",()=>{
 const storage=memory();assert.equal(savePendingTlReview(storage,row(0)),true);
 const tamper={...storage,setItem:(k,v)=>{const changed=JSON.parse(v);changed[0]=row(2);storage.setItem(k,JSON.stringify(changed));}};
 assert.equal(savePendingTlReview(tamper,row(1)),false);
});
test("clearing one EOD review after Core receipt must preserve every unrelated original nonce",()=>{
 const storage=memory();assert.equal(savePendingTlReview(storage,row(0)),true);assert.equal(savePendingTlReview(storage,row(1)),true);
 const tamper={...storage,setItem:(k,v)=>{const changed=JSON.parse(v);changed[0]=row(2);storage.setItem(k,JSON.stringify(changed));}};
 assert.equal(clearPendingTlReview(tamper,row(0)),false);
});
test("honest Team Leader storage and independent review still work",()=>{
 const s=memory();assert.equal(savePendingTlReview(s,row(0)),true);assert.equal(savePendingTlReview(s,row(1)),true);
 assert.equal(clearPendingTlReview(s,row(0)),true);assert.deepEqual(readPendingTlReviews(s).records,[row(1)]);
});
