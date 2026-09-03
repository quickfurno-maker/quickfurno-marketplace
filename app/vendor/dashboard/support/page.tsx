import { getMyVendor } from "@/app/actions";
import { VendorNoProfileFallback } from "@/app/vendor/dashboard/_components/VendorNoProfileFallback";
import { VendorSupportWorkspace } from "@/components/vendor-dashboard-v2/support/VendorSupportWorkspace";
import { readSupportFeedback } from "@/components/vendor-dashboard-v2/support/supportModel";
import { listVendorSupportThreads } from "@/services/vendorSupportService";
import "./vendor-support-v2.css";

export const metadata = { title: "Support - QuickFurno" };
export const dynamic = "force-dynamic";

type VendorSupportPageProps = {
  searchParams?: {
    support?: string;
    code?: string;
  };
};

export default async function VendorSupportPage({ searchParams }: VendorSupportPageProps) {
  const me = await getMyVendor();
  const vendor = me.ok ? me.data : null;

  if (!vendor) {
    return <VendorNoProfileFallback />;
  }

  // The same single read the pre-V2 page made, unchanged.
  const threadsResult = await listVendorSupportThreads(vendor.id);

  return (
    <VendorSupportWorkspace
      threads={threadsResult.ok ? threadsResult.data : []}
      feedback={readSupportFeedback(searchParams?.support)}
      loadError={!threadsResult.ok}
    />
  );
}
