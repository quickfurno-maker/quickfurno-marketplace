import "server-only";
import {adminClient} from "@/lib/supabase";
import {verifyVoxOwnerBearer} from "@/services/vox/verifiedStaffBearer";
import {buildVerifiedOwnerTeamTimeWindow} from "@/contracts/vox/virtualOfficeOwnerTime.mjs";
export const runtime="nodejs";
export const dynamic="force-dynamic";
// REVIEW ONLY: VO2 time rows are absent from approved managed migrations.
// Explicitly reviewed code change is required after restore+DBA/AppSec gates.
const VO10_MANAGED_OWNER_TIME_CERTIFIED=false as const;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;
const ROLES=["operations_manager","acquisition_agent","vendor_success_agent","support_agent"];
const H={"cache-control":"private, no-store, max-age=0",
 "vary":"Authorization","x-content-type-options":"nosniff"};
const send=(b:unknown,s:number)=>Response.json(b,{status:s,headers:H});
const validTime=(v:unknown)=>typeof v==="string"&&Number.isFinite(Date.parse(v))&&Date.parse(v)>Date.now();
export async function GET(request:Request){
 if(!VO10_MANAGED_OWNER_TIME_CERTIFIED||
   process.env.VOX_VO10_OWNER_TIME_ENABLED!=="staging"||
   process.env.VOX_STAFF_GRANTS_ENABLED!=="staging"||
   process.env.VOX_DEPARTMENT_ENFORCEMENT_ENABLED!=="staging")
  return send({ok:false,error:"OWNER_TIME_NOT_CERTIFIED"},503);
 if(new URL(request.url).search||new URL(request.url).hash)
  return send({ok:false,error:"FILTER_NOT_ALLOWED"},400);
 const header=request.headers.get("authorization");
 try{
  const owner=await verifyVoxOwnerBearer(header);
  if(!owner)return send({ok:false,error:"OWNER_AAL2_REQUIRED"},403);
  const db=adminClient();
  const roster=await db.from("vox_staff_memberships_v1")
   .select("auth_user_id,team_id,staff_role,is_active,revoked_at,expires_at")
   .in("staff_role",ROLES).eq("is_active",true).is("revoked_at",null)
   .gt("expires_at",new Date().toISOString())
   .order("auth_user_id",{ascending:true}).limit(21);
  if(roster.error||!roster.data||roster.data.length>21)
   return send({ok:false,error:"OWNER_STAFF_ROSTER_UNAVAILABLE"},503);
  const window=roster.data.slice(0,20);
  const ids=window.map(x=>x.auth_user_id),teams=[...new Set(window.map(x=>x.team_id))];
  if(new Set(ids).size!==ids.length||
   window.some(m=>!UUID.test(String(m.auth_user_id))||
    !UUID.test(String(m.team_id))||!ROLES.includes(m.staff_role)||
    m.is_active!==true||m.revoked_at!==null||!validTime(m.expires_at)))
   return send({ok:false,error:"OWNER_ROSTER_UNTRUSTED"},503);
  const [profiles,teamRows,authUsers]=await Promise.all([
   ids.length?db.from("profiles").select("id,role,is_active").in("id",ids).limit(21):
    Promise.resolve({data:[],error:null}),
   teams.length?db.from("vox_staff_teams_v1").select("id,city_id,is_active").in("id",teams).limit(21):
    Promise.resolve({data:[],error:null}),
   Promise.all(ids.map(id=>db.auth.admin.getUserById(id)))
  ]);
  if(profiles.error||teamRows.error||!profiles.data||!teamRows.data||
   profiles.data.length!==ids.length||teamRows.data.length!==teams.length||
   authUsers.some((x,i)=>x.error||x.data.user?.id!==ids[i]||
    x.data.user.app_metadata?.qf_principal!=="vox_staff"||
    x.data.user.app_metadata?.admin_role!=null))
   return send({ok:false,error:"OWNER_ROSTER_IDENTITY_UNVERIFIED"},503);
  const cityIds=[...new Set(teamRows.data.map(x=>x.city_id))];
  if(cityIds.some(x=>!UUID.test(String(x)))||
   teamRows.data.some(x=>x.is_active!==true||!teams.includes(x.id)))
   return send({ok:false,error:"OWNER_TEAM_SOURCE_UNTRUSTED"},503);
  const cities=cityIds.length?await db.from("cities")
   .select("id,is_active").in("id",cityIds).limit(21):
   {data:[],error:null};
  if(cities.error||!cities.data||cities.data.length!==cityIds.length||
   cities.data.some(x=>x.is_active!==true||!cityIds.includes(x.id)))
   return send({ok:false,error:"OWNER_CITY_UNAVAILABLE"},503);
  const members=window.map(m=>{
   const profile=profiles.data.find(x=>x.id===m.auth_user_id);
   const team=teamRows.data.find(x=>x.id===m.team_id);
   return {staffId:m.auth_user_id,teamId:m.team_id,
    cityId:team?.city_id??"",role:m.staff_role,
    verifiedNeutralStaff:!!profile&&profile.role===null&&profile.is_active===true};
  });
  const ledger=ids.length?await db.from("vox_vo2_staff_time_state_candidate_v1")
   .select("staff_id,team_id,city_id,revision,clocked_in_at,clocked_out_at,break_started_at,total_break_ms,active_work_item_id,task_started_at,last_work_item_id,task_time_ms,last_event_at")
   .in("staff_id",ids).limit(21):{data:[],error:null};
  if(ledger.error||!ledger.data||ledger.data.length>20)
   return send({ok:false,error:"OWNER_TIME_SOURCE_UNAVAILABLE"},503);
  // Revalidate Owner and current membership leases after the external reads.
  const [freshOwner,freshRoster]=await Promise.all([
   verifyVoxOwnerBearer(header),
   ids.length?db.from("vox_staff_memberships_v1")
    .select("auth_user_id,team_id,staff_role,is_active,revoked_at,expires_at")
    .in("auth_user_id",ids).limit(21):
    Promise.resolve({data:[],error:null})
  ]);
  if(freshOwner!==owner||freshRoster.error||!freshRoster.data||
   freshRoster.data.length!==ids.length||
   window.some(before=>{
    const after=freshRoster.data.find(x=>x.auth_user_id===before.auth_user_id);
    return !after||after.team_id!==before.team_id||
     after.staff_role!==before.staff_role||after.is_active!==true||
     after.revoked_at!==null||!validTime(after.expires_at);
   }))return send({ok:false,error:"OWNER_OR_STAFF_SCOPE_CHANGED"},403);
  const result=buildVerifiedOwnerTeamTimeWindow(members,ledger.data,{
   ownerId:owner,serverNowMs:Date.now(),rosterVerified:true,
   rowSourceVerified:true,hasMore:roster.data.length===21
  });
  if(result.ok!==true)return send({ok:false,error:"OWNER_TIME_PROJECTION_UNVERIFIED"},503);
  return send(result,200);
 }catch{return send({ok:false,error:"OWNER_TIME_UNAVAILABLE"},503);}
}
export function POST(){return send({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function PUT(){return send({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function PATCH(){return send({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function DELETE(){return send({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
