import { redirect } from "next/navigation";
import { getAdminSession } from "@/app/actions";
import { AdminLoginForm } from "@/components/AdminLoginForm";

export const metadata = { title: "Superadmin Login - QuickFurno" };
export const dynamic = "force-dynamic";

export default async function AdminLoginPage(props: {
  searchParams?: Promise<{ error?: string }>;
}) {
  // Next 16: searchParams is a Promise. Read synchronously it type-checks,
  // builds clean, then returns undefined at runtime.
  const searchParams = await props.searchParams;
  const session = await getAdminSession();

  if (session.isSuperadmin) redirect("/admin/dashboard");

  const initialError =
    searchParams?.error === "unauthorized"
      ? "Only Superadmin users can access this dashboard."
      : undefined;

  return <AdminLoginForm initialError={initialError} />;
}
