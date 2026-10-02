import { adminClient } from "../lib/supabase";

type VendorSignalRow = {
  id: string;
  status: string | null;
  is_active: boolean | null;
  remaining_credits: number | null;
  package_status: string | null;
  package_expires_at: string | null;
  last_delivered_at: string | null;
};

async function insertNotice(input: {
  vendorId: string;
  key: string;
  title: string;
  message: string;
  type: string;
  priority: "low" | "normal" | "high";
  ctaLabel: string;
  ctaUrl: string;
}): Promise<boolean> {
  const { error } = await adminClient().from("vendor_notifications").insert({
    vendor_id: input.vendorId,
    title: input.title,
    message: input.message,
    notification_type: input.type,
    type: input.type,
    priority: input.priority,
    cta_label: input.ctaLabel,
    cta_url: input.ctaUrl,
    is_read: false,
    dedupe_key: input.key,
  });
  if (!error) return true;
  // Unique dedupe collision is the expected replay path.
  if (error.code === "23505") return false;
  throw error;
}

/**
 * V5 advisory maintenance. It only reads Core truth and writes vendor notices.
 * It cannot change credits, packages, eligibility, assignments, recovery,
 * conversation authority, or WhatsApp transport.
 */
export async function runVendorIntelligenceMaintenance(
  limit = 100,
): Promise<{ examined: number; noticesCreated: number }> {
  const db = adminClient();
  const { data, error } = await db
    .from("vendors")
    .select("id,status,is_active,remaining_credits,package_status,package_expires_at,last_delivered_at")
    .eq("status", "Approved")
    .eq("is_active", true)
    .order("id", { ascending: true })
    .limit(Math.max(1, Math.min(limit, 500)));
  if (error) throw error;

  let noticesCreated = 0;
  const now = Date.now();
  for (const vendor of (data ?? []) as VendorSignalRow[]) {
    const credits = Number(vendor.remaining_credits ?? 0);
    if (credits >= 0 && credits <= 3) {
      if (await insertNotice({
        vendorId: vendor.id,
        key: `v5:low-credit:${vendor.id}:${credits}`,
        title: credits === 0 ? "Recharge needed" : "Credits running low",
        message: credits === 0
          ? "Your lead wallet is empty. Recharge before your next eligible match."
          : `You have ${credits} lead credit${credits === 1 ? "" : "s"} remaining.`,
        type: "low_credit",
        priority: credits === 0 ? "high" : "normal",
        ctaLabel: "View packages",
        ctaUrl: "/vendor/dashboard/package",
      })) noticesCreated += 1;
    }

    if (vendor.package_status === "active" && vendor.package_expires_at) {
      const expiry = Date.parse(vendor.package_expires_at);
      const days = Number.isFinite(expiry) ? Math.ceil((expiry - now) / 86_400_000) : null;
      if (days !== null && days >= 0 && days <= 7) {
        const dayKey = new Date(expiry).toISOString().slice(0, 10);
        if (await insertNotice({
          vendorId: vendor.id,
          key: `v5:package-expiry:${vendor.id}:${dayKey}`,
          title: "Package expiring soon",
          message: days === 0 ? "Your package expires today." : `Your package expires in ${days} day${days === 1 ? "" : "s"}.`,
          type: "package_expiry",
          priority: days <= 2 ? "high" : "normal",
          ctaLabel: "Review package",
          ctaUrl: "/vendor/dashboard/package",
        })) noticesCreated += 1;
      }
    }

    if (vendor.last_delivered_at) {
      const delivered = Date.parse(vendor.last_delivered_at);
      if (Number.isFinite(delivered) && now - delivered >= 30 * 86_400_000) {
        const monthKey = new Date(now).toISOString().slice(0, 7);
        if (await insertNotice({
          vendorId: vendor.id,
          key: `v5:reactivation:${vendor.id}:${monthKey}`,
          title: "Ready for new client matches?",
          message: "It has been a while since your last confirmed lead delivery. Review your profile, location and package readiness.",
          type: "reactivation",
          priority: "low",
          ctaLabel: "Review profile",
          ctaUrl: "/vendor/dashboard/profile",
        })) noticesCreated += 1;
      }
    }
  }

  // One acknowledgement reminder per genuinely delivered, still-unaccepted lead.
  const vendorIds = ((data ?? []) as VendorSignalRow[]).map((v) => v.id);
  if (vendorIds.length > 0) {
    const { data: assignments, error: assignmentError } = await db
      .from("lead_assignments")
      .select("id,vendor_id")
      .in("vendor_id", vendorIds)
      .eq("lifecycle_status", "delivered")
      .limit(Math.max(1, Math.min(limit * 3, 1000)));
    if (assignmentError) throw assignmentError;
    for (const assignment of assignments ?? []) {
      if (await insertNotice({
        vendorId: assignment.vendor_id,
        key: `v5:lead-ack:${assignment.id}`,
        title: "New lead delivered",
        message: "QuickFurno confirmed delivery of a new client match. Acknowledge it in your lead inbox.",
        type: "lead_ack_required",
        priority: "high",
        ctaLabel: "Open lead inbox",
        ctaUrl: "/vendor/dashboard/matching",
      })) noticesCreated += 1;
    }
  }

  return { examined: data?.length ?? 0, noticesCreated };
}
