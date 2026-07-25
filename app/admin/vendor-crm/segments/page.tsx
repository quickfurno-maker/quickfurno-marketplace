import { redirect } from "next/navigation";
import { getAdminSession } from "@/app/actions";
import { listVendorSegments } from "@/services/vendorSegmentService";
import { VendorSegmentDirectory } from "@/components/admin/crm/segments/VendorSegmentDirectory";

export const dynamic = "force-dynamic";

// Fixed administrator-facing text. A raw exception/database message is NEVER
// rendered: it can embed SQL, column names, row values or connection detail.
const SEGMENT_DIRECTORY_LOAD_ERROR =
  "The segment directory could not be loaded. Please retry — if this persists, contact engineering.";

/** Server-side diagnostic. Logs the error CLASS only — never `message`. */
function logSegmentRouteFailure(scope: string, e: unknown) {
  const err = e as { name?: string; code?: string } | null;
  console.error("[segment-route] load failed", {
    scope,
    name: err?.name ?? "Error",
    code: err?.code ?? "UNKNOWN",
  });
}

// Admin-only deterministic segment directory. Server-guarded, server-paged.
// No client service-role access; all reads run in this server component.
export default async function VendorSegmentDirectoryPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const session = await getAdminSession();
  if (!session.isLoggedIn) redirect("/admin/login");
  if (!session.isSuperadmin) redirect("/admin/login?error=unauthorized");

  const sp = searchParams ?? {};
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]?.[0] : sp[k]) ?? undefined;
  const query = { page: one("page"), status: one("status") };

  let result;
  let error: string | null = null;
  try {
    result = await listVendorSegments(query);
  } catch (e) {
    logSegmentRouteFailure("vendor-crm/segments", e);
    error = SEGMENT_DIRECTORY_LOAD_ERROR;
  }

  return (
    <VendorSegmentDirectory
      result={result ?? { rows: [], page: 1, pageSize: 25, total: 0 }}
      query={query}
      error={error}
    />
  );
}
