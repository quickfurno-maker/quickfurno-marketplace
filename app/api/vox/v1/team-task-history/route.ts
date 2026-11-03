import "server-only";
import {adminClient} from "@/lib/supabase";
import {getVerifiedScopedStaff} from "@/services/vox/verifiedScopedStaff";
import {projectVerifiedTlTaskHistory} from "@/contracts/vox/virtualOfficeTlTaskHistory.mjs";
import {intervalHistoryKeysetFilter} from "@/contracts/vox/virtualOfficeHistoryCursor.mjs";
export const runtime="nodejs";
export const dynamic="force-dynamic";
// VO7 intervals remain review-only. No staging env toggle can install schema,
// authorize payroll/EOD, or activate this reader without independent approval.
const VO10_MANAGED_TL_TASK_HISTORY_CERTIFIED=false as const;
const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROLES=["operations_manager","acquisition_agent","vendor_success_agent","support_agent"];
const headers={"cache-control":"private, no-store, max-age=0",
 "vary":"Authorization","x-content-type-options":"nosniff"};
const send=(value:unknown,status:number)=>Response.json(value,{status,headers});
const eligibleLeader=(x:Awaited<ReturnType<typeof getVerifiedScopedStaff>>)=>
 !!x&&x.role==="team_leader"&&x.canMutate===false&&x.canReadContent===false&&
 ID.test(x.userId)&&ID.test(x.teamId)&&ID.test(x.cityId);
const leaseValid=(date:unknown)=>typeof date==="string"&&
 Number.isFinite(Date.parse(date))&&Date.parse(date)>Date.now();
export async function GET(request:Request){
 if(!VO10_MANAGED_TL_TASK_HISTORY_CERTIFIED||
    process.env.VOX_VO10_TL_TASK_HISTORY_ENABLED!=="staging"||
    process.env.VOX_STAFF_GRANTS_ENABLED!=="staging"||
    process.env.VOX_DEPARTMENT_ENFORCEMENT_ENABLED!=="staging")
  return send({ok:false,error:"TEAM_TASK_HISTORY_NOT_CERTIFIED"},503);
 const url=new URL(request.url);
 const keys=[...url.searchParams.keys()];
 if(url.hash||keys.length>1||(keys.length===1&&keys[0]!=="cursor"))
  return send({ok:false,error:"FILTER_NOT_ALLOWED"},400);
 const cursor=keys.length?url.searchParams.get("cursor"):null;
 const filter=cursor===null?null:intervalHistoryKeysetFilter(cursor);
 if(cursor!==null&&!filter)
  return send({ok:false,error:"HISTORY_CURSOR_INVALID"},400);
 const auth=request.headers.get("authorization");
 try{
  const tl=await getVerifiedScopedStaff(auth);
  if(!eligibleLeader(tl))return send({ok:false,error:"TEAM_LEADER_AAL2_REQUIRED"},403);
  const db=adminClient();
  const roster=await db.from("vox_staff_memberships_v1")
   .select("auth_user_id,team_id,staff_role,is_active,revoked_at,expires_at")
   .eq("team_id",tl!.teamId).in("staff_role",ROLES)
   .eq("is_active",true).is("revoked_at",null)
   .gt("expires_at",new Date().toISOString())
   .order("auth_user_id",{ascending:true}).limit(21);
  if(roster.error||!roster.data||roster.data.length>20)
   return send({ok:false,error:"TEAM_TASK_ROSTER_INCOMPLETE"},503);
  const ids=roster.data.map(m=>m.auth_user_id);
  if(new Set(ids).size!==ids.length||roster.data.some(m=>
    !ID.test(String(m.auth_user_id))||m.team_id!==tl!.teamId||
    !ROLES.includes(m.staff_role)||m.is_active!==true||
    m.revoked_at!==null||!leaseValid(m.expires_at)))
   return send({ok:false,error:"TEAM_TASK_ROSTER_UNVERIFIED"},503);
  const [profiles,users]=await Promise.all([
   ids.length?db.from("profiles").select("id,role,is_active").in("id",ids).limit(21):
    Promise.resolve({data:[],error:null}),
   Promise.all(ids.map(id=>db.auth.admin.getUserById(id)))
  ]);
  if(profiles.error||!profiles.data||profiles.data.length!==ids.length||
   users.some((x,i)=>x.error||x.data.user?.id!==ids[i]||
    x.data.user.app_metadata?.qf_principal!=="vox_staff"||
    x.data.user.app_metadata?.admin_role!=null))
   return send({ok:false,error:"TEAM_TASK_STAFF_AUTH_UNVERIFIED"},503);
  const members=roster.data.map(m=>{
   const p=profiles.data.find(x=>x.id===m.auth_user_id);
   return {staffId:m.auth_user_id,teamId:tl!.teamId,cityId:tl!.cityId,
    role:m.staff_role,verifiedNeutralStaff:!!p&&p.role===null&&p.is_active===true};
  });
  if(members.some(x=>x.verifiedNeutralStaff!==true))
   return send({ok:false,error:"TEAM_TASK_NEUTRAL_STAFF_REQUIRED"},503);
  let query=db.from("vox_vo7_staff_task_intervals_candidate_v1")
   .select("closed_by_event_nonce,staff_id,team_id,city_id,work_item_id,started_at,ended_at,elapsed_ms,state_revision,closing_action")
   .eq("team_id",tl!.teamId).eq("city_id",tl!.cityId);
  if(ids.length)query=query.in("staff_id",ids);
  if(filter)query=query.or(filter);
  const times=ids.length?await query.order("ended_at",{ascending:false})
   .order("closed_by_event_nonce",{ascending:false}).limit(21):
   {data:[],error:null};
  if(times.error||!times.data||times.data.length>21)
   return send({ok:false,error:"TEAM_TASK_INTERVAL_SOURCE_UNAVAILABLE"},503);
  const [latest,refreshed]=await Promise.all([
   getVerifiedScopedStaff(auth),
   ids.length?db.from("vox_staff_memberships_v1")
    .select("auth_user_id,team_id,staff_role,is_active,revoked_at,expires_at")
    .in("auth_user_id",ids).limit(21):
    Promise.resolve({data:[],error:null})
  ]);
  if(!eligibleLeader(latest)||latest!.userId!==tl!.userId||
   latest!.teamId!==tl!.teamId||latest!.cityId!==tl!.cityId||
   refreshed.error||!refreshed.data||refreshed.data.length!==ids.length||
   roster.data.some(before=>{
    const after=refreshed.data.find(x=>x.auth_user_id===before.auth_user_id);
    return !after||after.team_id!==before.team_id||
      after.staff_role!==before.staff_role||after.is_active!==true||
      after.revoked_at!==null||!leaseValid(after.expires_at);
   }))return send({ok:false,error:"TEAM_TASK_SCOPE_CHANGED"},403);
  const projected=projectVerifiedTlTaskHistory(members,times.data,{
   leaderId:tl!.userId,teamId:tl!.teamId,cityId:tl!.cityId,
   serverNowMs:Date.now(),rosterVerified:true,rowSourceVerified:true
  });
  if(projected.ok!==true)
   return send({ok:false,error:"TEAM_TASK_HISTORY_INTEGRITY_UNVERIFIED"},503);
  return send(projected,200);
 }catch{return send({ok:false,error:"TEAM_TASK_HISTORY_UNAVAILABLE"},503);}
}
export function POST(){return send({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function PUT(){return send({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function PATCH(){return send({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function DELETE(){return send({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
