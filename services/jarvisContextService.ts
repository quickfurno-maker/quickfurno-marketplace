import type { JarvisContextDataSource, JarvisContextResult } from "../lib/jarvis/contextRead";
import { readJarvisSanitizedContextFromSource } from "../lib/jarvis/contextRead";
import type { QfjContextReadRequestV1 } from "../lib/jarvis/contextContract";
import type { QfJarvisRuntimePolicy } from "../lib/jarvis/runtimePolicy";

/**
 * A failed count is not a genuine zero. Fail closed so Anisha does not
 * misrepresent missing vendor activity/notifications as verified absence.
 * PII-free error code only; the caller returns unavailable, never invented.
 */
export function requireVerifiedVendorCounts(
  reads: readonly { readonly count: number | null; readonly error: unknown }[],
): readonly number[] {
  if (reads.some(({ count, error }) =>
    error !== null || !Number.isSafeInteger(count) || count === null || count < 0
  )) throw new TypeError("qfj-vendor-context-count-unavailable");
  return Object.freeze(reads.map(({ count }) => count as number));
}

async function productionDb() { const { adminClient } = await import("../lib/supabase"); return adminClient(); }

const productionSource: JarvisContextDataSource = Object.freeze({
  async readLead(id: string) {
    const db=await productionDb();
    const {data,error}=await db.from("leads")
      .select("id, city, service_required, budget, property_type, timeline, status, verification_status, is_duplicate")
      .eq("id",id).maybeSingle();
    if(error) throw error;
    return (data as Record<string,unknown>|null) ?? null;
  },

  async readVendor(id: string) {
    const db=await productionDb();
    const [vendorRead, activeLeadRead, unackedRead, reportRead, noticeRead] = await Promise.all([
      db.from("vendors")
        .select("id, city, service_categories, status, remaining_credits, is_active, public_visibility, paid_status, package_status, package_expires_at, location_verification_status")
        .eq("id",id).maybeSingle(),
      db.from("lead_assignments")
        .select("id", { count:"exact", head:true })
        .eq("vendor_id",id)
        .in("lifecycle_status",["assigned","delivered","accepted"]),
      db.from("lead_assignments")
        .select("id", { count:"exact", head:true })
        .eq("vendor_id",id)
        .eq("lifecycle_status","delivered"),
      db.from("bad_lead_reports")
        .select("id", { count:"exact", head:true })
        .eq("vendor_id",id)
        .in("status",["Pending","Under Review"]),
      db.from("vendor_notifications")
        .select("id", { count:"exact", head:true })
        .eq("vendor_id",id)
        .eq("is_read",false),
    ]);
    if (vendorRead.error) throw vendorRead.error;
    if (!vendorRead.data) return null;
    const [activeLeads, delivered, badReports, unreadNotices] = requireVerifiedVendorCounts([
      activeLeadRead, unackedRead, reportRead, noticeRead,
    ]);
    return {
      ...(vendorRead.data as Record<string,unknown>),
      active_lead_count: activeLeads,
      delivered_unacknowledged_count: delivered,
      pending_bad_lead_report_count: badReports,
      unread_notification_count: unreadNotices,
    };
  },
});

export async function readJarvisSanitizedContext(args:{
  readonly request:QfjContextReadRequestV1;
  readonly policy:QfJarvisRuntimePolicy;
}):Promise<JarvisContextResult> {
  return readJarvisSanitizedContextFromSource({ ...args, source:productionSource });
}
