import { categoriesShareCanonicalGroup, normalizeCategory } from "../vendors/categoryMatching";

export type PackageCategoryScopeRow = {
  id: string;
  name: string | null;
  slug: string | null;
  parent_id: string | null;
  is_active: boolean | null;
};

export type PackageCityScopeRow = {
  id: string;
  name: string | null;
  slug: string | null;
  is_active: boolean | null;
};

export type VendorPackageScopeContext = {
  city: string | null;
  selected_category: string | null;
  selected_subcategories: string[] | null;
  service_categories: string[] | null;
};

export type PackageScope = {
  categoryIds: string[];
  cityIds: string[];
};function vendorTerms(vendor: VendorPackageScopeContext): string[] {
  return [
    vendor.selected_category,
    ...(vendor.selected_subcategories ?? []),
    ...(vendor.service_categories ?? []),
  ].map(normalizeCategory).filter(Boolean);
}

function categoryMatchesTerm(row: PackageCategoryScopeRow, term: string): boolean {
  const names = [row.name, row.slug].map(normalizeCategory).filter(Boolean);
  if (names.includes(term)) return true;
  return names.some((name) => categoriesShareCanonicalGroup(name, term));
}

function activeCategoryIdsForVendor(
  vendor: VendorPackageScopeContext,
  categories: PackageCategoryScopeRow[],
): Set<string> {
  const byId = new Map(categories.map((row) => [row.id, row]));
  const terms = vendorTerms(vendor);
  const matched = new Set<string>();

  for (const row of categories) {
    const parent = row.parent_id ? byId.get(row.parent_id) : null;
    const structurallyActive = row.is_active !== false && (!parent || parent.is_active !== false);
    if (!structurallyActive) continue;
    if (terms.some((term) => categoryMatchesTerm(row, term))) matched.add(row.id);
  }

  for (const row of categories) {
    if (!row.parent_id || !matched.has(row.id)) continue;
    const parent = byId.get(row.parent_id);
    if (parent && parent.is_active !== false) matched.add(parent.id);
  }
  return matched;
}function activeVendorCityId(vendorCity: string | null, cities: PackageCityScopeRow[]): string | null {
  const term = normalizeCategory(vendorCity);
  if (!term) return null;
  const row = cities.find((city) => {
    if (city.is_active === false) return false;
    return [city.name, city.slug].map(normalizeCategory).filter(Boolean).includes(term);
  });
  return row?.id ?? null;
}

export function packageAppliesToVendor(input: {
  vendor: VendorPackageScopeContext;
  scope: PackageScope;
  categories: PackageCategoryScopeRow[];
  cities: PackageCityScopeRow[];
}): boolean {
  const cityId = activeVendorCityId(input.vendor.city, input.cities);
  if (!cityId) return false;
  if (input.scope.cityIds.length > 0 && !input.scope.cityIds.includes(cityId)) return false;

  const categoryIds = activeCategoryIdsForVendor(input.vendor, input.categories);
  if (categoryIds.size === 0) return false;
  if (input.scope.categoryIds.length === 0) return true;
  return input.scope.categoryIds.some((id) => categoryIds.has(id));
}
