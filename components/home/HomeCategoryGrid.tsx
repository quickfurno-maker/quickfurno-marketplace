"use client";

import { useState } from "react";
import Link from "next/link";
import { QFIcon } from "@/components/QuickFurnoIcons";
import { categorySlug, type QuickFurnoCategory } from "@/lib/quickfurno-data";

type HomeCategory = {
  label: string;
  icon: Parameters<typeof QFIcon>[0]["name"];
  category?: QuickFurnoCategory;
  subcategories: string[];
};

const homeCategories: HomeCategory[] = [
  {
    label: "Interior",
    icon: "home",
    category: "Interior Designers",
    subcategories: ["Interior Designer", "Full Home Interior", "Premium Interiors", "Modular Factory", "Kitchen & Wardrobe", "Home Renovation"],
  },
  {
    label: "Carpenter",
    icon: "hammer",
    category: "Carpenters",
    subcategories: ["Custom Furniture", "Wardrobe", "TV Unit", "Bed", "Kitchen Work", "Repair Work"],
  },
  {
    label: "Modular Kitchen",
    icon: "kitchen",
    category: "Modular Factory",
    subcategories: ["L Shape Kitchen", "U Shape Kitchen", "Parallel Kitchen", "Island Kitchen", "Kitchen Renovation"],
  },
  { label: "Wardrobe", icon: "wardrobe", category: "Modular Factory", subcategories: ["Sliding Wardrobe", "Hinged Wardrobe", "Loft Storage", "Walk-in Wardrobe"] },
  { label: "Painting", icon: "paint", category: "Painter", subcategories: ["Interior Painting", "Exterior Painting", "Texture Painting", "Waterproofing"] },
  { label: "Sofa", icon: "sofa", category: "Sofa", subcategories: ["Sofa Maker", "Sofa Repair", "Recliner", "Custom Sofa", "Upholstery"] },
  { label: "Painter", icon: "paint", category: "Painter", subcategories: ["Interior Painting", "Exterior Painting", "Texture Painting", "Waterproofing"] },
  { label: "False Ceiling", icon: "ceiling", category: "Interior Designers", subcategories: ["Gypsum Ceiling", "POP Ceiling", "Lighting Layout", "Ceiling Repair"] },
  { label: "Civil Work", icon: "civil", category: "Civil Work", subcategories: ["Renovation", "Tile Work", "Bathroom Renovation", "Mason Work"] },
  { label: "Electrician", icon: "plug", category: "Civil Work", subcategories: ["Wiring", "Switchboards", "Lighting", "Repair Work"] },
  { label: "Renovation", icon: "reno", category: "Civil Work", subcategories: ["Home Renovation", "Bathroom Renovation", "Tile Work", "Civil Repair"] },
  { label: "Plumber", icon: "pipe", category: "Civil Work", subcategories: ["Bathroom Plumbing", "Leak Repair", "Kitchen Plumbing", "Fittings"] },
  { label: "Flooring", icon: "floor", category: "Civil Work", subcategories: ["Tile Flooring", "Wooden Flooring", "Vinyl Flooring", "Repair"] },
  { label: "More Services", icon: "more", category: "Civil Work", subcategories: ["Civil Work", "Painting", "Custom Furniture", "Home Renovation"] },
];

export function HomeCategoryGrid() {
  const [active, setActive] = useState<HomeCategory | null>(null);

  function routeFor(item: HomeCategory) {
    return `/category/${categorySlug(item.category ?? "Civil Work")}`;
  }

  function openCategory(item: HomeCategory) {
    setActive(item);
  }

  return (
    <>
      <div className="qf-home-category-grid" data-reveal-group>
        {homeCategories.map((item) => (
          <button key={item.label} type="button" className="qf-home-category-card" onClick={() => openCategory(item)}>
            <span className="qf-home-category-icon">
              <QFIcon name={item.icon} />
            </span>
            <span>{item.label}</span>
          </button>
        ))}
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
                <Link key={subcategory} href={routeFor(active)} onClick={() => setActive(null)}>
                  <span>{subcategory}</span>
                  <QFIcon name="arrow" />
                </Link>
              ))}
            </div>
            <Link className="qf-sheet-primary" href={routeFor(active)} onClick={() => setActive(null)}>
              View all {active.label} vendors
            </Link>
          </section>
        </div>
      ) : null}
    </>
  );
}
