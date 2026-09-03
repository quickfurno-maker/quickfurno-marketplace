import { getMyVendor } from "@/app/actions";
import { VendorNoProfileFallback } from "@/app/vendor/dashboard/_components/VendorNoProfileFallback";
import { VendorPackageWorkspace } from "@/components/vendor-dashboard-v2/package/VendorPackageWorkspace";
import { readPackageFeedback } from "@/components/vendor-dashboard-v2/package/packageModel";
import {
  getVendorCurrentPackageSummary,
  listAvailableVendorPackages,
  listVendorPackageOrders,
} from "@/services/vendorPackageOrderService";
import "./vendor-package-v2.css";

export const metadata = { title: "Credits & package - QuickFurno" };
export const dynamic = "force-dynamic";

type VendorPackagePageProps = {
  searchParams?: {
    order?: string;
    code?: string;
  };
};

export default async function VendorPackagePage({ searchParams }: VendorPackagePageProps) {
  const me = await getMyVendor();
  const vendor = me.ok ? me.data : null;

  if (!vendor) {
    return <VendorNoProfileFallback />;
  }

  // The same three reads the pre-V2 page made, unchanged.
  const [summaryRes, packagesRes, ordersRes] = await Promise.all([
    getVendorCurrentPackageSummary(vendor.id),
    listAvailableVendorPackages(),
    listVendorPackageOrders(vendor.id),
  ]);

  return (
    <VendorPackageWorkspace
      vendor={vendor}
      summary={summaryRes.ok ? summaryRes.data : null}
      packages={packagesRes.ok ? packagesRes.data : []}
      orders={ordersRes.ok ? ordersRes.data : []}
      feedback={readPackageFeedback(searchParams?.order)}
      loadError={!summaryRes.ok || !packagesRes.ok || !ordersRes.ok}
    />
  );
}
