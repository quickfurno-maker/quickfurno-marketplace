"use client";

import { useState } from "react";
import Link from "next/link";
import { QFIcon } from "@/components/QuickFurnoIcons";
import { categorySlug, type QuickFurnoCategory } from "@/lib/quickfurno-data";
import { mainCategories, type MainCategory } from "@/lib/categories";

// Single source of truth — shared with the vendor registration Step 2 so the
// public category structure never drifts. See lib/categories.ts.
const homeCategories = mainCategories;

export function HomeCategoryGrid() {
  const [active, setActive] = useState<MainCategory | null>(null);

  function routeFor(category: QuickFurnoCategory) {
    return `/category/${categorySlug(category)}`;
  }

  function openCategory(item: MainCategory) {
    setActive(item);
  }

  return (
    <>
      <div className="qf-home-category-grid" data-reveal-group>
        {homeCategories.map((item) => {
          const cardInner = (
            <>
              <span className="qf-home-category-icon">
                <QFIcon name={item.icon} />
              </span>
              <span className="qf-home-category-label">{item.label}</span>
              <small className="qf-home-category-tag">{item.tagline}</small>
              <span className="qf-home-category-arrow" aria-hidden="true">
                <QFIcon name="arrow" />
              </span>
            </>
          );

          // Categories with subcategories open the picker modal; categories
          // without (e.g. Sofa) link straight to the vendor listing.
          return item.subcategories.length > 0 ? (
            <button
              key={item.label}
              type="button"
              className="qf-home-category-card"
              onClick={() => openCategory(item)}
            >
              {cardInner}
            </button>
          ) : (
            <Link key={item.label} href={item.category ? routeFor(item.category) : "#featured"} className="qf-home-category-card">
              {cardInner}
            </Link>
          );
        })}

        {/* Mobile-only "More" tile — completes the compact app-style grid.
            Hidden on tablet/desktop so the 5-card desktop row is unchanged. */}
        <Link href="#featured" className="qf-home-category-card qf-home-category-card--more">
          <span className="qf-home-category-icon">
            <QFIcon name="grid" />
          </span>
          <span className="qf-home-category-label">More</span>
          <small className="qf-home-category-tag">Browse all services</small>
          <span className="qf-home-category-arrow" aria-hidden="true">
            <QFIcon name="arrow" />
          </span>
        </Link>
      </div>

      {active ? (
        <div className="qf-subcategory-backdrop" role="presentation" onMouseDown={() => setActive(null)}>
          <section
            className="qf-subcategory-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="qf-subcategory-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="qf-sheet-handle" aria-hidden="true" />
            <div className="qf-subcategory-head">
              <div>
                <h2 id="qf-subcategory-title">{active.label}</h2>
                <p>Choose a service or open the vendor listing.</p>
              </div>
              <button type="button" onClick={() => setActive(null)} aria-label="Close subcategory menu">
                x
              </button>
            </div>
            <div className="qf-subcategory-list">
              {active.subcategories.map((subcategory) => (
                <Link key={subcategory.label} href={routeFor(subcategory.category)} onClick={() => setActive(null)}>
                  <span>{subcategory.label}</span>
                  <QFIcon name="arrow" />
                </Link>
              ))}
            </div>
            {active.category ? (
              <Link className="qf-sheet-primary" href={routeFor(active.category)} onClick={() => setActive(null)}>
                View all {active.label} vendors
              </Link>
            ) : null}
          </section>
        </div>
      ) : null}
    </>
  );
}
