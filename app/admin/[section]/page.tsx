import { redirect } from "next/navigation";
import { adminSnapshot, getAdminSession } from "@/app/actions";
import { AdminSectionPage } from "@/components/admin/AdminSectionPage";
import { getAdminSectionBySlug } from "@/components/admin/adminConfig";

export const dynamic = "force-dynamic";

export default async function AdminDynamicSectionPage({ params }: { params: { section: string } }) {
  const section = getAdminSectionBySlug(params.section);
  if (!section || section.key === "dashboard") redirect("/admin/dashboard");

  const session = await getAdminSession();
  if (!session.isLoggedIn) redirect("/admin/login");
  if (!session.isSuperadmin) redirect("/admin/login?error=unauthorized");

  const snapshot = await adminSnapshot();

  return (
    <AdminSectionPage
      section={section.key}
      snapshot={snapshot.ok ? (snapshot.data as any) : null}
      error={!snapshot.ok ? snapshot.error : null}
    />
  );
}
