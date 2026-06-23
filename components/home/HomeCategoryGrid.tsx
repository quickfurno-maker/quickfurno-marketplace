"use client";

import { useState } from "react";
import Link from "next/link";
import { QFIcon } from "@/components/QuickFurnoIcons";
import { categorySlug, type QuickFurnoCategory } from "@/lib/quickfurno-data";

type HomeSubcategory = { label: string; category: QuickFurnoCategory };

type HomeCategory = {
  label: string;
  tagline: string;
  icon: Parameters<typeof QFIcon>[0]["name"];
  category: QuickFurnoCategory;
  subcategories: HomeSubcategory[];
};

const homeCategories: HomeCategory[] = [
  {
    label: "Interiors",
    tagline: "Design, woodwork & turnkey homes",
    icon: "home",
    category: "Interior Designers",
    subcategories: [
      { label: "Carpenters", category: "Carpenters" },
      { label: "Modular Factory", category: "Modular Factory" },
      { label: "Premium Interiors", category: "Premium Interiors" },
      { label: "Interior Designers", category: "Interior Designers" },
    ],
  },
  {
    label: "Carpentry",
    tagline: "Carpenters, wardrobes & custom furniture",
    icon: "hammer",
    category: "Carpenters",
    subcategories: [
      { label: "Carpenter", category: "Carpenters" },
      { label: "Modular Factory", category: "Modular Factory" },
      { label: "Custom Furniture", category: "Carpenters" },
      { label: "Wardrobes", category: "Carpenters" },
    ],
  },
  {
    label: "Sofa",
    tagline: "Custom sofas, recliners & upholstery",
    icon: "sofa",
    category: "Sofa",
    // No subcategories — clicking Sofa opens the vendor listing directly.
    subcategories: [],
  },
  {
    label: "Painting",
    tagline: "Interior, texture & waterproofing",
    icon: "paint",
    category: "Painter",
    subcategories: [
      { label: "Interior Painting", category: "Painter" },
      { label: "Exterior Painting", category: "Painter" },
      { label: "Texture Painting", category: "Painter" },
      { label: "Waterproofing", category: "Painter" },
    ],
  },
  {
    label: "Civil Work",
    tagline: "Renovation, tiling & masonry",
    icon: "civil",
    category: "Civil Work",
    subcategories: [
      { label: "Home Renovation", category: "Civil Work" },
      { label: "Tile Work", category: "Civil Work" },
      { label: "Bathroom Renovation", category: "Civil Work" },
      { label: "Mason Work", category: "Civil Work" },
    ],
  },
];

export function HomeCategoryGrid() {
  const [active, setActive] = useState<HomeCategory | null>(null);

  function routeFor(category: QuickFurnoCategory) {
    return `/category/${categorySlug(category)}`;
  }

  function openCategory(item: HomeCategory) {
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
            <Link key={item.label} href={routeFor(item.category)} className="qf-home-category-card">
              {cardInner}
            </Link>
          );
        })}
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
            <Link className="qf-sheet-primary" href={routeFor(active.category)} onClick={() => setActive(null)}>
              View all {active.label} vendors
            </Link>
          </section>
        </div>
      ) : null}
    </>
  );
}
