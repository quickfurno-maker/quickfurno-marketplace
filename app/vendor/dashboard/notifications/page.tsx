import { VendorPlaceholderPage } from "@/app/vendor/dashboard/_components/VendorPlaceholderPage";

export const metadata = { title: "Vendor notifications - QuickFurno" };
export const dynamic = "force-dynamic";

export default async function VendorNotificationsPage() {
  return VendorPlaceholderPage({
    title: "Notifications",
    message: "Your vendor notifications will appear here.",
  });
}
