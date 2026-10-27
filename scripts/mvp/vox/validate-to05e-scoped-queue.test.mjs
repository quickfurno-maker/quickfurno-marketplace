import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {selectScopedWorkCandidates as choose} from "../../../contracts/vox/scopedWorkCandidates.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const scope={userId:id(1),teamId:id(2),cityId:id(3)};
const row=(n,overrides={})=>({id:id(1000+n),team_id:scope.teamId,
 city_id:scope.cityId,source_kind:"prospect",source_id:id(10),
 assignee_id:scope.userId,state:"ASSIGNED",revision:1,
 updated_at:new Date(Date.UTC(2026,9,15,10,0,n)).toISOString(),...overrides});
const args=rows=>({scope,rows,verifiedProspectIds:[id(10)],
 verifiedVendorIds:[],verifiedSupportThreadIds:[]});
test("select actual matching rows before global 25 cutoff, deterministically newest",()=>{
 const rows=Array.from({length:50},(_,i)=>row(i));
 const result=choose(args(rows));
 assert.equal(result.ok,true);
 assert.equal(result.rows.length,25);
 assert.equal(result.rows[0].id,id(1049));
 assert.equal(result.rows.at(-1).id,id(1025));
 assert.equal(result.rows.some(x=>x.id===id(1000)),false);
});
test("up to 150 current, scoped per-kind+assignee rows supported",()=>{
 const rows=[
  ...Array.from({length:50},(_,i)=>row(i)),
  ...Array.from({length:50},(_,i)=>row(100+i,{
    source_kind:"vendor",source_id:id(11),state:"NEW",assignee_id:null
  })),
  ...Array.from({length:50},(_,i)=>row(200+i,{
    source_kind:"support_thread",source_id:id(12),assignee_id:scope.userId
  }))
 ];
 const r=choose({...args(rows),verifiedVendorIds:[id(11)],verifiedSupportThreadIds:[id(12)]});
 assert.equal(r.ok,true);assert.equal(r.rows.length,25);
 assert.equal(r.rows[0].source_kind,"support_thread");
});
test("never admit unauthorized subject, foreign city, team or another assignee",()=>{
 for(const corrupted of [
  {source_id:id(999)},
  {source_kind:"client"},
  {city_id:id(44)},
  {team_id:id(45)},
  {assignee_id:id(46)},
  {state:"DONE",assignee_id:null},
  {updated_at:"not a date"},
  {revision:-1}
 ])assert.equal(choose(args([row(1,corrupted)])).ok,false,JSON.stringify(corrupted));
 assert.equal(choose(args([row(1),row(1)])).ok,false);
 assert.equal(choose(args(Array.from({length:151},(_,i)=>row(i)))).ok,false);
});
test("Core endpoint source verifies grants and assignee BEFORE any 25 limit",()=>{
 const src=readFileSync(new URL("../../../app/api/vox/v1/work-queue/route.ts",import.meta.url),"utf8");
 assert.match(src,/selectScopedWorkCandidates\(/);
 assert.match(src,/\.in\("source_id",lane\.ids\)/);
 assert.match(src,/\.eq\("assignee_id",scope\.userId\)/);
 assert.match(src,/\.is\("assignee_id",null\)\.eq\("state","NEW"\)/);
 assert.match(src,/snapshots\.flatMap\(x=>x\.data\?\?\[\]\)/);
 assert.doesNotMatch(src,/\.eq\("city_id",scope\.cityId\)\s*\.order\("updated_at",\{ascending:false\}\)\.limit\(25\)/);
 assert.doesNotMatch(src,/inviteUserByEmail|provider\.send\(/);
});
