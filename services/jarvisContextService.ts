import type { JarvisContextDataSource, JarvisContextResult } from "../lib/jarvis/contextRead";
import { readJarvisSanitizedContextFromSource } from "../lib/jarvis/contextRead";
import type { QfjContextReadRequestV1 } from "../lib/jarvis/contextContract";
import type { QfJarvisRuntimePolicy } from "../lib/jarvis/runtimePolicy";

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
    return {
      ...(vendorRead.data as Record<string,unknown>),
      active_lead_count: activeLeadRead.count ?? 0,
      delivered_unacknowledged_count: unackedRead.count ?? 0,
      pending_bad_lead_report_count: reportRead.count ?? 0,
      unread_notification_count: noticeRead.count ?? 0,
    };
  },
});

export async function readJarvisSanitizedContext(args:{
  readonly request:QfjContextReadRequestV1;
  readonly policy:QfJarvisRuntimePolicy;
}):Promise<JarvisContextResult> {
  return readJarvisSanitizedContextFromSource({ ...args, source:productionSource });
}
