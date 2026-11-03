// VO10 Owner-only bounded team-time projection. Core verifies owner, neutral
// Staff principals, active teams/cities, and the source rows before invoking.
// The result is a current snapshot, NOT a full roster, payroll or EOD.
import {projectVerifiedStaffTimeRow} from "./virtualOfficeTimeRead.mjs";
export const OWNER_TEAM_TIME_SCHEMA="qf.vox.owner.team-time-window.v1";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROLES=new Set(["operations_manager","acquisition_agent","vendor_success_agent","support_agent"]);
const safe=n=>Number.isSafeInteger(n)&&n>=0;
const isId=v=>typeof v==="string"&&UUID.test(v);
const bad=reason=>Object.freeze({ok:false,reason,sourceVerified:false});
const fields=["staffId","teamId","cityId","role","verifiedNeutralStaff"];
const exact=(o,keys)=>Object.keys(o).sort().join("|")===[...keys].sort().join("|");
export function buildVerifiedOwnerTeamTimeWindow(members,rows,opts={}){
 const {ownerId,serverNowMs,rosterVerified=false,rowSourceVerified=false,
  hasMore=false}=opts;
 if(!isId(ownerId)||!safe(serverNowMs)||rosterVerified!==true||
  rowSourceVerified!==true||typeof hasMore!=="boolean"||
  !Array.isArray(members)||members.length>20||
  !Array.isArray(rows)||rows.length>20)
  return bad("OWNER_TEAM_TIME_SOURCE_UNVERIFIED");
 const map=new Map(),refs=new Set(),teamPairs=new Map();
 for(const m of members){
  if(!m||typeof m!=="object"||Array.isArray(m)||!exact(m,fields)||
   !isId(m.staffId)||!isId(m.teamId)||!isId(m.cityId)||
   m.staffId===ownerId||m.verifiedNeutralStaff!==true||
   !ROLES.has(m.role)||map.has(m.staffId))
   return bad("OWNER_TEAM_TIME_ROSTER_UNTRUSTED");
  const ref="STAFF-"+m.staffId.slice(0,8).toUpperCase();
  if(refs.has(ref))return bad("OWNER_TEAM_TIME_REF_COLLISION");
  refs.add(ref);
  if(teamPairs.has(m.teamId)&&teamPairs.get(m.teamId)!==m.cityId)
   return bad("OWNER_TEAM_TIME_TEAM_CITY_COLLISION");
  teamPairs.set(m.teamId,m.cityId);
  map.set(m.staffId,m);
 }
 const byStaff=new Map();
 for(const row of rows){
  if(!row||typeof row!=="object"||Array.isArray(row)||
   !isId(row.staff_id)||!map.has(row.staff_id)||
   byStaff.has(row.staff_id))
   return bad("OWNER_TEAM_TIME_FOREIGN_OR_DUPLICATE");
  byStaff.set(row.staff_id,row);
 }
 const staff=[];
 let attendanceMs=0,breakMs=0,taskMs=0,unattributedMs=0;
 const states={NOT_STARTED:0,CLOCKED_IN:0,ON_BREAK:0,
  TRACKING_TASK:0,CLOCKED_OUT:0};
 for(const m of members){
  const shift=projectVerifiedStaffTimeRow(byStaff.has(m.staffId)?
   byStaff.get(m.staffId):null,{
    staffId:m.staffId,teamId:m.teamId,cityId:m.cityId,
    serverNowMs,sourceVerified:true
   });
  if(shift.ok!==true)return bad("OWNER_TEAM_TIME_SHIFT_UNVERIFIED");
  states[shift.status]++;
  attendanceMs+=shift.attendanceMs;breakMs+=shift.breakMs;
  taskMs+=shift.taskMs;unattributedMs+=shift.unattributedMs;
  if(![attendanceMs,breakMs,taskMs,unattributedMs].every(safe))
   return bad("OWNER_TEAM_TIME_SUM_OVERFLOW");
  staff.push(Object.freeze({
   staffRef:"STAFF-"+m.staffId.slice(0,8).toUpperCase(),
   teamRef:"TEAM-"+m.teamId.slice(0,8).toUpperCase(),
   status:shift.status,attendanceMs:shift.attendanceMs,
   breakMs:shift.breakMs,taskMs:shift.taskMs,
   unattributedMs:shift.unattributedMs
  }));
 }
 return Object.freeze({
  ok:true,schema:OWNER_TEAM_TIME_SCHEMA,mode:"OWNER_READ_ONLY",
  source:"CORE_VERIFIED_CURRENT_SHIFTS",sourceVerified:true,
  rosterVerified:true,boundedWindow:true,windowSize:20,hasMore,
  completeHistory:false,officialEod:false,payrollVerified:false,
  livePresence:false,staffCount:staff.length,
  asOf:new Date(serverNowMs).toISOString(),
  states:Object.freeze(states),
  attendanceMs,breakMs,taskMs,unattributedMs,
  staff:Object.freeze(staff),providerMessagesSent:0,moneyMinorUnits:0
 });
}
