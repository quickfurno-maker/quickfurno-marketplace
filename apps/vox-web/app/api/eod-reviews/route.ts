import {allowedOrigin,safeJson} from "../../../lib/auth";
import {fetchTlEodQueue,decideTlEod} from "../../../lib/teamWorkflow";
export const runtime="nodejs";export const dynamic="force-dynamic";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function GET(request:Request){
 if(new URL(request.url).search)return safeJson({ok:false,error:"FILTER_DENIED"},400);
 const r=await fetchTlEodQueue();return safeJson(r,r.status);
}
export async function POST(request:Request){
 if(!allowedOrigin(request))return safeJson({ok:false,error:"ORIGIN_DENIED"},403);
 if(!request.headers.get("content-type")?.startsWith("application/json"))
  return safeJson({ok:false,error:"JSON_REQUIRED"},415);
 try{
  const raw=await request.text();
  if(!raw||raw.length>230)return safeJson({ok:false,error:"PAYLOAD_TOO_LARGE"},413);
  const data:unknown=JSON.parse(raw);
  if(!data||typeof data!=="object"||Array.isArray(data))
   return safeJson({ok:false,error:"INVALID_PAYLOAD"},400);
  const v=data as Record<string,unknown>;
  if(Object.keys(v).sort().join("|")!=="decision|nonce|reportId"||
    typeof v.nonce!=="string"||!UUID.test(v.nonce)||
    typeof v.reportId!=="string"||!UUID.test(v.reportId)||
    !["ACKNOWLEDGED","REJECTED"].includes(String(v.decision)))
   return safeJson({ok:false,error:"INVALID_REVIEW"},400);
  const r=await decideTlEod(v.reportId,v.nonce,String(v.decision));
  return safeJson(r,r.status);
 }catch{return safeJson({ok:false,error:"INVALID_JSON"},400);}
}
export function PUT(){return safeJson({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function PATCH(){return safeJson({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function DELETE(){return safeJson({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
