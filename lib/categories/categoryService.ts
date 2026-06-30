// ============================================================================
// QuickFurno — Phase 14C: Category source-of-truth service (SERVER ONLY)
//
// Single source of truth for "which categories/subcategories are live" = the
// admin-managed public.service_categories table, filtered to is_active = true.
// Admin dropdowns and the public client-enquiry service picker read from here so
// a category added or deactivated in Admin → Categories is reflected everywhere.
//
// NOTE: the vendor-side product taxonomy (lib/categories.ts mainCategories) is a
// separate, intentional vocabulary used by the homepage, the guided enquiry
// modal, and vendor registration for lead↔vendor matching. It is NOT changed by
// this service — see the Phase 14C doc.
//
// SAFETY:
//   - SERVER ONLY (service-role client). Never import from a client component;
//     the public surface is GET /api/categories.
//   - READ ONLY. No writes, no WhatsApp, no vendor notification, no credits,
//     no auto-assignment, no n8n.
//   - Never throws: missing table/column resolves to an empty list so dropdowns
//     show the "no active categories configured" message instead of crashing.
// ============================================================================
import { adminClient } from "@/lib/supabase";

export interface ActiveCategory {
  id: string;
  name: string;
  slug: string | null;
  parentId: string | null;
  sortOrder: number;
}

export interface ActiveCategoryNode extends ActiveCategory {
  subcategories: ActiveCategory[];
}

function isMissingColumnError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  const message = (error.message ?? "").toLowerCase();
  return code === "42703" || code === "PGRST204" || (message.includes("column") && message.includes("does not exist"));
}

function toCategory(row: Record<string, unknown>): ActiveCategory | null {
  const name = typeof row.name === "string" ? row.name.trim() : "";
  if (!name) return null;
  return {
    id: String(row.id ?? name),
    name,
    slug: typeof row.slug === "string" ? row.slug : null,
    parentId: typeof row.parent_id === "string" ? row.parent_id : null,
    sortOrder: Number.isFinite(Number(row.sort_order)) ? Number(row.sort_order) : 100,
  };
}

/** Active categories (flat), ordered by sort_order then name. Never throws. */
export async function getActiveServiceCategories(): Promise<ActiveCategory[]> {
  try {
    const db = adminClient();
    const full = await db
      .from("service_categories")
      .select("id, name, slug, is_active, parent_id, sort_order")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });

    let rows: unknown = full.data;
    if (full.error && isMissingColumnError(full.error)) {
      // Older schema without parent_id/sort_order.
      const basic = await db.from("service_categories").select("id, name, slug, is_active").eq("is_active", true).order("name", { ascending: true });
      if (basic.error || !Array.isArray(basic.data)) return [];
      rows = basic.data;
    } else if (full.error || !Array.isArray(full.data)) {
      return [];
    }

    const seen = new Set<string>();
    const out: ActiveCategory[] = [];
    for (const raw of rows as Array<Record<string, unknown>>) {
      const category = toCategory(raw);
      if (!category) continue;
      const key = category.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(category);
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Selectable active category names for a single dropdown: subcategories plus
 * childless top-level categories. A parent that has active subcategories is a
 * grouping, not a selectable service, so it is excluded. (On a flat schema with
 * no parent_id, every active category is selectable.)
 */
export async function getActiveServiceCategoryNames(): Promise<string[]> {
  const categories = await getActiveServiceCategories();
  const parentsWithActiveChild = new Set(
    categories.filter((c) => c.parentId).map((c) => c.parentId as string),
  );
  return categories.filter((c) => !parentsWithActiveChild.has(c.id)).map((c) => c.name);
}

/**
 * Active categories as a parent → subcategory tree. Categories with a parent_id
 * become children of that parent; orphans/parents are top-level.
 */
export async function getActiveServiceCategoryTree(): Promise<ActiveCategoryNode[]> {
  const categories = await getActiveServiceCategories();
  const byId = new Map(categories.map((c) => [c.id, c]));
  const parents: ActiveCategoryNode[] = [];
  const childrenByParent = new Map<string, ActiveCategory[]>();

  for (const category of categories) {
    if (category.parentId && byId.has(category.parentId)) {
      const list = childrenByParent.get(category.parentId) ?? [];
      list.push(category);
      childrenByParent.set(category.parentId, list);
    }
  }

  for (const category of categories) {
    const isChild = category.parentId && byId.has(category.parentId);
    if (isChild) continue;
    parents.push({ ...category, subcategories: childrenByParent.get(category.id) ?? [] });
  }

  return parents;
}
