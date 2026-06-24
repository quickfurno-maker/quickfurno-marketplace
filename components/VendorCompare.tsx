"use client";

import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import Link from "next/link";
import { CONTACT_TEL, MAX_COMPARE_VENDORS, whatsappLink } from "@/lib/config";
import {
  getVendorListingMeta,
  getVendorPortfolio,
  getVendorServiceChips,
  getVendorTrust,
  type Vendor,
} from "@/lib/quickfurno-data";

const MAX_COMPARE = MAX_COMPARE_VENDORS;

type CompareContextValue = {
  selected: Vendor[];
  count: number;
  max: number;
  isSelected: (slug: string) => boolean;
  toggle: (vendor: Vendor) => void;
  remove: (slug: string) => void;
  clear: () => void;
};

const CompareContext = createContext<CompareContextValue | null>(null);

/** Returns the compare controller, or null when rendered outside a provider. */
export function useVendorCompare() {
  return useContext(CompareContext);
}

export function VendorCompareProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<Vendor[]>([]);
  const [limitHit, setLimitHit] = useState(false);
  const [open, setOpen] = useState(false);

  const isSelected = useCallback((slug: string) => selected.some((v) => v.slug === slug), [selected]);

  const toggle = useCallback((vendor: Vendor) => {
    setSelected((current) => {
      if (current.some((v) => v.slug === vendor.slug)) {
        setLimitHit(false);
        return current.filter((v) => v.slug !== vendor.slug);
      }
      if (current.length >= MAX_COMPARE) {
        setLimitHit(true);
        return current;
      }
      setLimitHit(false);
      return [...current, vendor];
    });
  }, []);

  const remove = useCallback((slug: string) => {
    setLimitHit(false);
    setSelected((current) => current.filter((v) => v.slug !== slug));
  }, []);

  const clear = useCallback(() => {
    setLimitHit(false);
    setSelected([]);
  }, []);

  const value = useMemo<CompareContextValue>(
    () => ({ selected, count: selected.length, max: MAX_COMPARE, isSelected, toggle, remove, clear }),
    [selected, isSelected, toggle, remove, clear],
  );

  // Auto-close the modal if selection drops below 2.
  useEffect(() => {
    if (selected.length < 2) setOpen(false);
  }, [selected.length]);

  return (
    <CompareContext.Provider value={value}>
      {children}

      {selected.length > 0 ? (
        <div className="qf-compare-bar" role="region" aria-label="Vendor comparison tray">
          <div className="qf-compare-bar-info">
            <strong>Compare {selected.length}/{MAX_COMPARE} vendors</strong>
            {limitHit ? (
              <span className="qf-compare-bar-warn" role="alert">
                You can compare up to {MAX_COMPARE} vendors.
              </span>
            ) : (
              <span className="qf-compare-bar-hint">Select 2–3 vendors to compare side by side.</span>
            )}
            <div className="qf-compare-bar-chips">
              {selected.map((vendor) => (
                <span key={vendor.slug} className="qf-compare-bar-chip">
                  {vendor.businessName}
                  <button type="button" aria-label={`Remove ${vendor.businessName}`} onClick={() => remove(vendor.slug)}>
                    ×
                  </button>
                </span>
              ))}
            </div>
          </div>
          <div className="qf-compare-bar-actions">
            <button type="button" className="qf-compare-btn qf-compare-btn--ghost" onClick={clear}>
              Clear
            </button>
            <button
              type="button"
              className="qf-compare-btn qf-compare-btn--primary"
              disabled={selected.length < 2}
              onClick={() => setOpen(true)}
            >
              Compare Now
            </button>
          </div>
        </div>
      ) : null}

      {open && selected.length >= 2 ? <CompareModal vendors={selected} onClose={() => setOpen(false)} onRemove={remove} /> : null}
    </CompareContext.Provider>
  );
}

