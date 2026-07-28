import { redirect } from "next/navigation";
import { getAdminSession } from "@/app/actions";
import { listFrequencyPolicies } from "@/services/communicationFrequencyPolicyService";
import { FrequencyPolicyManager } from "@/components/admin/crm/policies/FrequencyPolicyManager";

export const dynamic = "force-dynamic";

// Fixed administrator-facing text. A raw exception/database message is NEVER
// rendered: it can embed SQL, column names, row values or connection detail.
const POLICY_LOAD_ERROR =
  "Frequency policies could not be loaded. Please retry — if this persists, contact engineering.";

/** Server-side diagnostic. Logs the error CLASS only — never `message`. */
function logPolicyRouteFailure(e: unknown) {
  const err = e as { name?: string; code?: string } | null;
  console.error("[frequency-policy-route] load failed", {
    name: err?.name ?? "Error",
    code: err?.code ?? "UNKNOWN",
  });
}

// Superadmin-only. The frequency policy bounds how often any recipient may be
// contacted, so it sits behind the same boundary as the rest of Vendor CRM.
export default async function FrequencyPolicyPage() {
  const session = await getAdminSession();
  if (!session.isLoggedIn) redirect("/admin/login");
  if (!session.isSuperadmin) redirect("/admin/login?error=unauthorized");

  let policies: unknown[] = [];
  let error: string | null = null;
  try {
    policies = await listFrequencyPolicies();
  } catch (e) {
    logPolicyRouteFailure(e);
    error = POLICY_LOAD_ERROR;
  }

  return (
    <main className="admin-surface">
      <h1>Communication frequency policies</h1>
      <p>
        The Core rule that bounds how often a recipient may be contacted. While no active policy
        exists for a channel and purpose, campaign handoff fails closed and no campaign can create
        communication intents.
      </p>
      {error ? <p role="alert">{error}</p> : null}
      <FrequencyPolicyManager policies={(policies ?? []) as never[]} />
    </main>
  );
}
