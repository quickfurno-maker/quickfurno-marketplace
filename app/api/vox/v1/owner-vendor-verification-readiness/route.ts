/**
 * VOX Owner-only verification readiness view — READ ONLY, source-gated OFF.
 *
 * Reuses the canonical Core/private service-role readiness RPC; no document
 * bytes, storage keys, personal identity data, activation or approval actions.
 * This endpoint is NOT a replacement for the later Owner document-review UI.
 */
import "server-only";
import { adminClient } from "@/lib/supabase";
import { verifyVoxOwnerBearer } from "@/services/vox/verifiedStaffBearer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const respond = (data: unknown, status: number): Response => Response.json(data, {
  status,
  headers: {
    "cache-control": "private, no-store, max-age=0",
    "vary": "Authorization",
    "x-content-type-options": "nosniff",
  },
});

export async function GET(request: Request): Promise<Response> {
  // Explicit staging-only feature flag. Missing config is DISABLED.
  if (process.env.VOX_OWNER_VENDOR_VERIFICATION_READ_ENABLED !== "staging") {
    return respond({ ok: false, code: "OWNER_VENDOR_REVIEW_DISABLED" }, 503);
  }
  const url = new URL(request.url);
  const ids = url.searchParams.getAll("vendorId");
  if (url.hash || url.searchParams.size !== 1 || ids.length !== 1 || !UUID.test(ids[0])) {
    return respond({ ok: false, code: "INVALID_VENDOR_QUERY" }, 400);
  }
  try {
    const owner = await verifyVoxOwnerBearer(request.headers.get("authorization"));
    if (!owner) return respond({ ok: false, code: "OWNER_AAL2_REQUIRED" }, 403);

    // Truth only from the private consent/identity/office/Owner-decision gate,
    // not from a browser field, public document bucket or case self-attestation.
    const { data: ready, error } = await adminClient().rpc(
      "qf_vendor_verification_case_ready", { p_vendor_id: ids[0] }
    );
    // Missing migration, a failed read and an unknown response are errors,
    // never a misleading "not ready" verdict.
    if (error || typeof ready !== "boolean") {
      return respond({ ok: false, code: "VERIFICATION_READ_UNAVAILABLE" }, 503);
    }

    // Revalidate the signed Owner session after the privileged read.
    const freshOwner = await verifyVoxOwnerBearer(request.headers.get("authorization"));
    if (freshOwner !== owner) return respond({ ok: false, code: "OWNER_SESSION_REVOKED" }, 403);

    return respond({
      ok: true, schema: "qf.vox.owner.vendor-verification-readiness.v1",
      vendorId: ids[0], readyForCoreApproval: ready,
      mode: "READ_ONLY", canApprove: false, canReviewDocuments: false,
      requiresSeparateCoreReview: true,
    }, 200);
  } catch {
    return respond({ ok: false, code: "VERIFICATION_READ_UNAVAILABLE" }, 503);
  }
}
export function POST(): Response { return respond({ ok: false, code: "CORE_APPROVAL_REQUIRED" }, 405); }
export function PUT(): Response { return respond({ ok: false, code: "CORE_APPROVAL_REQUIRED" }, 405); }
export function PATCH(): Response { return respond({ ok: false, code: "CORE_APPROVAL_REQUIRED" }, 405); }
export function DELETE(): Response { return respond({ ok: false, code: "CORE_APPROVAL_REQUIRED" }, 405); }
