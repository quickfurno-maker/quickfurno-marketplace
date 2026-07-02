import { redirect } from "next/navigation";
import Link from "next/link";
import { getMyRole } from "@/app/actions";
import { SignOut } from "@/components/SignOut";

const NAV = [
  { label: "Dashboard", href: "/vendor/dashboard" },
  { label: "Leads", href: "/vendor/dashboard/leads" },
  { label: "Package / Recharge", href: "/vendor/dashboard/package" },
  { label: "Profile Approval", href: "/vendor/dashboard/profile" },
  { label: "Notifications", href: "/vendor/dashboard/notifications" },
  { label: "Support", href: "/vendor/dashboard/support" },
];

export default async function VendorDashboardLayout({ children }: { children: React.ReactNode }) {
  const role = await getMyRole();
  if (!role) redirect("/login");

  return (
    <div className="qf-vd-shell">
      <aside className="qf-vd-sidebar">
        <Link href="/vendor" className="qf-vd-brand">
          <span className="qf-vd-brand-q">Quick</span>
          <span className="qf-vd-brand-f">Furno</span>
        </Link>
        <span className="qf-vd-brand-tag">Vendor Portal</span>
        <nav className="qf-vd-nav" aria-label="Vendor sections">
          {NAV.map((item) => (
            <Link key={item.label} href={item.href}>{item.label}</Link>
          ))}
        </nav>
        <div className="qf-vd-sidebar-foot">
          <SignOut />
        </div>
      </aside>

      <div className="qf-vd-main">
        <header className="qf-vd-topbar">
          <Link href="/vendor" className="qf-vd-brand qf-vd-brand--sm">
            <span className="qf-vd-brand-q">Quick</span>
            <span className="qf-vd-brand-f">Furno</span>
          </Link>
          <span className="qf-vd-topbar-title">Vendor Dashboard</span>
          <div className="qf-vd-topbar-actions">
            <SignOut />
          </div>
        </header>

        <main className="qf-vd-content">{children}</main>

        <nav className="qf-vd-bottomnav" aria-label="Vendor navigation">
          <Link href="/vendor/dashboard">Home</Link>
          <Link href="/vendor/dashboard/leads">Leads</Link>
          <Link href="/vendor/dashboard/package">Package</Link>
          <Link href="/vendor/dashboard/support">Support</Link>
        </nav>
      </div>
    </div>
  );
}
