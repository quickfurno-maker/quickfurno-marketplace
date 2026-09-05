// ============================================================================
// QuickFurno — Vendor Notifications view model (QF-UI-V2-04)
//
// PURE presentation over rows listVendorNotifications() already returns.
// Ownership, the all/unread filter semantics and the mark-read actions are
// untouched: this module only maps stored values to labels and icons.
// ============================================================================
import type { VendorIconName } from "../icons";
import type { VendorNotification } from "@/services/vendorNotificationService";

/**
 * Icon per stored `type`. Only the values the codebase actually writes are
 * mapped — lead_assigned, lead_selected_recharge, profile and support — and
 * anything else falls back to a neutral bell rather than inventing a meaning.
 */
const TYPE_ICON: Record<string, VendorIconName> = {
  lead_assigned: "leads",
  lead_selected_recharge: "credits",
  profile: "profile",
  support: "support",
  package: "credits",
  account: "shield",
  general: "bell",
};

export function notificationIcon(type: string | null | undefined): VendorIconName {
  const key = (type ?? "").trim().toLowerCase();
  return TYPE_ICON[key] ?? "bell";
}

/** Human label per stored `type`, again with a neutral fallback. */
const TYPE_LABEL: Record<string, string> = {
  lead_assigned: "Lead assigned",
  lead_selected_recharge: "Credits needed",
  profile: "Profile review",
  support: "Support",
  package: "Package",
  account: "Account",
  general: "Update",
};

export function notificationTypeLabel(type: string | null | undefined): string {
  const key = (type ?? "").trim().toLowerCase();
  if (!key) return "Update";
  return TYPE_LABEL[key] ?? key.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Priority is surfaced ONLY when it carries information. The services write
 * "high" or "normal"; marking everything "Normal" would be noise, so only
 * "high" produces a badge.
 */
export function isHighPriority(priority: string | null | undefined): boolean {
  return (priority ?? "").trim().toLowerCase() === "high";
}

/**
 * CTA target, restricted to internal app paths.
 *
 * Every cta_url the codebase creates is an internal "/vendor/dashboard/..."
 * path. The service's own safeUrl() would also permit an absolute http(s) URL,
 * so this narrows — never widens — what the inbox will navigate to: an external
 * value simply renders no CTA instead of becoming an off-site link.
 */
export function internalCtaHref(url: string | null | undefined): string | null {
  if (typeof url !== "string") return null;
  const trimmed = url.trim();
  if (!trimmed.startsWith("/")) return null;
  // Protocol-relative "//host" would leave the site.
  if (trimmed.startsWith("//")) return null;
  return trimmed;
}

export function unreadCount(notifications: VendorNotification[]): number {
  return notifications.filter((notification) => !notification.is_read).length;
}

export function formatNotificationTime(value: string | null | undefined): string {
  if (!value) return "Recently";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently";
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

// ---------------------------------------------------------------------------
// Feedback for the existing ?notice= contract.
// ---------------------------------------------------------------------------
export type NoticeFeedbackTone = "ok" | "error";

export interface NoticeFeedback {
  tone: NoticeFeedbackTone;
  message: string;
}

export function readNoticeFeedback(param: string | undefined): NoticeFeedback | null {
  switch (param) {
    case "read":
      return { tone: "ok", message: "Notification marked as read." };
    case "all-read":
      return { tone: "ok", message: "All notifications marked as read." };
    case "failed":
      return { tone: "error", message: "That notification could not be updated. Please try again." };
    default:
      return null;
  }
}
