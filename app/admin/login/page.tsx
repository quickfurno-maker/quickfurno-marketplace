import { redirect } from "next/navigation";
import { getAdminSession } from "@/app/actions";
import { AdminLoginForm } from "@/components/AdminLoginForm";

export const metadata = { title: "Superadmin Login - QuickFurno" };
export const dynamic = "force-dynamic";

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams?: { error?: string };
}) {
  const session = await getAdminSession();

  if (session.isSuperadmin) redirect("/admin/dashboard");

  const initialError =
    searchParams?.error === "unauthorized"
      ? "Only Superadmin users can access this dashboard."
      : undefined;

  return <AdminLoginForm initialError={initialError} />;
}
