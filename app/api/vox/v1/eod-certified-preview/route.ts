import "server-only";
import {adminClient} from "@/lib/supabase";
import {getVerifiedScopedStaff} from "@/services/vox/verifiedScopedStaff";
import {readCertifiedFourSourceEod} from "@/contracts/vox/f1CertifiedFourSourceEod.mjs";
export const runtime="nodejs";export const dynamic="force-dynamic";
const send=(data:unknown,status:number)=>Response.json(data,{status,headers:{
 "cache-control":"private, no-store, max-age=0","vary":"Authorization"}});
/** Source-only until reviewed canonical event SQL and trusted issuers exist. */
export async function GET(request:Request):Promise<Response>{
 if(process.env.VOX_STAFF_GRANTS_ENABLED!=="staging"||
  process.env.VOX_DEPARTMENT_ENFORCEMENT_ENABLED!=="staging"||
  process.env.VOX_EOD_CERTIFIED_PREVIEW_ENABLED!=="staging")
  return send({ok:false,error:"F1_EOD_DISABLED"},503);
 if(new URL(request.url).search||new URL(request.url).hash)
  return send({ok:false,error:"BROWSER_FILTER_NOT_ALLOWED"},400);
 const secret=process.env.VOX_F1_EOD_SIGNING_KEY;
 if(!secret||secret.length<32||secret.length>4096)
  return send({ok:false,error:"TRUSTED_SIGNER_NOT_INSTALLED"},503);
 try{
  const bearer=request.headers.get("authorization");
  const original=await getVerifiedScopedStaff(bearer);
  if(!original||original.canReadContent!==true||original.canMutate!==false||
   !["operations_manager","acquisition_agent","vendor_success_agent",
     "support_agent"].includes(original.role))
   return send({ok:false,error:"CURRENT_NEUTRAL_STAFF_AAL2_REQUIRED"},403);
  const db=adminClient();
  const current=async()=>{
   const s=await getVerifiedScopedStaff(bearer);
   return !!s&&s.canReadContent===true&&s.canMutate===false&&
    s.userId===original.userId&&s.teamId===original.teamId&&
    s.cityId===original.cityId&&s.role===original.role&&
    (s.verifiedDepartments??[]).slice().sort().join("|")===
    (original.verifiedDepartments??[]).slice().sort().join("|");
  };
  const exactGrant=async(e:{source:string;subjectKind:string;subjectId:string;
   actorId:string;teamId:string;cityId:string})=>{
   if(e.actorId!==original.userId||e.teamId!==original.teamId||
      e.cityId!==original.cityId)return false;
   const kind=e.subjectKind;
   if(e.source==="CRM_AAROHI"&&kind!=="prospect"||
      e.source==="SUPPORT_DESK"&&kind!=="support_thread"||
      e.source==="CORE_CONVERSATION"&&kind!=="conversation"||
      !["prospect","vendor","support_thread","conversation"].includes(kind))
    return false;
   const lookup=kind==="prospect"?"prospectIds":kind==="vendor"?
    "vendorIds":kind==="support_thread"?"supportThreadIds":"conversationIds";
   if(kind==="conversation"){
    if(!original.verifiedDepartments?.includes("client_success"))return false;
   }else if(!(original[lookup as "prospectIds"|"vendorIds"|"supportThreadIds"])
    .includes(e.subjectId))return false;
   const grant=await db.from("vox_staff_object_scopes_v1")
    .select("object_id").eq("auth_user_id",original.userId)
    .eq("scope_kind",kind).eq("object_id",e.subjectId)
    .is("revoked_at",null).gt("expires_at",new Date().toISOString()).maybeSingle();
   if(grant.error||grant.data?.object_id!==e.subjectId)return false;
   const activeZone=async(vendorId:string)=>{
    const v=await db.from("vendors").select("service_zone_id").eq("id",vendorId)
     .maybeSingle();
    if(v.error||!v.data?.service_zone_id)return false;
    const z=await db.from("marketplace_service_zones")
     .select("id").eq("id",v.data.service_zone_id)
     .eq("city_id",original.cityId).eq("is_active",true).maybeSingle();
    return !z.error&&z.data?.id===v.data.service_zone_id;
   };
   if(kind==="vendor")return activeZone(e.subjectId);
   if(kind==="prospect"){
    const p=await db.from("aarohi_prospects").select("city_id")
     .eq("id",e.subjectId).maybeSingle();
    return !p.error&&p.data?.city_id===original.cityId;
   }
   if(kind==="support_thread"){
    const t=await db.from("vendor_support_threads").select("vendor_id")
     .eq("id",e.subjectId).maybeSingle();
    if(t.error||!t.data?.vendor_id||
      !original.vendorIds.includes(t.data.vendor_id))return false;
    const vg=await db.from("vox_staff_object_scopes_v1").select("object_id")
     .eq("auth_user_id",original.userId).eq("scope_kind","vendor")
     .eq("object_id",t.data.vendor_id).is("revoked_at",null)
     .gt("expires_at",new Date().toISOString()).maybeSingle();
    return !vg.error&&vg.data?.object_id===t.data.vendor_id&&
     await activeZone(t.data.vendor_id);
   }
   const c=await db.from("communication_conversations").select("subject_id")
    .eq("id",e.subjectId).eq("subject_type","client").maybeSingle();
   if(c.error||!c.data?.subject_id)return false;
   const l=await db.from("leads").select(
    "service_zone_id,google_place_id,location_verification_status")
    .eq("id",c.data.subject_id).maybeSingle();
   if(l.error||l.data?.location_verification_status!=="verified"||
    typeof l.data?.google_place_id!=="string"||
    l.data.google_place_id.length<8)return false;
   const z=await db.from("marketplace_service_zones").select("id")
    .eq("id",l.data.service_zone_id).eq("city_id",original.cityId)
    .eq("is_active",true).maybeSingle();
   return !z.error&&z.data?.id===l.data.service_zone_id;
  };
  const yesterday=new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Kolkata",
   year:"numeric",month:"2-digit",day:"2-digit"}).format(
    new Date(Date.now()-86400000));
  const proof=await readCertifiedFourSourceEod({
   db,scope:{...original,currentAal:"aal2"},businessDate:yesterday,
   secret,verifyCurrentScope:current,verifyExactObjectGrant:exactGrant});
  if(!proof.ok)return send({ok:false,error:proof.reason,totalKnown:false},503);
  if(!(await current()))return send({ok:false,error:"STAFF_REVOKED"},403);
  return send(proof,200);
 }catch{return send({ok:false,error:"EOD_SOURCE_UNAVAILABLE"},503);}
}
export function POST(){return send({ok:false,error:"OFFICIAL_EOD_NOT_CERTIFIED"},405);}
export function PUT(){return send({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function PATCH(){return send({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function DELETE(){return send({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
