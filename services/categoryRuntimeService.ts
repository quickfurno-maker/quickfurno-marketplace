import { adminClient } from "@/lib/supabase";
import {
  buildRuntimeCategoryPolicies,
  resolveRuntimeCategoryPolicy,
  type RuntimeCategoryPolicy,
  type RuntimeCategoryRow,
} from "@/lib/categories/runtimeCategoryPolicy";

const FULL_COLS = "id,name,slug,parent_id,sort_order,is_active,automation_key,lead_service_value,matching_aliases,automation_enabled";
const LEGACY_COLS = "id,name,slug,parent_id,sort_order,is_active";

function isMissingColumnError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const message = (error.message ?? "").toLowerCase();
  return error.code === "42703" || error.code === "PGRST204" || (message.includes("column") && message.includes("does not exist"));
}

export async function getRuntimeCategoryPolicies(): Promise<RuntimeCategoryPolicy[]> {
  const db = adminClient();
  const full = await db.from("service_categories").select(FULL_COLS).order("sort_order", { ascending: true }).order("name", { ascending: true });
  if (!full.error && Array.isArray(full.data)) return buildRuntimeCategoryPolicies(full.data as RuntimeCategoryRow[]);
  if (!full.error || !isMissingColumnError(full.error)) return [];

  const legacy = await db.from("service_categories").select(LEGACY_COLS).order("sort_order", { ascending: true }).order("name", { ascending: true });
  if (legacy.error || !Array.isArray(legacy.data)) return [];
  const rows = (legacy.data as RuntimeCategoryRow[]).map((row) => ({
    ...row,
    automation_key: row.slug ?? row.name,
    lead_service_value: row.name,
    matching_aliases: [row.name],
    automation_enabled: false,
  }));
  return buildRuntimeCategoryPolicies(rows);
}

export async function resolveActiveCategoryPolicy(...terms: unknown[]): Promise<RuntimeCategoryPolicy | null> {
  return resolveRuntimeCategoryPolicy(await getRuntimeCategoryPolicies(), terms, { activeOnly: true, leafOnly: true });
}

export async function getActiveCategoryPolicyBySlug(slug: string): Promise<RuntimeCategoryPolicy | null> {
  const clean = slug.trim().toLowerCase();
  if (!clean) return null;
  return (await getRuntimeCategoryPolicies()).find((policy) => policy.effectiveActive && policy.slug.toLowerCase() === clean) ?? null;
}

export async function getActiveCategoryTreePolicies(): Promise<Array<RuntimeCategoryPolicy & { subcategories: RuntimeCategoryPolicy[] }>> {
  const policies = (await getRuntimeCategoryPolicies()).filter((policy) => policy.effectiveActive);
  const children = new Map<string, RuntimeCategoryPolicy[]>();
  for (const policy of policies) {
    if (!policy.parentId) continue;
    const list = children.get(policy.parentId) ?? [];
    list.push(policy);
    children.set(policy.parentId, list);
  }
  return policies
    .filter((policy) => !policy.parentId)
    .map((policy) => ({ ...policy, subcategories: (children.get(policy.id) ?? []).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)) }))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

export async function requireAutomationReadyCategory(...terms: unknown[]): Promise<RuntimeCategoryPolicy | null> {
  const policy = await resolveActiveCategoryPolicy(...terms);
  return policy?.automationReady ? policy : null;
}
