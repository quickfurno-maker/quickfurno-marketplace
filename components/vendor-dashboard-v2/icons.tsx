// ============================================================================
// QuickFurno — Vendor Portal V2 icon set (QF-UI-V2-01)
//
// The repo carries no icon dependency, so the portal ships one small, internally
// consistent inline-SVG family instead of adding a package: 24x24 viewBox,
// stroke-only, 1.6 stroke width, round caps and joins, `currentColor`. Every
// vendor-portal icon MUST come from here so nav, KPIs, statuses and empty
// states never drift into mixed stroke weights or emoji.
// ============================================================================
import type { SVGProps } from "react";

export type VendorIconName =
  | "overview"
  | "leads"
  | "profile"
  | "credits"
  | "bell"
  | "support"
  | "signout"
  | "more"
  | "phone"
  | "arrow-right"
  | "check"
  | "alert"
  | "clock"
  | "shield"
  | "close"
  | "external"
  | "pin"
  | "inbox"
  | "lock"
  | "search";

type IconProps = Omit<SVGProps<SVGSVGElement>, "children"> & { size?: number };

function Svg({ size = 20, ...rest }: IconProps & { children?: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    />
  );
}

const PATHS: Record<VendorIconName, React.ReactNode> = {
  overview: (
    <>
      <rect x="3" y="3" width="7.5" height="7.5" rx="1.6" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.6" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.6" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.6" />
    </>
  ),
  leads: (
    <>
      <path d="M3.5 7.5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
      <path d="M3.9 8.1 12 13l8.1-4.9" />
    </>
  ),
  profile: (
    <>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M4.8 19.6a7.4 7.4 0 0 1 14.4 0" />
    </>
  ),
  credits: (
    <>
      <path d="M3.5 8.2a2 2 0 0 1 2-2h11.2a2 2 0 0 1 2 2v.8" />
      <path d="M3.5 8.2v8.6a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2V11a2 2 0 0 0-2-2h-13a2 2 0 0 1-2-2z" />
      <circle cx="16.6" cy="14" r="1.1" />
    </>
  ),
  bell: (
    <>
      <path d="M18 9a6 6 0 1 0-12 0c0 4.2-1.4 5.6-1.4 5.6h14.8S18 13.2 18 9" />
      <path d="M10.3 18.2a2 2 0 0 0 3.4 0" />
    </>
  ),
  support: (
    <>
      <circle cx="12" cy="12" r="8.6" />
      <circle cx="12" cy="12" r="3.4" />
      <path d="m6 6 3.6 3.6M18 6l-3.6 3.6M18 18l-3.6-3.6M6 18l3.6-3.6" />
    </>
  ),
  signout: (
    <>
      <path d="M14.5 4.5h2.6a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-2.6" />
      <path d="M10 16.2 5.8 12 10 7.8" />
      <path d="M5.9 12h9" />
    </>
  ),
  more: (
    <>
      <circle cx="5.5" cy="12" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="18.5" cy="12" r="1.15" fill="currentColor" stroke="none" />
    </>
  ),
  phone: (
    <path d="M7.2 3.9h2.5l1.3 3.4-1.9 1.4a11.4 11.4 0 0 0 5.2 5.2l1.4-1.9 3.4 1.3v2.5a2 2 0 0 1-2.2 2A15.6 15.6 0 0 1 5.2 6.1a2 2 0 0 1 2-2.2" />
  ),
  "arrow-right": (
    <>
      <path d="M4.8 12h13.6" />
      <path d="m13.6 7 5.2 5-5.2 5" />
    </>
  ),
  check: (
    <>
      <circle cx="12" cy="12" r="8.6" />
      <path d="m8.4 12.2 2.5 2.5 4.7-4.9" />
    </>
  ),
  alert: (
    <>
      <path d="M10.6 4.4 3.3 17a1.6 1.6 0 0 0 1.4 2.4h14.6a1.6 1.6 0 0 0 1.4-2.4L13.4 4.4a1.6 1.6 0 0 0-2.8 0" />
      <path d="M12 9.6v4" />
      <circle cx="12" cy="16.4" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M12 7.4V12l3 1.8" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3.4 5.4 6v5.4c0 4 2.7 7.5 6.6 8.9 3.9-1.4 6.6-4.9 6.6-8.9V6z" />
      <path d="m9.2 12 2.1 2.1 4-4.2" />
    </>
  ),
  close: <path d="m6.4 6.4 11.2 11.2M17.6 6.4 6.4 17.6" />,
  external: (
    <>
      <path d="M13.6 4.6h5.8v5.8" />
      <path d="M19.4 4.6 11 13" />
      <path d="M18 14.4v3.6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3.6" />
    </>
  ),
  pin: (
    <>
      <path d="M19 10.3c0 5-7 10.4-7 10.4s-7-5.4-7-10.4a7 7 0 0 1 14 0" />
      <circle cx="12" cy="10.2" r="2.6" />
    </>
  ),
  inbox: (
    <>
      <path d="M3.6 13.4 6.2 5.6a2 2 0 0 1 1.9-1.3h7.8a2 2 0 0 1 1.9 1.3l2.6 7.8" />
      <path d="M3.6 13.4h4.2l1.2 2.4h6l1.2-2.4h4.2v4.3a2 2 0 0 1-2 2H5.6a2 2 0 0 1-2-2z" />
    </>
  ),
  lock: (
    <>
      <rect x="4.8" y="10.4" width="14.4" height="9.4" rx="2" />
      <path d="M8.4 10.4V7.9a3.6 3.6 0 0 1 7.2 0v2.5" />
    </>
  ),
  search: (
    <>
      <circle cx="10.8" cy="10.8" r="6.2" />
      <path d="m15.4 15.4 4.2 4.2" />
    </>
  ),
};

/** Render any portal icon by name. Always decorative — label the control, not the icon. */
export function VendorIcon({ name, ...rest }: IconProps & { name: VendorIconName }) {
  return <Svg {...rest}>{PATHS[name]}</Svg>;
}
