import {safeJson} from "../../../lib/auth";
import {fetchScopedCrm} from "../../../lib/core";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(){const r=await fetchScopedCrm("acquisition");return safeJson(r,r.status);}
export function POST(){return safeJson({ok:false,error:"CORE_APPROVAL_REQUIRED"},405);}
export function PATCH(){return safeJson({ok:false,error:"CORE_APPROVAL_REQUIRED"},405);}
