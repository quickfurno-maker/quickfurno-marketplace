import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {projectScopedWorkQueue as view} from "../../../contracts/vox/workQueuePreview.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const scope={userId:id(1),teamId:id(2),cityId:id(3),role:"operations_manager",
 canReadContent:true,canMutate:false,prospectIds:[id(10)],vendorIds:[id(11)],
 supportThreadIds:[id(12)],conversationIds:[]};
const row={id:id(80),source_kind:"prospect",source_id:id(10),
 team_id:scope.teamId,city_id:scope.cityId,assignee_id:null,state:"NEW",
 revision:0,updated_at:"2026-10-15T13:00:00Z"};
const prepare=(rows=[row],s=scope)=>({scope:s,rows,verifiedProspectIds:[id(10)],
 verifiedVendorIds:[id(11)],verifiedSupportThreadIds:[id(12)]});
test("unassigned eligible Core scoped work is metadata-only",()=>{
 const result=view(prepare());
 assert.equal(result.ok,true);assert.equal(result.items.length,1);
 assert.equal(result.items[0].assignedToMe,false);
 assert.equal(result.items[0].canClaim,false);
 assert.equal(result.items[0].canTransition,false);
 assert.equal(result.completeness,"BOUNDED_NOT_TOTAL");
 assert.equal(JSON.stringify(result).includes("source_id"),false);
});
test("staff may read own assigned, not another employee's or stale orphan cases",()=>{
 const rows=[{...row,id:id(81),state:"IN_PROGRESS",assignee_id:id(1)},
  {...row,id:id(82),state:"ASSIGNED",assignee_id:id(9)},
  {...row,id:id(83),state:"WAITING_APPROVAL",assignee_id:null}];
 const result=view(prepare(rows));assert.equal(result.ok,true);
 assert.deepEqual(result.items.map(x=>x.workItemId),[id(81)]);
});
test("requires current canonical city subject verification AND exact current grant",()=>{
 assert.deepEqual(view({...prepare(),verifiedProspectIds:[]}).items,[]);
 const bad={...row,source_id:id(44)};
 assert.deepEqual(view(prepare([bad])).items,[]);
 const wrong={...row,city_id:id(88)};
 assert.equal(view(prepare([wrong])).ok,false);
 const fake={...prepare(),verifiedProspectIds:[id(44)]};
 assert.equal(view(fake).ok,false);
});
test("vendor, support and client isolation",()=>{
 const vendor={...row,id:id(84),source_kind:"vendor",source_id:id(11)};
 const support={...row,id:id(85),source_kind:"support_thread",source_id:id(12)};
 assert.equal(view(prepare([vendor,support])).items.length,2);
 const client={...row,id:id(86),source_kind:"client",source_id:id(10)};
 assert.equal(view(prepare([client])).ok,false);
});
test("team leader cannot read content and duplicate/overflowed source rows fail closed",()=>{
 assert.equal(view(prepare([row],{...scope,role:"team_leader",canReadContent:false})).ok,false);
 assert.equal(view(prepare([row,row])).ok,false);
 assert.equal(view(prepare(Array(26).fill({...row,id:id(80)}))).ok,false);
});
const src=readFileSync(new URL("../../../app/api/vox/v1/work-queue/route.ts",import.meta.url),"utf8");
test("HTTP queue is default OFF, actual Core AAL2, city proof, no writes or leaks",()=>{
 for(const gate of ["VOX_STAFF_GRANTS_ENABLED","VOX_DEPARTMENT_ENFORCEMENT_ENABLED",
  "VOX_WORK_QUEUE_READ_ENABLED"])assert.ok(src.includes('process.env.'+gate+'!=="staging"'));
 assert.match(src,/getVerifiedScopedStaff\(request\.headers\.get\("authorization"\)\)/);
 for(const table of ["aarohi_prospects","vendors","marketplace_service_zones",
  "vendor_support_threads","vox_work_items_candidate_v1"])
  assert.ok(src.includes('from("'+table+'")'));
 assert.doesNotMatch(src,/\.insert\(|\.update\(|\.delete\(|inviteUserByEmail|provider\.send/);
 assert.match(src,/export function POST\(\)/);
});
