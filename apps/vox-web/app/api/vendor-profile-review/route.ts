import {safeJson} from "../../../lib/auth";
import {fetchScopedProfileReviews} from "../../../lib/core";
export const runtime="nodejs";export const dynamic="force-dynamic";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;
export async function GET(request:Request){
 const url=new URL(request.url);
 if([...url.searchParams.keys()].length!==1||!url.searchParams.has("vendorId")||
  !UUID.test(url.searchParams.get("vendorId")??""))
  return safeJson({ok:false,error:"INVALID_VENDOR"},400);
 const result=await fetchScopedProfileReviews(url.searchParams.get("vendorId")!);
 return safeJson(result,result.status);
}
export function POST(){return safeJson({ok:false,error:"NATIVE_CORE_APPROVAL_ONLY"},405);}
export function PATCH(){return safeJson({ok:false,error:"NATIVE_CORE_APPROVAL_ONLY"},405);}
export function DELETE(){return safeJson({ok:false,error:"NATIVE_CORE_APPROVAL_ONLY"},405);}
