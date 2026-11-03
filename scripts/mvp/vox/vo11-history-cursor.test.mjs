import test from "node:test";
import assert from "node:assert/strict";
import {encodeHistoryCursor,decodeHistoryCursor,intervalHistoryKeysetFilter}
 from "../../../contracts/vox/virtualOfficeHistoryCursor.mjs";
const nonce=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const now=Date.parse("2026-11-03T11:00:00Z");
const row=(n=2)=>({ended_at:"2026-11-03T10:00:00.123456+00:00",
 closed_by_event_nonce:nonce(n)});
test("VO11 signed-in identity is NOT a cursor; precise time plus nonce is",()=>{
 const cursor=encodeHistoryCursor(row());
 assert.equal(typeof cursor,"string");
 assert.deepEqual(decodeHistoryCursor(cursor,now),{
  endedAt:row().ended_at,nonce:nonce(2)});
 assert.equal(intervalHistoryKeysetFilter(cursor,now),
  "ended_at.lt."+row().ended_at+",and(ended_at.eq."+
  row().ended_at+",closed_by_event_nonce.lt."+nonce(2)+")");
 const data=Buffer.from(cursor,"base64url").toString("utf8");
 assert.doesNotMatch(data,/staffId|teamId|cityId|phone|email|jwt/);
});
test("VO11 malformed cursors, precision loss, extra claims and future time fail",()=>{
 const cursor=encodeHistoryCursor(row());
 for(const bad of ["","a".repeat(260),cursor+"=",
  Buffer.from('{"v":1,"t":"2026-11-03T10:00:00Z","n":"bad"}').toString("base64url"),
  Buffer.from(JSON.stringify({v:1,t:row().ended_at,n:nonce(2),staff:"inject"})).toString("base64url"),
  Buffer.from(JSON.stringify({v:1,t:"2027-11-03T10:00:00Z",n:nonce(2)})).toString("base64url"),
  Buffer.from(JSON.stringify({v:1,t:"2026-11-03T10:00:00Z,or(1=1)",n:nonce(2)})).toString("base64url")]){
  assert.equal(decodeHistoryCursor(bad,now),null);
  assert.equal(intervalHistoryKeysetFilter(bad,now),null);
 }
 assert.equal(encodeHistoryCursor({...row(),ended_at:"broken"}),null);
 assert.equal(encodeHistoryCursor({...row(),closed_by_event_nonce:"bad"}),null);
});
test("VO11 distinct UUIDs at same exact microsecond retain strict pagination order",()=>{
 const a=encodeHistoryCursor(row(2)),b=encodeHistoryCursor(row(1));
 assert.notEqual(a,b);
 assert.match(intervalHistoryKeysetFilter(a,now),/closed_by_event_nonce\.lt\./);
 assert.equal(decodeHistoryCursor(a,now).endedAt,row().ended_at);
});
