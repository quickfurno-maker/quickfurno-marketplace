import type { ProviderEventCompletion, RazorpayProviderEventEnvelope } from "./vendorPackageProviderEventLedger.mjs";

export interface VendorPackageProviderEventRepository {
  claim(envelope: RazorpayProviderEventEnvelope): Promise<unknown>;
  complete(envelope: RazorpayProviderEventEnvelope, expected: Readonly<ProviderEventCompletion>): Promise<unknown>;
}
export type VendorPackageEventLedgerGate =
  | Readonly<{ action: "legacy" }>
  | Readonly<{ action: "ledger"; repository: VendorPackageProviderEventRepository }>
  | Readonly<{ action: "deny"; code: string }>;
export function resolveVendorPackageEventLedgerGate(input: {
  providerMode: string;
  ledgerModeValue: string | undefined | null;
  repository?: unknown;
}): VendorPackageEventLedgerGate;
export function isProviderEventRepository(repository: unknown): repository is VendorPackageProviderEventRepository;
export type ProviderEventProcessingResult = Readonly<{
  ack: boolean;
  retry: boolean;
  status: string;
  code: string | null;
  replay?: true;
}>;
export function processVendorPackageProviderEvent(input: {
  envelope: RazorpayProviderEventEnvelope;
  repository: unknown;
  handle: (envelope: RazorpayProviderEventEnvelope) => Promise<string>;
}): Promise<ProviderEventProcessingResult>;
export function providerEventHttpStatus(result: unknown): number;
