import {safeJson} from "../../../lib/auth";
import {fetchStaffEodPreview} from "../../../lib/eod";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(request:Request){
 const url=new URL(request.url);
 if(url.search||url.hash)return safeJson({ok:false,error:"UNSUPPORTED_EOD_FILTER"},400);
 const result=await fetchStaffEodPreview();
 return safeJson(result,result.status);
}
export function POST(){return safeJson({ok:false,error:"READ_ONLY"},405);}
export function PUT(){return safeJson({ok:false,error:"READ_ONLY"},405);}
export function PATCH(){return safeJson({ok:false,error:"READ_ONLY"},405);}
export function DELETE(){return safeJson({ok:false,error:"READ_ONLY"},405);}
