import { VendorPlaceholderPage } from "@/app/vendor/dashboard/_components/VendorPlaceholderPage";

export const metadata = { title: "Vendor leads - QuickFurno" };
export const dynamic = "force-dynamic";

export default async function VendorLeadsPage() {
  return VendorPlaceholderPage({
    title: "Leads",
    message: "Your assigned QuickFurno leads will appear here after your package is active.",
  });
}
