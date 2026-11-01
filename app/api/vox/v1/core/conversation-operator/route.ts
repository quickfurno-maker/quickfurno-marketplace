import "server-only";
import {adminClient} from "@/lib/supabase";
import {verifyVoxOperationsStaffBearer} from "@/services/vox/verifiedStaffBearer";
import {createRc42AtomicConversationHandler} from "@/services/vox/rc42AtomicConversationHandler";
export const runtime="nodejs";
export const dynamic="force-dynamic";
// Review-only candidate, not installed. Staging flag ALONE cannot activate it.
export const RC42_ATOMIC_CONVERSATION_RPC_INSTALLED=false as const;
const handle=createRc42AtomicConversationHandler({
 enabled:()=>process.env.VOX_RC42_CORE_CONVERSATION_OPERATOR_ENABLED==="staging"&&
  process.env.VOX_STAFF_GRANTS_ENABLED==="staging"&&
  process.env.VOX_DEPARTMENT_ENFORCEMENT_ENABLED==="staging",
 installed:()=>RC42_ATOMIC_CONVERSATION_RPC_INSTALLED,
 verify:verifyVoxOperationsStaffBearer,
 rpc:async(fn,args)=>adminClient().rpc(fn,args)
});
export const POST=handle;
const denied=()=>Response.json({ok:false,error:"METHOD_NOT_ALLOWED"},{status:405,
 headers:{"cache-control":"private, no-store, max-age=0","allow":"POST"}});
export const GET=denied;
export const PUT=denied;
export const PATCH=denied;
export const DELETE=denied;
