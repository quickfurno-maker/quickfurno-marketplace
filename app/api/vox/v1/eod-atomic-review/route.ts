import "server-only";
import {createRc42SignedEodDataApiReviewHandler} from "@/services/vox/rc42SignedEodDataApiReviewHandler";
import {verifyRc41PendingEodViaRpc} from "@/services/vox/rc41SignedEodReviewSnapshot";
export const runtime="nodejs";
export const dynamic="force-dynamic";
// UNINSTALLED candidate. Dedicated reviewed reader role not yet provisioned.
// Never substitute service-role adminClient() or pg.Pool for the missing reader.
export const RC42_EOD_ATOMIC_DATA_API_READER_INSTALLED=false as const;
const handler=createRc42SignedEodDataApiReviewHandler({
 enabled:()=>process.env.VOX_RC42_EOD_ATOMIC_REVIEW_ENABLED==="staging"&&
  process.env.VOX_DEPARTMENT_ENFORCEMENT_ENABLED==="staging",
 installed:()=>RC42_EOD_ATOMIC_DATA_API_READER_INSTALLED,
 rpc:()=>null,
 review:(owner,leader,input,rpc)=>verifyRc41PendingEodViaRpc(owner,leader,input,rpc)
});
export const GET=handler;
const deny=()=>Response.json({ok:false,error:"METHOD_NOT_ALLOWED"},{status:405,
 headers:{"cache-control":"private, no-store, max-age=0","allow":"GET"}});
export const POST=deny;
export const PUT=deny;
export const PATCH=deny;
export const DELETE=deny;
