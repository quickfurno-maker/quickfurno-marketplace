import type {RazorpayProviderEventEnvelope} from "./vendorPackageProviderEventLedger.mjs";
export const RC39_REFUND_IDENTITY_INTAKE_RELEASED:false;
export const REFUND_IDENTITY_INTAKE_ENV_FLAG:"QF_VOX_REFUND_IDENTITY_INTAKE";
export function refundIdentityIntakeFlagOn(env: unknown): boolean;
export type StagedRefundIdentityIntakeResult =
  | Readonly<{ handled: false; reason: string; ack: false; retry: false; creditMutation: false; refundAllowed: false }>
  | Readonly<{ handled: true; ack: boolean; retry: boolean; status: string; code: string | null;
      identity?: "bound"; creditMutation: false; refundAllowed: false }>;
export function createStagedRefundIdentityIntake(deps: {
  repository: unknown;
  callRpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error?: unknown }>;
  macKey: string | Uint8Array;
  keyId: string;
  providerMode: "test" | "live";
  env: Record<string, string | undefined>;
  sqlApproved: boolean;
  released?: boolean;
}): { process(envelope: RazorpayProviderEventEnvelope): Promise<StagedRefundIdentityIntakeResult> };
