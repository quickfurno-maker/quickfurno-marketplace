import { redirect } from "next/navigation";
import { adminCommandCenterData, getAdminSession } from "@/app/actions";
import { AdminDashboard } from "@/components/AdminDashboard";

export const metadata = { title: "Superadmin Dashboard - QuickFurno" };
export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
  const session = await getAdminSession();

  if (!session.isLoggedIn) redirect("/admin/login");
  if (!session.isSuperadmin) redirect("/admin/login?error=unauthorized");

  // C-PERF1: dashboard-specific bounded loader — accurate count-query KPIs
  // plus ≤10-row previews, instead of the broad every-table snapshot.
  const data = await adminCommandCenterData();

  return (
    <AdminDashboard
      data={data.ok ? (data.data as any) : null}
      error={!data.ok ? data.error : null}
    />
  );
}
