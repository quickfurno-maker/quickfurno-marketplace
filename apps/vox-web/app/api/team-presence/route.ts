import {allowedOrigin,safeJson} from "../../../lib/auth";
import {fetchVerifiedTeamPresence,setMyPresenceStatus} from "../../../lib/teamPresence";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(request:Request){
 if(new URL(request.url).search||new URL(request.url).hash)
  return safeJson({ok:false,error:"FILTER_DENIED"},400);
 const r=await fetchVerifiedTeamPresence();
 return safeJson(r,r.status);
}
export async function POST(request:Request){
 if(process.env.VOX_VO6_PRESENCE_UI_ENABLED!=="staging"||
    process.env.VOX_VO6_PRESENCE_WRITE_ENABLED!=="staging")
  return safeJson({ok:false,error:"PRESENCE_NOT_CERTIFIED"},503);
 if(new URL(request.url).search||new URL(request.url).hash)
  return safeJson({ok:false,error:"FILTER_DENIED"},400);
 if(!allowedOrigin(request))return safeJson({ok:false,error:"ORIGIN_DENIED"},403);
 if(request.headers.get("content-type")?.split(";",1)[0]?.trim().toLowerCase()!=="application/json")
  return safeJson({ok:false,error:"JSON_REQUIRED"},415);
 let body:Record<string,unknown>;
 try{
  const raw=await request.text();
  if(!raw||raw.length>72)return safeJson({ok:false,error:"INVALID_SIZE"},413);
  const value:unknown=JSON.parse(raw);
  if(!value||typeof value!=="object"||Array.isArray(value))
   return safeJson({ok:false,error:"INVALID_BODY"},400);
  body=value as Record<string,unknown>;
 }catch{return safeJson({ok:false,error:"INVALID_JSON"},400);}
 if(Object.keys(body).join("|")!=="state"||
    !["ONLINE","AWAY","BUSY","IN_MEETING","ON_BREAK"].includes(String(body.state)))
  return safeJson({ok:false,error:"INVALID_PRESENCE_SIGNAL"},400);
 const r=await setMyPresenceStatus(body.state as string);
 if(!r.ok)return safeJson({ok:false,error:r.error},r.status);
 return safeJson(r.receipt,200);
}
export function PUT(){return safeJson({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function PATCH(){return safeJson({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function DELETE(){return safeJson({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
