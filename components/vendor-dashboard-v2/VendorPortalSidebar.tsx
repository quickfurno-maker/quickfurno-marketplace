"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SignOut } from "@/components/SignOut";
import { VendorIcon } from "./icons";
import { VendorPortalBrand } from "./VendorPortalBrand";
import {
  VENDOR_PRIMARY_NAV,
  VENDOR_UTILITY_NAV,
  isVendorNavItemActive,
  type VendorNavItem,
} from "./navigation";

/**
 * Desktop-only sidebar. Hidden below the shell's desktop breakpoint, where the
 * fixed bottom nav takes over — the two never render at the same time.
 */
export function VendorPortalSidebar() {
  const pathname = usePathname();

  return (
    <aside className="qf-vendor-v2-sidebar">
      <div className="qf-vendor-v2-sidebar-head">
        <VendorPortalBrand tag />
      </div>

      <nav className="qf-vendor-v2-sidebar-nav" aria-label="Vendor portal">
        <ul className="qf-vendor-v2-navlist">
          {VENDOR_PRIMARY_NAV.map((item) => (
            <SidebarLink key={item.href} item={item} pathname={pathname} />
          ))}
        </ul>

        <p className="qf-vendor-v2-navgroup-label" id="qf-vendor-v2-utility-label">
          Account
        </p>
        <ul className="qf-vendor-v2-navlist" aria-labelledby="qf-vendor-v2-utility-label">
          {VENDOR_UTILITY_NAV.map((item) => (
            <SidebarLink key={item.href} item={item} pathname={pathname} />
          ))}
        </ul>
      </nav>

      <div className="qf-vendor-v2-sidebar-foot">
        <span className="qf-vendor-v2-signout">
          <VendorIcon name="signout" size={18} />
          <SignOut />
        </span>
      </div>
    </aside>
  );
}

function SidebarLink({ item, pathname }: { item: VendorNavItem; pathname: string | null }) {
  const active = isVendorNavItemActive(pathname, item.href);
  return (
    <li>
      <Link
        href={item.href}
        className="qf-vendor-v2-navlink"
        data-active={active ? "true" : undefined}
        aria-current={active ? "page" : undefined}
      >
        <VendorIcon name={item.icon} size={19} />
        <span>{item.label}</span>
      </Link>
    </li>
  );
}
