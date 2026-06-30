// ============================================================================
// QuickFurno — Phase 14C: GET /api/categories
// Public, read-only list of ACTIVE admin-managed categories (and a parent →
// subcategory tree).
//
// Categories are public info (service_categories allows anon read of active
// rows), so no auth is required. Returns names + a safe tree only — NO secrets,
// NO service-role key. Used by client-side dropdowns so admin-managed active
// categories are the single source of truth.
// ============================================================================
import { NextResponse } from "next/server";
import { getActiveServiceCategories, getActiveServiceCategoryNames, getActiveServiceCategoryTree } from "@/lib/categories/categoryService";

export const dynamic = "force-dynamic";

export async function GET() {
  const [records, names, tree] = await Promise.all([
    getActiveServiceCategories(),
    getActiveServiceCategoryNames(),
    getActiveServiceCategoryTree(),
  ]);
  // `categories` = selectable services (leaves); `tree` = full hierarchy.
  return NextResponse.json({ ok: true, categories: names, tree, records }, { status: 200 });
}
