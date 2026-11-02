import {allowedOrigin,safeJson} from "../../../lib/auth";
import {fetchCurrentStaffTime,submitStaffTimeCommand} from "../../../lib/staffTime";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(request:Request){
 if(new URL(request.url).search||new URL(request.url).hash)
  return safeJson({ok:false,error:"FILTER_DENIED"},400);
 const result=await fetchCurrentStaffTime();
 return safeJson(result,result.statusCode);
}
export async function POST(request:Request){
 if(process.env.VOX_VO4_WORKDAY_UI_ENABLED!=="staging"||
    process.env.VOX_VO3_TIME_WRITES_ENABLED!=="staging")
  return safeJson({ok:false,error:"STAFF_TIME_WRITES_NOT_CERTIFIED"},503);
 if(new URL(request.url).search||new URL(request.url).hash)
  return safeJson({ok:false,error:"FILTER_DENIED"},400);
 if(!allowedOrigin(request))return safeJson({ok:false,error:"ORIGIN_DENIED"},403);
 if(request.headers.get("content-type")?.split(";",1)[0]?.trim().toLowerCase()!=="application/json")
  return safeJson({ok:false,error:"JSON_REQUIRED"},415);
 let submitted=false;
 try{
  const raw=await request.text();
  if(raw.length===0||raw.length>500)return safeJson({ok:false,error:"INVALID_SIZE"},413);
  const command:unknown=JSON.parse(raw);
  if(!command||typeof command!=="object"||Array.isArray(command))
   return safeJson({ok:false,error:"INVALID_COMMAND"},400);
  submitted=true;
  const response=await submitStaffTimeCommand(command as
   Parameters<typeof submitStaffTimeCommand>[0]);
  // Expose only the exact Core receipt required for original nonce cleanup.
  if(response.ok)return safeJson(response.okReceipt,200);
  return safeJson({ok:false,error:response.error,
   ...("retrySameNonceOnly" in response?
    {retrySameNonceOnly:true,committed:null}:{})},response.statusCode);
 }catch{
  return submitted?safeJson({ok:false,error:"CORE_TIME_OUTCOME_UNKNOWN",
   committed:null,retrySameNonceOnly:true},503):
   safeJson({ok:false,error:"INVALID_TIME_JSON"},400);
 }
}
export function PUT(){return safeJson({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function PATCH(){return safeJson({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function DELETE(){return safeJson({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
