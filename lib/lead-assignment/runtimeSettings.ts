import { adminClient } from "@/lib/supabase";
import { fail, ok, type Result } from "@/lib/errors";

export type AutoAssignmentMode = "off" | "preview" | "auto_suggest";

export interface MarketplaceRuntimeSettings {
  show_free_vendors_publicly: boolean;
  allow_free_vendor_interest_capture: boolean;
  notify_free_vendor_recharge_interest: boolean;
  allow_trial_vendors_for_assignment: boolean;
  minimum_paid_vendors_required_for_auto_assignment: number;
  max_vendors_per_lead: number;
  auto_assignment_mode: AutoAssignmentMode;
}

export interface MarketplaceRuntimeSettingRow {
  id?: string;
  key: string;
  value: unknown;
  description?: string | null;
  updated_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export const DEFAULT_MARKETPLACE_RUNTIME_SETTINGS: MarketplaceRuntimeSettings = {
  show_free_vendors_publicly: true,
  allow_free_vendor_interest_capture: true,
  notify_free_vendor_recharge_interest: true,
  allow_trial_vendors_for_assignment: true,
  minimum_paid_vendors_required_for_auto_assignment: 1,
  max_vendors_per_lead: 3,
  auto_assignment_mode: "preview",
};

const SETTING_DESCRIPTIONS: Record<keyof MarketplaceRuntimeSettings, string> = {
  show_free_vendors_publicly: "Allows approved active free vendors to remain publicly visible.",
  allow_free_vendor_interest_capture: "Allows clients to register gated interest on free vendor profiles.",
  notify_free_vendor_recharge_interest: "Creates preview-only recharge prompt events for free vendor interest.",
  allow_trial_vendors_for_assignment: "Allows trial vendors with credits to appear in assignment suggestions.",
  minimum_paid_vendors_required_for_auto_assignment: "Minimum paid/trial eligible vendors required before preview suggestions succeed.",
  max_vendors_per_lead: "Maximum vendors selected in preview suggestions for one lead.",
  auto_assignment_mode: "Controls paid-only auto matching mode for this phase.",
};

const SETTING_KEYS = Object.keys(DEFAULT_MARKETPLACE_RUNTIME_SETTINGS) as Array<keyof MarketplaceRuntimeSettings>;

export function normalizeMarketplaceSettings(rows: unknown): MarketplaceRuntimeSettings {
  const settings = { ...DEFAULT_MARKETPLACE_RUNTIME_SETTINGS };
  if (!Array.isArray(rows)) return settings;

  rows.forEach((row) => {
    if (!isRecord(row)) return;
    const key = typeof row.key === "string" ? row.key : "";
    if (!isMarketplaceSettingKey(key)) return;
    const rawValue = "value" in row ? row.value : undefined;
    settings[key] = normalizeSettingValue(key, rawValue) as never;
  });

  return settings;
}

export async function loadMarketplaceRuntimeSettings(): Promise<MarketplaceRuntimeSettings> {
  try {
    const { data, error } = await adminClient()
      .from("marketplace_runtime_settings")
      .select("key, value")
      .order("key", { ascending: true });
    if (error) {
      console.warn("[marketplace settings] using defaults", { message: error.message });
      return { ...DEFAULT_MARKETPLACE_RUNTIME_SETTINGS };
    }
    return normalizeMarketplaceSettings(data ?? []);
  } catch (error) {
    console.warn("[marketplace settings] using defaults", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return { ...DEFAULT_MARKETPLACE_RUNTIME_SETTINGS };
  }
}

export async function updateMarketplaceRuntimeSetting(
  key: string,
  value: unknown,
  updatedBy = "Superadmin",
): Promise<Result<MarketplaceRuntimeSettingRow>> {
  try {
    if (!isMarketplaceSettingKey(key)) {
      return { ok: false, code: "VALIDATION", error: "Unknown marketplace runtime setting." };
    }

    const normalized = normalizeSettingValue(key, value);
    const now = new Date().toISOString();
    const { data, error } = await adminClient()
      .from("marketplace_runtime_settings")
      .upsert(
        {
          key,
          value: normalized,
          description: SETTING_DESCRIPTIONS[key],
          updated_by: updatedBy,
          updated_at: now,
        },
        { onConflict: "key" },
      )
      .select("id, key, value, description, updated_by, created_at, updated_at")
      .single();

    if (error) throw error;
    return ok((data ?? { key, value: normalized, updated_by: updatedBy, updated_at: now }) as MarketplaceRuntimeSettingRow);
  } catch (error) {
    return fail(error);
  }
}

export function getMarketplaceSettingRowsFromSettings(settings: MarketplaceRuntimeSettings): MarketplaceRuntimeSettingRow[] {
  return SETTING_KEYS.map((key) => ({
    key,
    value: settings[key],
    description: SETTING_DESCRIPTIONS[key],
  }));
}

function isMarketplaceSettingKey(value: string): value is keyof MarketplaceRuntimeSettings {
  return (SETTING_KEYS as string[]).includes(value);
}

function normalizeSettingValue<K extends keyof MarketplaceRuntimeSettings>(
  key: K,
  value: unknown,
): MarketplaceRuntimeSettings[K] {
  const fallback = DEFAULT_MARKETPLACE_RUNTIME_SETTINGS[key];
  if (typeof fallback === "boolean") return readBoolean(value, fallback) as MarketplaceRuntimeSettings[K];
  if (typeof fallback === "number") {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback as MarketplaceRuntimeSettings[K];
    const rounded = Math.max(1, Math.floor(parsed));
    if (key === "max_vendors_per_lead") return Math.min(3, rounded) as MarketplaceRuntimeSettings[K];
    return rounded as MarketplaceRuntimeSettings[K];
  }
  if (key === "auto_assignment_mode") {
    const mode = typeof value === "string" ? value.trim() : "";
    return (mode === "off" || mode === "preview" || mode === "auto_suggest" ? mode : fallback) as MarketplaceRuntimeSettings[K];
  }
  return fallback as MarketplaceRuntimeSettings[K];
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.trim().toLowerCase() === "true";
  return fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
