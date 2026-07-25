import { redirect, notFound } from "next/navigation";
import { getAdminSession } from "@/app/actions";
import {
  getVendorCoreFacts, getVendorCrmProfile, listVendorContacts,
  listVendorTagAssignments, listVendorTags, listVendorNotes, listVendorTasks,
} from "@/services/vendorCrmService";
import { VendorCrmProfile } from "@/components/admin/crm/VendorCrmProfile";

export const dynamic = "force-dynamic";

// Fixed administrator-facing text. A raw exception/database/provider message is
// NEVER rendered: it can embed SQL, column names, row values or connection
// detail. The operator gets a stable string; the detail stays server-side.
const CRM_PROFILE_LOAD_ERROR =
  "This vendor's CRM profile could not be loaded. Please retry — if this persists, contact engineering.";

/** Server-side diagnostic. Logs the error CLASS only — never `message`, which is
 *  the field that carries SQL, identifiers, values and PII. Never logs the
 *  vendor id. */
function logCrmRouteFailure(scope: string, e: unknown) {
  const err = e as { name?: string; code?: string } | null;
  console.error("[crm-route] load failed", {
    scope,
    name: err?.name ?? "Error",
    code: err?.code ?? "UNKNOWN",
  });
}

// Admin-only combined Vendor CRM profile (Core read-only + CRM extensions).
export default async function VendorCrmProfilePage({ params }: { params: { vendorId: string } }) {
  const session = await getAdminSession();
  if (!session.isLoggedIn) redirect("/admin/login");
  if (!session.isSuperadmin) redirect("/admin/login?error=unauthorized");

  const vendorId = params.vendorId;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(vendorId)) notFound();

  let core, profile, contacts, tagAssignments, allTags, notes, tasks;
  let error: string | null = null;
  try {
    [core, profile, contacts, tagAssignments, allTags, notes, tasks] = await Promise.all([
      getVendorCoreFacts(vendorId),
      getVendorCrmProfile(vendorId),
      listVendorContacts(vendorId),
      listVendorTagAssignments(vendorId),
      listVendorTags(),
      listVendorNotes(vendorId),
      listVendorTasks(vendorId),
    ]);
  } catch (e) {
    logCrmRouteFailure("vendor-crm/profile", e);
    error = CRM_PROFILE_LOAD_ERROR;
  }

  if (!error && !core) notFound();

  return (
    <VendorCrmProfile
      vendorId={vendorId}
      core={(core as any) ?? null}
      profile={(profile as any) ?? null}
      contacts={(contacts as any) ?? []}
      tagAssignments={(tagAssignments as any) ?? []}
      allTags={(allTags as any) ?? []}
      notes={(notes as any) ?? []}
      tasks={(tasks as any) ?? []}
      error={error}
    />
  );
}
