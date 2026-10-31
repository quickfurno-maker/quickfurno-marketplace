import type {RazorpayProviderEventEnvelope} from "./vendorPackageProviderEventLedger.mjs";
export type RefundIdentityFields = Readonly<{
  eventId: string; bodySha256: string; providerMode: "test" | "live";
  eventType: "refund.created" | "refund.processed" | "refund.failed";
  refundId: string; paymentId: string; providerOrderId: string;
}>;
export function canonicalRefundIdentity(fields: RefundIdentityFields): string | null;
export function computeRefundIdentityMac(fields: RefundIdentityFields, key: string | Uint8Array): string | null;
export function verifyRefundIdentityMac(fields: RefundIdentityFields, mac: unknown, key: string | Uint8Array): boolean;
export function verifyDurableRefundIdentity(row: unknown, key: string | Uint8Array): boolean;
export type RefundIdentityBindResult =
  | Readonly<{ ok: true; reason: "REFUND_IDENTITY_BOUND"; refundId: string; paymentId: string; creditMutation: false; refundAllowed: false }>
  | Readonly<{ ok: false; reason: string; retrySafe: boolean; creditMutation: false; refundAllowed: false }>;
export function createRefundIdentityBinder(
  callRpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error?: unknown }>,
  options: { macKey: string | Uint8Array; keyId: string },
): { bind(envelope: RazorpayProviderEventEnvelope): Promise<RefundIdentityBindResult> };
