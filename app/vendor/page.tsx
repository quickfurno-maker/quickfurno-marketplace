import Link from "next/link";
import { getMyVendor, vendorDashboard, vendorLeads } from "@/app/actions";
import { VendorDashboard } from "@/components/VendorDashboard";
import type { VendorDashboardStats } from "@/lib/types";

export const metadata = { title: "Studio dashboard — QuickFurno" };
export const dynamic = "force-dynamic";

export default async function VendorPage() {
  const me = await getMyVendor();
  const vendor = me.ok ? me.data : null;

  if (!vendor) {
    return (
      <div className="panel p-8 text-center">
        <h1 className="text-2xl text-ivory">No studio profile yet</h1>
        <p className="mx-auto mt-3 max-w-md font-sans text-sm text-muted">
          Your account isn’t linked to a studio. Complete your partner application to get started.
        </p>
        <Link href="/vendors/register" className="btn-gold mt-6">Complete application</Link>
      </div>
    );
  }

  const [statsRes, leadsRes] = await Promise.all([vendorDashboard(vendor.id), vendorLeads(vendor.id)]);
  const stats = (statsRes.ok ? statsRes.data : {
    remaining_credits: 0, total_credits: 0, total_leads: 0, won: 0, lost: 0, in_progress: 0, bad_lead_reports: 0,
  }) as VendorDashboardStats;
  const leads = (leadsRes.ok ? leadsRes.data : []) as any[];

  return <VendorDashboard vendorId={vendor.id} status={vendor.status} stats={stats} leads={leads} />;
}
