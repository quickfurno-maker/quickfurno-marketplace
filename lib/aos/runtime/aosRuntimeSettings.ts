// ============================================================================
// QuickFurno AOS — Phase 12: Admin-Controlled AOS / n8n Activation Switch
//
// Runtime setting reader/writer for the AOS -> n8n master router gate (Lock 2).
//
// TWO-LOCK SAFETY MODEL
//   Lock 1 (server env): N8N_ENABLED=true AND N8N_OUTBOUND_WEBHOOK_ENABLED=true
//                        (see isN8nEnabled / isN8nOutboundWebhookEnabled).
//   Lock 2 (runtime):    aos_runtime_settings row 'aos_n8n_master_router'
//                        enabled=true AND mode='preview'.
//
// Only when BOTH locks are ON may QuickFurno forward an event to the n8n
// Master Preview Router. If either lock is OFF, AOS event processing continues
// safely in mock/preview mode and n8nWebhookCalled stays false.
//
// SAFETY CONTRACT:
//   - SERVER ONLY. Reads/writes via the Supabase service-role client. Never
//     import this from a client component — it must never reach the browser.
//   - Never throws on read: a missing table/row/error resolves to a safe OFF
//     default so lead submission is never blocked.
//   - Stores NO secrets. Exposes NO webhook URL or QF_N8N_SECRET.
//   - This module performs NO WhatsApp send, NO vendor notification, NO credit
//     deduction, NO auto assignment, and NO n8n-driven database writes.
// ============================================================================
import { adminClient } from "@/lib/supabase";
import { isN8nEnabled, isN8nOutboundWebhookEnabled } from "@/lib/aos/tools/n8nTool";

export const AOS_N8N_MASTER_ROUTER_KEY = "aos_n8n_master_router";

export type AosRuntimeMode = "off" | "preview" | "production_locked";

/** Modes a Superadmin is allowed to set right now. production_locked is reserved. */
export const AOS_SELECTABLE_MODES: AosRuntimeMode[] = ["off", "preview"];

const DEFAULT_DESCRIPTION =
  "Controls QuickFurno AOS event forwarding to n8n Master Preview Router.";

export interface AosRuntimeSetting {
  settingKey: string;
  enabled: boolean;
  mode: AosRuntimeMode;
  description: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
  /** true when the row was found in Supabase; false when a safe default was used. */
  exists: boolean;
}

export interface AosN8nEnvLock {
  n8nEnabled: boolean;
  outboundWebhookEnabled: boolean;
  bothEnabled: boolean;
}

export interface AosN8nActivation {
  envLock: AosN8nEnvLock;
  runtime: AosRuntimeSetting;
  /** All four conditions true → QuickFurno may forward to the preview router. */
  shouldCallN8n: boolean;
  /** Human-readable reason used for logs and the API status response. */
  reason: string;
}

function safeDefaultSetting(): AosRuntimeSetting {
  return {
    settingKey: AOS_N8N_MASTER_ROUTER_KEY,
    enabled: false,
    mode: "off",
    description: DEFAULT_DESCRIPTION,
    updatedBy: null,
    updatedAt: null,
    exists: false,
  };
}

function normalizeMode(value: unknown): AosRuntimeMode {
  if (value === "preview" || value === "production_locked") return value;
  return "off";
}

function mapRow(row: Record<string, unknown>): AosRuntimeSetting {
  return {
    settingKey: typeof row.setting_key === "string" ? row.setting_key : AOS_N8N_MASTER_ROUTER_KEY,
    enabled: row.enabled === true,
    mode: normalizeMode(row.mode),
    description: typeof row.description === "string" ? row.description : null,
    updatedBy: typeof row.updated_by === "string" ? row.updated_by : null,
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
    exists: true,
  };
}

/**
 * Read the master-router runtime setting. Never throws: any missing table,
 * missing row, or client error resolves to a safe OFF default so AOS event
 * handling and lead submission are never blocked.
 */
