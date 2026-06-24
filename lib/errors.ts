// ============================================================================
// QuickFurno — lib/errors.ts
// Maps internal RPC error codes to user-facing messages, and gives every
// service a single consistent result shape.
// ============================================================================

export class AppError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const MESSAGES: Record<string, string> = {
  NO_ELIGIBLE_VENDORS: "No eligible vendors found.",
  VENDOR_NO_CREDITS: "Vendor has no credits.",
  LEAD_ALREADY_ASSIGNED: "Lead already assigned.",
  MAX_VENDORS_EXCEEDED: "Maximum 3 vendors allowed.",
  DUPLICATE_LEAD: "Duplicate lead detected.",
  UNAUTHORIZED: "Unauthorized access.",
  LEAD_NOT_FOUND: "Lead not found.",
  PAYMENT_NOT_FOUND: "Payment not found.",
  PAYMENT_NOT_PAID: "Payment is not marked as paid yet.",
  PACKAGE_NOT_FOUND: "Package not found.",
  VALIDATION: "Some required fields are missing or invalid.",
  REPORT_WINDOW_CLOSED: "Bad-lead reports must be filed within the allowed window.",
  UNKNOWN: "Something went wrong. Please try again.",
};

/** Translate a Postgres/RPC error into an AppError with a friendly message. */
export function fromPgError(err: unknown): AppError {
  const raw =
    (err as { message?: string })?.message ??
    (typeof err === "string" ? err : "") ??
    "";
  // our RPCs raise bare codes like "DUPLICATE_LEAD"
  const code = Object.keys(MESSAGES).find((k) => raw.includes(k)) ?? "UNKNOWN";
  return new AppError(code, MESSAGES[code]);
}

export function appError(code: keyof typeof MESSAGES): AppError {
  return new AppError(code, MESSAGES[code] ?? MESSAGES.UNKNOWN);
}

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; error: string };

export function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}
export function fail(err: unknown): Result<never> {
  const e = err instanceof AppError ? err : fromPgError(err);
  return { ok: false, code: e.code, error: e.message };
}
