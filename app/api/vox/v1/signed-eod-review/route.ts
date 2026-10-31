import "server-only";
import {handleRc38SignedEodReview} from "@/services/vox/rc38SignedEodReviewHandler";
import {verifyRc28PendingEodForHumanReview} from "@/services/vox/rc28PendingSignedEodReview";
import {rc38SignedEodReviewDbSource} from "@/services/vox/rc38SignedEodReviewDb";
import {verifyVoxOwnerBearer} from "@/services/vox/verifiedStaffBearer";
export const runtime="nodejs";
export const dynamic="force-dynamic";
// Read-only. Default OFF: needs an explicit staging flag AND a dedicated reader DB.
const enabled=()=>process.env.VOX_RC38_SIGNED_EOD_REVIEW_ENABLED==="staging"&&
 process.env.VOX_DEPARTMENT_ENFORCEMENT_ENABLED==="staging";
export async function GET(request:Request){
 // Explicit Owner AAL2 gate at the route boundary; RC28 re-verifies both
 // distinct Owner/TL identities before and after its immutable receipt reads.
 if(!enabled())return handleRc38SignedEodReview(request,{enabled,
  dbSource:rc38SignedEodReviewDbSource,review:verifyRc28PendingEodForHumanReview});
 try{
  if(!await verifyVoxOwnerBearer(request.headers.get("authorization")))
   return Response.json({ok:false,error:"OWNER_AAL2_REQUIRED"},{status:403,
    headers:{"cache-control":"private, no-store, max-age=0","vary":"Authorization"}});
 }catch{return Response.json({ok:false,error:"OWNER_AUTH_UNAVAILABLE"},{status:503,
  headers:{"cache-control":"private, no-store, max-age=0"}})}
 return handleRc38SignedEodReview(request,{enabled,
  dbSource:rc38SignedEodReviewDbSource,review:verifyRc28PendingEodForHumanReview});
}
const deny=()=>Response.json({ok:false,error:"METHOD_NOT_ALLOWED"},{status:405,
 headers:{"cache-control":"private, no-store, max-age=0","allow":"GET"}});
export const POST=deny;
export const PUT=deny;
export const PATCH=deny;
export const DELETE=deny;
