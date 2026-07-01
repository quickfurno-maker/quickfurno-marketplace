import { VendorPlaceholderPage } from "@/app/vendor/dashboard/_components/VendorPlaceholderPage";

export const metadata = { title: "Vendor profile approval - QuickFurno" };
export const dynamic = "force-dynamic";

export default async function VendorProfileApprovalPage() {
  return VendorPlaceholderPage({
    title: "Profile Approval",
    message: "Submit profile changes for QuickFurno approval. Approved changes will go live after admin review.",
  });
}
