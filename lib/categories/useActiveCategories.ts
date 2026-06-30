"use client";

// ============================================================================
// QuickFurno — Phase 14C: useActiveCategories (client hook)
//
// Fetches admin-managed ACTIVE categories from GET /api/categories so client
// dropdowns use the same source of truth. When none are configured, callers
// should show the safe fallback message:
//   "No active categories configured. Add categories from Admin → Categories."
// ============================================================================
import { useEffect, useState } from "react";

export const NO_ACTIVE_CATEGORIES_MESSAGE =
  "No active categories configured. Add categories from Admin → Categories.";

export interface ActiveCategoryOption {
  id: string;
  name: string;
  slug: string | null;
  parentId: string | null;
  sortOrder: number;
}

export interface ActiveCategoryTreeNode extends ActiveCategoryOption {
  subcategories: ActiveCategoryOption[];
}

export interface ActiveCategoriesState {
  categories: string[];
  tree: ActiveCategoryTreeNode[];
  loading: boolean;
  loaded: boolean;
}

export function useActiveCategories(): ActiveCategoriesState {
  const [categories, setCategories] = useState<string[]>([]);
  const [tree, setTree] = useState<ActiveCategoryTreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/categories", { cache: "no-store" });
        const data = await res.json();
        if (!active) return;
        if (res.ok && data?.ok) {
          if (Array.isArray(data.categories)) {
            setCategories(data.categories.filter((name: unknown): name is string => typeof name === "string" && name.trim().length > 0));
          }
          if (Array.isArray(data.tree)) setTree(data.tree as ActiveCategoryTreeNode[]);
        }
      } catch {
        // Leave empty; callers render the safe fallback message.
      } finally {
        if (active) {
          setLoading(false);
          setLoaded(true);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  return { categories, tree, loading, loaded };
}
