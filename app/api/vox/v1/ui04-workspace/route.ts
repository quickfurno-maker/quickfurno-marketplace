import "server-only";
import {adminClient} from "@/lib/supabase";
import {getVerifiedScopedStaff} from "@/services/vox/verifiedScopedStaff";
import {GET as readWork} from "../work-queue/route";
import {GET as readClients} from "../riya-client-cases/route";
import {composeAuthorizedCoreWorkspace} from "@/contracts/vox/ui04RouteFusion.mjs";
export const runtime="nodejs";
export const dynamic="force-dynamic";

type Staff=NonNullable<Awaited<ReturnType<typeof getVerifiedScopedStaff>>>;
type Check={source:string;itemId:string;kind:string;
 expectedRevision:number;expectedState:string;expectedProjectId?:string};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const id=(x:unknown):x is string=>typeof x==="string"&&uuid.test(x);
const send=(value:unknown,status:number)=>Response.json(value,{status,headers:{
 "cache-control":"private, no-store, max-age=0","vary":"Authorization",
 "x-content-type-options":"nosniff"
}});
const enabled=()=>[
 "VOX_UI04_WORKSPACE_READ_ENABLED","VOX_STAFF_GRANTS_ENABLED",
 "VOX_DEPARTMENT_ENFORCEMENT_ENABLED","VOX_WORK_QUEUE_READ_ENABLED",
 "VOX_RIYA_CLIENT_CASE_READ_ENABLED"
].every(key=>process.env[key]==="staging");
const list=(a:readonly string[]|undefined)=>(a??[]).slice().sort().join("|");
const same=(a:Staff,b:Staff)=>a.userId===b.userId&&
 a.cityId===b.cityId&&a.teamId===b.teamId&&a.role===b.role&&
 a.canReadContent===true&&b.canReadContent===true&&
 a.canMutate===false&&b.canMutate===false&&
 list(a.verifiedDepartments)===list(b.verifiedDepartments)&&
 list(a.prospectIds)===list(b.prospectIds)&&
 list(a.vendorIds)===list(b.vendorIds)&&
 list(a.supportThreadIds)===list(b.supportThreadIds)&&
 list(a.conversationIds)===list(b.conversationIds);

/** Read-only composition of existing authenticated Core handlers.
 * Does NOT mint actor claims or derive authority from browser query data.
 */
