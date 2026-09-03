import Link from "next/link";
import { VendorIcon, type VendorIconName } from "./icons";

/**
 * The portal's single surface primitive. Everything on the Overview is one of
 * these — one border, one radius, one shadow — so the page never grows nested
 * cards or a bento wall of mismatched containers.
 */
export function VendorPanel({
  title,
  hint,
  action,
  children,
  className,
}: {
  title?: string;
  hint?: string;
  action?: { label: string; href: string };
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`qf-vendor-v2-panel${className ? ` ${className}` : ""}`}>
      {title ? (
        <header className="qf-vendor-v2-panel-head">
          <div>
            <h2 className="qf-vendor-v2-panel-title">{title}</h2>
            {hint ? <p className="qf-vendor-v2-panel-hint">{hint}</p> : null}
          </div>
          {action ? (
            <Link href={action.href} className="qf-vendor-v2-textlink">
              {action.label}
              <VendorIcon name="arrow-right" size={16} />
            </Link>
          ) : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

/**
 * Shared empty / restricted state. Professional line icon + one sentence + at
 * most one action. Never an oversized emoji.
 */
export function VendorEmptyState({
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

/**
 * Status pill. Tone drives colour, but the label always carries the meaning in
 * words, so nothing is communicated by colour alone.
 */
export function VendorStatusPill({
  tone,
  children,
  icon,
}: {
  tone: "ok" | "pending" | "warn" | "blocked" | "neutral";
  children: React.ReactNode;
  icon?: VendorIconName;
}) {
  return (
    <span className="qf-vendor-v2-pill" data-tone={tone}>
      {icon ? <VendorIcon name={icon} size={14} /> : null}
      {children}
    </span>
  );
}
