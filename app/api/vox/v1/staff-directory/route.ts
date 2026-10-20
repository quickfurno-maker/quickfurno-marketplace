import "server-only";
import {adminClient} from "@/lib/supabase";
import {verifyVoxOwnerBearer} from "@/services/vox/verifiedStaffBearer";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STAFF_ROLES=new Set([
 "operations_manager","acquisition_agent","vendor_success_agent",
 "support_agent","team_leader","auditor"
]);
const send=(value:unknown,status:number)=>Response.json(value,{status,headers:{
 "cache-control":"private, no-store, max-age=0",
 "vary":"Authorization","x-content-type-options":"nosniff"
}});
const validId=(x:unknown):x is string=>typeof x==="string"&&UUID.test(x);
const validExpiry=(x:unknown)=>typeof x==="string"&&
 x.length<=40&&Number.isFinite(Date.parse(x));
/** Owner-only bounded roster preview. No emails, phone, tokens or grants. */
export async function GET(request:Request){
 if(process.env.VOX_STAFF_GRANTS_ENABLED!=="staging"||
    process.env.VOX_STAFF_DIRECTORY_ENABLED!=="staging")
   return send({ok:false,error:"STAFF_DIRECTORY_DISABLED"},503);
 const url=new URL(request.url);
 if(url.search||url.hash)return send({ok:false,error:"FILTERS_NOT_CERTIFIED"},400);
 try{
  const owner=await verifyVoxOwnerBearer(request.headers.get("authorization"));
  if(!owner)return send({ok:false,error:"ADMIN_AAL2_REQUIRED"},403);
  const db=adminClient();
  const membership=await db.from("vox_staff_memberships_v1")
   .select("auth_user_id,team_id,staff_role,is_active,expires_at,revoked_at")
   .order("auth_user_id",{ascending:true}).limit(41);
  if(membership.error||!membership.data||membership.data.length>40)
   return send({ok:false,error:"DIRECTORY_UNAVAILABLE_OR_OVER_LIMIT"},503);
  const ids=[...new Set(membership.data.map(m=>m.team_id))];
  const teams=ids.length?await db.from("vox_staff_teams_v1")
   .select("id,city_id,is_active").in("id",ids).limit(41):
    {data:[],error:null};
  if(teams.error||!teams.data||teams.data.length!==ids.length)
   return send({ok:false,error:"DIRECTORY_TEAM_UNAVAILABLE"},503);
  const byTeam=new Map(teams.data.map(t=>[t.id,t]));
  const members=[] as Array<{
    staffRef:string;staffRole:string;teamRef:string;cityRef:string;
    state:"ACTIVE"|"SUSPENDED_OR_EXPIRED";expiresAt:string
  }>;
  for(const m of membership.data){
   const team=byTeam.get(m.team_id);
   if(!validId(m.auth_user_id)||!validId(m.team_id)||
      !STAFF_ROLES.has(m.staff_role)||
      !team||!validId(team.city_id)||!validExpiry(m.expires_at)||
      typeof m.is_active!=="boolean"||typeof team.is_active!=="boolean"||
      !(m.revoked_at===null||validExpiry(m.revoked_at)))
    return send({ok:false,error:"DIRECTORY_RECORD_UNTRUSTED"},503);
   const active=m.is_active&&m.revoked_at===null&&team.is_active&&
     Date.parse(m.expires_at)>Date.now();
   members.push({
     staffRef:"STAFF-"+m.auth_user_id.slice(0,8),
     staffRole:m.staff_role,
     teamRef:"TEAM-"+m.team_id.slice(0,8),
     cityRef:"CITY-"+team.city_id.slice(0,8),
     state:active?"ACTIVE":"SUSPENDED_OR_EXPIRED",
     expiresAt:m.expires_at
   });
  }
  // RC1: Owner may be revoked or lose AAL2 while the roster is fetched.
  // Do not return even masked Staff/team metadata on an old Owner scope.
  const currentOwner=await verifyVoxOwnerBearer(request.headers.get("authorization"));
  if(!currentOwner||currentOwner!==owner)
   return send({ok:false,error:"OWNER_AUTH_REVOKED_DURING_DIRECTORY_READ"},403);
  return send({ok:true,schema:"qf.vox.staff.directory.preview.v1",
   source:"quickfurno-core",mode:"READ_ONLY",actionsEnabled:false,
   totalKnown:false,previewCount:members.length,members},200);
 }catch{return send({ok:false,error:"DIRECTORY_UNAVAILABLE"},503);}
}
for(const name of ["POST","PUT","PATCH","DELETE"]){
 void name; // All mutation verbs stay disabled in this source-only endpoint.
}
export function POST(){return send({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function PUT(){return send({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function PATCH(){return send({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function DELETE(){return send({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
