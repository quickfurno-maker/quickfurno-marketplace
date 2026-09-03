import { redirect } from "next/navigation";
import { getMyRole, getMyVendor } from "@/app/actions";
import { VendorMobileNav } from "@/components/vendor-dashboard-v2/VendorMobileNav";
import { VendorPortalSidebar } from "@/components/vendor-dashboard-v2/VendorPortalSidebar";
import { VendorPortalTopbar } from "@/components/vendor-dashboard-v2/VendorPortalTopbar";
import { isVendorVerified } from "@/components/vendor-dashboard-v2/vendorOverviewModel";
import "./vendor-portal-v2.css";

export default async function VendorDashboardLayout({ children }: { children: React.ReactNode }) {
  // Auth gate is UNCHANGED: no session role, no portal.
  const role = await getMyRole();
  if (!role) redirect("/vendor?mode=login");

  // Display-only identity for the topbar account control. Never a gate — a
  // missing or failed profile read simply hides the chip, and each page keeps
  // its own authoritative getMyVendor() call.
  const me = await getMyVendor();
  const vendor = me.ok ? me.data : null;

  return (
    <div className="qf-vd-shell qf-vendor-v2-shell">
      <VendorPortalSidebar />

      <div className="qf-vendor-v2-main">
        <VendorPortalTopbar
          businessName={vendor?.business_name ?? null}
          verified={vendor ? isVendorVerified(vendor) : false}
        />
        <main className="qf-vendor-v2-content">{children}</main>
        <VendorMobileNav />
      </div>
    </div>
  );
}
