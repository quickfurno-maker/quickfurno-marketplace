// ============================================================================
// QuickFurno — Vendor Credits & Package view model (QF-UI-V2-04)
//
// PURE presentation logic over data the package page ALREADY loads
// (getVendorCurrentPackageSummary + listAvailableVendorPackages +
// listVendorPackageOrders). No I/O, no writes, no new service, no new query.
//
// PAYMENT TRUTH. createVendorPackageOrder writes exactly one row with
// order_status "created", payment_status "not_started", payment_method
// "online_future", payment_provider "not_connected" and activation_status
// "not_activated". It never activates a package, never marks a payment paid and
// never adds a credit. Nothing in this module or its components changes that,
// and the copy below is written so the vendor cannot mistake an order for a
// purchase.
// ============================================================================
import type {
  VendorCurrentPackageSummary,
  VendorPackageOrder,
} from "@/services/vendorPackageOrderService";

/** The one sentence that must accompany every order action. */
export const PAYMENT_NOT_CONNECTED_NOTICE =
  "Payment is not connected yet. QuickFurno activates credits only after verified payment.";

/**
 * Display-only threshold for the "running low" cue. This is a UI reading of a
 * real number, NOT a backend rule — no service anywhere treats 3 as special.
 */
export const LOW_CREDIT_DISPLAY_THRESHOLD = 3;

export type CreditTone = "ok" | "low" | "empty";

export interface CreditState {
  remaining: number;
  total: number;
  /** null when total is 0, so no bar is drawn from a meaningless ratio. */
  percent: number | null;
  tone: CreditTone;
  headline: string;
  detail: string;
}

export function deriveCreditState(summary: VendorCurrentPackageSummary | null, fallback: {
  remaining: number;
  total: number;
}): CreditState {
  const remaining = numberOr(summary?.remaining_credits, fallback.remaining);
  const total = numberOr(summary?.total_credits, fallback.total);
  const percent = total > 0 ? Math.max(0, Math.min(100, Math.round((remaining / total) * 100))) : null;

  if (remaining <= 0) {
    return {
      remaining,
      total,
      percent,
      tone: "empty",
      headline: "No lead credits remaining",
      detail: "New enquiries cannot be assigned to you until credits are added.",
    };
  }

  if (remaining <= LOW_CREDIT_DISPLAY_THRESHOLD) {
    return {
      remaining,
      total,
      percent,
      tone: "low",
      headline: "Lead credits running low",
      detail: `Only ${remaining} lead credit${remaining === 1 ? "" : "s"} left.`,
    };
  }

  return {
    remaining,
    total,
    percent,
    tone: "ok",
    headline: "Lead credits available",
    detail: "Matched enquiries can be assigned to your business.",
  };
}

function numberOr(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// ---------------------------------------------------------------------------
// Order status presentation. Labels only — the stored values are untouched.
// ---------------------------------------------------------------------------
export type OrderChipTone = "neutral" | "pending" | "ok" | "warn";

export interface OrderChip {
  label: string;
  value: string;
  tone: OrderChipTone;
}

const ORDER_STATUS_LABEL: Record<string, string> = {
  created: "Created",
  cancelled: "Cancelled",
  failed: "Failed",
  completed: "Completed",
};

const PAYMENT_STATUS_LABEL: Record<string, string> = {
  not_started: "Not started",
  pending: "Pending",
  paid: "Paid",
  failed: "Failed",
  refunded: "Refunded",
};

const ACTIVATION_STATUS_LABEL: Record<string, string> = {
  not_activated: "Not activated",
  activated: "Activated",
  expired: "Expired",
};

function label(map: Record<string, string>, raw: string | null | undefined, fallback: string): string {
  const key = (raw ?? "").trim().toLowerCase();
  if (!key) return fallback;
  return map[key] ?? humanize(key);
}

function humanize(value: string): string {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** The three status chips shown per order row, always in the same order. */
export function orderChips(order: VendorPackageOrder): OrderChip[] {
  const orderStatus = (order.order_status ?? "created").toLowerCase();
  const paymentStatus = (order.payment_status ?? "not_started").toLowerCase();
  const activationStatus = (order.activation_status ?? "not_activated").toLowerCase();

  return [
    {
      label: "Order",
      value: label(ORDER_STATUS_LABEL, orderStatus, "Created"),
      tone: orderStatus === "failed" || orderStatus === "cancelled" ? "warn" : "neutral",
    },
    {
      label: "Payment",
      value: label(PAYMENT_STATUS_LABEL, paymentStatus, "Not started"),
      tone: paymentStatus === "paid" ? "ok" : paymentStatus === "failed" ? "warn" : "pending",
    },
    {
      label: "Activation",
      value: label(ACTIVATION_STATUS_LABEL, activationStatus, "Not activated"),
      tone: activationStatus === "activated" ? "ok" : "pending",
    },
  ];
}

/**
 * Failure reason, only when it is short, plain text and safe to surface.
 * Provider and internal identifiers are never rendered anywhere.
 */
export function readableFailureReason(order: VendorPackageOrder): string | null {
  const reason = (order.failure_reason ?? "").trim();
  if (!reason) return null;
  if (reason.length > 200) return null;
  // Anything that looks like an internal identifier stays hidden.
  if (/^[a-f0-9-]{16,}$/i.test(reason)) return null;
  return reason;
}

export function packageStatusLabel(summary: VendorCurrentPackageSummary | null): string {
  const raw = (summary?.package_status ?? "").trim();
  if (!raw) return "Not active";
  return humanize(raw.toLowerCase());
}

export function isPackageActive(summary: VendorCurrentPackageSummary | null): boolean {
  const raw = (summary?.package_status ?? "").trim().toLowerCase();
  return raw === "active" || raw === "trial";
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------
export function formatINR(value: unknown): string {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) return "₹0";
  return `₹${amount.toLocaleString("en-IN")}`;
}

export function formatCount(value: unknown): string {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n.toLocaleString("en-IN") : "0";
}

export function formatDate(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

// ---------------------------------------------------------------------------
// Feedback for the existing ?order= contract.
// ---------------------------------------------------------------------------
export type PackageFeedbackTone = "ok" | "error";

export interface PackageFeedback {
  tone: PackageFeedbackTone;
  message: string;
}

export function readPackageFeedback(param: string | undefined): PackageFeedback | null {
  switch (param) {
    case "created":
      return {
        tone: "ok",
        message:
          "Package order created. Payment is not connected yet — your package will activate only after QuickFurno verifies payment.",
      };
    case "failed":
      return {
        tone: "error",
        message: "Package order could not be created. Try again or contact support.",
      };
    case "invalid":
      return { tone: "error", message: "That package could not be identified. Please try again." };
    case "no-vendor":
      return { tone: "error", message: "We could not find your vendor profile for that action." };
    default:
      return null;
  }
}
