"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import type { VendorListingView } from "./listingModel";

/**
 * Truthful vendor comparison (QF-UI-V2-06).
 *
 * The previous compare table ranked vendors on rating, response speed,
 * experience and warranty and highlighted a "best" cell for each. For real
 * Supabase vendors every one of those was a constant default (rating 4.2,
 * responseScore 55, "5+ years", "Up to 10 years warranty" for any paid plan),
 * so the highlight marked all vendors equally "best" on invented data.
 *
 * This version keeps only attributes with a real source, and has no "best"
 * highlighting at all — there is no authoritative quality signal to rank on:
 *
 *   Verified        <- vendors.status = approved
 *   Service area    <- public_service_area_summary (else city)
 *   Services        <- service_categories (canonicalised)
 *   Starting price  <- starting_price, only when a real figure was listed
 *   Photos          <- the vendor's own portfolio_urls count
 *   Business hours  <- public_business_hours
 *
 * A row whose value is missing renders an em dash rather than a substitute.
 */
export function VendorCompareV2({
  vendors,
  onClose,
  onRemove,
}: {
  vendors: VendorListingView[];
  onClose: () => void;
  onRemove: (id: string) => void;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    dialogRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  /*
    QF-UI-V2-06R — scroll lock while the dialog is open.

    `html` is the scrolling element on this site (QF-UI-V2-05 gave `body`
    `overflow-x: clip` precisely so it is NOT a scroll container), so the lock
    goes on documentElement. Both the previous INLINE values are captured and
    restored on unmount, which means the stylesheet's own `overflow-x: hidden`
    comes back untouched and no permanent gap or overflow change is left behind.

    Removing the scrollbar would otherwise reflow the page, so its width is
    compensated with padding for exactly as long as the dialog is mounted. This
    component only mounts while compare is open, so the effect needs no state
    shared with the listing.
  */
  useEffect(() => {
    const root = document.documentElement;
    const previousOverflow = root.style.overflow;
    const previousPaddingRight = root.style.paddingRight;
    const scrollbarWidth = window.innerWidth - root.clientWidth;

    root.style.overflow = "hidden";
    if (scrollbarWidth > 0) root.style.paddingRight = `${scrollbarWidth}px`;

    return () => {
      root.style.overflow = previousOverflow;
      root.style.paddingRight = previousPaddingRight;
    };
  }, []);

  const rows: { label: string; value: (v: VendorListingView) => string }[] = [
    { label: "Verified", value: (v) => (v.verified ? "Yes" : "—") },
    { label: "Service area", value: (v) => v.serviceArea ?? v.city },
    { label: "Services", value: (v) => (v.services.length ? v.services.join(", ") : "—") },
    { label: "Starting price", value: (v) => v.startingPrice ?? "Not listed" },
    { label: "Photos", value: (v) => (v.portfolioCount > 0 ? String(v.portfolioCount) : "—") },
    { label: "Business hours", value: (v) => v.businessHours ?? "—" },
  ];

  return (
    <div className="qf-vl-compare-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        className="qf-vl-compare"
        role="dialog"
        aria-modal="true"
        aria-labelledby="qf-vl-compare-title"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="qf-vl-compare-head">
          <div>
            <h2 id="qf-vl-compare-title">Compare vendors</h2>
            <p>Only details each vendor has published are shown.</p>
          </div>
          <button type="button" className="qf-vl-compare-close" onClick={onClose}>
            <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false">
              <path d="M5 5l10 10M15 5L5 15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            <span className="qf-pub-sronly">Close comparison</span>
          </button>
        </div>

        <div className="qf-vl-compare-scroll">
          <table className="qf-vl-compare-table">
            <caption className="qf-pub-sronly">Published details for the selected vendors</caption>
            <thead>
              <tr>
                <th scope="col">Detail</th>
                {vendors.map((vendor) => (
                  <th scope="col" key={vendor.id}>
                    <Link href={`/vendors/${vendor.id}`}>{vendor.businessName}</Link>
                    <button type="button" onClick={() => onRemove(vendor.id)}>
                      Remove
                      <span className="qf-pub-sronly"> {vendor.businessName} from comparison</span>
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label}>
                  <th scope="row">{row.label}</th>
                  {vendors.map((vendor) => (
                    <td key={vendor.id}>{row.value(vendor)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
