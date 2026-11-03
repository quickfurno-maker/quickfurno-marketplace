import {allowedOrigin,safeJson} from "../../../lib/auth";
import {fetchTeamAssignments,submitTeamAssignment} from "../../../lib/teamAssignments";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(request:Request){
 if(new URL(request.url).search||new URL(request.url).hash)
  return safeJson({ok:false,error:"FILTER_DENIED"},400);
 const r=await fetchTeamAssignments();
 return safeJson(r,r.status);
}
export async function POST(request:Request){
 if(process.env.VOX_VO5_TL_ASSIGNMENT_UI_ENABLED!=="staging"||
    process.env.VOX_VO5_TL_ASSIGNMENT_WRITES_ENABLED!=="staging")
  return safeJson({ok:false,error:"TL_ASSIGNMENT_NOT_CERTIFIED"},503);
 if(new URL(request.url).search||new URL(request.url).hash)
  return safeJson({ok:false,error:"FILTER_DENIED"},400);
 if(!allowedOrigin(request))return safeJson({ok:false,error:"ORIGIN_DENIED"},403);
 if(request.headers.get("content-type")?.split(";",1)[0]?.trim().toLowerCase()!=="application/json")
  return safeJson({ok:false,error:"JSON_REQUIRED"},415);
 let submitted=false;
 try{
  const raw=await request.text();
  if(raw.length<2||raw.length>600)return safeJson({ok:false,error:"INVALID_SIZE"},413);
  const body:unknown=JSON.parse(raw);
  if(!body||typeof body!=="object"||Array.isArray(body))
   return safeJson({ok:false,error:"INVALID_BODY"},400);
  submitted=true;
  const r=await submitTeamAssignment(body as Parameters<typeof submitTeamAssignment>[0]);
  if(r.ok)return safeJson(r.receipt,200);
  if("retrySameNonceOnly" in r)return safeJson({ok:false,
    error:"TL_ASSIGNMENT_OUTCOME_UNKNOWN",committed:null,
    retrySameNonceOnly:true},503);
  return safeJson({ok:false,error:r.error},r.status);
 }catch{
  return submitted?safeJson({ok:false,error:"TL_ASSIGNMENT_OUTCOME_UNKNOWN",
   committed:null,retrySameNonceOnly:true},503):
   safeJson({ok:false,error:"INVALID_JSON"},400);
 }
}
export function PUT(){return safeJson({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function PATCH(){return safeJson({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function DELETE(){return safeJson({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
