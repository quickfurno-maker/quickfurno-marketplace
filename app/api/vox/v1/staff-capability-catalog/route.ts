import "server-only";
import {verifyVoxOwnerBearer} from "@/services/vox/verifiedStaffBearer";
import {departmentPacks} from "@/contracts/vox/staffDepartmentPacks.mjs";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const send=(value:unknown,status:number)=>Response.json(value,{status,headers:{
 "cache-control":"private, no-store, max-age=0","vary":"Authorization",
 "x-content-type-options":"nosniff"
}});
/**
 * Admin-only read-only catalogue. Does not create staff, mutate grants,
 * issue invitations or expose unscoped employee records.
 */
export async function GET(request:Request){
 if(process.env.VOX_STAFF_READ_ENABLED!=="staging") return send({ok:false,error:"STAFF_READ_DISABLED"},503);
 if(process.env.VOX_STAFF_GRANTS_ENABLED!=="staging"||
    process.env.VOX_MULTI_DEPARTMENT_CATALOG_ENABLED!=="staging")
   return send({ok:false,error:"CAPABILITY_CATALOG_DISABLED"},503);
 try{
  const adminId=await verifyVoxOwnerBearer(request.headers.get("authorization"));
  if(!adminId)return send({ok:false,error:"ADMIN_AAL2_REQUIRED"},403);
  return send({ok:true,schema:"qf.vox.staff.department.catalog.v1",
   mode:"READ_ONLY",owner:"quickfurno-core",
   capabilities:departmentPacks,canInvite:false,canActivate:false,
   requiresSeparateReview:true,requiresObjectScopes:true},200);
 }catch{return send({ok:false,error:"AUTHORITY_UNAVAILABLE"},503);}
}
const denied=()=>send({ok:false,error:"GOVERNED_CORE_ACTION_NOT_IMPLEMENTED"},405);
export const POST=denied;
export const PUT=denied;
export const PATCH=denied;
export const DELETE=denied;
