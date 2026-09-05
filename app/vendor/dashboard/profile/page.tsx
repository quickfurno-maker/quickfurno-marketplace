import { getMyVendor } from "@/app/actions";
import { VendorNoProfileFallback } from "@/app/vendor/dashboard/_components/VendorNoProfileFallback";
import { VendorProfileWorkspace } from "@/components/vendor-dashboard-v2/profile/VendorProfileWorkspace";
import { readProfileFeedback } from "@/components/vendor-dashboard-v2/profile/profileModel";
import {
  getVendorApprovedProfileSummary,
  listVendorProfileChangeRequests,
} from "@/services/vendorProfileChangeService";
import "./vendor-profile-v2.css";

export const metadata = { title: "My profile - QuickFurno" };
export const dynamic = "force-dynamic";

type VendorProfilePageProps = {
  searchParams?: {
    request?: string;
    code?: string;
  };
};

export default async function VendorProfilePage({ searchParams }: VendorProfilePageProps) {
  const me = await getMyVendor();
  const vendor = me.ok ? me.data : null;

  if (!vendor) {
    return <VendorNoProfileFallback />;
  }

  // The same two reads the pre-V2 page made, unchanged: the approved public
  // summary and this vendor's own change requests.
  const [summaryRes, requestsRes] = await Promise.all([
    getVendorApprovedProfileSummary(vendor.id),
    listVendorProfileChangeRequests(vendor.id),
  ]);

  return (
    <VendorProfileWorkspace
      vendor={vendor}
      summary={summaryRes.ok ? summaryRes.data : null}
      requests={requestsRes.ok ? requestsRes.data : []}
      feedback={readProfileFeedback(searchParams?.request)}
      loadError={!summaryRes.ok || !requestsRes.ok}
    />
  );
}
