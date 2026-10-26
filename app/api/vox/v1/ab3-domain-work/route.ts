import "server-only";
import {adminClient} from "@/lib/supabase";
import {getVerifiedScopedStaff} from "@/services/vox/verifiedScopedStaff";
import {GET as readProtectedWorkQueue} from "../work-queue/route";
import {getAuthenticatedDomainWork} from "@/contracts/vox/ab3DomainHttp.mjs";
export const dynamic="force-dynamic";
export const runtime="nodejs";
const send=(body:unknown,status:number)=>Response.json(body,{status,headers:{
 "cache-control":"private, no-store, max-age=0","vary":"Authorization",
 "x-content-type-options":"nosniff"
}});
const active=()=>[
 "VOX_AB3_DOMAIN_READ_ENABLED","VOX_STAFF_GRANTS_ENABLED",
 "VOX_DEPARTMENT_ENFORCEMENT_ENABLED","VOX_WORK_QUEUE_READ_ENABLED"
].every(k=>process.env[k]==="staging");
const id=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const roleDep:Record<string,string>={
 acquisition_agent:"acquisition",vendor_success_agent:"vendor_success",
 support_agent:"service_support"
};
export async function GET(request:Request):Promise<Response>{
 if(!active())return send({ok:false,error:"AB3_DOMAIN_DISABLED"},503);
 if(new URL(request.url).search||new URL(request.url).hash)
  return send({ok:false,error:"CLIENT_FILTERS_DENIED"},400);
 try{
  const bearer=request.headers.get("authorization");
  const staff=await getVerifiedScopedStaff(bearer);
  if(!staff||!roleDep[staff.role]||
   !staff.verifiedDepartments?.includes(roleDep[staff.role])||
   staff.canReadContent!==true||staff.canMutate!==false)
   return send({ok:false,error:"EXACT_CURRENT_STAFF_SCOPE_REQUIRED"},403);
  const db=adminClient();
  const list=(x:readonly string[]|undefined)=>(x??[]).slice().sort().join("|");
  const current=async()=>{
   const rechecked=await getVerifiedScopedStaff(bearer);
   return !!rechecked&&rechecked.userId===staff.userId&&
    rechecked.cityId===staff.cityId&&rechecked.teamId===staff.teamId&&
    rechecked.role===staff.role&&
    rechecked.canReadContent===true&&rechecked.canMutate===false&&
    list(rechecked.verifiedDepartments)===list(staff.verifiedDepartments)&&
    list(rechecked.prospectIds)===list(staff.prospectIds)&&
    list(rechecked.vendorIds)===list(staff.vendorIds)&&
    list(rechecked.supportThreadIds)===list(staff.supportThreadIds);
  };
  const check=async(x:{itemId:string;kind:string;revision:number;state:string})=>{
   if(!id.test(x.itemId)||!["prospect","vendor","support_thread"].includes(x.kind)||
    !Number.isSafeInteger(x.revision)||x.revision<0)return false;
   const work=await db.from("vox_work_items_candidate_v1")
    .select("id,team_id,city_id,source_kind,source_id,state,revision,assignee_id")
    .eq("id",x.itemId).eq("team_id",staff.teamId).eq("city_id",staff.cityId)
    .maybeSingle();
   if(work.error||!work.data||work.data.id!==x.itemId||
    work.data.source_kind!==x.kind||work.data.state!==x.state||
    work.data.revision!==x.revision||
    !(work.data.assignee_id===staff.userId||
      (work.data.assignee_id===null&&work.data.state==="NEW"))||
    typeof work.data.source_id!=="string"||
    !id.test(work.data.source_id))return false;
   const sourceId=work.data.source_id;
   const allowed=x.kind==="prospect"?staff.prospectIds:
    x.kind==="vendor"?staff.vendorIds:staff.supportThreadIds;
   if(!allowed.includes(sourceId))return false;
   const g=await db.from("vox_staff_object_scopes_v1")
    .select("object_id").eq("auth_user_id",staff.userId)
    .eq("scope_kind",x.kind).eq("object_id",sourceId)
    .is("revoked_at",null).gt("expires_at",new Date().toISOString())
    .maybeSingle();
   return !g.error&&g.data?.object_id===sourceId;
  };
  const result=await getAuthenticatedDomainWork({
   request,scope:{...staff,currentAal:"aal2"},
   enabled:true,readProtectedWork:readProtectedWorkQueue,
   verifyCurrentScope:current,verifyCurrentWorkObject:check
  });
  return send(result,result.ok?200:result.status??503);
 }catch{return send({ok:false,error:"AB3_DOMAIN_UNAVAILABLE"},503);}
}
const reject=()=>send({ok:false,error:"READ_ONLY"},405);
export const POST=reject;export const PUT=reject;
export const PATCH=reject;export const DELETE=reject;
