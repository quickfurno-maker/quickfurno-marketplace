import {safeJson} from "../../../lib/auth";
import {fetchStaffOverview} from "../../../lib/core";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(){if(process.env.VOX_STAFF_VIEW_MODE!=="owner")return safeJson({ok:false,error:"OWNER_MODE_REQUIRED"},503);const result=await fetchStaffOverview();return safeJson(result,result.status);}
export function POST(){return safeJson({ok:false,error:"READ_ONLY"},405);}
