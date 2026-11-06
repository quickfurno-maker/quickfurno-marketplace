/** Owner-only VOX same-origin read BFF; never a direct database client. */
import {safeJson} from "../../../../../lib/auth";
import {ownerVendorQueue} from "../../../../../lib/ownerVendorVerification";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(request:Request):Promise<Response>{
 const u=new URL(request.url);
 if(u.search||u.hash)return safeJson({ok:false,code:"UNSUPPORTED_FILTER"},400);
 const r=await ownerVendorQueue();
 return r.ok?safeJson({ok:true,pending:r.data,limit:20,
   schema:"qf.vox.owner.vendor-review-bff.v1"},200):
   safeJson({ok:false,code:r.error},r.status);
}
export function POST(){return safeJson({ok:false,code:"METHOD_NOT_ALLOWED"},405);}
export function PATCH(){return safeJson({ok:false,code:"METHOD_NOT_ALLOWED"},405);}
export function PUT(){return safeJson({ok:false,code:"METHOD_NOT_ALLOWED"},405);}
export function DELETE(){return safeJson({ok:false,code:"METHOD_NOT_ALLOWED"},405);}
