// ==========================================================================
// QuickFurno AOS V2 — runtime state
//
// The existing aos_runtime_settings table is reused only as a lightweight
// feature switch. It is NOT a workflow authority. AOS V2 never calls an external automation runtime
// directly and never authorizes business mutations.
// =============================================================================
import { adminClient } from "@/lib/supabase";
import {
  AOS_V2_ACTION_PROPOSALS_KEY,
  AOS_V2_RUNTIME_KEY,
  type AosV2RuntimeState,
} from "./contracts";

type RuntimeRow = {
  setting_key?: string | null;
  enabled?: boolean | null;
  mode?: string | null;
};

function defaultState(): AosV2RuntimeState {
  return {
    intelligenceEnabled: false,
    mode: "off",
    actionProposalsEnabled: false,
    legacyExternalAutomationRetired: true,
  };
}

export async function getAosV2RuntimeState(): Promise<AosV2RuntimeState> {
  try {
    const { data, error } = await adminClient()
      .from("aos_runtime_settings")
      .select("setting_key, enabled, mode")
      .in("setting_key", [AOS_V2_RUNTIME_KEY, AOS_V2_ACTION_PROPOSALS_KEY]);

    if (error) return defaultState();

    const rows = (data ?? []) as RuntimeRow[];
    const intelligence = rows.find((row) => row.setting_key === AOS_V2_RUNTIME_KEY);
    const proposals = rows.find((row) => row.setting_key === AOS_V2_ACTION_PROPOSALS_KEY);

    const intelligenceEnabled =
      intelligence?.enabled === true && intelligence.mode === "preview";

    // Deliberately independent from intelligence activation. Even an active AOS
    // remains advisory unless this second governance switch is explicitly on.
    const actionProposalsEnabled =
      proposals?.enabled === true && proposals.mode === "preview";

    return {
      intelligenceEnabled,
      mode: intelligenceEnabled ? "shadow" : "off",
      actionProposalsEnabled,
      legacyExternalAutomationRetired: true,
    };
  } catch {
    return defaultState();
  }
}

export async function setAosV2IntelligenceEnabled(input: {
  enabled: boolean;
  updatedBy: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { error } = await adminClient()
      .from("aos_runtime_settings")
      .upsert(
        {
          setting_key: AOS_V2_RUNTIME_KEY,
          enabled: input.enabled,
          mode: input.enabled ? "preview" : "off",
          description:
            "AOS V2 intelligence runtime. Shadow/advisory only; Core remains authority.",
          updated_by: input.updatedBy,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "setting_key" },
      );

    if (error) return { ok: false, error: "AOS_V2_RUNTIME_UPDATE_FAILED" };
    return { ok: true };
  } catch {
    return { ok: false, error: "AOS_V2_RUNTIME_UPDATE_FAILED" };
  }
}

export async function forceAosV2ActionProposalsOff(input: {
  updatedBy: string;
}): Promise<void> {
  try {
    await adminClient()
      .from("aos_runtime_settings")
      .upsert(
        {
          setting_key: AOS_V2_ACTION_PROPOSALS_KEY,
          enabled: false,
          mode: "off",
          description:
            "AOS V2 governed action proposal seam. Locked OFF until separately certified.",
          updated_by: input.updatedBy,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "setting_key" },
      );
  } catch {
    // Safety default is OFF; an inability to persist OFF never activates it.
  }
}
