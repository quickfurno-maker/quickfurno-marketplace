/**
 * VO2 scoped ephemeral Staff presence projection.
 *
 * Presence represents connection/activity hints only. It is NEVER proof of
 * attendance, billed hours, task completion, meetings attended or payroll.
 * The roster and observations MUST originate from verified Core authority.
 * Supabase Realtime transport and RLS subscription are separate gates.
 */
export const PRESENCE_SCHEMA="qf.vox.virtual-office.team-presence.v1";
export const PRESENCE_TTL_MS=90_000;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATES=new Set(["ONLINE","AWAY","BUSY","IN_MEETING","ON_BREAK"]);
const isId=v=>typeof v==="string"&&UUID.test(v);
const deny=reason=>Object.freeze({ok:false,reason,attendanceVerified:false});
const exact=(o,keys)=>Object.keys(o).sort().join("|")===[...keys].sort().join("|");
/**
 * A caller without an explicitly verified roster cannot claim a zero or
 * offline headcount. Unobserved staff are UNKNOWN, not OFFLINE.
 * Staff may see only themselves; TL may see ONLY exact team/city roster.
 */
export function projectVerifiedTeamPresence({viewer,roster,observations,nowMs,
 rosterVerified=false}={}){
 if(rosterVerified!==true||!viewer||!isId(viewer.userId)||
   !isId(viewer.teamId)||!isId(viewer.cityId)||
   !["staff","team_leader"].includes(viewer.role)||
   !Number.isSafeInteger(nowMs)||nowMs<0||
   !Array.isArray(roster)||roster.length>200||
   !Array.isArray(observations)||observations.length>200)
  return deny("PRESENCE_CORE_SCOPE_UNVERIFIED");
 if(roster.some(x=>!isId(x))||new Set(roster).size!==roster.length)
  return deny("PRESENCE_ROSTER_UNVERIFIED");
 if(viewer.role==="staff"&&(roster.length!==1||roster[0]!==viewer.userId))
  return deny("STAFF_PRESENCE_SCOPE_DENIED");
 const scope=new Set(roster),seen=new Set(),byId=new Map();
 for(const o of observations){
  if(!o||typeof o!=="object"||Array.isArray(o)||
     !exact(o,["staffId","teamId","cityId","state","seenAtMs"])||
     !isId(o.staffId)||!scope.has(o.staffId)||seen.has(o.staffId)||
     o.teamId!==viewer.teamId||o.cityId!==viewer.cityId||
     !STATES.has(o.state)||!Number.isSafeInteger(o.seenAtMs)||
     o.seenAtMs<0||o.seenAtMs>nowMs)
   return deny("PRESENCE_SOURCE_UNVERIFIED");
  seen.add(o.staffId);byId.set(o.staffId,o);
 }
 const entries=roster.map(staffId=>{
  const observation=byId.get(staffId);
  const state=!observation?"UNKNOWN":
   nowMs-observation.seenAtMs>PRESENCE_TTL_MS?"OFFLINE":observation.state;
  return Object.freeze({staffId,state,source:"EPHEMERAL_ONLY"});
 });
 const unknownStaffCount=entries.filter(e=>e.state==="UNKNOWN").length;
 return Object.freeze({ok:true,schema:PRESENCE_SCHEMA,entries:Object.freeze(entries),
  totalRosterKnown:true,unknownStaffCount,attendanceVerified:false,
  timeTrackingVerified:false,taskCompletionVerified:false,
  latestObservationsVerified:observations.length});
}
