// ============================================================================
// QuickFurno - services/vendorNotificationService.ts
// Vendor-facing notification inbox. No WhatsApp or lead matching side effects.
// ============================================================================
import { adminClient } from "../lib/supabase";
import { appError, fail, ok, type Result } from "../lib/errors";

export type VendorNotification = {
  id: string;
  vendor_id: string;
  title: string;
  message: string;
  type: string | null;
  priority: string | null;
  is_read: boolean | null;
  cta_label: string | null;
  cta_url: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type VendorNotificationInput = {
  title: string;
  message: string;
  type?: string;
  priority?: string;
  cta_label?: string | null;
  cta_url?: string | null;
};

export async function listVendorNotifications(vendorId: string, filter: "all" | "unread" = "all"): Promise<Result<VendorNotification[]>> {
  try {
    let query = adminClient()
      .from("vendor_notifications")
      .select("*")
      .eq("vendor_id", vendorId)
      .order("created_at", { ascending: false });

    if (filter === "unread") query = query.eq("is_read", false);

    const { data, error } = await query;
    if (error) throw error;
    return ok((data ?? []) as VendorNotification[]);
  } catch (e) {
    return fail(e);
  }
}

export async function markVendorNotificationRead(vendorId: string, notificationId: string): Promise<Result<null>> {
  try {
    if (!notificationId) throw appError("VALIDATION");
    const { error } = await adminClient()
      .from("vendor_notifications")
      .update({ is_read: true, updated_at: new Date().toISOString() })
      .eq("id", notificationId)
      .eq("vendor_id", vendorId);
    if (error) throw error;
    return ok(null);
  } catch (e) {
    return fail(e);
  }
}

export async function markAllVendorNotificationsRead(vendorId: string): Promise<Result<null>> {
  try {
    const { error } = await adminClient()
      .from("vendor_notifications")
      .update({ is_read: true, updated_at: new Date().toISOString() })
      .eq("vendor_id", vendorId)
      .eq("is_read", false);
    if (error) throw error;
    return ok(null);
  } catch (e) {
    return fail(e);
  }
}

export async function createVendorNotification(vendorId: string, input: VendorNotificationInput): Promise<Result<VendorNotification>> {
  try {
    const title = cleanText(input.title, 120);
    const message = cleanText(input.message, 600);
    if (!title || !message) throw appError("VALIDATION");

    const { data, error } = await adminClient()
      .from("vendor_notifications")
      .insert({
        vendor_id: vendorId,
        title,
        message,
        type: cleanText(input.type ?? "general", 40) || "general",
        priority: cleanText(input.priority ?? "normal", 40) || "normal",
        cta_label: cleanText(input.cta_label ?? "", 80) || null,
        cta_url: safeUrl(input.cta_url),
        is_read: false,
      })
      .select("*")
      .single();
    if (error) throw error;
    return ok(data as VendorNotification);
  } catch (e) {
    return fail(e);
  }
}

function cleanText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function safeUrl(value: unknown) {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  if (!cleaned) return null;
  if (cleaned.startsWith("/") || /^https?:\/\//i.test(cleaned)) return cleaned.slice(0, 500);
  return null;
}
