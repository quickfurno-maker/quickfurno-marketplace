import { redirect } from "next/navigation";
import { adminLeadsDirectory, adminSnapshot, adminVendorsDirectory, getAdminSession } from "@/app/actions";
import { AdminSectionPage } from "@/components/admin/AdminSectionPage";
import { LeadsDirectory } from "@/components/admin/sections/LeadsDirectory";
import { VendorsPage } from "@/components/admin/sections/VendorsSection";
import { getAdminSectionBySlug } from "@/components/admin/adminConfig";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

function param(searchParams: SearchParams, key: string): string {
  const value = searchParams[key];
  return typeof value === "string" ? value : "";
}

export default async function AdminDynamicSectionPage({
  params,
  searchParams,
}: {
  params: { section: string };
  searchParams: SearchParams;
}) {
  const section = getAdminSectionBySlug(params.section);
  if (!section || section.key === "dashboard") redirect("/admin/dashboard");

  const session = await getAdminSession();
  if (!session.isLoggedIn) redirect("/admin/login");
  if (!session.isSuperadmin) redirect("/admin/login?error=unauthorized");

  // C-PERF1: high-volume directories use dedicated bounded server-paged
  // loaders instead of the broad snapshot. Remaining sections still use the
  // snapshot — tracked as C-PERF2 work.
  if (section.key === "leads") {
    const directory = await adminLeadsDirectory({
      page: param(searchParams, "page"),
      search: param(searchParams, "search"),
      city: param(searchParams, "city"),
      category: param(searchParams, "category"),
      status: param(searchParams, "status"),
      source: param(searchParams, "source"),
      priority: param(searchParams, "priority"),
    });
    const payload = directory.ok ? (directory.data as any) : null;
    return (
      <LeadsDirectory
        data={payload}
        badLeadReview={payload?.badLeadReview ?? null}
        error={!directory.ok ? directory.error : null}
      />
    );
  }

  if (section.key === "vendors") {
    const directory = await adminVendorsDirectory({
      page: param(searchParams, "page"),
      search: param(searchParams, "search"),
      city: param(searchParams, "city"),
      category: param(searchParams, "category"),
      status: param(searchParams, "status"),
      packageStatus: param(searchParams, "package"),
    });
    return (
      <VendorsPage
        data={directory.ok ? (directory.data as any) : null}
        error={!directory.ok ? directory.error : null}
      />
    );
  }

  const snapshot = await adminSnapshot();

  return (
    <AdminSectionPage
      section={section.key}
      snapshot={snapshot.ok ? (snapshot.data as any) : null}
      error={!snapshot.ok ? snapshot.error : null}
    />
  );
}
