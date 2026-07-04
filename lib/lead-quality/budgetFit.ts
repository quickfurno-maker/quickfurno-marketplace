// ============================================================================
// QuickFurno — lib/lead-quality/budgetFit.ts
//
// Deterministic, category-aware GRADED budget-fit for the Lead Quality Engine V2.
// Answers: "is the client's budget a realistic, category-plausible amount?" — used
// only to award graded commercial-intent points (8 / 5 / 2 / 0).
//
// PRINCIPLES
//   • Low budget is NEVER fraud — it just earns fewer/zero points.
//   • Floors are conservative (low) temporary defaults, centralized here for review.
//   • Category resolution reuses the existing normalizeClarificationCategory() —
//     no duplicate competing category map.
// ============================================================================
import { normalizeClarificationCategory } from "@/lib/lead-quality/clarificationPresets";
import type { QuickFurnoCategory } from "@/lib/quickfurno-data";

/** Conservative minimum realistic TOTAL project budget (₹) per category (floors). */
export const CATEGORY_MIN_REALISTIC_BUDGET_INR: Record<QuickFurnoCategory, number> = {
  "Interior Designers": 100000,
  "Premium Interiors": 200000,
  "Modular Factory": 75000,
  "Carpenters": 15000,
  "Sofa": 8000,
  "Painter": 8000,
  "Civil Work": 20000,
};

/** Fallback floor when the category genuinely cannot be resolved. */
export const DEFAULT_MIN_REALISTIC_BUDGET_INR = 10000;

/**
 * Graded tiers relative to the category floor (deterministic, not a binary cliff):
 *   ratio >= 1.00 → +8 ("full") · >= 0.70 → +5 ("near") · >= 0.40 → +2 ("partial") · else +0 ("below")
 */
export const BUDGET_FIT_TIERS = {
  full: { minRatio: 1.0, points: 8 },
  near: { minRatio: 0.7, points: 5 },
  partial: { minRatio: 0.4, points: 2 },
} as const;

export type BudgetFitTier = "full" | "near" | "partial" | "below" | "none";

export type BudgetFit = {
  hasBudget: boolean;
  maxRupees: number | null;
  category: QuickFurnoCategory | null;
  categoryMin: number;
  ratio: number | null;
  points: number;
  tier: BudgetFitTier;
};

const NOT_SURE_RE = /\b(not sure|unknown|na|n\/a|free|explor|tbd|to be decided)\b/i;

/**
 * Parse the largest ₹ amount from a budget string. Handles raw-rupee ranges
 * ("₹70,000 – ₹90,000") AND bucket labels ("₹3–7 lakh", "Below ₹1 lakh", "₹15 lakh+").
 */
export function parseBudgetMaxRupees(text: string): number | null {
  const t = (text ?? "").toLowerCase().trim();
  if (!t || NOT_SURE_RE.test(t)) return null;

  const hasCrore = /\bcrore\b|\bcr\b/.test(t);
  const hasLakh = /\blakh\b|\blac\b|\bl\b/.test(t) || /\d\s*l\b/.test(t);

  const numbers = (t.match(/\d[\d,]*\.?\d*/g) ?? [])
    .map((n) => Number(n.replace(/,/g, "")))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (numbers.length === 0) return null;

  let max = Math.max(...numbers);
  if (hasCrore) max *= 10000000;
  else if (hasLakh) max *= 100000;
  return max;
}

/**
 * Category resolution priority (deterministic):
 *   1. structured subcategory  2. canonical category  3. service label  4. null → default floor
 */
export function resolveBudgetCategory(hints: {
  service?: string | null;
  category?: string | null;
  subcategory?: string | null;
}): QuickFurnoCategory | null {
  return (
    normalizeClarificationCategory(hints.subcategory) ||
    normalizeClarificationCategory(hints.category) ||
    normalizeClarificationCategory(hints.service) ||
    null
  );
}

/** Evaluate graded budget-fit. Side-effect free; below-range is never fraud. */
export function evaluateBudgetFit(
  budgetText: string | null | undefined,
  hints: { service?: string | null; category?: string | null; subcategory?: string | null },
): BudgetFit {
  const maxRupees = parseBudgetMaxRupees(budgetText ?? "");
  const category = resolveBudgetCategory(hints);
  const categoryMin = category
    ? CATEGORY_MIN_REALISTIC_BUDGET_INR[category]
    : DEFAULT_MIN_REALISTIC_BUDGET_INR;

  if (maxRupees == null) {
    return { hasBudget: false, maxRupees: null, category, categoryMin, ratio: null, points: 0, tier: "none" };
  }

  const ratio = maxRupees / categoryMin;
  let points = 0;
  let tier: BudgetFitTier = "below";
  if (ratio >= BUDGET_FIT_TIERS.full.minRatio) { points = BUDGET_FIT_TIERS.full.points; tier = "full"; }
  else if (ratio >= BUDGET_FIT_TIERS.near.minRatio) { points = BUDGET_FIT_TIERS.near.points; tier = "near"; }
  else if (ratio >= BUDGET_FIT_TIERS.partial.minRatio) { points = BUDGET_FIT_TIERS.partial.points; tier = "partial"; }
  else { points = 0; tier = "below"; }

  return { hasBudget: true, maxRupees, category, categoryMin, ratio, points, tier };
}
