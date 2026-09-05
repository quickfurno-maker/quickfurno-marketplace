import Link from "next/link";
import { VendorIcon, type VendorIconName } from "./icons";

/**
 * Page header shared by Credits & Package, Notifications and Support.
 *
 * The shell topbar already says which page this is, so the in-page header stays
 * compact: a title, one line of context, and at most one action.
 */
export function VendorUtilityHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="qf-vendor-v2-utilhead">
      <div>
        <h1 className="qf-vendor-v2-utilhead-title">{title}</h1>
        <p className="qf-vendor-v2-utilhead-sub">{subtitle}</p>
      </div>
      {action ? <div className="qf-vendor-v2-utilhead-actions">{action}</div> : null}
    </header>
  );
}

/**
 * Result banner for the existing ?order= / ?notice= / ?support= search-param
 * contracts, which the server actions still drive. role="status" so the outcome
 * is announced when the banner mounts after an action's redirect.
 *
 * Not dismissible: each of these pages is reached by a redirect that carries the
 * param, and the three actions revalidate their own path, so the banner is
 * replaced on the next interaction rather than needing a close button.
 */
export function VendorUtilityAlert({
  tone,
  children,
  icon,
}: {
  tone: "ok" | "error" | "info" | "warn";
  children: React.ReactNode;
  icon?: VendorIconName;
}) {
  const fallback: VendorIconName =
    tone === "ok" ? "check" : tone === "error" || tone === "warn" ? "alert" : "bell";
  return (
    <div className="qf-vendor-v2-utilalert" data-tone={tone} role="status">
      <span className="qf-vendor-v2-utilalert-icon" aria-hidden="true">
        <VendorIcon name={icon ?? fallback} size={18} />
      </span>
      <p className="qf-vendor-v2-utilalert-text">{children}</p>
    </div>
  );
}

/** Shared empty state for the three utility pages. */
export function VendorUtilityEmpty({
  icon,
  title,
  message,
  action,
}: {
  icon: VendorIconName;
  title: string;
  message: string;
  action?: { label: string; href: string };
}) {
  return (
    <div className="qf-vendor-v2-empty">
      <span className="qf-vendor-v2-empty-icon" aria-hidden="true">
        <VendorIcon name={icon} size={22} />
      </span>
      <p className="qf-vendor-v2-empty-title">{title}</p>
      <p className="qf-vendor-v2-empty-message">{message}</p>
      {action ? (
        <Link href={action.href} className="qf-vendor-v2-btn qf-vendor-v2-btn--quiet">
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}
