"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SignOut } from "@/components/SignOut";
import { VendorIcon } from "./icons";
import {
  VENDOR_MOBILE_NAV,
  VENDOR_UTILITY_NAV,
  isVendorNavItemActive,
} from "./navigation";

/**
 * Fixed, safe-area-aware bottom navigation for phone widths. Four primary
 * destinations plus "More", a lightweight drawer holding Notifications, Support
 * and Sign out — every desktop destination stays reachable on mobile.
 */
export function VendorMobileNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const moreButtonRef = useRef<HTMLButtonElement | null>(null);
  const drawerRef = useRef<HTMLDivElement | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    moreButtonRef.current?.focus();
  }, []);

  // Route change closes the drawer, so it can never survive a navigation.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    document.addEventListener("keydown", onKeyDown);
    drawerRef.current?.focus();
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  const moreActive = VENDOR_UTILITY_NAV.some((item) => isVendorNavItemActive(pathname, item.href));

  return (
    <>
      {open ? (
        <div className="qf-vendor-v2-sheet-backdrop" onClick={close} aria-hidden="true" />
      ) : null}

      {open ? (
        <div
          className="qf-vendor-v2-sheet"
          role="dialog"
          aria-modal="true"
          aria-label="More vendor portal options"
          tabIndex={-1}
          ref={drawerRef}
        >
          <div className="qf-vendor-v2-sheet-head">
            <span className="qf-vendor-v2-sheet-title">More</span>
            <button type="button" className="qf-vendor-v2-iconbtn" onClick={close} aria-label="Close menu">
              <VendorIcon name="close" size={18} />
            </button>
          </div>
          <ul className="qf-vendor-v2-sheet-list">
            {VENDOR_UTILITY_NAV.map((item) => {
              const active = isVendorNavItemActive(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="qf-vendor-v2-sheet-link"
                    data-active={active ? "true" : undefined}
                    aria-current={active ? "page" : undefined}
                  >
                    <VendorIcon name={item.icon} size={19} />
                    <span>{item.label}</span>
                    <VendorIcon name="arrow-right" size={17} className="qf-vendor-v2-sheet-chevron" />
                  </Link>
                </li>
              );
            })}
            <li className="qf-vendor-v2-sheet-divider">
              <span className="qf-vendor-v2-sheet-link qf-vendor-v2-signout">
                <VendorIcon name="signout" size={19} />
                <SignOut />
              </span>
            </li>
          </ul>
        </div>
      ) : null}

      <nav className="qf-vendor-v2-bottomnav" aria-label="Vendor portal">
        {VENDOR_MOBILE_NAV.map((item) => {
          const active = isVendorNavItemActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className="qf-vendor-v2-bottomnav-item"
              data-active={active ? "true" : undefined}
              aria-current={active ? "page" : undefined}
            >
              <VendorIcon name={item.icon} size={21} />
              <span>{item.label}</span>
            </Link>
          );
        })}
        <button
          type="button"
          ref={moreButtonRef}
          className="qf-vendor-v2-bottomnav-item"
          data-active={moreActive || open ? "true" : undefined}
          aria-expanded={open}
          aria-haspopup="dialog"
          onClick={() => setOpen((value) => !value)}
        >
          <VendorIcon name="more" size={21} />
          <span>More</span>
        </button>
      </nav>
    </>
  );
}
