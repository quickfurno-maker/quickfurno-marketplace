import Image from "next/image";
import Link from "next/link";

/**
 * QuickFurno wordmark for the vendor portal. Same two-tone lockup the public
 * site uses (ink + brand gold) — no new logo, no new asset. `tag` renders the
 * quiet "Vendor Portal" descriptor beneath it.
 */
export function VendorPortalBrand({ tag = false, size = "md" }: { tag?: boolean; size?: "sm" | "md" }) {
  const width = size === "sm" ? 138 : 164;
  const height = size === "sm" ? 37 : 44;

  return (
    <Link href="/vendor/dashboard" className={`qf-vendor-v2-brand qf-vendor-v2-brand--${size}`}>
      <Image
        src="/assets/quickfurno/logos/quickfurno-logo.svg"
        alt="QuickFurno"
        width={width}
        height={height}
        className="qf-vendor-v2-brand-logo"
        priority={size === "sm"}
      />
      {tag ? <span className="qf-vendor-v2-brand-tag">Vendor Portal</span> : null}
    </Link>
  );
}
