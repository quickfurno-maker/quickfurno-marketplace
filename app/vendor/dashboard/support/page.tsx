import { VendorPlaceholderPage } from "@/app/vendor/dashboard/_components/VendorPlaceholderPage";

export const metadata = { title: "Vendor support - QuickFurno" };
export const dynamic = "force-dynamic";

export default async function VendorSupportPage() {
  return VendorPlaceholderPage({
    title: "Support",
    message: "Vendor support center is coming soon. For urgent help, contact QuickFurno support.",
  });
}
