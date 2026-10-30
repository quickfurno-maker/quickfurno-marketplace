export type RazorpayMode = "test" | "live";
export interface PersistedRazorpayOrderMode {
  payment_provider: string | null;
  provider_mode: RazorpayMode | string | null;
}
export function storedRazorpayOrderModeError(
  order: PersistedRazorpayOrderMode | null,
  requestedMode: RazorpayMode
): "PACKAGE_ORDER_MODE_MISMATCH" | "PACKAGE_ORDER_PROVIDER_MISMATCH" | null;
export interface ExpectedRazorpayClaim {
  orderId: string;
  amountSubunits: number;
  receipt: string;
}
export function inspectRazorpayOrderClaim(
  claim: unknown,
  expected: ExpectedRazorpayClaim
): "claimed" | "already_bound" | "invalid";

export function isDefiniteRazorpayOrderRejection(status: number): boolean;
