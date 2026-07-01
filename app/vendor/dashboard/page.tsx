import { getMyVendor, vendorDashboard, vendorLeads } from "@/app/actions";
import { VendorNoProfileFallback } from "@/app/vendor/dashboard/_components/VendorNoProfileFallback";
import { VendorDashboard } from "@/components/VendorDashboard";
import type { VendorDashboardStats } from "@/lib/types";

export const metadata = { title: "Vendor dashboard - QuickFurno" };
export const dynamic = "force-dynamic";

export default async function VendorDashboardPage() {
  const me = await getMyVendor();
  const vendor = me.ok ? me.data : null;

  if (!vendor) {
    return <VendorNoProfileFallback />;
  }

  const [statsRes, leadsRes] = await Promise.all([vendorDashboard(vendor.id), vendorLeads(vendor.id)]);
  const stats = (statsRes.ok ? statsRes.data : {
    remaining_credits: 0, total_credits: 0, total_leads: 0, won: 0, lost: 0, in_progress: 0, bad_lead_reports: 0,
  }) as VendorDashboardStats;
  const leads = (leadsRes.ok ? leadsRes.data : []) as any[];

  return <VendorDashboard vendor={vendor} stats={stats} leads={leads} />;
}
