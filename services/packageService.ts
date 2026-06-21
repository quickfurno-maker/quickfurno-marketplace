// ============================================================================
// QuickFurno — services/packageService.ts
// Packages, manual payments, and crediting a vendor once payment is confirmed.
// ============================================================================
import { adminClient, publicClient } from "../lib/supabase";
import { appError, type Result, ok, fail } from "../lib/errors";
import { logSupabaseInsertError } from "../lib/supabaseLogging";

export async function listPackages(): Promise<Result<unknown[]>> {
  try {
    const { data, error } = await publicClient()
      .from("packages").select("*").eq("is_active", true).order("lead_count");
    if (error) throw error;
    return ok(data ?? []);
  } catch (e) {
    return fail(e);
  }
}

/** Admin records a manual payment (UPI/bank transfer) against a package. */
export async function createManualPayment(
  vendorId: string, packageId: string, amount: number, method: string, transactionId?: string
): Promise<Result<{ id: string }>> {
  try {
    const { data, error } = await adminClient()
      .from("payments")
      .insert({
        vendor_id: vendorId, package_id: packageId, amount,
        payment_method: method, transaction_id: transactionId ?? null,
        payment_status: "Pending",
      })
      .select("id")
      .single();
    if (error) {
      logSupabaseInsertError("payments", error, {
        vendor_id: vendorId,
        package_id: packageId,
        has_transaction_id: Boolean(transactionId),
      });
      throw error;
    }
    return ok({ id: data.id });
  } catch (e) {
    return fail(e);
  }
}

export async function markPaymentPaid(paymentId: string, adminNotes?: string): Promise<Result<null>> {
  try {
    const { error } = await adminClient()
      .from("payments")
      .update({ payment_status: "Paid", admin_notes: adminNotes ?? null })
      .eq("id", paymentId);
    if (error) throw error;
    return ok(null);
  } catch (e) {
    return fail(e);
  }
}

/** Credit a vendor for a specific paid payment (atomic RPC: mints batch + adds credits + sets visibility). */
export async function assignPackageToVendor(
  vendorId: string, packageId: string, paymentId: string
): Promise<Result<unknown>> {
  try {
    const { data, error } = await adminClient().rpc("assign_package_to_vendor", {
      p_vendor_id: vendorId, p_package_id: packageId, p_payment_id: paymentId,
    });
    if (error) throw error;
    return ok(data);
  } catch (e) {
    return fail(e);
  }
}

/** Convenience: look up a paid payment and credit the vendor in one call. */
export async function assignPackageAfterPayment(paymentId: string): Promise<Result<unknown>> {
  try {
    const db = adminClient();
    const { data: p, error } = await db
      .from("payments").select("vendor_id, package_id, payment_status").eq("id", paymentId).single();
    if (error || !p) throw appError("PAYMENT_NOT_FOUND");
    if (p.payment_status !== "Paid") throw appError("PAYMENT_NOT_PAID");
    return assignPackageToVendor(p.vendor_id, p.package_id, paymentId);
  } catch (e) {
    return fail(e);
  }
}
