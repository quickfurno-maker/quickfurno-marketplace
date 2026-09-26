export type RuntimeCategoryRow = {
  id: string;
  name: string;
  slug?: string | null;
  parent_id?: string | null;
  sort_order?: number | null;
  is_active?: boolean | null;
  automation_key?: string | null;
  lead_service_value?: string | null;
  matching_aliases?: string[] | null;
  automation_enabled?: boolean | null;
};

export type RuntimeCategoryPolicy = {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  parentName: string | null;
  sortOrder: number;
  effectiveActive: boolean;
  hasChildren: boolean;
  automationKey: string;
  leadServiceValue: string;
  aliases: string[];
  automationEnabled: boolean;
  automationReady: boolean;
  configurationIssues: string[];
};

export function normalizeRuntimeCategoryTerm(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function cleanList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean))];
}

export function buildRuntimeCategoryPolicies(rows: RuntimeCategoryRow[]): RuntimeCategoryPolicy[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const childCount = new Map<string, number>();
  for (const row of rows) {
    if (row.parent_id) childCount.set(row.parent_id, (childCount.get(row.parent_id) ?? 0) + 1);
  }
  const effectiveMemo = new Map<string, boolean>();
  const visiting = new Set<string>();
  const effectiveActive = (id: string): boolean => {
    if (effectiveMemo.has(id)) return effectiveMemo.get(id) === true;
    const row = byId.get(id);
    if (!row || row.is_active !== true || visiting.has(id)) {
      effectiveMemo.set(id, false);
      return false;
    }
    if (!row.parent_id) {
      effectiveMemo.set(id, true);
      return true;
    }
    visiting.add(id);
    const active = effectiveActive(row.parent_id);
    visiting.delete(id);
    effectiveMemo.set(id, active);
    return active;
  };

  return rows.map((row) => {
    const aliases = [...new Set([
      row.name?.trim(),
      row.slug?.trim(),
      row.automation_key?.trim(),
      row.lead_service_value?.trim(),
      ...cleanList(row.matching_aliases),
    ].filter((v): v is string => Boolean(v)))];
    const hasChildren = (childCount.get(row.id) ?? 0) > 0;
    const automationKey = row.automation_key?.trim() ?? "";
    const leadServiceValue = row.lead_service_value?.trim() ?? "";
    const issues: string[] = [];
    if (!hasChildren) {
      if (!automationKey) issues.push("missing_automation_key");
      if (!leadServiceValue) issues.push("missing_lead_service_value");
      if (aliases.length === 0) issues.push("missing_matching_aliases");
      if (row.automation_enabled !== true) issues.push("automation_disabled");
    }
    const active = effectiveActive(row.id);
    return {
      id: row.id,
      name: row.name,
      slug: row.slug?.trim() || row.id,
      parentId: row.parent_id ?? null,
      parentName: row.parent_id ? byId.get(row.parent_id)?.name ?? null : null,
      sortOrder: Number.isFinite(Number(row.sort_order)) ? Number(row.sort_order) : 100,
      effectiveActive: active,
      hasChildren,
      automationKey,
      leadServiceValue,
      aliases,
      automationEnabled: row.automation_enabled === true,
      automationReady: active && !hasChildren && issues.length === 0,
      configurationIssues: issues,
    };
  });
}

export function resolveRuntimeCategoryPolicy(
  policies: RuntimeCategoryPolicy[],
  terms: unknown[],
  options: { activeOnly?: boolean; leafOnly?: boolean } = {},
): RuntimeCategoryPolicy | null {
  const wanted = [...new Set(terms.map(normalizeRuntimeCategoryTerm).filter(Boolean))];
  if (wanted.length === 0) return null;
  const activeOnly = options.activeOnly !== false;
  const leafOnly = options.leafOnly !== false;
  let best: { policy: RuntimeCategoryPolicy; score: number } | null = null;
  for (const [termIndex, term] of wanted.entries()) {
    for (const policy of policies) {
      if (activeOnly && !policy.effectiveActive) continue;
      if (leafOnly && policy.hasChildren) continue;
      const exactTerms = [policy.name, policy.slug, policy.automationKey, policy.leadServiceValue]
        .map(normalizeRuntimeCategoryTerm).filter(Boolean);
      const aliasTerms = policy.aliases.map(normalizeRuntimeCategoryTerm).filter(Boolean);
      const matchScore = exactTerms.includes(term) ? 3 : aliasTerms.includes(term) ? 2 : 0;
      const score = matchScore > 0 ? (wanted.length - termIndex) * 10 + matchScore : 0;
      if (score > 0 && (!best || score > best.score)) best = { policy, score };
    }
  }
  return best ? best.policy : null;
}

export function runtimeAliasSet(policy: RuntimeCategoryPolicy | null | undefined): Set<string> {
  return new Set((policy?.aliases ?? []).map(normalizeRuntimeCategoryTerm).filter(Boolean));
}

export function vendorTermsMatchPolicy(vendorTerms: unknown[], policy: RuntimeCategoryPolicy | null | undefined): boolean {
  if (!policy) return false;
  const aliases = runtimeAliasSet(policy);
  return vendorTerms.some((term) => aliases.has(normalizeRuntimeCategoryTerm(term)));
}
