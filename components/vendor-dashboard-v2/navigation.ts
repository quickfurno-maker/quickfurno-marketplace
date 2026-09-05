// ============================================================================
// QuickFurno — Vendor Portal V2 navigation model (QF-UI-V2-01)
//
// ONE source of truth for the portal's information architecture. The desktop
// sidebar, the desktop topbar title and the mobile bottom nav all read this, so
// a label or route can never drift between the three surfaces.
//
// Routes are the EXISTING vendor dashboard routes. This module creates no new
// route and renames no route — only the labels and grouping are new.
// ============================================================================
import type { VendorIconName } from "./icons";

export interface VendorNavItem {
  label: string;
  /** Short label used where horizontal space is tight (mobile bottom nav). */
  shortLabel?: string;
  href: string;
  icon: VendorIconName;
}

/** Primary work surfaces — the four things a vendor operates day to day. */
export const VENDOR_PRIMARY_NAV: VendorNavItem[] = [
  { label: "Overview", href: "/vendor/dashboard", icon: "overview" },
  { label: "Leads", href: "/vendor/dashboard/leads", icon: "leads" },
  { label: "My Profile", shortLabel: "Profile", href: "/vendor/dashboard/profile", icon: "profile" },
  { label: "Credits & Package", shortLabel: "Credits", href: "/vendor/dashboard/package", icon: "credits" },
];

/** Lower-priority destinations, visually separated from the primary group. */
export const VENDOR_UTILITY_NAV: VendorNavItem[] = [
  { label: "Notifications", href: "/vendor/dashboard/notifications", icon: "bell" },
  { label: "Support", href: "/vendor/dashboard/support", icon: "support" },
];

export const VENDOR_ALL_NAV: VendorNavItem[] = [...VENDOR_PRIMARY_NAV, ...VENDOR_UTILITY_NAV];

/**
 * Mobile bottom nav: the four primary destinations plus "More", which opens a
 * drawer exposing the utility group and Sign out. Five slots is the most that
 * fits a 360px viewport without clipping a label.
 */
export const VENDOR_MOBILE_NAV: VendorNavItem[] = [
  { label: "Home", href: "/vendor/dashboard", icon: "overview" },
  { label: "Leads", href: "/vendor/dashboard/leads", icon: "leads" },
  { label: "Profile", href: "/vendor/dashboard/profile", icon: "profile" },
  { label: "Credits", href: "/vendor/dashboard/package", icon: "credits" },
];

const OVERVIEW_HREF = "/vendor/dashboard";

/**
 * Active-route test. Overview matches EXACTLY (it is the parent of every other
 * portal route, so a prefix test would light it up everywhere); the rest match
 * the route and its descendants.
 */
export function isVendorNavItemActive(pathname: string | null | undefined, href: string): boolean {
  if (!pathname) return false;
  const path = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  if (href === OVERVIEW_HREF) return path === OVERVIEW_HREF;
  return path === href || path.startsWith(`${href}/`);
}

/** Topbar context label for the current route. Falls back to the portal name. */
export function vendorPageTitle(pathname: string | null | undefined): string {
  const match = VENDOR_ALL_NAV.filter((item) => isVendorNavItemActive(pathname, item.href))
    // Longest matching href wins, so a nested route never reports "Overview".
    .sort((a, b) => b.href.length - a.href.length)[0];
  return match?.label ?? "Vendor Portal";
}
