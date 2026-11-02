import {safeJson} from "../../../lib/auth";
import {fetchOwnerAosHealth} from "../../../lib/core";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(){const r=await fetchOwnerAosHealth();return safeJson(r,r.status);}
export function POST(){return safeJson({ok:false,error:"OWNER_ONLY_READ_ONLY"},405);}
export function PATCH(){return safeJson({ok:false,error:"OWNER_ONLY_READ_ONLY"},405);}
export function DELETE(){return safeJson({ok:false,error:"OWNER_ONLY_READ_ONLY"},405);}
