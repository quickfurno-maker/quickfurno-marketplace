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
    <div className="space-y-4">
      <section aria-labelledby="frequency-policies-title" className="qfa-panel p-4 sm:p-5">
        <h2 id="frequency-policies-title" className="text-base font-semibold text-slate-950">Communication frequency policies</h2>
        <p className="mt-1 max-w-4xl text-[13px] leading-5 text-slate-500">
        The Core rule that bounds how often a recipient may be contacted. While no active policy
        exists for a channel and purpose, campaign handoff fails closed and no campaign can create
        communication intents.
        </p>
      </section>
      {error ? <p role="alert" className="rounded-[var(--qfa-radius)] border border-rose-200 bg-rose-50 p-3 text-[13px] text-rose-700">{error}</p> : null}
      <FrequencyPolicyManager policies={(policies ?? []) as never[]} />
    </div>
  );
}
