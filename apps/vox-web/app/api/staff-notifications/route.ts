import {allowedOrigin,safeJson} from "../../../lib/auth";
import {fetchStaffNotifications,markStaffNotificationRead}
 from "../../../lib/staffNotifications";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function GET(request:Request){
 if(new URL(request.url).search)return safeJson({ok:false,error:"FILTER_DENIED"},400);
 const result=await fetchStaffNotifications();
 return safeJson(result,result.status);
}
export async function POST(request:Request){
 if(!allowedOrigin(request))return safeJson({ok:false,error:"ORIGIN_DENIED"},403);
 if(!request.headers.get("content-type")?.startsWith("application/json"))
  return safeJson({ok:false,error:"JSON_REQUIRED"},415);
 try{
  const raw=await request.text();
  if(!raw||raw.length>180)return safeJson({ok:false,error:"SIZE_DENIED"},413);
  const parsed:unknown=JSON.parse(raw);
  if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))
   return safeJson({ok:false,error:"INVALID_BODY"},400);
  const body=parsed as Record<string,unknown>;
  if(Object.keys(body).sort().join("|")!=="nonce|notificationId"||
     typeof body.nonce!=="string"||!UUID.test(body.nonce)||
     typeof body.notificationId!=="string"||!UUID.test(body.notificationId))
   return safeJson({ok:false,error:"INVALID_READ_REQUEST"},400);
  const r=await markStaffNotificationRead(body.notificationId,body.nonce);
  return safeJson(r,r.status);
 }catch{return safeJson({ok:false,error:"INVALID_JSON"},400);}
}
export function PUT(){return safeJson({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function PATCH(){return safeJson({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function DELETE(){return safeJson({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
