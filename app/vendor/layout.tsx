import { redirect } from "next/navigation";
import Link from "next/link";
import { getMyRole } from "@/app/actions";
import { SignOut } from "@/components/SignOut";

const NAV = [
  { label: "Dashboard", href: "#welcome" },
  { label: "Status", href: "#status" },
  { label: "Leads", href: "#leads" },
  { label: "Profile", href: "#profile" },
  { label: "Support", href: "#support" },
];

export default async function VendorLayout({ children }: { children: React.ReactNode }) {
  const role = await getMyRole();
  if (!role) redirect("/login");
  if (role === "admin") redirect("/admin/dashboard");

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
            <a key={item.label} href={item.href}>{item.label}</a>
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
          <a href="#welcome">Home</a>
          <a href="#leads">Leads</a>
          <a href="#profile">Profile</a>
          <a href="#support">Support</a>
        </nav>
      </div>
    </div>
  );
}
