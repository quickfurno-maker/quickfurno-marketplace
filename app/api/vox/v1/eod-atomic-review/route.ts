import "server-only";
import {createRc42SignedEodDataApiReviewHandler} from "@/services/vox/rc42SignedEodDataApiReviewHandler";
import {verifyRc41PendingEodViaRpc} from "@/services/vox/rc41SignedEodReviewSnapshot";
import {verifyVoxOwnerBearer} from "@/services/vox/verifiedStaffBearer";
import {createRc44DedicatedEodReviewReader} from "@/services/vox/rc44DedicatedEodReviewReader";
export const runtime="nodejs";
export const dynamic="force-dynamic";
// UNINSTALLED candidate. Dedicated reviewed reader role not yet provisioned.
// Never substitute privileged Data API or a direct PostgreSQL pool for the missing reader.
export const RC42_EOD_ATOMIC_DATA_API_READER_INSTALLED=false as const;
const handler=createRc42SignedEodDataApiReviewHandler({
 enabled:()=>process.env.VOX_RC42_EOD_ATOMIC_REVIEW_ENABLED==="staging"&&
  process.env.VOX_DEPARTMENT_ENFORCEMENT_ENABLED==="staging",
 installed:()=>RC42_EOD_ATOMIC_DATA_API_READER_INSTALLED,
 rpc:()=>createRc44DedicatedEodReviewReader({
  supabaseUrl:process.env.NEXT_PUBLIC_SUPABASE_URL,
  anonKey:process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  readerJwt:process.env.QF_VOX_EOD_REVIEW_READER_JWT
 }),
 review:(owner,leader,input,rpc)=>verifyRc41PendingEodViaRpc(owner,leader,input,rpc)
});
export async function GET(request:Request){
 // Independently verify Owner AAL2 at route boundary; RC28 verifies BOTH
 // Owner + distinct TL before/after reads and performs two receipt snapshots.
 if(!RC42_EOD_ATOMIC_DATA_API_READER_INSTALLED||
    process.env.VOX_RC42_EOD_ATOMIC_REVIEW_ENABLED!=="staging")return handler(request);
 let preflightTimer:ReturnType<typeof setTimeout>|undefined;
 const denyOwner=(error:string,status:number)=>Response.json({ok:false,error,
  approved:false,publicationAuthorized:false,providerMessagesSent:0},
  {status,headers:{"cache-control":"private, no-store, max-age=0"}});
 try{
  // Separate Owner AAL2 preflight is BEFORE all read-only EOD review calls.
  // A stalled GoTrue request must never hang this route indefinitely.
  const result=await Promise.race([
   verifyVoxOwnerBearer(request.headers.get("authorization"))
    .then(actor=>({timedOut:false as const,actor})),
   new Promise<{timedOut:true}>(resolve=>{
    preflightTimer=setTimeout(()=>resolve({timedOut:true}),1500);
   })
  ]);
  if(result.timedOut)return denyOwner("OWNER_AUTH_TIMEOUT",503);
  if(!result.actor)return denyOwner("OWNER_AAL2_REQUIRED",403);
 }catch{return denyOwner("OWNER_AUTH_UNAVAILABLE",503);}
 finally{if(preflightTimer!==undefined)clearTimeout(preflightTimer);}
 return handler(request);
}
const deny=()=>Response.json({ok:false,error:"METHOD_NOT_ALLOWED"},{status:405,
 headers:{"cache-control":"private, no-store, max-age=0","allow":"GET"}});
export const POST=deny;
export const PUT=deny;
export const PATCH=deny;
export const DELETE=deny;
