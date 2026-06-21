import { redirect } from "next/navigation";
import { adminSnapshot, getAdminSession } from "@/app/actions";
import { AdminDashboard } from "@/components/AdminDashboard";

export const metadata = { title: "Superadmin Dashboard - QuickFurno" };
export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
  const session = await getAdminSession();

  if (!session.isLoggedIn) redirect("/admin/login");
  if (!session.isSuperadmin) redirect("/admin/login?error=unauthorized");

  const snapshot = await adminSnapshot();

  return (
    <AdminDashboard
      snapshot={snapshot.ok ? (snapshot.data as any) : null}
      error={!snapshot.ok ? snapshot.error : null}
    />
  );
}
