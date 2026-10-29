import {verifyVoxOwnerBearer} from "@/services/vox/verifiedStaffBearer";
import {getAosV2AdminSnapshot} from "@/services/aosV2AdminService";
import {projectOwnerAosHealth} from "@/contracts/vox/aosHealth.mjs";
export const runtime="nodejs";export const dynamic="force-dynamic";
const reply=(data:unknown,status:number)=>Response.json(data,{
 status,headers:{"cache-control":"private, no-store, max-age=0","vary":"Authorization","x-content-type-options":"nosniff"}});
export async function GET(request:Request){
 // Platform-wide AOS aggregates are NOT safe for city-scoped staff.
 if(process.env.VOX_AOS_HEALTH_ENABLED!=="staging")return reply({ok:false,error:"AOS_READ_DISABLED"},503);
 try{
  const owner=await verifyVoxOwnerBearer(request.headers.get("authorization"));
  if(!owner)return reply({ok:false,error:"OWNER_AAL2_REQUIRED"},403);
  const snapshot=await getAosV2AdminSnapshot(); // Real canonical Core service, no extra SQL.
  const view=projectOwnerAosHealth(snapshot);
  return reply({ok:true,view},200);
 }catch{return reply({ok:false,error:"AOS_READ_UNAVAILABLE"},503);}
}
export function POST(){return reply({ok:false,error:"READ_ONLY"},405);}
export function PUT(){return reply({ok:false,error:"READ_ONLY"},405);}
export function PATCH(){return reply({ok:false,error:"READ_ONLY"},405);}
export function DELETE(){return reply({ok:false,error:"READ_ONLY"},405);}
