import { VendorPlaceholderPage } from "@/app/vendor/dashboard/_components/VendorPlaceholderPage";

export const metadata = { title: "Vendor package - QuickFurno" };
export const dynamic = "force-dynamic";

export default async function VendorPackagePage() {
  return VendorPlaceholderPage({
    title: "Package / Recharge",
    message: "Package buying and recharge dashboard is coming soon. Online payment will be enabled after verified payment integration.",
  });
}
