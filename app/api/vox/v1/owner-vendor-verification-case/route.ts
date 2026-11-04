/**
 * VOX Owner-only review action. Signed Owner AAL2 and Core private RPC only.
 * No document bytes, Aadhaar/PAN numbers, private storage keys, provider sends,
 * vendor business approval or lead activation are exposed by this route.
 *
 * Disabled unless a separately approved staging feature flag is set. No
 * browser may execute the underlying service-role SQL function directly.
 */
import "server-only";
import { adminClient } from "@/lib/supabase";
import { verifyVoxOwnerBearer } from "@/services/vox/verifiedStaffBearer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REASON = /^[a-z][a-z0-9_]{2,63}$/;
const ACTIONS = new Set(["request_documents","request_correction","approve","reject"]);
const response = (payload: unknown, status: number) => Response.json(payload,{
  status,
  headers: {
    "cache-control": "private, no-store, max-age=0",
    "vary": "Authorization",
    "x-content-type-options": "nosniff",
  },
});
const enabled = () => process.env.VOX_OWNER_VENDOR_CASE_REVIEW_ENABLED === "staging";

export async function GET(request: Request): Promise<Response> {
  if (!enabled()) return response({ok:false,code:"OWNER_REVIEW_DISABLED"},503);
  const url = new URL(request.url);
  const ids = url.searchParams.getAll("vendorId");
  if (url.hash || url.searchParams.size!==1 || ids.length!==1 || !UUID.test(ids[0]))
    return response({ok:false,code:"INVALID_VENDOR_QUERY"},400);
  try {
    const owner = await verifyVoxOwnerBearer(request.headers.get("authorization"));
    if (!owner) return response({ok:false,code:"OWNER_AAL2_REQUIRED"},403);
    const {data,error} = await adminClient().rpc("qf_vendor_owner_review_snapshot",{
      p_vendor_id:ids[0],
    });
    if (error || !data || typeof data!=="object" || Array.isArray(data))
      return response({ok:false,code:"OWNER_REVIEW_UNAVAILABLE"},503);
    const snapshot = data as Record<string,unknown>;
    if (typeof snapshot.casePresent!=="boolean" ||
        typeof snapshot.readyForCoreApproval!=="boolean")
      return response({ok:false,code:"OWNER_REVIEW_UNAVAILABLE"},503);
    if (await verifyVoxOwnerBearer(request.headers.get("authorization")) !== owner)
      return response({ok:false,code:"OWNER_SESSION_REVOKED"},403);
    return response({
      ok:true,schema:"qf.vox.owner.vendor-private-review.v1",
      vendorId:ids[0],mode:"OWNER_REVIEW",
      casePresent:snapshot.casePresent,
      caseVersion:snapshot.caseVersion ?? null,
      caseState:snapshot.state ?? null,
      contactStatus:snapshot.contactStatus ?? null,
      identityStatus:snapshot.identityStatus ?? null,
      officeStatus:snapshot.officeStatus ?? null,
      categoryStatus:snapshot.categoryStatus ?? null,
      zoneStatus:snapshot.zoneStatus ?? null,
      consentValid:snapshot.consentValid===true,
      identityEvidenceVerified:snapshot.identityEvidenceVerified===true,
      officeEvidenceVerified:snapshot.officeEvidenceVerified===true,
      readyForCoreApproval:snapshot.readyForCoreApproval===true,
      canViewPrivateDocuments:false,
      canActivateLeads:false,
      requiresSeparateCoreVendorApproval:true,
    },200);
  } catch {
    return response({ok:false,code:"OWNER_REVIEW_UNAVAILABLE"},503);
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!enabled()) return response({ok:false,code:"OWNER_REVIEW_DISABLED"},503);
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase()!=="application/json")
    return response({ok:false,code:"INVALID_CONTENT_TYPE"},415);
  if (request.headers.has("cookie") && !request.headers.has("authorization"))
    return response({ok:false,code:"OWNER_AAL2_REQUIRED"},403);
  try {
    const owner = await verifyVoxOwnerBearer(request.headers.get("authorization"));
    if (!owner) return response({ok:false,code:"OWNER_AAL2_REQUIRED"},403);
    const raw: unknown = await request.json();
    if (!raw || typeof raw!=="object" || Array.isArray(raw))
      return response({ok:false,code:"INVALID_REVIEW_ACTION"},400);
    const body = raw as Record<string,unknown>;
    const keys = Object.keys(body).sort();
    if (keys.join(",")!=="action,reasonCode,vendorId" ||
        typeof body.vendorId!=="string" || !UUID.test(body.vendorId) ||
        typeof body.action!=="string" || !ACTIONS.has(body.action) ||
        typeof body.reasonCode!=="string" || !REASON.test(body.reasonCode))
      return response({ok:false,code:"INVALID_REVIEW_ACTION"},400);

    // A second trusted AAL2 inspection is mandatory immediately before the
    // privileged write; browser-selected reviewer ids are never accepted.
    if (await verifyVoxOwnerBearer(request.headers.get("authorization")) !== owner)
      return response({ok:false,code:"OWNER_SESSION_REVOKED"},403);
    const {data,error} = await adminClient().rpc(
      "qf_owner_record_vendor_verification_decision",{
        p_vendor_id:body.vendorId,
        p_reviewer_user_id:owner,
        p_action:body.action,
        p_reason_code:body.reasonCode,
      }
    );
    if (error || typeof data!=="string")
      return response({ok:false,code:"OWNER_REVIEW_UNAVAILABLE"},503);
    if (!["approved","rejected","needs_correction","documents_requested"].includes(data))
      return response({ok:false,code:"OWNER_REVIEW_DENIED"},409);
    return response({
      ok:true,schema:"qf.vox.owner.vendor-review-decision.v1",
      vendorId:body.vendorId,caseState:data,
      immutableDecisionRecorded:true,
      vendorBusinessStatusUnchanged:true,
      leadActivationUnchanged:true,
      requiresSeparateCoreVendorApproval:true,
    },200);
  } catch {
    return response({ok:false,code:"OWNER_REVIEW_UNAVAILABLE"},503);
  }
}
export function PUT():Response{return response({ok:false,code:"METHOD_NOT_ALLOWED"},405);}
export function PATCH():Response{return response({ok:false,code:"METHOD_NOT_ALLOWED"},405);}
export function DELETE():Response{return response({ok:false,code:"METHOD_NOT_ALLOWED"},405);}
