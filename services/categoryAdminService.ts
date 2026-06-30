// ============================================================================
// QuickFurno — services/categoryAdminService.ts
// Phase 14C governance: Superadmin/Admin management of categories &
// subcategories (public.service_categories).
//
// SAFETY CONTRACT:
//   - SERVER ONLY. Uses the service-role client; never reaches the browser. The
//     service-role key is never returned to any caller.
//   - Writes are ADMIN ONLY — callers (the API routes) MUST verify the admin
//     session before invoking these. RLS also restricts writes to is_admin().
//   - SOFT delete only (is_active=false). No hard delete — old leads/vendors may
//     reference a category name.
//   - No duplicate names. Deactivating a parent with active subcategories
//     requires an explicit force flag (the UI warns first).
//   - NO WhatsApp, NO vendor notification, NO credit deduction, NO
//     auto-assignment, NO n8n.
//   - Resilient to older/flat schemas: parent_id / sort_order / created_by /
//     updated_by may be absent (migration 021 adds them) and are written
//     best-effort.
// ============================================================================
import { adminClient } from "../lib/supabase";

const SELECT_COLS = "id, name, slug, is_active, parent_id, sort_order, created_at, updated_at";
const SELECT_COLS_BASIC = "id, name, slug, is_active";

export interface CategoryAdminRow {
  id: string;
  name: string;
  slug: string | null;
  isActive: boolean;
  parentId: string | null;
  parentName: string | null;
  sortOrder: number;
  activeSubcategoryCount: number;
  createdAt: string | null;
  updatedAt: string | null;
}

export type CategoryResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code: string; meta?: Record<string, unknown> };

function isMissingColumnError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  const message = (error.message ?? "").toLowerCase();
  return code === "42703" || code === "PGRST204" || (message.includes("column") && message.includes("does not exist"));
}

function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

async function fetchRawCategories(): Promise<Array<Record<string, unknown>>> {
  const db = adminClient();
  const full = await db.from("service_categories").select(SELECT_COLS).order("name", { ascending: true });
  if (!full.error && Array.isArray(full.data)) return full.data as Array<Record<string, unknown>>;
  if (full.error && !isMissingColumnError(full.error)) return [];
  const basic = await db.from("service_categories").select(SELECT_COLS_BASIC).order("name", { ascending: true });
  if (basic.error || !Array.isArray(basic.data)) return [];
  return basic.data as Array<Record<string, unknown>>;
}

function mapRows(rows: Array<Record<string, unknown>>): CategoryAdminRow[] {
  const nameById = new Map<string, string>();
  const activeChildren = new Map<string, number>();
  for (const row of rows) {
    nameById.set(String(row.id), typeof row.name === "string" ? row.name : "");
    const parentId = typeof row.parent_id === "string" ? row.parent_id : null;
    if (parentId && row.is_active === true) activeChildren.set(parentId, (activeChildren.get(parentId) ?? 0) + 1);
  }
  return rows
    .map((row) => {
      const id = String(row.id ?? "");
      const name = typeof row.name === "string" ? row.name.trim() : "";
      if (!id || !name) return null;
      const parentId = typeof row.parent_id === "string" ? row.parent_id : null;
      return {
        id,
        name,
        slug: typeof row.slug === "string" ? row.slug : null,
        isActive: row.is_active === true,
        parentId,
        parentName: parentId ? nameById.get(parentId) ?? null : null,
        sortOrder: Number.isFinite(Number(row.sort_order)) ? Number(row.sort_order) : 100,
        activeSubcategoryCount: activeChildren.get(id) ?? 0,
        createdAt: typeof row.created_at === "string" ? row.created_at : null,
        updatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
      } satisfies CategoryAdminRow;
    })
    .filter((row): row is CategoryAdminRow => row !== null);
}

// ----------------------------------------------------------------------------
// READ
// ----------------------------------------------------------------------------
export async function listAllCategories(): Promise<CategoryResult<CategoryAdminRow[]>> {
  try {
    return { ok: true, data: mapRows(await fetchRawCategories()) };
  } catch {
    return { ok: false, error: "Could not load categories.", code: "READ_FAILED" };
  }
}

// ----------------------------------------------------------------------------
// CREATE (category or subcategory)
// ----------------------------------------------------------------------------
export interface CreateCategoryInput {
  name: string;
  parentId?: string | null;
  updatedBy: string;
}

export async function createCategory(input: CreateCategoryInput): Promise<CategoryResult<CategoryAdminRow>> {
  const name = (input.name ?? "").trim();
  if (!name) return { ok: false, error: "Category name is required.", code: "VALIDATION" };

  try {
    const rows = await fetchRawCategories();
    if (rows.some((r) => String(r.name ?? "").trim().toLowerCase() === name.toLowerCase())) {
      return { ok: false, error: `A category named "${name}" already exists.`, code: "DUPLICATE" };
    }

    const parentId = typeof input.parentId === "string" && input.parentId.trim() ? input.parentId.trim() : null;
    const base: Record<string, unknown> = { name, slug: slugify(name), is_active: true };
    const full: Record<string, unknown> = {
      ...base,
      parent_id: parentId,
      created_by: input.updatedBy,
      updated_by: input.updatedBy,
      updated_at: new Date().toISOString(),
    };

    const db = adminClient();
    let inserted = await db.from("service_categories").insert(full).select("id").single();
    if (inserted.error && isMissingColumnError(inserted.error)) {
      inserted = await db.from("service_categories").insert(base).select("id").single();
    }
    if (inserted.error || !inserted.data?.id) {
      return { ok: false, error: "Could not create the category.", code: "WRITE_FAILED" };
    }
    return findById(String(inserted.data.id));
  } catch {
    return { ok: false, error: "Could not create the category.", code: "WRITE_FAILED" };
  }
}

