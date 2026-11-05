/**
 * Owner-only bounded vendor verification queue, sourced from the EXISTING
 * private QuickFurno Core case system. Never an independent VOX database.
 * Disabled until separately approved Staging; no private document URLs.
 */
import "server-only";
import { adminClient } from "@/lib/supabase";
import { verifyVoxOwnerBearer } from "@/services/vox/verifiedStaffBearer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const enabled=()=>process.env.VOX_OWNER_VENDOR_CASE_REVIEW_ENABLED==="staging" &&
  process.env.VOX_OWNER_VENDOR_QUEUE_ENABLED==="staging";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATES=new Set(["pending","documents_requested","under_review","needs_correction"]);
const STAGES=new Set(["pending","verified","rejected","expired"]);
const reply=(data:unknown,status:number)=>Response.json(data,{
  status,headers:{"cache-control":"private, no-store, max-age=0",
                  "vary":"Authorization","x-content-type-options":"nosniff"},
});
type QueueRecord={
  vendorId:string;caseVersion:number;caseState:string;submittedAt:string;
  contactStatus:string;identityStatus:string;officeStatus:string;
  categoryStatus:string;zoneStatus:string;consentValid:boolean;
  pendingScanCount:number;rejectedScanCount:number;
};
function safeRecord(value:unknown):QueueRecord|null{
 if(!value||typeof value!=="object"||Array.isArray(value))return null;
 const r=value as Record<string,unknown>;
 const fields=["vendorId","caseVersion","caseState","submittedAt","contactStatus",
    "identityStatus","officeStatus","categoryStatus","zoneStatus","consentValid",
    "pendingScanCount","rejectedScanCount"];
 if(Object.keys(r).sort().join(",")!==fields.sort().join(",") ||
    typeof r.vendorId!=="string"||!UUID.test(r.vendorId)||
    typeof r.caseVersion!=="number"||!Number.isSafeInteger(r.caseVersion)||
    r.caseVersion<1||r.caseVersion>100000||
    typeof r.caseState!=="string"||!STATES.has(r.caseState)||
    typeof r.submittedAt!=="string"||
    !Number.isFinite(Date.parse(r.submittedAt))||
    typeof r.consentValid!=="boolean"||
    typeof r.pendingScanCount!=="number"||
    !Number.isSafeInteger(r.pendingScanCount)||r.pendingScanCount<0||
    typeof r.rejectedScanCount!=="number"||
    !Number.isSafeInteger(r.rejectedScanCount)||r.rejectedScanCount<0||
    ["contactStatus","identityStatus","officeStatus","categoryStatus","zoneStatus"]
       .some(k=>typeof r[k]!=="string"||!STAGES.has(r[k] as string)))
   return null;
 return r as QueueRecord;
}
export async function GET(request:Request):Promise<Response>{
 if(!enabled())return reply({ok:false,code:"VENDOR_REVIEW_QUEUE_DISABLED"},503);
 const url=new URL(request.url);
 if(url.search||url.hash)return reply({ok:false,code:"UNSUPPORTED_FILTER"},400);
 try{
  const authorization=request.headers.get("authorization");
  const owner=await verifyVoxOwnerBearer(authorization);
  if(!owner)return reply({ok:false,code:"OWNER_AAL2_REQUIRED"},403);
  const {data,error}=await adminClient().rpc("qf_vox_owner_vendor_review_queue");
  if(error||!Array.isArray(data)||data.length>20)
    return reply({ok:false,code:"OWNER_QUEUE_UNAVAILABLE"},503);
  const pending:QueueRecord[]=[];
  const seen=new Set<string>();
  for(const raw of data){
   const item=safeRecord(raw);
   if(!item||seen.has(item.vendorId))
    return reply({ok:false,code:"OWNER_QUEUE_UNTRUSTED"},503);
   seen.add(item.vendorId);pending.push(item);
  }
  if(await verifyVoxOwnerBearer(authorization)!==owner)
    return reply({ok:false,code:"OWNER_SESSION_REVOKED"},403);
  return reply({ok:true,schema:"qf.vox.owner.vendor-verification-queue.v1",
    mode:"READ_ONLY",source:"quickfurno-core",pending,limit:20,
    canApprove:false,canViewPrivateDocuments:false,canActivateLeads:false,
    requiresSeparateOwnerCaseDecision:true},200);
 }catch{return reply({ok:false,code:"OWNER_QUEUE_UNAVAILABLE"},503);}
}
export function POST():Response{return reply({ok:false,code:"METHOD_NOT_ALLOWED"},405);}
export function PUT():Response{return reply({ok:false,code:"METHOD_NOT_ALLOWED"},405);}
export function PATCH():Response{return reply({ok:false,code:"METHOD_NOT_ALLOWED"},405);}
export function DELETE():Response{return reply({ok:false,code:"METHOD_NOT_ALLOWED"},405);}
