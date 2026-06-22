"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { QFIcon } from "@/components/QuickFurnoIcons";
import { categorySlug, type QuickFurnoCategory } from "@/lib/quickfurno-data";

const suggestions: Array<{ label: string; category: QuickFurnoCategory; helper: string }> = [
  { label: "Interior Designer", category: "Interior Designers", helper: "Full home design and execution" },
  { label: "Carpenter", category: "Carpenters", helper: "Custom furniture and repair work" },
  { label: "Modular Kitchen", category: "Modular Factory", helper: "Kitchen and wardrobe specialists" },
  { label: "Wardrobe", category: "Modular Factory", helper: "Storage and modular wardrobe work" },
  { label: "Painter", category: "Painter", helper: "Painting, texture and waterproofing" },
  { label: "Civil Renovation", category: "Civil Work", helper: "Renovation, tiles and masonry" },
];

export function HomeSearchBar() {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);

  const filtered = useMemo(() => {
    const value = query.trim().toLowerCase();
    if (!value) return suggestions.slice(0, 4);
    return suggestions.filter((item) => `${item.label} ${item.category}`.toLowerCase().includes(value)).slice(0, 5);
  }, [query]);

  return (
    <div className="qf-home-search-wrap">
      <label className="qf-home-search">
        <QFIcon name="search" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => window.setTimeout(() => setFocused(false), 120)}
          placeholder="Search for carpenters, modular kitchen, painters..."
          aria-label="Search home services"
        />
      </label>

      {focused ? (
        <div className="qf-search-suggestions" role="listbox">
          {/* TODO: Replace local suggestions with Supabase-backed service search when service metadata is public. */}
          {filtered.map((item) => (
            <Link
              key={`${item.label}-${item.category}`}
              href={`/category/${categorySlug(item.category)}`}
              onClick={() => setFocused(false)}
            >
              <span>{item.label}</span>
              <small>{item.helper}</small>
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
