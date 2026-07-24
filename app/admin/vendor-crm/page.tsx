import { redirect } from "next/navigation";
import { getAdminSession } from "@/app/actions";
import { listVendorCrmDirectory } from "@/services/vendorCrmService";
import { listVendorTags } from "@/services/vendorCrmService";
import { VendorCrmDirectory } from "@/components/admin/crm/VendorCrmDirectory";

export const dynamic = "force-dynamic";

// Admin-only Vendor CRM directory. Server-guarded, server-paged. No client
// service-role access; all reads run in this server component behind the guard.
export default async function VendorCrmDirectoryPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const session = await getAdminSession();
  if (!session.isLoggedIn) redirect("/admin/login");
  if (!session.isSuperadmin) redirect("/admin/login?error=unauthorized");

  const sp = searchParams ?? {};
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]?.[0] : sp[k]) ?? undefined;
  const query = {
    page: one("page"),
    search: one("search"),
    category: one("category"),
    city: one("city"),
    verification: one("verification"),
    enabled: one("enabled"),
    onboarding_stage: one("onboarding_stage"),
    relationship_status: one("relationship_status"),
    tagId: one("tagId"),
    taskState: one("taskState"),
  };

  let result;
  let error: string | null = null;
  let tags: { id: string; name: string; is_active?: boolean }[] = [];
  try {
    [result, tags] = await Promise.all([listVendorCrmDirectory(query), listVendorTags() as any]);
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to load the Vendor CRM directory.";
  }

  return (
    <VendorCrmDirectory
      result={result ?? { rows: [], page: 1, pageSize: 25, total: 0 }}
      query={query}
      tags={(tags ?? []).filter((t: any) => t.is_active !== false).map((t: any) => ({ id: t.id, name: t.name }))}
      error={error}
    />
  );
}
