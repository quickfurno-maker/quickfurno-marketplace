"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { QFIcon } from "@/components/QuickFurnoIcons";
import { categorySlug, type QuickFurnoCategory } from "@/lib/quickfurno-data";
import { mainCategories, type MainCategory } from "@/lib/categories";

/**
 * "Find a service" launcher — the homepage's single service-discovery surface.
 *
 * CATEGORY SOURCE IS NOT DUPLICATED. Routes come from categorySlug(), the
 * grouped entry comes from lib/categories.ts, and the `category` values below
 * are typed as QuickFurnoCategory so a name that is not a real marketplace
 * category cannot compile. Only the short display labels are local, because the
 * launcher needs tighter wording than the full category names.
 *
 * The "Interior" tile is the parent group and opens the existing subcategory
 * picker (which still lists Interior Designers, Carpenters, Modular Factory and
 * Premium Interiors). The remaining six tiles are leaves that route directly,
 * exactly as the product already did.
 */
type LauncherTile =
  | { kind: "group"; id: string; label: string }
  | { kind: "leaf"; category: QuickFurnoCategory; label: string; wide?: boolean };

const TILES: LauncherTile[] = [
  { kind: "group", id: "interior", label: "Interior" },
  { kind: "leaf", category: "Carpenters", label: "Carpentry" },
  { kind: "leaf", category: "Modular Factory", label: "Modular" },
  { kind: "leaf", category: "Premium Interiors", label: "Premium Interiors" },
  { kind: "leaf", category: "Sofa", label: "Sofa" },
  { kind: "leaf", category: "Painter", label: "Painting" },
  { kind: "leaf", category: "Civil Work", label: "Civil Work", wide: true },
];

const TILE_ICON: Record<string, Parameters<typeof QFIcon>[0]["name"]> = {
  Interior: "home",
  Carpentry: "hammer",
  Modular: "kitchen",
  "Premium Interiors": "star",
  Sofa: "sofa",
  Painting: "paint",
  "Civil Work": "civil",
};

const routeFor = (category: QuickFurnoCategory) => `/category/${categorySlug(category)}`;

export function HomeServiceLauncher() {
  const [active, setActive] = useState<MainCategory | null>(null);

  return (
    <>
      <section className="qf-launcher" id="services" aria-labelledby="qf-launcher-title">
        <div className="qf-launcher-head">
          <h2 id="qf-launcher-title">Find a service</h2>
          <p>Pick what you need and get matched with verified local teams.</p>
        </div>

        <div className="qf-launcher-grid">
          {TILES.map((tile) => {
            const label = tile.label;
            const inner = (
              <>
                <span className="qf-launcher-item-icon" aria-hidden="true">
                  <QFIcon name={TILE_ICON[label] ?? "grid"} />
                </span>
                <span>{label}</span>
              </>
            );

            if (tile.kind === "group") {
              const group = mainCategories.find((c) => c.id === tile.id);
              if (!group) return null;
              return (
                <button
                  key={label}
                  type="button"
                  className="qf-launcher-item"
                  aria-haspopup="dialog"
                  onClick={() => setActive(group)}
                >
                  {inner}
                </button>
              );
            }

            return (
              <Link
                key={label}
                href={routeFor(tile.category)}
                className={`qf-launcher-item${tile.wide ? " qf-launcher-item--wide" : ""}`}
              >
                {inner}
              </Link>
            );
          })}
        </div>
      </section>

      {active ? <SubcategorySheet group={active} onClose={() => setActive(null)} /> : null}
    </>
  );
}

/**
 * Subcategory picker — a bottom sheet on phones, a centred dialog on desktop.
 * Behaviour is unchanged (same links, same routes); the close control is now a
 * labelled icon button rather than a bare "x", and Escape and backdrop both
 * dismiss it.
 */
function SubcategorySheet({ group, onClose }: { group: MainCategory; onClose: () => void }) {
  const sheetRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    sheetRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div className="qf-subsheet-backdrop" role="presentation" onMouseDown={onClose} />
      <div
        className="qf-subsheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="qf-subsheet-title"
        tabIndex={-1}
        ref={sheetRef}
      >
        <div className="qf-subsheet-grip" aria-hidden="true" />

        <div className="qf-subsheet-head">
          <div>
            <h2 id="qf-subsheet-title">{group.label}</h2>
            <p>Choose a service, or view every matching team.</p>
          </div>
          <button type="button" className="qf-subsheet-close" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" aria-hidden="true">
              <path d="m6.4 6.4 11.2 11.2M17.6 6.4 6.4 17.6" />
            </svg>
          </button>
        </div>

        <div className="qf-subsheet-list">
          {group.subcategories.map((sub) => (
            <Link
              key={sub.label}
              href={routeFor(sub.category)}
              className="qf-subsheet-item"
              onClick={onClose}
            >
              <span>{sub.label}</span>
              <QFIcon name="arrow" />
            </Link>
          ))}
        </div>

        {group.category ? (
          <Link
            className="qf-pub-btn qf-pub-btn--primary qf-pub-btn--block qf-subsheet-all"
            href={routeFor(group.category)}
            onClick={onClose}
          >
            View all {group.label} teams
          </Link>
        ) : null}
      </div>
    </>
  );
}
