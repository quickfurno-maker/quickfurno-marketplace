import {safeJson} from "../../../lib/auth";
import {fetchScopedServiceDesk} from "../../../lib/core";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(){const result=await fetchScopedServiceDesk();return safeJson(result,result.status);}
export function POST(){return safeJson({ok:false,error:"CORE_APPROVAL_REQUIRED"},405);}
export function PATCH(){return safeJson({ok:false,error:"CORE_APPROVAL_REQUIRED"},405);}
export function DELETE(){return safeJson({ok:false,error:"CORE_APPROVAL_REQUIRED"},405);}
