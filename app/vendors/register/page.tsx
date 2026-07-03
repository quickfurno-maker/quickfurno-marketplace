import { redirect } from "next/navigation";

// Vendor signup + application now live on the single vendor portal. This keeps
// old /vendors/register bookmarks and links working by forwarding to the portal
// signup tab, where the same onboarding wizard now also creates a login account.
export default function VendorRegisterRedirectPage() {
  redirect("/vendor?mode=signup");
}
