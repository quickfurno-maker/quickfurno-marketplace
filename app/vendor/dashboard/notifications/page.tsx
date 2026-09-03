import { getMyVendor } from "@/app/actions";
import { VendorNoProfileFallback } from "@/app/vendor/dashboard/_components/VendorNoProfileFallback";
import { VendorNotificationsWorkspace } from "@/components/vendor-dashboard-v2/notifications/VendorNotificationsWorkspace";
import { readNoticeFeedback } from "@/components/vendor-dashboard-v2/notifications/notificationsModel";
import { listVendorNotifications } from "@/services/vendorNotificationService";
import "./vendor-notifications-v2.css";

export const metadata = { title: "Notifications - QuickFurno" };
export const dynamic = "force-dynamic";

type NotificationsPageProps = {
  searchParams?: {
    filter?: string;
    notice?: string;
  };
};

export default async function VendorNotificationsPage({ searchParams }: NotificationsPageProps) {
  const me = await getMyVendor();
  const vendor = me.ok ? me.data : null;

  if (!vendor) {
    return <VendorNoProfileFallback />;
  }

  // Filter semantics unchanged: the server query does the filtering, exactly as
  // before, and anything other than "unread" means "all".
  const filter = searchParams?.filter === "unread" ? "unread" : "all";
  const notificationsResult = await listVendorNotifications(vendor.id, filter);

  return (
    <VendorNotificationsWorkspace
      notifications={notificationsResult.ok ? notificationsResult.data : []}
      filter={filter}
      feedback={readNoticeFeedback(searchParams?.notice)}
      loadError={!notificationsResult.ok}
    />
  );
}
