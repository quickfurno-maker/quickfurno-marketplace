import {projectVerifiedStaffTimeRow} from "./virtualOfficeTimeRead.mjs";
export const TEAM_SHIFT_SCHEMA="qf.vox.team.current-shifts.v1";
const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuid=x=>typeof x==="string"&&ID.test(x);
const bad=reason=>Object.freeze({ok:false,reason,sourceVerified:false});
const safe=x=>Number.isSafeInteger(x)&&x>=0;
const rowKeys=["staffId","teamId","cityId","role","verifiedNeutralStaff"];
/** Bounded, current team-only shift read model; not a daily report, payroll
 * or proof that a Staff member is offline. DB source and roster are required.
 * Zero hours is permitted only for verified absent-row (not a failed query).
 */
export function buildVerifiedTeamShiftWindow(members,dbRows,{
 leaderId,teamId,cityId,serverNowMs,rosterVerified=false,
 rowSourceVerified=false
}={}){
 if(!uuid(leaderId)||!uuid(teamId)||!uuid(cityId)||
  !safe(serverNowMs)||rosterVerified!==true||rowSourceVerified!==true||
  !Array.isArray(members)||members.length>20||
  !Array.isArray(dbRows)||dbRows.length>20)return bad("TEAM_SHIFT_SOURCE_NOT_VERIFIED");
 const roster=new Map();
 for(const m of members){
  if(!m||typeof m!=="object"||Array.isArray(m)||
   Object.keys(m).sort().join("|")!==[...rowKeys].sort().join("|")||
   !uuid(m.staffId)||m.staffId===leaderId||roster.has(m.staffId)||
   m.teamId!==teamId||m.cityId!==cityId||
   m.verifiedNeutralStaff!==true||
   !["operations_manager","acquisition_agent","vendor_success_agent",
    "support_agent"].includes(m.role))
   return bad("TEAM_SHIFT_ROSTER_INVALID");
  roster.set(m.staffId,m);
 }
 const rows=new Map();
 for(const r of dbRows){
  if(!r||typeof r!=="object"||Array.isArray(r)||
    !uuid(r.staff_id)||!roster.has(r.staff_id)||
    rows.has(r.staff_id))return bad("TEAM_SHIFT_ROW_FOREIGN_OR_DUPLICATE");
  rows.set(r.staff_id,r);
 }
 const staff=[];
 let attendanceMs=0,breakMs=0,taskMs=0,netShiftMs=0,unattributedMs=0;
 const states={NOT_STARTED:0,CLOCKED_IN:0,ON_BREAK:0,
  TRACKING_TASK:0,CLOCKED_OUT:0};
 for(const member of members){
  const r=projectVerifiedStaffTimeRow(rows.has(member.staffId)?
   rows.get(member.staffId):null,{
    staffId:member.staffId,teamId,cityId,serverNowMs,sourceVerified:true
   });
  if(!r.ok)return bad("TEAM_SHIFT_INTEGRITY_UNVERIFIED");
  states[r.status]++;
  attendanceMs+=r.attendanceMs;breakMs+=r.breakMs;
  taskMs+=r.taskMs;netShiftMs+=r.netShiftMs;
  unattributedMs+=r.unattributedMs;
  if(![attendanceMs,breakMs,taskMs,netShiftMs,unattributedMs].every(safe))
   return bad("TEAM_SHIFT_OVERFLOW");
  staff.push(Object.freeze({staffRef:"STAFF-"+member.staffId.slice(0,8).toUpperCase(),
   status:r.status,attendanceMs:r.attendanceMs,breakMs:r.breakMs,
   taskMs:r.taskMs,unattributedMs:r.unattributedMs}));
 }
 return Object.freeze({ok:true,schema:TEAM_SHIFT_SCHEMA,mode:"READ_ONLY",
  source:"CORE_CURRENT_SHIFT_ROWS",sourceVerified:true,
  rosterVerified:true,boundedWindow:true,completeHistory:false,
  officialEod:false,payrollVerified:false,livePresence:false,
  asOf:new Date(serverNowMs).toISOString(),staffCount:members.length,
  states:Object.freeze(states),attendanceMs,breakMs,taskMs,
  netShiftMs,unattributedMs,staff:Object.freeze(staff),
  providerMessagesSent:0,moneyMinorUnits:0});
}
