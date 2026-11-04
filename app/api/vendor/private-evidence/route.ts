/**
 * Pending vendor office/category-proof intake via PRIVATE Supabase Storage.
 * This is not an identity-document upload service: NO Aadhaar/PAN raw numbers,
 * Aadhaar scans or front-end claims of verified status are accepted here.
 * OFF by default. It does not approve evidence, vendors, leads, or credits.
 */
import "server-only";
import { createHash,randomUUID } from "node:crypto";
import { adminClient,serverClient } from "@/lib/supabase";
import { VENDOR_REGISTRATION_PRIVACY_REVISION } from "@/lib/vendors/vendorSignupPolicy";
import { allowPublicMutation } from "@/lib/security/publicMutationRateLimit";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const BUCKET="qf-vendor-verification-private";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_SIZE=5*1024*1024;
const MAX_BODY=MAX_SIZE+65536;
const methods=new Set(["aadhaar_offline","passport","driving_licence","voter_id"]);
const kinds=new Set(["office_proof","category_proof"]);
const reply=(body:unknown,status:number)=>Response.json(body,{
 status,headers:{"cache-control":"no-store,max-age=0","x-content-type-options":"nosniff"},
});
const enabled=()=>process.env.QF_VENDOR_PRIVATE_EVIDENCE_MODE==="staging" &&
 process.env.QF_VENDOR_PRIVATE_BUCKET_CERTIFIED==="staging";
function sameOrigin(r:Request):boolean{
 try{
  const origin=r.headers.get("origin");
  return Boolean(origin&&new URL(origin).origin===new URL(r.url).origin);
 }catch{return false;}
}
function sniff(bytes:Buffer,mime:string):{ext:"pdf"|"png"|"jpg";mime:string}|null{
 if(bytes.length<8||bytes.length>MAX_SIZE)return null;
 if(mime==="application/pdf"&&bytes.subarray(0,5).toString("ascii")==="%PDF-")
  return {ext:"pdf",mime};
 if(mime==="image/png"&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))
  return {ext:"png",mime};
 if(mime==="image/jpeg"&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)
  return {ext:"jpg",mime};
 return null;
}

export async function POST(request:Request):Promise<Response>{
 if(!enabled())return reply({ok:false,code:"PRIVATE_EVIDENCE_NOT_YET_AVAILABLE"},503);
 if(!sameOrigin(request))return reply({ok:false,code:"ORIGIN_REQUIRED"},403);
 if(!request.headers.get("content-type")?.startsWith("multipart/form-data;"))
  return reply({ok:false,code:"FORMDATA_REQUIRED"},415);
 const length=Number(request.headers.get("content-length"));
 if(!Number.isSafeInteger(length)||length<1||length>MAX_BODY)
  return reply({ok:false,code:"REQUEST_TOO_LARGE"},413);
 try{
  const sb=await serverClient();
  const {data:auth,error:authError}=await sb.auth.getUser();
  const user=auth?.user;
  if(authError||!user||!UUID.test(user.id)||!user.phone_confirmed_at)
   return reply({ok:false,code:"VERIFIED_VENDOR_SESSION_REQUIRED"},401);
  const data=await request.formData();
  if([...data.keys()].sort().join(",")!==
       "evidenceType,file,identityConsent,identityMethod,vendorId")
   return reply({ok:false,code:"INVALID_EVIDENCE_REQUEST"},400);
  const vendorId=data.get("vendorId");
  const evidenceType=data.get("evidenceType");
  const identityMethod=data.get("identityMethod");
  const consent=data.get("identityConsent");
  const file=data.get("file");
  if(typeof vendorId!=="string"||!UUID.test(vendorId)||
     typeof evidenceType!=="string"||!kinds.has(evidenceType)||
     typeof identityMethod!=="string"||!methods.has(identityMethod)||
     consent!=="true" || !(file instanceof File)||
     file.size<8 || file.size>MAX_SIZE ||
     !["application/pdf","image/png","image/jpeg"].includes(file.type))
   return reply({ok:false,code:"INVALID_EVIDENCE_REQUEST"},400);

  if(!(await allowPublicMutation({
    scope:"vendor-private-evidence",identity:user.id,limit:6,
    windowMs:60*60*1000,
  })))return reply({ok:false,code:"EVIDENCE_RATE_LIMITED"},429);

  const binary=Buffer.from(await file.arrayBuffer());
  const accepted=sniff(binary,file.type);
  if(!accepted)return reply({ok:false,code:"INVALID_FILE_FORMAT"},415);

  // The server-only private case RPC checks verified Auth phone, exact vendor
  // ownership, active membership, Pending business status, case state and
  // unrevoked consent. It is the single privacy/ownership authority.
  const db=adminClient();
  const {data:caseId,error:caseError}=await db.rpc(
    "qf_vendor_begin_private_verification_case",{
      p_vendor_id:vendorId,p_auth_user_id:user.id,
      p_identity_method:identityMethod,
      p_notice_version:VENDOR_REGISTRATION_PRIVACY_REVISION,
    });
  if(caseError||typeof caseId!=="string"||!UUID.test(caseId))
   return reply({ok:false,code:"PRIVATE_CASE_UNAVAILABLE"},409);

  const key=`vendors/${vendorId}/${randomUUID()}.${accepted.ext}`;
  // PRIVATE bucket only. No signed public URL, service-role key or raw upload
  // file name is returned. A missing bucket is a hard refusal.
  const {error:uploadError}=await db.storage.from(BUCKET).upload(key,binary,{
    cacheControl:"0",contentType:accepted.mime,upsert:false,
  });
  if(uploadError)return reply({ok:false,code:"PRIVATE_UPLOAD_UNAVAILABLE"},503);
  const hash=createHash("sha256").update(binary).digest("hex");
  const {data:evidenceId,error:linkError}=await db.rpc(
    "qf_vendor_attach_private_evidence",{
      p_vendor_id:vendorId,p_auth_user_id:user.id,p_case_id:caseId,
      p_evidence_type:evidenceType,p_storage_key:key,p_sha256:hash,
    });
  if(linkError||typeof evidenceId!=="string"||!UUID.test(evidenceId)){
    // Only the new, random path created by this request may be removed.
    try{await db.storage.from(BUCKET).remove([key]);}catch{/* deny anyway */}
    return reply({ok:false,code:"EVIDENCE_LINK_FAILED"},503);
  }
  return reply({
    ok:true,status:"pending_scan_and_owner_review",
    caseVersionKnown:false,approved:false,publicDocumentUrl:null,
    vendorBusinessStatusUnchanged:true,
  },202);
 }catch{return reply({ok:false,code:"PRIVATE_EVIDENCE_UNAVAILABLE"},503);}
}
export function GET():Response{return reply({ok:false,code:"METHOD_NOT_ALLOWED"},405);}
