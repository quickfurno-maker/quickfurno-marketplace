import { redirect } from "next/navigation";

// The generic sign-in page has moved. Vendors now log in from the vendor portal
// at /vendor?mode=login; admins have a separate login at /admin/login (a vendor
// portal sign-in still routes an admin to /admin/dashboard by role). This keeps
// old /login bookmarks working by forwarding to the vendor portal login tab.
export default function LoginRedirectPage() {
  redirect("/vendor?mode=login");
}
