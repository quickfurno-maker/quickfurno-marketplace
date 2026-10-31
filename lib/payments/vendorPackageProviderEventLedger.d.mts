export const PROVIDER_EVENT_MAX_ATTEMPTS: number;
export type VendorPackageEventLedgerMode = "off" | "enforce";
export function vendorPackageEventLedgerMode(value: string | undefined | null): VendorPackageEventLedgerMode | null;
export function vendorPackageEventLedgerConfigError(
  providerMode: string,
  ledgerMode: VendorPackageEventLedgerMode | null
): string | null;
export type RazorpayProviderEventEnvelope =
  | Readonly<{
      ok: true;
      eventId: string;
      bodySha256: string;
      providerMode: "test" | "live";
      eventType: "payment.captured" | "payment.failed";
      providerOrderId: string;
      paymentId: string;
    }>
  | Readonly<{ ok: false; reason: string }>;
export function buildRazorpayProviderEventEnvelope(input: {
  eventId: string | null;
  bodySha256: string;
  providerMode: string;
  candidate: unknown;
}): RazorpayProviderEventEnvelope;
export type ProviderEventClaim =
  | Readonly<{ state: "claimed"; attempt: number }>
  | Readonly<{ state: "replay"; outcome: string }>
  | Readonly<{ state: "quarantined"; code: string }>
  | Readonly<{ state: "in_flight" | "conflict" | "invalid" }>;
export function inspectProviderEventClaim(receipt: unknown, envelope: RazorpayProviderEventEnvelope): ProviderEventClaim;
export type ProviderEventCompletion =
  | { disposition: "completed"; outcome: string }
  | { disposition: "retryable" | "quarantined"; errorCode: string };
export function inspectProviderEventCompletion(
  receipt: unknown,
  envelope: RazorpayProviderEventEnvelope,
  expected: ProviderEventCompletion
): boolean;
export function providerEventOutcomeAllowed(eventType: string, outcome: string): boolean;
export function financeErrorCode(error: unknown): string;
export function classifyVendorPackageWebhookFailure(code: string): "quarantine" | "retryable";
