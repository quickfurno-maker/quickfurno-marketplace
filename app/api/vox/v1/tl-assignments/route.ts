import "server-only";
import {adminClient} from "@/lib/supabase";
import {getVerifiedScopedStaff} from "@/services/vox/verifiedScopedStaff";
import {assignScopedTeamWork} from "@/services/vox/virtualOfficeTeamAssignment.mjs";
export const runtime="nodejs";
export const dynamic="force-dynamic";
// No environment variable can activate SQL that has not been DBA/AppSec
// certified and restored into the real managed Staging schema.
const VO5_MANAGED_TL_ASSIGNMENT_CERTIFIED=false as const;
const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const send=(body:unknown,status:number)=>Response.json(body,{status,headers:{
 "cache-control":"private, no-store, max-age=0","vary":"Authorization",
 "x-content-type-options":"nosniff"}});
type Scope=NonNullable<Awaited<ReturnType<typeof getVerifiedScopedStaff>>>;
const checkTeam=(s:Scope|null):s is Scope=>!!s&&s.role==="team_leader"&&
 s.canReadContent===false&&s.canMutate===false&&
 ID.test(s.userId)&&ID.test(s.teamId)&&ID.test(s.cityId);
async function verifiedTeam(header:string|null){
 const scope=await getVerifiedScopedStaff(header);
 if(!checkTeam(scope))return null;
 return scope;
}
/** Team Leader sees only work-item references and internal Staff references.
 * No client/vendor data, WhatsApp messages or broad unbounded team totals.
 */
