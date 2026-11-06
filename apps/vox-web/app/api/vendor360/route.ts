import {safeJson} from "../../../lib/auth";
import {fetchScopedCrm} from "../../../lib/core";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(){if(process.env.VOX_STAFF_VIEW_MODE!=="owner")return safeJson({ok:false,error:"OWNER_MODE_REQUIRED"},503);const r=await fetchScopedCrm("vendor360");return safeJson(r,r.status);}
export function POST(){return safeJson({ok:false,error:"CORE_APPROVAL_REQUIRED"},405);}
export function PATCH(){return safeJson({ok:false,error:"CORE_APPROVAL_REQUIRED"},405);}