// ----------------------------------------------------------------------------
// UPDATE (rename / re-parent / sort)
// ----------------------------------------------------------------------------
export interface UpdateCategoryInput {
  name?: string;
  parentId?: string | null;
  sortOrder?: number;
  updatedBy: string;
}

export async function updateCategory(id: string, input: UpdateCategoryInput): Promise<CategoryResult<CategoryAdminRow>> {
  const categoryId = (id ?? "").trim();
  if (!categoryId) return { ok: false, error: "A category id is required.", code: "VALIDATION" };

  try {
    const rows = await fetchRawCategories();
    const current = rows.find((r) => String(r.id) === categoryId);
    if (!current) return { ok: false, error: "Category not found.", code: "NOT_FOUND" };

    const name = typeof input.name === "string" ? input.name.trim() : null;
    if (name !== null) {
      if (!name) return { ok: false, error: "Category name cannot be empty.", code: "VALIDATION" };
      if (rows.some((r) => String(r.id) !== categoryId && String(r.name ?? "").trim().toLowerCase() === name.toLowerCase())) {
        return { ok: false, error: `A category named "${name}" already exists.`, code: "DUPLICATE" };
      }
    }
    if (typeof input.parentId === "string" && input.parentId.trim() === categoryId) {
      return { ok: false, error: "A category cannot be its own parent.", code: "VALIDATION" };
    }

    const base: Record<string, unknown> = {};
    if (name !== null) {
      base.name = name;
      base.slug = slugify(name);
    }
    const full: Record<string, unknown> = { ...base, updated_by: input.updatedBy, updated_at: new Date().toISOString() };
    if (input.parentId !== undefined) full.parent_id = input.parentId ? input.parentId.trim() : null;
    if (typeof input.sortOrder === "number") full.sort_order = Math.round(input.sortOrder);

    if (Object.keys(base).length === 0 && input.parentId === undefined && input.sortOrder === undefined) {
      return findById(categoryId);
    }

    const db = adminClient();
    let updated = await db.from("service_categories").update(full).eq("id", categoryId);
    if (updated.error && isMissingColumnError(updated.error)) {
      updated = await db.from("service_categories").update(base).eq("id", categoryId);
    }
    if (updated.error) return { ok: false, error: "Could not update the category.", code: "WRITE_FAILED" };
    return findById(categoryId);
  } catch {
    return { ok: false, error: "Could not update the category.", code: "WRITE_FAILED" };
  }
}

// ----------------------------------------------------------------------------
// ACTIVATE / DEACTIVATE (soft delete)
// ----------------------------------------------------------------------------
export async function setCategoryActive(
  id: string,
  isActive: boolean,
  updatedBy: string,
  options: { force?: boolean } = {},
): Promise<CategoryResult<CategoryAdminRow>> {
  const categoryId = (id ?? "").trim();
  if (!categoryId) return { ok: false, error: "A category id is required.", code: "VALIDATION" };

  try {
    const rows = await fetchRawCategories();
    const current = rows.find((r) => String(r.id) === categoryId);
    if (!current) return { ok: false, error: "Category not found.", code: "NOT_FOUND" };

    // Warn before deactivating a parent that still has active subcategories.
    if (!isActive && !options.force) {
      const activeSubs = rows.filter((r) => String(r.parent_id ?? "") === categoryId && r.is_active === true);
      if (activeSubs.length > 0) {
        return {
          ok: false,
          code: "HAS_ACTIVE_SUBCATEGORIES",
          error: `"${String(current.name ?? "This category")}" has ${activeSubs.length} active subcategory(ies). Deactivate anyway?`,
          meta: { activeSubcategoryCount: activeSubs.length },
        };
      }
    }

    const db = adminClient();
    const full: Record<string, unknown> = { is_active: isActive, updated_by: updatedBy, updated_at: new Date().toISOString() };
    let updated = await db.from("service_categories").update(full).eq("id", categoryId);
    if (updated.error && isMissingColumnError(updated.error)) {
      updated = await db.from("service_categories").update({ is_active: isActive }).eq("id", categoryId);
    }
    if (updated.error) return { ok: false, error: "Could not update the category.", code: "WRITE_FAILED" };
    return findById(categoryId);
  } catch {
    return { ok: false, error: "Could not update the category.", code: "WRITE_FAILED" };
  }
}

async function findById(id: string): Promise<CategoryResult<CategoryAdminRow>> {
  const rows = mapRows(await fetchRawCategories());
  const row = rows.find((r) => r.id === id);
  if (!row) return { ok: false, error: "Category not found after write.", code: "NOT_FOUND" };
  return { ok: true, data: row };
}
