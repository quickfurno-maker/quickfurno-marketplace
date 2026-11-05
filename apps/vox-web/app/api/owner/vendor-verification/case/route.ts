/** Owner-only VOX same-origin Core case summary; no evidence bytes or URLs. */
import {safeJson} from "../../../../../lib/auth";
import {ownerVendorCase} from "../../../../../lib/ownerVendorVerification";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(request:Request):Promise<Response>{
 const u=new URL(request.url);
 const vendorId=u.searchParams.getAll("vendorId");
 if(u.hash||u.searchParams.size!==1||vendorId.length!==1)
   return safeJson({ok:false,code:"INVALID_VENDOR_ID"},400);
 const r=await ownerVendorCase(vendorId[0]);
 return r.ok?safeJson({ok:true,case:r.data,
   schema:"qf.vox.owner.vendor-case-bff.v1"},200):
   safeJson({ok:false,code:r.error},r.status);
}
export function POST(){return safeJson({ok:false,code:"METHOD_NOT_ALLOWED"},405);}
export function PUT(){return safeJson({ok:false,code:"METHOD_NOT_ALLOWED"},405);}
export function PATCH(){return safeJson({ok:false,code:"METHOD_NOT_ALLOWED"},405);}
export function DELETE(){return safeJson({ok:false,code:"METHOD_NOT_ALLOWED"},405);}
