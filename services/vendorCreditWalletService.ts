// ============================================================================
// QuickFurno — services/vendorCreditWalletService.ts
// Phase 4 (credit-wallet): THE canonical backend boundary for vendor wallet
// mutations (grants / package purchases / refunds / manual adjustments).
//
// Every legitimate wallet INCREASE and manual adjustment routes through the atomic
// idempotent DB primitive `qf_apply_vendor_credit_delta` (migration
// 20260706000141). The lead-assignment DEBIT stays atomic inside the assignment
// RPC (20260706000142). No other code should write vendors.remaining_credits /
// vendors.total_credits / vendor_credit_logs directly.
//
// DEPLOY ORDERING: migration 20260706000141 must be applied before this code path
// is exercised in production (the RPC must exist).
// ============================================================================
import { adminClient } from "../lib/supabase";
import { appError, fail, ok, type Result } from "../lib/errors";

export type WalletChangeType =
  | "package_purchase"
  | "admin_credit_grant"
  | "invalid_lead_refund"
  | "manual_adjustment";

export interface WalletApplyResult {
  status: "applied" | "already_applied";
  vendor_id: string;
  credits_before: number;
  credits_after: number;
  delta: number;
}

export interface ApplyVendorCreditDeltaInput {
  vendorId: string;
  delta: number;
  changeType: WalletChangeType;
  reason?: string | null;
  /** Idempotency reference: same (referenceType, referenceId) mutates at most once. */
  referenceType?: string | null;
  referenceId?: string | null;
  updatedBy?: string;
  /** Explicit policy opt-in for a negative-resulting manual adjustment. Never clamps. */
  allowNegative?: boolean;
}

/** Low-level canonical mutation. Prefer the typed helpers below for clarity. */
export async function applyVendorCreditDelta(input: ApplyVendorCreditDeltaInput): Promise<Result<WalletApplyResult>> {
  try {
    const vendorId = (input.vendorId ?? "").trim();
    if (!vendorId) throw appError("VALIDATION");
    const delta = Math.round(Number(input.delta));
    if (!Number.isFinite(delta)) throw appError("VALIDATION");

    const { data, error } = await adminClient().rpc("qf_apply_vendor_credit_delta", {
      p_vendor_id: vendorId,
      p_delta: delta,
      p_change_type: input.changeType,
      p_reason: input.reason ?? null,
      p_reference_type: input.referenceType ?? null,
      p_reference_id: input.referenceId ?? null,
      p_updated_by: input.updatedBy ?? "system",
      p_allow_negative: input.allowNegative ?? false,
    });
    if (error) throw error;

    const r = (data ?? {}) as Record<string, unknown>;
    return ok({
      status: r.status === "already_applied" ? "already_applied" : "applied",
      vendor_id: String(r.vendor_id ?? vendorId),
      credits_before: Number(r.credits_before ?? 0),
      credits_after: Number(r.credits_after ?? 0),
      delta: Number(r.delta ?? 0),
    });
  } catch (e) {
    return fail(e);
  }
}

/** Positive-only grant (package purchase / admin grant / refund). Rejects ≤ 0. */
export async function grantVendorCredits(input: {
  vendorId: string;
  amount: number;
  changeType: Exclude<WalletChangeType, "manual_adjustment">;
  reason?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
  updatedBy?: string;
}): Promise<Result<WalletApplyResult>> {
  if (!(Number(input.amount) > 0)) return fail(appError("VALIDATION"));
  return applyVendorCreditDelta({ ...input, delta: Math.round(Number(input.amount)) });
}

/** Invalid-lead refund (+1). Idempotent on the assignment/approval id. */
export async function refundCreditForInvalidLead(input: {
  vendorId: string;
  referenceId: string; // assignment id or refund-approval id
  reason?: string | null;
  updatedBy?: string;
}): Promise<Result<WalletApplyResult>> {
  if (!input.referenceId) return fail(appError("VALIDATION"));
  return grantVendorCredits({
    vendorId: input.vendorId,
    amount: 1,
    changeType: "invalid_lead_refund",
    reason: input.reason ?? "Invalid lead refund",
    referenceType: "invalid_lead_refund",
    referenceId: input.referenceId,
    updatedBy: input.updatedBy ?? "admin",
  });
}

/**
 * FUTURE package-purchase call site (documented; NO payment logic invented).
 * The app currently only creates package ORDER INTENTS
 * (vendorPackageOrderService.createVendorPackageOrder → payment_status:'not_started').
 * When a real payment-confirmation webhook exists, it MUST call this AFTER verifying
 * payment success. Idempotent on (package_purchase, referenceId = provider payment
 * id or order id). At the DB level, the paid-package RPC assign_package_to_vendor is
 * already routed through the same primitive (migration 20260706000145).
 */
export async function grantCreditsForConfirmedPackagePurchase(input: {
  vendorId: string;
  creditsPurchased: number;
  referenceId: string; // provider payment id or order id (idempotency key)
  packageName?: string | null;
  updatedBy?: string;
}): Promise<Result<WalletApplyResult>> {
  return grantVendorCredits({
    vendorId: input.vendorId,
    amount: input.creditsPurchased,
    changeType: "package_purchase",
    reason: `Package purchase${input.packageName ? `: ${input.packageName}` : ""}`,
    referenceType: "package_purchase",
    referenceId: input.referenceId,
    updatedBy: input.updatedBy ?? "payment_confirmation",
  });
}
