import "server-only";
import {adminClient} from "@/lib/supabase";
import {getVerifiedScopedStaff} from "@/services/vox/verifiedScopedStaff";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const SOURCES=["CORE_WORK_LEDGER","CRM_AAROHI","SUPPORT_DESK","CORE_CONVERSATION"];
const SHA=/^[a-f0-9]{64}$/;
const send=(payload:unknown,status:number)=>Response.json(payload,{status,headers:{
 "cache-control":"private, no-store, max-age=0",
 "vary":"Authorization","x-content-type-options":"nosniff"
}});
const enabled=()=>process.env.VOX_AB5_EOD_CHECKPOINTS_READ_ENABLED==="staging"&&
 process.env.VOX_STAFF_GRANTS_ENABLED==="staging"&&
 process.env.VOX_DEPARTMENT_ENFORCEMENT_ENABLED==="staging";
const scopeValid=(s:Awaited<ReturnType<typeof getVerifiedScopedStaff>>)=>!!s&&
 s.canReadContent===true&&s.canMutate===false&&
 ["acquisition_agent","vendor_success_agent","support_agent",
 "operations_manager"].includes(s.role);
const same=(a:NonNullable<Awaited<ReturnType<typeof getVerifiedScopedStaff>>>,
 b:NonNullable<Awaited<ReturnType<typeof getVerifiedScopedStaff>>>)=>
 a.userId===b.userId&&a.teamId===b.teamId&&a.cityId===b.cityId&&
 a.role===b.role&&
 [...(a.verifiedDepartments??[])].sort().join("|")===
 [...(b.verifiedDepartments??[])].sort().join("|")&&
 [...a.prospectIds].sort().join("|")===
 [...b.prospectIds].sort().join("|")&&
 [...a.vendorIds].sort().join("|")===
 [...b.vendorIds].sort().join("|")&&
 [...a.supportThreadIds].sort().join("|")===
 [...b.supportThreadIds].sort().join("|")&&
 [...a.conversationIds].sort().join("|")===
 [...b.conversationIds].sort().join("|");
const yesterdayIST=()=>{
 const today=new Intl.DateTimeFormat("sv-SE",{
  timeZone:"Asia/Kolkata",year:"numeric",month:"2-digit",day:"2-digit"
 }).format(new Date());
 return new Date(Date.parse(today+"T00:00:00Z")-86400000)
  .toISOString().slice(0,10);
};
/**
 * Candidate Core DB-backed *closed day* source inventory. The SQL candidate
 * recomputes event hashes, but DOES NOT cryptographically verify F1 hashes
 * or official four-source watermarks. Never label as official EOD.
 */
export async function GET(request:Request):Promise<Response>{
 if(!enabled())return send({ok:false,error:"AB5_EOD_CHECKPOINT_DISABLED"},503);
 if(new URL(request.url).search||new URL(request.url).hash)
  return send({ok:false,error:"BROWSER_FILTERS_DENIED"},400);
 try{
  const bearer=request.headers.get("authorization");
  const scoped=await getVerifiedScopedStaff(bearer);
  if(!scopeValid(scoped))return send({ok:false,error:"CURRENT_AAL2_STAFF_REQUIRED"},403);
  const db=adminClient(),date=yesterdayIST();
  const res=await db.from("vox_ab3_staff_source_snapshots_candidate_v1")
   .select("source,actor_id,team_id,city_id,business_date,event_count,event_checksum,watermark_signature")
   .eq("actor_id",scoped!.userId).eq("team_id",scoped!.teamId)
   .eq("city_id",scoped!.cityId).eq("business_date",date).limit(5);
  if(res.error||!res.data||res.data.length>4)
   return send({ok:false,error:"CANONICAL_EOD_SNAPSHOTS_UNAVAILABLE"},503);
  const bySource=new Map<string,number>();
  for(const row of res.data){
   if(!SOURCES.includes(row.source)||bySource.has(row.source)||
    row.actor_id!==scoped!.userId||row.team_id!==scoped!.teamId||
    row.city_id!==scoped!.cityId||row.business_date!==date||
    !Number.isSafeInteger(row.event_count)||row.event_count<0||
    row.event_count>10000||
    typeof row.event_checksum!=="string"||!SHA.test(row.event_checksum)||
    typeof row.watermark_signature!=="string"||
    !SHA.test(row.watermark_signature))
    return send({ok:false,error:"EOD_SOURCE_SNAPSHOT_UNTRUSTED"},503);
   bySource.set(row.source,row.event_count);
  }
  const recheck=await getVerifiedScopedStaff(bearer);
  if(!scopeValid(recheck)||!same(scoped!,recheck!))
   return send({ok:false,error:"STAFF_SOURCE_SCOPE_REVOKED"},403);
  const sources=SOURCES.map(source=>({
   source,recordPresent:bySource.has(source),
   eventCountInSnapshot:bySource.has(source)?bySource.get(source):null,
   watermarkCryptoVerified:false,officialSourceCertified:false
  }));
  return send({ok:true,schema:"qf.vox.ab5.source-checkpoint.inventory.v1",
   mode:"READ_ONLY",businessDate:date,source:"CORE_CANDIDATE_SQL_SNAPSHOT",
   completeness:bySource.size===4?
    "FOUR_SQL_CHECKPOINTS_PRESENT_NOT_CRYPTO_CERTIFIED":"INCOMPLETE_SOURCE_CHECKPOINTS",
   sources,checkpointRows:bySource.size,totalKnown:false,official:false,
   canSubmit:false,canAcknowledge:false,
   providerMessagesSent:0,actionsEnabled:false},200);
 }catch{return send({ok:false,error:"CANONICAL_EOD_SOURCE_READ_UNAVAILABLE"},503);}
}
export const POST=()=>send({ok:false,error:"READ_ONLY"},405);
export const PUT=()=>send({ok:false,error:"READ_ONLY"},405);
export const PATCH=()=>send({ok:false,error:"READ_ONLY"},405);
export const DELETE=()=>send({ok:false,error:"READ_ONLY"},405);
