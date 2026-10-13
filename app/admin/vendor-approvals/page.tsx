import { redirect } from "next/navigation";
import { getAdminSession } from "@/app/actions";
import { listPendingVendorProfileChangeRequests } from "@/services/vendorProfileChangeService";
import { VendorApprovalQueue } from "@/components/admin/vendor-approvals/VendorApprovalQueue";

export const dynamic = "force-dynamic";
export const metadata = { title: "Vendor Approvals - QuickFurno" };

export default async function VendorApprovalsPage() {
  const session = await getAdminSession();
  if (!session.isLoggedIn) redirect("/admin/login");
  if (!session.isSuperadmin) redirect("/admin/login?error=unauthorized");
  const result = await listPendingVendorProfileChangeRequests();
  return <VendorApprovalQueue requests={result.ok ? result.data : []} loadError={!result.ok} />;
}
