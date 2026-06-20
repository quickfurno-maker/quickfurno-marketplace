import {
  adminStats, adminAllVendors, adminBadLeadReports, fetchPackages, adminAllLeads,
} from "@/app/actions";
import { AdminDashboard } from "@/components/AdminDashboard";
import type { AdminDashboardStats } from "@/lib/types";

export const metadata = { title: "Admin — QuickFurno" };
export const dynamic = "force-dynamic";

const EMPTY: AdminDashboardStats = {
  total_leads: 0, assigned_leads: 0, duplicate_leads: 0, total_vendors: 0,
  approved_vendors: 0, pending_vendors: 0, active_vendors: 0, total_revenue: 0,
  leads_distributed: 0, remaining_vendor_credits: 0, bad_lead_reports_pending: 0,
};

export default async function AdminPage() {
  const [s, v, r, p, l] = await Promise.all([
    adminStats(), adminAllVendors(), adminBadLeadReports(), fetchPackages(), adminAllLeads(),
  ]);

  return (
    <AdminDashboard
      stats={(s.ok ? s.data : EMPTY)}
      vendors={(v.ok ? v.data : []) as any[]}
      reports={(r.ok ? r.data : []) as any[]}
      packages={(p.ok ? p.data : []) as any[]}
      leads={(l.ok ? l.data : []) as any[]}
    />
  );
}
