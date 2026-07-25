import { redirect, notFound } from "next/navigation";
import { getAdminSession } from "@/app/actions";
import { getVendorSegment } from "@/services/vendorSegmentService";
import { VendorSegmentEditor } from "@/components/admin/crm/segments/VendorSegmentEditor";

export const dynamic = "force-dynamic";

// Fixed administrator-facing text. A raw exception/database message is NEVER
// rendered: it can embed SQL, column names, row values or connection detail.
const SEGMENT_LOAD_ERROR =
  "This segment could not be loaded. Please retry — if this persists, contact engineering.";

/** Server-side diagnostic. Logs the error CLASS only — never `message`, and
 *  never the segment id. */
function logSegmentRouteFailure(scope: string, e: unknown) {
  const err = e as { name?: string; code?: string } | null;
  console.error("[segment-route] load failed", {
    scope,
    name: err?.name ?? "Error",
    code: err?.code ?? "UNKNOWN",
  });
}

// Admin-only segment definition editor + dynamic preview.
export default async function VendorSegmentEditorPage({ params }: { params: { segmentId: string } }) {
  const session = await getAdminSession();
  if (!session.isLoggedIn) redirect("/admin/login");
  if (!session.isSuperadmin) redirect("/admin/login?error=unauthorized");

  const segmentId = params.segmentId;
  const isNew = segmentId === "new";
  if (!isNew && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segmentId)) {
    notFound();
  }

  let segment = null;
  let error: string | null = null;
  if (!isNew) {
    try {
      segment = await getVendorSegment(segmentId);
    } catch (e) {
      logSegmentRouteFailure("vendor-crm/segments/detail", e);
      error = SEGMENT_LOAD_ERROR;
    }
    if (!error && !segment) notFound();
  }

  return (
    <VendorSegmentEditor
      segmentId={isNew ? null : segmentId}
      segment={(segment as any) ?? null}
      error={error}
    />
  );
}
