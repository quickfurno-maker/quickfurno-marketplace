import "server-only";
import {adminClient} from "@/lib/supabase";
import {getVerifiedScopedStaff} from "@/services/vox/verifiedScopedStaff";
import {projectVerifiedTeamPresence} from "@/contracts/vox/virtualOfficePresence.mjs";
export const runtime="nodejs";
export const dynamic="force-dynamic";
/**
 * VO6 read-only private presence snapshot. No realtime subscription or writer
 * is installed. Never claim presence as attendance, work hours or payroll.
 * Hard code gate prevents premature deployment by an environment toggle.
 */
const VO6_MANAGED_PRESENCE_CERTIFIED=false as const;
const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const send=(body:unknown,status:number)=>Response.json(body,{status,headers:{
 "cache-control":"private, no-store, max-age=0","vary":"Authorization",
 "x-content-type-options":"nosniff"
}});
const same=(a:NonNullable<Awaited<ReturnType<typeof getVerifiedScopedStaff>>>,
 b:NonNullable<Awaited<ReturnType<typeof getVerifiedScopedStaff>>>)=>{
 const ks=["userId","teamId","cityId","role","canReadContent","canMutate"];
 return ks.every(k=>(a as unknown as Record<string,unknown>)[k]===(b as unknown as Record<string,unknown>)[k])&&
 ["prospectIds","vendorIds","supportThreadIds","conversationIds","verifiedDepartments"]
 .every(k=>{
  const x=(a as unknown as Record<string,unknown>)[k];
  const y=(b as unknown as Record<string,unknown>)[k];
  if(x===undefined&&y===undefined)return true;
  return Array.isArray(x)&&Array.isArray(y)&&
   JSON.stringify([...x].sort())===JSON.stringify([...y].sort());
 });
};
export async function GET(request:Request){
 if(!VO6_MANAGED_PRESENCE_CERTIFIED||
    process.env.VOX_VO6_PRESENCE_READ_ENABLED!=="staging"||
    process.env.VOX_STAFF_GRANTS_ENABLED!=="staging"||
    process.env.VOX_DEPARTMENT_ENFORCEMENT_ENABLED!=="staging")
  return send({ok:false,error:"PRESENCE_SOURCE_NOT_CERTIFIED"},503);
 if(new URL(request.url).search||new URL(request.url).hash)
  return send({ok:false,error:"FILTER_DENIED"},400);
 const header=request.headers.get("authorization");
 try{
  const scope=await getVerifiedScopedStaff(header);
  if(!scope||scope.canMutate!==false||
    (scope.role==="team_leader"?
      scope.canReadContent!==false:
      scope.canReadContent!==true||scope.role==="auditor"))
   return send({ok:false,error:"CURRENT_STAFF_AAL2_REQUIRED"},403);
  const leader=scope.role==="team_leader";
  const db=adminClient();
  let roster=[scope.userId];
  if(leader){
   const members=await db.from("vox_staff_memberships_v1")
    .select("auth_user_id,team_id,staff_role,is_active,expires_at,revoked_at")
    .eq("team_id",scope.teamId).eq("is_active",true)
    .is("revoked_at",null).order("auth_user_id",{ascending:true}).limit(22);
   if(members.error||!members.data||members.data.length>21)
    return send({ok:false,error:"PRESENCE_ROSTER_INCOMPLETE"},503);
   const raw=members.data.filter(x=>x.staff_role!=="team_leader"&&
    x.staff_role!=="auditor"&&x.auth_user_id!==scope.userId);
   if(raw.length>20||raw.some(x=>!ID.test(String(x.auth_user_id))||
     x.team_id!==scope.teamId||x.is_active!==true||
     x.revoked_at!==null||!Number.isFinite(Date.parse(x.expires_at))||
     Date.parse(x.expires_at)<=Date.now()))
    return send({ok:false,error:"PRESENCE_ROSTER_UNVERIFIED"},503);
   roster=raw.map(x=>x.auth_user_id);
   if(new Set(roster).size!==roster.length)
    return send({ok:false,error:"PRESENCE_DUPLICATE_ROSTER"},503);
   const profiles=roster.length?await db.from("profiles")
    .select("id,role,is_active").in("id",roster).limit(21):
    {data:[],error:null};
   const identities=await Promise.all(roster.map(id=>db.auth.admin.getUserById(id)));
   if(profiles.error||!profiles.data||profiles.data.length!==roster.length||
      identities.some((x,i)=>x.error||x.data.user?.id!==roster[i]||
       x.data.user?.app_metadata?.qf_principal!=="vox_staff"||
       x.data.user?.app_metadata?.admin_role!=null)||
      roster.some(id=>{
       const p=profiles.data.find(x=>x.id===id);
       return !p||p.role!==null||p.is_active!==true;
      }))
    return send({ok:false,error:"PRESENCE_ROSTER_IDENTITY_UNVERIFIED"},503);
  }
  const observed=roster.length?await db.from("vox_vo6_staff_presence_observations_candidate_v1")
   .select("staff_id,team_id,city_id,state,seen_at")
   .eq("team_id",scope.teamId).eq("city_id",scope.cityId)
   .in("staff_id",roster).limit(21):
   {data:[],error:null};
  if(observed.error||!observed.data||observed.data.length>roster.length)
   return send({ok:false,error:"PRESENCE_OBSERVATIONS_UNAVAILABLE"},503);
  const nowMs=Date.now();
  const observations=[];
  for(const x of observed.data){
   if(!ID.test(String(x.staff_id))||x.team_id!==scope.teamId||
      x.city_id!==scope.cityId||
      typeof x.seen_at!=="string"||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(x.seen_at)||
      !Number.isSafeInteger(Date.parse(x.seen_at)))
    return send({ok:false,error:"PRESENCE_OBSERVATION_UNTRUSTED"},503);
   observations.push({staffId:x.staff_id,teamId:x.team_id,
    cityId:x.city_id,state:x.state,seenAtMs:Date.parse(x.seen_at)});
  }
  const projected=projectVerifiedTeamPresence({
   viewer:{userId:scope.userId,teamId:scope.teamId,cityId:scope.cityId,
    role:leader?"team_leader":"staff"},
   roster,observations,nowMs,rosterVerified:true
  });
  if(!projected.ok)return send({ok:false,error:projected.reason},503);
  const refreshed=await getVerifiedScopedStaff(header);
  if(!refreshed||!same(scope,refreshed))
   return send({ok:false,error:"PRESENCE_SCOPE_REVOKED"},403);
  return send({ok:true,schema:projected.schema,mode:"EPHEMERAL_READ_ONLY",
   sourceVerified:true,rosterVerified:true,liveRealtimeConnected:false,
   asOf:new Date(nowMs).toISOString(),boundedWindow:true,
   attendanceVerified:false,timeTrackingVerified:false,
   taskCompletionVerified:false,latestObservationsVerified:projected.latestObservationsVerified,
   totalRosterKnown:true,unknownStaffCount:projected.unknownStaffCount,
   entries:projected.entries.map(e=>({staffRef:"STAFF-"+e.staffId.slice(0,8).toUpperCase(),
    state:e.state,source:e.source}))},200);
 }catch{return send({ok:false,error:"PRESENCE_SOURCE_UNAVAILABLE"},503);}
}
export function POST(){return send({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function PUT(){return send({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function PATCH(){return send({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function DELETE(){return send({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