export async function GET(request:Request){
 if(!VO5_MANAGED_TL_ASSIGNMENT_CERTIFIED||
    process.env.VOX_VO5_TL_ASSIGNMENT_READ_ENABLED!=="staging"||
    process.env.VOX_DEPARTMENT_ENFORCEMENT_ENABLED!=="staging"||
    process.env.VOX_STAFF_GRANTS_ENABLED!=="staging")
  return send({ok:false,error:"TL_ASSIGNMENT_NOT_CERTIFIED"},503);
 if(new URL(request.url).search||new URL(request.url).hash)
  return send({ok:false,error:"FILTER_NOT_ALLOWED"},400);
 try{
  const current=await verifiedTeam(request.headers.get("authorization"));
  if(!current)return send({ok:false,error:"CURRENT_TL_AAL2_REQUIRED"},403);
  const db=adminClient();
  const tasks=await db.from("vox_work_items_candidate_v1")
   .select("id,state,revision,source_kind,team_id,city_id,assignee_id")
   .eq("team_id",current.teamId).eq("city_id",current.cityId)
   .eq("state","NEW").is("assignee_id",null)
   .order("id",{ascending:true}).limit(21);
  const members=await db.from("vox_staff_memberships_v1")
   .select("auth_user_id,staff_role,team_id,is_active,revoked_at,expires_at")
   .eq("team_id",current.teamId).eq("is_active",true)
   .is("revoked_at",null).order("auth_user_id",{ascending:true}).limit(201);
  if(tasks.error||members.error||!tasks.data||!members.data||
     tasks.data.length>21||members.data.length>200)
   return send({ok:false,error:"TEAM_ASSIGNMENT_SOURCE_UNAVAILABLE"},503);
  // Guard against stale team joins, hostile database types and self-selection.
  const safeItems=[] as Array<{itemId:string;revision:number;kind:string;state:"NEW"}>;
  for(const row of tasks.data.slice(0,20)){
   if(!ID.test(String(row.id))||row.team_id!==current.teamId||
      row.city_id!==current.cityId||row.state!=="NEW"||
      row.assignee_id!==null||
      !["prospect","vendor","support_thread"].includes(String(row.source_kind))||
      !Number.isSafeInteger(row.revision)||row.revision<0||
      row.revision>2147483646)
    return send({ok:false,error:"TEAM_ASSIGNMENT_SOURCE_UNTRUSTED"},503);
   safeItems.push({itemId:row.id,revision:row.revision,
    kind:row.source_kind,state:"NEW"});
  }
  const targetIds=members.data.filter(row=>row.auth_user_id!==current.userId&&
    !["team_leader","auditor"].includes(row.staff_role)&&
    ID.test(String(row.auth_user_id))&&row.is_active===true&&
    row.revoked_at===null&&Number.isFinite(Date.parse(row.expires_at))&&
    Date.parse(row.expires_at)>Date.now()).map(row=>row.auth_user_id);
  if(targetIds.length>20)return send({ok:false,error:"STAFF_TARGET_WINDOW_TOO_LARGE"},503);
  const profiles=targetIds.length?await db.from("profiles")
   .select("id,role,is_active").in("id",targetIds).limit(21):
    {data:[],error:null};
  if(profiles.error||!profiles.data||profiles.data.length!==targetIds.length)
   return send({ok:false,error:"TARGET_IDENTITY_SOURCE_UNAVAILABLE"},503);
  const identities=await Promise.all(targetIds.map(id=>db.auth.admin.getUserById(id)));
  if(identities.some((identity,i)=>identity.error||
      identity.data.user?.id!==targetIds[i]||
      identity.data.user?.app_metadata?.qf_principal!=="vox_staff"||
      identity.data.user?.app_metadata?.admin_role!==undefined))
   return send({ok:false,error:"TARGET_IDENTITY_NOT_NEUTRAL"},503);
  const staff=[] as Array<{staffId:string;ref:string}>;
  for(const id of targetIds){
   const profile=profiles.data.find(p=>p.id===id);
   if(!profile||profile.role!==null||profile.is_active!==true)
    return send({ok:false,error:"TARGET_PROFILE_UNTRUSTED"},503);
   staff.push({staffId:id,ref:"STAFF-"+id.slice(0,8).toUpperCase()});
  }
  const after=await verifiedTeam(request.headers.get("authorization"));
  if(!after||after.userId!==current.userId||after.teamId!==current.teamId||
     after.cityId!==current.cityId)
   return send({ok:false,error:"TL_AUTHORITY_CHANGED_DURING_READ"},403);
  return send({ok:true,schema:"qf.vox.tl.assignment.preview.v1",
   mode:"REFERENCES_ONLY",boundedWindow:true,totalKnown:false,
   actionsEnabled:false,items:safeItems,staff,
   externalMessagesSent:0,marketplaceLeadAssignmentsChanged:0},200);
 }catch{return send({ok:false,error:"TL_ASSIGNMENT_SOURCE_UNAVAILABLE"},503);}
}
export async function POST(request:Request){
 if(!VO5_MANAGED_TL_ASSIGNMENT_CERTIFIED||
    process.env.VOX_VO5_TL_ASSIGNMENT_WRITES_ENABLED!=="staging"||
    process.env.VOX_STAFF_GRANTS_ENABLED!=="staging"||
    process.env.VOX_DEPARTMENT_ENFORCEMENT_ENABLED!=="staging")
  return send({ok:false,error:"TL_ASSIGNMENT_NOT_CERTIFIED"},503);
 if(new URL(request.url).search||new URL(request.url).hash)
  return send({ok:false,error:"FILTER_NOT_ALLOWED"},400);
 if(request.headers.get("content-type")?.split(";",1)[0]?.trim().toLowerCase()!=="application/json")
  return send({ok:false,error:"JSON_REQUIRED"},415);
 let body:unknown;
 try{
  const raw=await request.text();
  if(raw.length<2||raw.length>600)return send({ok:false,error:"PAYLOAD_SIZE_INVALID"},413);
  body=JSON.parse(raw);
 }catch{return send({ok:false,error:"INVALID_JSON"},400);}
 // The original nonce and revision are handled solely in the atomic SQL.
 // No second nonce or fallback after a possible write.
 const header=request.headers.get("authorization");
 const db=adminClient();
 try{
  const response=await assignScopedTeamWork(body,{
   environment:"staging",enabled:()=>process.env.VOX_VO5_TL_ASSIGNMENT_WRITES_ENABLED==="staging",
   reviewedWriterInstalled:()=>VO5_MANAGED_TL_ASSIGNMENT_CERTIFIED,
   currentLeader:async()=>{
    const scope=await verifiedTeam(header);
    return scope?{userId:scope.userId,teamId:scope.teamId,cityId:scope.cityId,
     role:"team_leader",canMutate:false,canReadContent:false,
     verifiedDepartments:[...(scope.verifiedDepartments??[])]}:null;
   },
   currentTarget:async(targetId:string)=>{
    if(!ID.test(targetId))return null;
    const tl=await verifiedTeam(header);
    if(!tl)return null;
    const member=await db.from("vox_staff_memberships_v1")
     .select("auth_user_id,team_id,staff_role,is_active,revoked_at,expires_at")
     .eq("auth_user_id",targetId).maybeSingle();
    const profile=await db.from("profiles").select("id,role,is_active")
     .eq("id",targetId).maybeSingle();
    const identity=await db.auth.admin.getUserById(targetId);
    const grants=await db.from("vox_staff_object_scopes_v1")
     .select("scope_kind,object_id,expires_at,revoked_at")
     .eq("auth_user_id",targetId).is("revoked_at",null).limit(201);
    if(member.error||profile.error||identity.error||grants.error||
       !member.data||!profile.data||!identity.data.user||!grants.data||
       grants.data.length>200||
       profile.data.id!==targetId||profile.data.role!==null||
       profile.data.is_active!==true||identity.data.user.id!==targetId||
       identity.data.user.app_metadata?.qf_principal!=="vox_staff"||
       identity.data.user.app_metadata?.admin_role!==undefined||
       member.data.team_id!==tl.teamId||
       member.data.auth_user_id!==targetId||
       member.data.is_active!==true||
       member.data.revoked_at!==null||
       !Number.isFinite(Date.parse(member.data.expires_at))||
       Date.parse(member.data.expires_at)<=Date.now())return null;
    const now=Date.now();
    return {userId:targetId,teamId:tl.teamId,cityId:tl.cityId,
     role:member.data.staff_role,active:true,revoked:false,
     verifiedNeutralStaff:true,objectGrants:grants.data.filter(g=>
       g.revoked_at===null&&Date.parse(g.expires_at)>now&&
       ["prospect","vendor","support_thread"].includes(g.scope_kind))
       .map(g=>({kind:g.scope_kind,id:g.object_id}))};
   },
   currentWork:async(itemId:string)=>{
    if(!ID.test(itemId))return null;
    const current=await verifiedTeam(header);
    if(!current)return null;
    const r=await db.from("vox_work_items_candidate_v1")
     .select("id,team_id,city_id,state,assignee_id,source_kind,source_id,related_vendor_id")
     .eq("id",itemId).eq("team_id",current.teamId)
     .eq("city_id",current.cityId).maybeSingle();
    if(r.error||!r.data)return null;
    return {id:r.data.id,teamId:r.data.team_id,cityId:r.data.city_id,
     state:r.data.state,assigneeId:r.data.assignee_id,
     sourceKind:r.data.source_kind,sourceId:r.data.source_id,
     relatedVendorId:r.data.related_vendor_id};
   },
   rpc:async(name:string,args:Record<string,unknown>)=>db.rpc(name,args)
  });
  if(response.ok!==true){
   if(response.reason==="TL_ASSIGNMENT_OUTCOME_UNKNOWN")
    return send({ok:false,error:"TL_ASSIGNMENT_OUTCOME_UNKNOWN",
     committed:null,retrySameNonceOnly:true},503);
   return send({ok:false,error:response.reason},403);
  }
  return send({ok:true,schema:"qf.vox.tl.assignment.receipt.v1",
   itemId:response.itemId,targetStaffId:response.targetStaffId,
   nonce:response.nonce,revision:response.revision,
   externalMessagesSent:0,vendorAssignmentsChanged:0,moneyMinorUnits:0},200);
 }catch{return send({ok:false,error:"TL_ASSIGNMENT_OUTCOME_UNKNOWN",
   committed:null,retrySameNonceOnly:true},503);}
}
export function PUT(){return send({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function PATCH(){return send({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function DELETE(){return send({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
