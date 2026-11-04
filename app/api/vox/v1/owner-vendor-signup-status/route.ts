/**
 * VOX Owner-only, READ-ONLY vendor signup ownership status.
 *
 * There is no staff access, document viewing, private storage key, phone,
 * email, identity proof, OTP, credit mutation or vendor activation here.
 * QuickFurno Core remains the single business authority. Never use this
 * informational projection as a replacement for SQL signup/approval gates.
 */
import "server-only";
import { adminClient } from "@/lib/supabase";
import { verifyVoxOwnerBearer } from "@/services/vox/verifiedStaffBearer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const json = (body: unknown,status: number) => Response.json(body,{
  status,
  headers: {
    "cache-control":"private, no-store, max-age=0",
    "vary":"Authorization",
    "x-content-type-options":"nosniff",
  },
});

export async function GET(request: Request): Promise<Response> {
  if(process.env.VOX_OWNER_VENDOR_SIGNUP_STATUS_READ_ENABLED !== "staging")
    return json({ok:false,code:"OWNER_SIGNUP_STATUS_DISABLED"},503);
  const url = new URL(request.url);
  const ids = url.searchParams.getAll("vendorId");
  if(url.hash || url.searchParams.size !== 1 || ids.length !== 1 || !UUID.test(ids[0]))
    return json({ok:false,code:"INVALID_VENDOR_QUERY"},400);
  try {
    const owner = await verifyVoxOwnerBearer(request.headers.get("authorization"));
    if(!owner) return json({ok:false,code:"OWNER_AAL2_REQUIRED"},403);

    const db = adminClient();
    const {data:vendor,error:vendorError} = await db.from("vendors")
      .select("id,user_id,status,is_active,accepting_leads,public_visibility,paid_status,registration_consent_version,registration_consent_accepted_at")
      .eq("id",ids[0]).maybeSingle();
    if(vendorError) return json({ok:false,code:"OWNER_SIGNUP_READ_UNAVAILABLE"},503);
    if(!vendor) return json({ok:false,code:"VENDOR_NOT_FOUND"},404);

    // Membership and profile are joined by this vendor's *server-known* user.
    // Bounded reads reject corrupted duplicate rows rather than picking first.
    const authUserId = typeof vendor.user_id === "string" ? vendor.user_id : null;
    const [members,profiles,readiness] = await Promise.all([
      db.from("vendor_dashboard_users")
        .select("vendor_id,user_id,role,status").eq("vendor_id",ids[0]).limit(2),
      authUserId ? db.from("profiles").select("id,role").eq("id",authUserId).limit(2)
                 : Promise.resolve({data:[],error:null}),
      db.rpc("qf_vendor_verification_case_ready",{p_vendor_id:ids[0]}),
    ]);

    if(members.error || profiles.error || readiness.error ||
       !Array.isArray(members.data) || !Array.isArray(profiles.data) ||
       members.data.length>1 || profiles.data.length>1 ||
       typeof readiness.data !== "boolean")
      return json({ok:false,code:"OWNER_SIGNUP_READ_UNAVAILABLE"},503);

    const member = members.data[0] ?? null;
    const profile = profiles.data[0] ?? null;
    const membershipConsistent =
      Boolean(authUserId && member && member.vendor_id===ids[0] &&
        member.user_id===authUserId && member.role==="owner" && member.status==="active");
    const principalConsistent =
      Boolean(authUserId && profile && profile.id===authUserId && profile.role==="vendor");
    const applicationPending =
      vendor.status==="Pending" && vendor.is_active===false &&
      vendor.accepting_leads===false && vendor.public_visibility===false;
    const ownerRepairRequired = !membershipConsistent || !principalConsistent;
    const readyForCoreApproval = readiness.data === true;

    // Revalidate Owner AAL2 after the privileged DB reads.
    const currentOwner=await verifyVoxOwnerBearer(request.headers.get("authorization"));
    if(currentOwner!==owner) return json({ok:false,code:"OWNER_SESSION_REVOKED"},403);

    return json({
      ok:true,schema:"qf.vox.owner.vendor-signup-status.v1",vendorId:ids[0],
      mode:"READ_ONLY",
      status:vendor.status,
      applicationPending,
      consentReceiptPresent:Boolean(vendor.registration_consent_version &&
                                      vendor.registration_consent_accepted_at),
      membershipConsistent,principalConsistent,ownerRepairRequired,
      readyForCoreApproval,
      requiresSeparateCoreReview:true,
      canApprove:false,canActivate:false,canMutate:false,canViewPrivateEvidence:false,
    },200);
  }catch{
    return json({ok:false,code:"OWNER_SIGNUP_READ_UNAVAILABLE"},503);
  }
}
export function POST(): Response { return json({ok:false,code:"CORE_REVIEW_REQUIRED"},405); }
export function PUT(): Response { return json({ok:false,code:"CORE_REVIEW_REQUIRED"},405); }
export function PATCH(): Response { return json({ok:false,code:"CORE_REVIEW_REQUIRED"},405); }
export function DELETE(): Response { return json({ok:false,code:"CORE_REVIEW_REQUIRED"},405); }
