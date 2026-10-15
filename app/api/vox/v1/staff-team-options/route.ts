import "server-only";
import {adminClient} from "@/lib/supabase";
import {verifyVoxOwnerBearer} from "@/services/vox/verifiedStaffBearer";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// Core uses ONLY its existing verified Superadmin principal. No second Admin.
const send=(body:unknown,status:number)=>Response.json(body,{status,headers:{
 "cache-control":"private, no-store, max-age=0","vary":"Authorization",
 "x-content-type-options":"nosniff"
}});
const id=(v:unknown):v is string=>typeof v==="string"&&
 /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
/** Owner-AAL2 only, bounded, live Core city/team options; READ ONLY.
 * No employee email, staff record, invite, permissions or migration.
 */
export async function GET(request:Request){
 if(process.env.VOX_STAFF_GRANTS_ENABLED!=="staging"||
    process.env.VOX_STAFF_TEAM_OPTIONS_ENABLED!=="staging")
  return send({ok:false,error:"TEAM_OPTIONS_DISABLED"},503);
 const url=new URL(request.url);
 if(url.search||url.hash)return send({ok:false,error:"FILTER_UNSUPPORTED"},400);
 try{
  const owner=await verifyVoxOwnerBearer(request.headers.get("authorization"));
  if(!owner)return send({ok:false,error:"CORE_SUPERADMIN_AAL2_REQUIRED"},403);
  const db=adminClient();
  const teams=await db.from("vox_staff_teams_v1")
   .select("id,city_id,is_active").order("id",{ascending:true}).limit(41);
  if(teams.error||!teams.data||teams.data.length>40)
   return send({ok:false,error:"TEAMS_UNAVAILABLE_OR_OVER_LIMIT"},503);
  const cityIds=[...new Set(teams.data.map(t=>t.city_id))];
  const cities=cityIds.length?await db.from("cities")
   .select("id,is_active").in("id",cityIds).limit(41):{data:[],error:null};
  if(cities.error||!cities.data||cities.data.length!==cityIds.length)
   return send({ok:false,error:"CITY_VERIFICATION_UNAVAILABLE"},503);
  const byCity=new Map(cities.data.map(c=>[c.id,c]));
  const items:Array<{teamId:string;cityId:string}>=[];
  for(const t of teams.data){
   if(!id(t.id)||!id(t.city_id)||typeof t.is_active!=="boolean"||
      typeof byCity.get(t.city_id)?.is_active!=="boolean")
    return send({ok:false,error:"INVALID_TEAM_CITY_RECORD"},503);
   if(t.is_active&&byCity.get(t.city_id)?.is_active===true)
    items.push({teamId:t.id,cityId:t.city_id});
  }
  return send({ok:true,schema:"qf.vox.staff.team-options.v1",
   mode:"READ_ONLY",actionsEnabled:false,totalKnown:false,
   previewCount:items.length,items},200);
 }catch{return send({ok:false,error:"TEAM_OPTIONS_UNAVAILABLE"},503);}
}
export function POST(){return send({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function PUT(){return send({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function PATCH(){return send({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function DELETE(){return send({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
