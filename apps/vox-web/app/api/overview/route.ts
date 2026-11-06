import {safeJson} from "../../../lib/auth";
import {fetchStaffOverview} from "../../../lib/core";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(){const result=await fetchStaffOverview();return safeJson(result,result.status);}
export function POST(){return safeJson({ok:false,error:"READ_ONLY"},405);}
