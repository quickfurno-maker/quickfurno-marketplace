import {safeJson} from "../../../lib/auth";
import {fetchConversationCandidates} from "../../../lib/conversationControl";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(request:Request){
 const u=new URL(request.url);
 if(u.search||u.hash)return safeJson({ok:false,error:"FILTER_DENIED"},400);
 const result=await fetchConversationCandidates();
 return safeJson(result,result.status);
}
const denied=()=>safeJson({ok:false,error:"READ_ONLY"},405);
export const POST=denied;export const PUT=denied;
export const PATCH=denied;export const DELETE=denied;