export async function GET(request:Request):Promise<Response>{
 if(!enabled())return send({ok:false,error:"UI04_WORKSPACE_DISABLED"},503);
 const url=new URL(request.url);
 if(url.search||url.hash)return send({ok:false,error:"FILTERS_DENIED"},400);
 const bearer=request.headers.get("authorization");
 try{
  const actor=await getVerifiedScopedStaff(bearer);
  if(!actor||actor.canReadContent!==true||actor.canMutate!==false||
   !["support_agent","operations_manager"].includes(actor.role)||
   !actor.verifiedDepartments?.includes("client_success"))
   return send({ok:false,error:"CURRENT_AAL2_CLIENT_SCOPE_REQUIRED"},403);
  const db=adminClient();
  const current=async()=>{
   const refreshed=await getVerifiedScopedStaff(bearer);
   return !!refreshed&&same(actor,refreshed);
  };
  const grant=async(kind:string,subjectId:string)=>{
   const g=await db.from("vox_staff_object_scopes_v1")
    .select("object_id").eq("auth_user_id",actor.userId)
    .eq("scope_kind",kind).eq("object_id",subjectId)
    .is("revoked_at",null).gt("expires_at",new Date().toISOString())
    .maybeSingle();
   return !g.error&&g.data?.object_id===subjectId;
  };
  const vendor=async(vendorId:string)=>{
   if(!actor.vendorIds.includes(vendorId)||!await grant("vendor",vendorId))
    return false;
   const v=await db.from("vendors").select("id,service_zone_id")
    .eq("id",vendorId).maybeSingle();
   if(v.error||v.data?.id!==vendorId||!id(v.data.service_zone_id))
    return false;
   const z=await db.from("marketplace_service_zones").select("id")
    .eq("id",v.data.service_zone_id).eq("city_id",actor.cityId)
    .eq("is_active",true).maybeSingle();
   return !z.error&&z.data?.id===v.data.service_zone_id;
  };
  const object=async({source,itemId,kind,expectedRevision,
   expectedState,expectedProjectId}:Check)=>{
   if(!id(itemId)||!Number.isSafeInteger(expectedRevision)||
    expectedRevision<0||!await current())return false;
   if(source==="CORE_WORK_LEDGER"){
    const w=await db.from("vox_work_items_candidate_v1")
     .select("id,source_kind,source_id,team_id,city_id,assignee_id,state,revision")
     .eq("id",itemId).eq("team_id",actor.teamId)
     .eq("city_id",actor.cityId).maybeSingle();
    if(w.error||w.data?.id!==itemId||
     w.data.source_kind!==kind||!id(w.data.source_id)||
     w.data.revision!==expectedRevision||w.data.state!==expectedState||
     !(w.data.assignee_id===actor.userId||
       (w.data.assignee_id===null&&w.data.state==="NEW")))
     return false;
    const subjectId=w.data.source_id;
    if(!await grant(kind,subjectId))return false;
    if(kind==="prospect"){
     if(!actor.prospectIds.includes(subjectId))return false;
     const p=await db.from("aarohi_prospects").select("id")
      .eq("id",subjectId).eq("city_id",actor.cityId).maybeSingle();
     return !p.error&&p.data?.id===subjectId;
    }
    if(kind==="vendor")return vendor(subjectId);
    if(kind==="support_thread"){
     if(!actor.supportThreadIds.includes(subjectId))return false;
     const t=await db.from("vendor_support_threads").select("id,vendor_id")
      .eq("id",subjectId).maybeSingle();
     return !t.error&&t.data?.id===subjectId&&
      id(t.data.vendor_id)&&await vendor(t.data.vendor_id);
    }
    return false;
   }
   if(source!=="CORE_CLIENT_RIYA"||kind!=="client"||
    !id(expectedProjectId)||!actor.verifiedDepartments?.includes("client_success")||
    !await grant("conversation",itemId))return false;
   const c=await db.from("communication_conversations")
    .select("id,subject_id,revision,state").eq("id",itemId)
    .eq("subject_type","client").maybeSingle();
   if(c.error||c.data?.id!==itemId||
    c.data.subject_id!==expectedProjectId||
    c.data.revision!==expectedRevision||c.data.state!==expectedState)
    return false;
   const l=await db.from("leads").select(
    "id,service_zone_id,google_place_id,location_verification_status,latitude,longitude")
    .eq("id",expectedProjectId).maybeSingle();
   if(l.error||l.data?.id!==expectedProjectId||
    l.data.location_verification_status!=="verified"||
    typeof l.data.google_place_id!=="string"||
    !/^[A-Za-z0-9_-]{8,200}$/.test(l.data.google_place_id)||
    typeof l.data.latitude!=="number"||
    typeof l.data.longitude!=="number"||
    !Number.isFinite(l.data.latitude)||!Number.isFinite(l.data.longitude)||
    Math.abs(l.data.latitude)>90||Math.abs(l.data.longitude)>180||
    !id(l.data.service_zone_id))return false;
   const z=await db.from("marketplace_service_zones").select("id")
    .eq("id",l.data.service_zone_id).eq("city_id",actor.cityId)
    .eq("is_active",true).maybeSingle();
   return !z.error&&z.data?.id===l.data.service_zone_id;
  };
  const response=await composeAuthorizedCoreWorkspace({
   request,scope:{...actor,currentAal:"aal2"},
   featureGates:{work:"staging",client:"staging",portal:"staging",
    grants:"staging",departments:"staging"},
   verifyCurrentScope:current,readWorkHandler:readWork,
   readClientHandler:readClients,verifyCurrentObjectGrant:object
  });
  return send(response,response.ok?200:response.status??503);
 }catch{return send({ok:false,error:"CORE_WORKSPACE_UNAVAILABLE"},503);}
}
const reject=()=>send({ok:false,error:"READ_ONLY"},405);
export const POST=reject;export const PUT=reject;
export const PATCH=reject;export const DELETE=reject;
