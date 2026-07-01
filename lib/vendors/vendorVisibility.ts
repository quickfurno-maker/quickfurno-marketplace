import {
  normalizeActive,
  normalizePackageStatus,
  normalizePaidStatus,
} from "@/lib/vendors/vendorEligibility";

export type VendorPublicVisibilityType = "paid" | "trial" | "free_visible" | "hidden";

export interface VendorPublicVisibility {
  isPubliclyVisible: boolean;
  visibilityType: VendorPublicVisibilityType;
  reasons: string[];
}

export interface VendorPublicVisibilitySettings {
  show_free_vendors_publicly?: boolean | null;
  allow_trial_vendors_for_assignment?: boolean | null;
}

export function getVendorPublicVisibility(
  vendor: Record<string, unknown> | null | undefined,
  settings: VendorPublicVisibilitySettings | Record<string, unknown> | null | undefined = {},
): VendorPublicVisibility {
  const row = isRecord(vendor) ? vendor : {};
  const reasons: string[] = [];
  const status = normalizeStatusText(row.status);
  const active = normalizeActive(row);
  const packageStatus = normalizePackageStatus(row);
  const paidStatus = normalizePaidStatus(row);
  const showFree = readBooleanSetting(settings, "show_free_vendors_publicly", false);
  const allowTrial = readBooleanSetting(settings, "allow_trial_vendors_for_assignment", false);

  if (status === "suspended") reasons.push("vendor_suspended");
  else if (status !== "approved") reasons.push("vendor_pending_approval");
  if (!active) reasons.push("vendor_inactive");

  if (reasons.length > 0) {
    return { isPubliclyVisible: false, visibilityType: "hidden", reasons };
  }

  if (packageStatus === "active" || isPaidStatus(paidStatus)) {
    return { isPubliclyVisible: true, visibilityType: "paid", reasons: [] };
  }

  if ((packageStatus === "trial" || paidStatus === "trial") && allowTrial) {
    return { isPubliclyVisible: true, visibilityType: "trial", reasons: [] };
  }

  if (showFree) {
    return { isPubliclyVisible: true, visibilityType: "free_visible", reasons: ["free_vendor_public_visibility_switch_on"] };
  }

  return {
    isPubliclyVisible: false,
    visibilityType: "hidden",
    reasons: ["free_vendor_public_visibility_switch_off"],
  };
}

function normalizeStatusText(value: unknown): string {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (text === "approved" || text === "active") return "approved";
  if (text === "suspended") return "suspended";
  return text || "pending";
}

function isPaidStatus(value: string): boolean {
  return value === "paid" || value === "active" || value === "premium" || value === "priority";
}

function readBooleanSetting(settings: unknown, key: string, fallback: boolean): boolean {
  if (!isRecord(settings)) return fallback;
  const value = settings[key];
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.trim().toLowerCase() === "true";
  return fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