export async function getAosN8nMasterRouterSetting(): Promise<AosRuntimeSetting> {
  try {
    const client = adminClient();
    const { data, error } = await client
      .from("aos_runtime_settings")
      .select("setting_key, enabled, mode, description, updated_by, updated_at")
      .eq("setting_key", AOS_N8N_MASTER_ROUTER_KEY)
      .maybeSingle();

    if (error || !data) return safeDefaultSetting();
    return mapRow(data as Record<string, unknown>);
  } catch {
    // Missing env, offline DB, or any unexpected error must stay safe.
    return safeDefaultSetting();
  }
}

export interface SetAosN8nMasterRouterInput {
  enabled: boolean;
  /** Only 'off' or 'preview' are accepted; production_locked is rejected. */
  mode: AosRuntimeMode;
  updatedBy?: string | null;
}

export interface SetAosN8nMasterRouterResult {
  ok: boolean;
  setting?: AosRuntimeSetting;
  error?: string;
}

/**
 * Upsert the master-router runtime setting. SERVER ONLY — callers MUST verify
 * the caller is a Superadmin before invoking this. Rejects production_locked
 * (reserved / coming soon). When enabled is false the mode is forced to 'off'
 * so a disabled switch can never advertise an active mode.
 */
export async function setAosN8nMasterRouterSetting(
  input: SetAosN8nMasterRouterInput,
): Promise<SetAosN8nMasterRouterResult> {
  if (input.mode === "production_locked") {
    return { ok: false, error: "production_locked mode is not available yet." };
  }
  if (!AOS_SELECTABLE_MODES.includes(input.mode)) {
    return { ok: false, error: "Invalid mode. Only 'off' or 'preview' are allowed." };
  }

  const enabled = Boolean(input.enabled);
  // A disabled switch must never report an active mode.
  const mode: AosRuntimeMode = enabled ? input.mode : "off";

  try {
    const client = adminClient();
    const { data, error } = await client
      .from("aos_runtime_settings")
      .upsert(
        {
          setting_key: AOS_N8N_MASTER_ROUTER_KEY,
          enabled,
          mode,
          description: DEFAULT_DESCRIPTION,
          updated_by: input.updatedBy ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "setting_key" },
      )
      .select("setting_key, enabled, mode, description, updated_by, updated_at")
      .maybeSingle();

    if (error) return { ok: false, error: "Could not save the runtime setting." };
    if (!data) return { ok: true, setting: { ...safeDefaultSetting(), enabled, mode, exists: true } };
    return { ok: true, setting: mapRow(data as Record<string, unknown>) };
  } catch {
    return { ok: false, error: "Could not save the runtime setting." };
  }
}

export function readAosN8nEnvLock(): AosN8nEnvLock {
  const n8nEnabled = isN8nEnabled();
  const outboundWebhookEnabled = isN8nOutboundWebhookEnabled();
  return {
    n8nEnabled,
    outboundWebhookEnabled,
    bothEnabled: n8nEnabled && outboundWebhookEnabled,
  };
}

/**
 * Resolve the full two-lock activation state. This is the single source of
 * truth used by both the AOS event dispatch logic and the admin status API.
 * Never throws: falls back to a safe OFF runtime default.
 */
export async function resolveAosN8nActivation(): Promise<AosN8nActivation> {
  const envLock = readAosN8nEnvLock();
  const runtime = await getAosN8nMasterRouterSetting();

  const runtimeReady = runtime.enabled && runtime.mode === "preview";
  const shouldCallN8n = envLock.bothEnabled && runtimeReady;

  let reason: string;
  if (!envLock.n8nEnabled) {
    reason = "Lock 1 OFF: N8N_ENABLED is not true. Running in safe mock mode.";
  } else if (!envLock.outboundWebhookEnabled) {
    reason = "Lock 1 OFF: N8N_OUTBOUND_WEBHOOK_ENABLED is not true. Running in safe mock mode.";
  } else if (!runtime.enabled) {
    reason = "Lock 2 OFF: admin runtime switch is disabled. Running in safe mock mode.";
  } else if (runtime.mode !== "preview") {
    reason = `Lock 2 mode is '${runtime.mode}', not 'preview'. Running in safe mock mode.`;
  } else {
    reason = "Both locks ON (preview). Events may be forwarded to the n8n Master Preview Router.";
  }

  return { envLock, runtime, shouldCallN8n, reason };
}
