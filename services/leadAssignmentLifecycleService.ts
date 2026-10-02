import { adminClient } from "../lib/supabase";
import { fail, ok, type Result } from "../lib/errors";

export async function projectLeadAssignmentLifecycleFromProviderMessages(input: {
  provider: string;
  providerMessageIds: readonly string[];
  providerAccountId?: string | null;
}): Promise<{ examined: number; projected: number; refused: number }> {
  const ids = Array.from(new Set(input.providerMessageIds.filter(Boolean))).slice(0, 100);
  if (!input.provider || ids.length === 0) return { examined: 0, projected: 0, refused: 0 };

  let query = adminClient()
    .from("communication_messages")
    .select("id,status")
    .eq("provider", input.provider)
    .in("provider_message_id", ids)
    .in("status", ["delivered", "read"]);
  if (input.providerAccountId) query = query.eq("provider_account_id", input.providerAccountId);

  const { data, error } = await query;
  if (error) return { examined: 0, projected: 0, refused: 0 };

  let projected = 0;
  let refused = 0;
  for (const row of (data ?? []) as Array<{ id: string }>) {
    const result = await adminClient().rpc("qf_project_vendor_lead_delivery_v1", { p_message_id: row.id });
    if (result.error) { refused += 1; continue; }
    const status = String((result.data as Record<string, unknown> | null)?.status ?? "");
    if (status === "applied" || status === "already_applied") projected += 1;
    else refused += 1;
  }
  return { examined: data?.length ?? 0, projected, refused };
}

export async function acknowledgeVendorLead(
  vendorId: string,
  assignmentId: string,
): Promise<Result<{ assignmentId: string; status: string }>> {
  try {
    if (!vendorId || !assignmentId) return { ok:false, code:"VALIDATION", error:"Vendor and assignment are required." };
    const { data, error } = await adminClient().rpc("qf_acknowledge_vendor_lead_v1", {
      p_vendor_id: vendorId,
      p_assignment_id: assignmentId,
    });
    if (error) throw error;
    const result = (data ?? {}) as Record<string, unknown>;
    const status = String(result.status ?? "");
    if (status !== "applied" && status !== "already_applied") {
      return { ok:false, code:String(result.reason_code ?? "ACKNOWLEDGEMENT_REFUSED"), error:"Lead acknowledgement is not available yet." };
    }
    return ok({ assignmentId, status });
  } catch (error) {
    return fail(error);
  }
}
