"use client";

import {
  StatusBadge,
  ToggleSwitch,
} from "../AdminPrimitives";
import { type Category } from "../adminTypes";
import {
  formatNumber,
  shortId,
} from "../adminUtils";
import { CategoryManager } from "../CategoryManager";
import { Strong } from "./shared";

/** C-PERF2: narrow section contract — the complete (small) category config
 *  set only. The hierarchy manager requires the full reference set; nothing
 *  else is fetched for this route. */
export function CategoriesPage({ categories, notify }: { categories: Category[]; notify: (message: string, tone?: "success" | "error" | "info") => void }) {
  // Phase 14C governance: full admin-only category/subcategory management.
  return <CategoryManager categories={categories} notify={notify} />;
}


export function CategoryParentCard({ item, subcategoryCount }: { item: Category; subcategoryCount: number }) {
  return (
    <article className="qf-card-shadow qf-card-hover rounded-xl border border-slate-200 bg-white p-5 transition hover:-translate-y-0.5 hover:border-emerald-200">
      <div className="flex items-start justify-between gap-3">
        <Strong title={item.name || "Unnamed category"} subtitle={item.slug || shortId(item.id)} />
        <StatusBadge value={item.is_active ? "Active" : "Inactive"} />
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-slate-50 p-3">
          <p className="text-xs font-semibold uppercase text-slate-500">Subcategories</p>
          <p className="mt-1 text-lg font-semibold text-slate-950">{formatNumber(subcategoryCount)}</p>
        </div>
        <div className="rounded-lg bg-slate-50 p-3">
          <p className="text-xs font-semibold uppercase text-slate-500">Sort</p>
          <p className="mt-1 text-lg font-semibold text-slate-950">{formatNumber(item.sort_order ?? 100)}</p>
        </div>
      </div>
      <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-4">
        <span className="text-sm font-semibold text-slate-600">Homepage</span>
        <ToggleSwitch checked={Boolean(item.show_on_homepage ?? true)} />
      </div>
    </article>
  );
}