function CompareModal({
  vendors,
  onClose,
  onRemove,
}: {
  vendors: Vendor[];
  onClose: () => void;
  onRemove: (slug: string) => void;
}) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const rows = vendors.map((vendor) => ({
    vendor,
    meta: getVendorListingMeta(vendor),
    trust: getVendorTrust(vendor),
    chips: getVendorServiceChips(vendor).slice(0, 4),
    portfolioCount: getVendorPortfolio(vendor).length,
  }));

  // Subtle "best value" highlights.
  const bestRating = Math.max(...rows.map((r) => r.trust.rating));
  const bestResponse = Math.max(...rows.map((r) => r.trust.responseScore));
  const bestWarranty = Math.max(...rows.map((r) => r.trust.warrantyYears));
  const priceValues = rows.map((r) => r.trust.priceValue).filter((v): v is number => v != null);
  const bestPrice = priceValues.length ? Math.min(...priceValues) : null;

  return (
    <div className="qf-compare-backdrop" role="presentation" onMouseDown={(e) => {
      if (e.target === e.currentTarget) onClose();
    }}>
      <section className="qf-compare-modal" role="dialog" aria-modal="true" aria-label="Compare vendors">
        <header className="qf-compare-modal-head">
          <div className="qf-compare-modal-titles">
            <h2>Compare Vendors</h2>
            <p>Compare rates, response time, experience and warranty.</p>
          </div>
          <button type="button" className="qf-compare-modal-close" aria-label="Close comparison" onClick={onClose}>
            ×
          </button>
        </header>

        <div className="qf-compare-scroll">
          <div className="qf-compare-grid" data-cols={vendors.length}>
            {/* Vendor name header row */}
            <div className="qf-compare-cell qf-compare-cell--rowhead">Vendor</div>
            {rows.map(({ vendor }) => (
              <div className="qf-compare-cell qf-compare-cell--vendorhead" key={`name-${vendor.slug}`}>
                <strong>{vendor.businessName}</strong>
                <small>{vendor.category}</small>
                <button type="button" className="qf-compare-remove" aria-label={`Remove ${vendor.businessName}`} onClick={() => onRemove(vendor.slug)}>
                  Remove
                </button>
              </div>
            ))}

            <div className="qf-compare-cell qf-compare-cell--rowhead">Verified</div>
            {rows.map(({ vendor }) => (
              <div className="qf-compare-cell" key={`verified-${vendor.slug}`}>
                {vendor.verified ? <span className="qf-compare-yes">Verified ✓</span> : <span className="qf-compare-muted">Not verified</span>}
              </div>
            ))}

            <div className="qf-compare-cell qf-compare-cell--rowhead">Rating</div>
            {rows.map(({ vendor, trust }) => (
              <div className={`qf-compare-cell${trust.rating === bestRating ? " is-best" : ""}`} key={`rating-${vendor.slug}`}>
                {trust.ratingLabel} <span aria-hidden="true">★</span>
              </div>
            ))}

            <div className="qf-compare-cell qf-compare-cell--rowhead">Starting price</div>
            {rows.map(({ vendor, trust }) => (
              <div
                className={`qf-compare-cell${trust.priceValue != null && trust.priceValue === bestPrice ? " is-best" : ""}`}
                key={`price-${vendor.slug}`}
              >
                {trust.startingPrice}
              </div>
            ))}

            <div className="qf-compare-cell qf-compare-cell--rowhead">Response time</div>
            {rows.map(({ vendor, trust }) => (
              <div className={`qf-compare-cell${trust.responseScore === bestResponse ? " is-best" : ""}`} key={`resp-${vendor.slug}`}>
                {trust.responseLabel}
              </div>
            ))}

            <div className="qf-compare-cell qf-compare-cell--rowhead">Experience</div>
            {rows.map(({ vendor, trust }) => (
              <div className="qf-compare-cell" key={`exp-${vendor.slug}`}>{trust.experienceLabel}</div>
            ))}

            <div className="qf-compare-cell qf-compare-cell--rowhead">Warranty</div>
            {rows.map(({ vendor, trust }) => (
              <div className={`qf-compare-cell${trust.warrantyYears > 0 && trust.warrantyYears === bestWarranty ? " is-best" : ""}`} key={`warr-${vendor.slug}`}>
                {trust.warrantyLabel}
              </div>
            ))}

            <div className="qf-compare-cell qf-compare-cell--rowhead">Service areas</div>
            {rows.map(({ vendor, meta }) => (
              <div className="qf-compare-cell" key={`area-${vendor.slug}`}>{meta.locality}</div>
            ))}

            <div className="qf-compare-cell qf-compare-cell--rowhead">Key services</div>
            {rows.map(({ vendor, chips }) => (
              <div className="qf-compare-cell" key={`svc-${vendor.slug}`}>
                <div className="qf-compare-tags">
                  {chips.map((chip) => (
                    <span key={chip.label}>{chip.label}</span>
                  ))}
                </div>
              </div>
            ))}

            <div className="qf-compare-cell qf-compare-cell--rowhead">Portfolio</div>
            {rows.map(({ vendor, portfolioCount }) => (
              <div className="qf-compare-cell" key={`pf-${vendor.slug}`}>
                {portfolioCount > 0 ? `${portfolioCount} photos` : "Coming soon"}
              </div>
            ))}

            <div className="qf-compare-cell qf-compare-cell--rowhead">Contact</div>
            {rows.map(({ vendor }) => (
              <div className="qf-compare-cell qf-compare-cell--cta" key={`cta-${vendor.slug}`}>
                <a className="qf-compare-cta qf-compare-cta--call" href={CONTACT_TEL}>
                  Call
                </a>
                <a
                  className="qf-compare-cta qf-compare-cta--wa"
                  href={whatsappLink(`Hi QuickFurno, I want a quote from ${vendor.businessName}.`)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  WhatsApp
                </a>
                <Link className="qf-compare-cta qf-compare-cta--profile" href={`/vendors/${vendor.slug}`}>
                  View Profile
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
