/** Public shape of the strictly bounded, read-only VOX Owner projection.
 * This declaration binds the existing runtime .mjs implementation in TypeScript.
 * No database authority, identity data, or actions are exposed through this module.
 */
export interface VoxOverviewSource {
  prospects?: readonly Record<string, unknown>[] | null;
  crm?: readonly Record<string, unknown>[] | null;
  vendorSupport?: readonly Record<string, unknown>[] | null;
  humanConversations?: readonly Record<string, unknown>[] | null;
}
export interface VoxOverviewProjection {
  readonly schema: "qf.vox.overview.v1";
  readonly source: "quickfurno-core";
  readonly prospectPreview: readonly {
    readonly prospectId: string | null;
    readonly businessName: string;
    readonly stage: string;
    readonly priority: string;
    readonly lastActivityAt: string | null;
  }[];
  readonly vendorCrmPreview: readonly {
    readonly vendorId: string | null;
    readonly onboarding: string;
    readonly relationship: string;
    readonly nextFollowupAt: string | null;
  }[];
  readonly supportPreview: readonly {
    readonly threadId: string | null;
    readonly vendorId: string | null;
    readonly status: string;
    readonly priority: string;
    readonly updatedAt: string | null;
  }[];
  readonly humanDeskPreview: readonly {
    readonly conversationId: string | null;
    readonly subjectType: "prospect" | "vendor" | "client" | "unknown";
    readonly state: "HUMAN" | "UNKNOWN";
    readonly revision: number | null;
    readonly updatedAt: string | null;
  }[];
  readonly permissions: readonly ["OWNER_READ_ONLY"];
  readonly actionsEnabled: false;
}
export function projectVoxOverview(source: VoxOverviewSource): VoxOverviewProjection;
