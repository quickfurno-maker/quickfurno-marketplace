import { redirect } from "next/navigation";
import {
  adminAnalyticsPage,
  adminAuditLogsPage,
  adminCategoriesPage,
  adminCitiesPage,
  adminCrmBase,
  adminLeadsDirectory,
  adminNotificationsPage,
  adminPackagesPage,
  adminPaymentsPage,
  adminReportsPage,
  adminSettingsPage,
  adminSubscriptionsPage,
  adminUsersPage,
  adminVendorsDirectory,
  getAdminSession,
} from "@/app/actions";
import { AdminSectionPage } from "@/components/admin/AdminSectionPage";
import { LeadsDirectory } from "@/components/admin/sections/LeadsDirectory";
import { VendorsPage } from "@/components/admin/sections/VendorsSection";
import { getAdminSectionBySlug, type AdminSectionKey } from "@/components/admin/adminConfig";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

function param(searchParams: SearchParams, key: string): string {
  const value = searchParams[key];
  return typeof value === "string" ? value : "";
}

/**
 * C-PERF2: section-first data loading. The route resolves the requested
 * section, then calls ONLY that section's bounded loader. No normal Admin V2
 * route fetches the broad every-table snapshot any more; sections that need
 * no server data (roadmap/scope pages) receive none.
 */
async function loadSectionPayload(section: AdminSectionKey, searchParams: SearchParams) {
  switch (section) {
    case "payments":
      return adminPaymentsPage({
        page: param(searchParams, "page"),
        status: param(searchParams, "status"),
        search: param(searchParams, "search"),
      });
    case "vendor-subscriptions":
      return adminSubscriptionsPage({
        page: param(searchParams, "page"),
        ordersPage: param(searchParams, "orders_page"),
      });
    case "packages":
      return adminPackagesPage();
    case "categories":
      return adminCategoriesPage();
    case "cities":
      return adminCitiesPage();
    case "settings":
      return adminSettingsPage();
    case "notifications":
      return adminNotificationsPage();
    case "users":
      return adminUsersPage({ page: param(searchParams, "page") });
    case "audit-logs":
      return adminAuditLogsPage({ page: param(searchParams, "page"), search: param(searchParams, "search") });
    case "reports":
      return adminReportsPage();
    case "analytics":
      return adminAnalyticsPage();
    case "crm":
      return adminCrmBase();
    default:
      // Sections with no server data (aos, ai-agents, automations,
      // website-content, reviews) and self-fetching tabbed sections
      // (lead-distribution) load nothing here.
      return { ok: true as const, data: null };
  }
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

  const payload = await loadSectionPayload(section.key, searchParams);

  return (
    <AdminSectionPage
      section={section.key}
      payload={payload.ok ? (payload.data as any) : null}
      error={!payload.ok ? (payload as { error?: string }).error ?? null : null}
    />
  );
}
