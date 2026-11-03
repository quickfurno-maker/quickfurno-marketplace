import "server-only";
import {adminClient} from "@/lib/supabase";
import {getVerifiedScopedStaff} from "@/services/vox/verifiedScopedStaff";
import {buildVerifiedTeamShiftWindow} from "@/contracts/vox/virtualOfficeTeamShiftRead.mjs";
export const runtime="nodejs";
export const dynamic="force-dynamic";
// Review-only time table is not approved on managed Staging. A deployment
// environment toggle can never override this literal code gate.
const VO5_MANAGED_TEAM_SHIFT_REPORT_CERTIFIED=false as const;
const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;
const send=(body:unknown,status:number)=>Response.json(body,{status,headers:{
 "cache-control":"private, no-store, max-age=0","vary":"Authorization",
 "x-content-type-options":"nosniff"}});
export async function GET(request:Request){
 if(!VO5_MANAGED_TEAM_SHIFT_REPORT_CERTIFIED||
    process.env.VOX_VO5_TEAM_SHIFTS_ENABLED!=="staging"||
    process.env.VOX_DEPARTMENT_ENFORCEMENT_ENABLED!=="staging"||
    process.env.VOX_STAFF_GRANTS_ENABLED!=="staging")
  return send({ok:false,error:"TEAM_SHIFT_READ_NOT_CERTIFIED"},503);
 if(new URL(request.url).search||new URL(request.url).hash)
  return send({ok:false,error:"FILTER_NOT_ALLOWED"},400);
 const header=request.headers.get("authorization");
 try{
  const tl=await getVerifiedScopedStaff(header);
  if(!tl||tl.role!=="team_leader"||tl.canReadContent!==false||
    tl.canMutate!==false)
   return send({ok:false,error:"TEAM_LEADER_AAL2_REQUIRED"},403);
  const db=adminClient();
  const roster=await db.from("vox_staff_memberships_v1")
   .select("auth_user_id,team_id,staff_role,is_active,revoked_at,expires_at")
   .eq("team_id",tl.teamId).eq("is_active",true)
   .is("revoked_at",null).order("auth_user_id",{ascending:true}).limit(22);
  if(roster.error||!roster.data||roster.data.length>21)
   return send({ok:false,error:"TEAM_ROSTER_INCOMPLETE"},503);
  const rows=roster.data.filter(m=>m.staff_role!=="team_leader"&&
   m.staff_role!=="auditor"&&m.auth_user_id!==tl.userId);
  if(rows.length>20||rows.some(m=>!ID.test(String(m.auth_user_id))||
    m.team_id!==tl.teamId||m.is_active!==true||
    m.revoked_at!==null||!Number.isFinite(Date.parse(m.expires_at))||
    Date.parse(m.expires_at)<=Date.now()))
   return send({ok:false,error:"STAFF_ROSTER_UNVERIFIED"},503);
  const ids=rows.map(x=>x.auth_user_id);
  if(new Set(ids).size!==ids.length)
   return send({ok:false,error:"DUPLICATE_STAFF_ROSTER"},503);
  const profiles=ids.length?await db.from("profiles")
   .select("id,role,is_active").in("id",ids).limit(21):
    {data:[],error:null};
  const authUsers=await Promise.all(ids.map(id=>db.auth.admin.getUserById(id)));
  if(profiles.error||!profiles.data||profiles.data.length!==ids.length||
    authUsers.some((u,i)=>u.error||u.data.user?.id!==ids[i]||
     u.data.user?.app_metadata?.qf_principal!=="vox_staff"||
     u.data.user?.app_metadata?.admin_role!=null))
   return send({ok:false,error:"STAFF_AUTH_PRINCIPAL_UNVERIFIED"},503);
  const members=rows.map(m=>{
   const p=profiles.data.find(x=>x.id===m.auth_user_id);
   return {staffId:m.auth_user_id,teamId:tl.teamId,cityId:tl.cityId,
    role:m.staff_role,verifiedNeutralStaff:!!p&&p.role===null&&p.is_active===true};
  });
  if(members.some(m=>!m.verifiedNeutralStaff))
   return send({ok:false,error:"STAFF_PROFILE_UNVERIFIED"},503);
  const ledger=ids.length?await db.from("vox_vo2_staff_time_state_candidate_v1")
   .select("staff_id,team_id,city_id,revision,clocked_in_at,clocked_out_at,break_started_at,total_break_ms,active_work_item_id,task_started_at,last_work_item_id,task_time_ms,last_event_at")
   .in("staff_id",ids).limit(21):
    {data:[],error:null};
  if(ledger.error||!ledger.data||ledger.data.length>20)
   return send({ok:false,error:"TEAM_SHIFT_LEDGER_UNAVAILABLE"},503);
  const result=buildVerifiedTeamShiftWindow(members,ledger.data,{
   leaderId:tl.userId,teamId:tl.teamId,cityId:tl.cityId,
   serverNowMs:Date.now(),rosterVerified:true,rowSourceVerified:true
  });
  if(result.ok!==true)return send({ok:false,error:"TEAM_SHIFT_INTEGRITY_UNVERIFIED"},503);
  const latest=await getVerifiedScopedStaff(header);
  if(!latest||latest.role!=="team_leader"||latest.userId!==tl.userId||
    latest.teamId!==tl.teamId||latest.cityId!==tl.cityId||
    latest.canReadContent!==false||latest.canMutate!==false)
   return send({ok:false,error:"TEAM_SHIFT_LEADER_REVOKED"},403);
  return send(result,200);
 }catch{return send({ok:false,error:"TEAM_SHIFT_READ_UNAVAILABLE"},503);}
}
export function POST(){return send({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function PUT(){return send({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function PATCH(){return send({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function DELETE(){return send({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
