import {allowedOrigin,safeJson} from "../../../lib/auth";
import {fetchTeamChat,sendTeamChat} from "../../../lib/teamWorkflow";
export const runtime="nodejs";export const dynamic="force-dynamic";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function GET(request:Request){
 if(new URL(request.url).search)return safeJson({ok:false,error:"FILTER_DENIED"},400);
 const r=await fetchTeamChat();return safeJson(r,r.status);
}
export async function POST(request:Request){
 if(!allowedOrigin(request))return safeJson({ok:false,error:"ORIGIN_DENIED"},403);
 if(!request.headers.get("content-type")?.startsWith("application/json"))
  return safeJson({ok:false,error:"JSON_REQUIRED"},415);
 try{
  const raw=await request.text();
  if(!raw||raw.length>1200)return safeJson({ok:false,error:"PAYLOAD_TOO_LARGE"},413);
  const item:unknown=JSON.parse(raw);
  if(!item||typeof item!=="object"||Array.isArray(item))return safeJson({ok:false,error:"INVALID_PAYLOAD"},400);
  const v=item as Record<string,unknown>;
  if(Object.keys(v).sort().join("|")!=="body|nonce"||
    typeof v.nonce!=="string"||!UUID.test(v.nonce)||
    typeof v.body!=="string"||v.body.length<1||v.body.length>500||
    v.body!==v.body.trim()||/[\u0000-\u001f\u007f]/.test(v.body))
   return safeJson({ok:false,error:"INVALID_MESSAGE"},400);
  const r=await sendTeamChat(v.body,v.nonce);return safeJson(r,r.status);
 }catch{return safeJson({ok:false,error:"INVALID_JSON"},400);}
}
export function PUT(){return safeJson({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function PATCH(){return safeJson({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function DELETE(){return safeJson({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
