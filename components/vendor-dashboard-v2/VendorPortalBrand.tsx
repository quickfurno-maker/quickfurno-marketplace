import Link from "next/link";

/**
 * QuickFurno wordmark for the vendor portal. Same two-tone lockup the public
 * site uses (ink + brand gold) — no new logo, no new asset. `tag` renders the
 * quiet "Vendor Portal" descriptor beneath it.
 */
export function VendorPortalBrand({ tag = false, size = "md" }: { tag?: boolean; size?: "sm" | "md" }) {
  return (
    <Link href="/vendor/dashboard" className={`qf-vendor-v2-brand qf-vendor-v2-brand--${size}`}>
      <span className="qf-vendor-v2-brand-mark" aria-hidden="true">
        <span>Q</span>
      </span>
      <span className="qf-vendor-v2-brand-text">
        <span className="qf-vendor-v2-brand-word">
          <span className="qf-vendor-v2-brand-quick">Quick</span>
          <span className="qf-vendor-v2-brand-furno">Furno</span>
        </span>
        {tag ? <span className="qf-vendor-v2-brand-tag">Vendor Portal</span> : null}
      </span>
    </Link>
  );
}
