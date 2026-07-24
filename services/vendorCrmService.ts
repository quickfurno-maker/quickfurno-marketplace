// ============================================================================
// QF-MVP-30.2 — Vendor CRM service boundary (SERVER ONLY).
//
// The single canonical Vendor CRM read/write authority. SERVER ONLY: it imports
// `server-only` and the service_role `adminClient` — it must NEVER be imported by
// a client component. Every mutation receives the actor id from the authorized
// server session (see crmAuth.requireCrmAdmin) — never from request input.
//
// LOCKED INVARIANTS
//  * writes touch ONLY the six CRM foundation tables; it NEVER writes vendors,
//    leads, packages, credits, consent, suppression or any Core object;
//  * no dynamic/arbitrary table name ever comes from input;
//  * notes are append-only — there is NO note update/delete method;
//  * contacts/tags/assignments/tasks are ARCHIVED via lifecycle fields, never
//    hard-deleted;
//  * tag normalized_name is generated deterministically server-side;
//  * task idempotency_key is honoured when supplied;
//  * the directory read is server-paged, deterministically sorted, bounded, and
//    batch-loads related CRM data (no N+1 per row);
//  * Core facts are displayed read-only and are NEVER copied into CRM columns.
// ============================================================================

import "server-only";
import { adminClient } from "../lib/supabase";
import {
  validateCrmProfile, validateContact, validateTag, validateNote,
  validateTaskCreate, validateTaskUpdate, requireCompletionResult, requireUuid,
  validateDirectoryQuery, type VendorCrmDirectoryQuery,
} from "../lib/crm/vendorCrmValidation";

/** The six CRM foundation tables — the ONLY tables this service may write. */
const CRM_NOTES = "vendor_internal_notes" as const;
const CRM_PROFILES = "vendor_crm_profiles" as const;
const CRM_CONTACTS = "vendor_contacts" as const;
const CRM_TAGS = "vendor_tags" as const;
const CRM_TAG_ASSIGNMENTS = "vendor_tag_assignments" as const;
const CRM_TASKS = "vendor_tasks" as const;

type Actor = string; // the authorized admin's auth.users.id
function db() { return adminClient(); }

export interface VendorCrmDirectoryRow {
  vendor_id: string;
  business_name: string | null;
  owner_name: string | null;
  phone: string | null;
  city: string | null;
  service_categories: string[] | null;
  status: string | null;            // Core verification/enabled indicator (read-only)
  is_active: boolean | null;        // Core enabled state (read-only)
  remaining_credits: number | null; // Core credit summary (read-only)
  total_credits: number | null;
  onboarding_stage: string | null;  // CRM
  relationship_status: string | null;
  next_follow_up_at: string | null;
  last_interaction_at: string | null;
  active_tags: { id: string; name: string }[];
  open_task_count: number;
  overdue_task_count: number;
  primary_contact_name: string | null;
}
export interface VendorCrmDirectoryResult {
  rows: VendorCrmDirectoryRow[];
  page: number;
  pageSize: number;
  total: number;
}

/** Server-paged directory combining Core (vendors) + CRM extensions. Bounded and
 *  batch-loaded: at most a fixed handful of queries regardless of page size. */
export async function listVendorCrmDirectory(rawQuery: Record<string, unknown>): Promise<VendorCrmDirectoryResult> {
  const q: VendorCrmDirectoryQuery = validateDirectoryQuery(rawQuery);
  const c = db();

  // 1. resolve CRM-filter vendor-id sets (batch, not per-row) when a CRM filter is set.
  let crmIdFilter: string[] | null = null;
  if (q.onboarding_stage || q.relationship_status) {
    let pq = c.from(CRM_PROFILES).select("vendor_id");
    if (q.onboarding_stage) pq = pq.eq("onboarding_stage", q.onboarding_stage);
    if (q.relationship_status) pq = pq.eq("relationship_status", q.relationship_status);
    const { data } = await pq;
    crmIdFilter = (data ?? []).map((r: { vendor_id: string }) => r.vendor_id);
    if (crmIdFilter.length === 0) return { rows: [], page: q.page, pageSize: q.pageSize, total: 0 };
  }
  if (q.tagId) {
    const { data } = await c.from(CRM_TAG_ASSIGNMENTS).select("vendor_id").eq("tag_id", q.tagId).is("removed_at", null);
    const tagIds = (data ?? []).map((r: { vendor_id: string }) => r.vendor_id);
    crmIdFilter = crmIdFilter === null ? tagIds : crmIdFilter.filter((id) => tagIds.includes(id));
    if (crmIdFilter.length === 0) return { rows: [], page: q.page, pageSize: q.pageSize, total: 0 };
  }
  if (q.taskState) {
    let tq = c.from(CRM_TASKS).select("vendor_id").in("status", ["open", "in_progress"]);
    if (q.taskState === "overdue") tq = tq.lt("due_at", new Date().toISOString());
    const { data } = await tq;
    const taskIds = Array.from(new Set((data ?? []).map((r: { vendor_id: string }) => r.vendor_id)));
    crmIdFilter = crmIdFilter === null ? taskIds : crmIdFilter.filter((id) => taskIds.includes(id));
    if (crmIdFilter.length === 0) return { rows: [], page: q.page, pageSize: q.pageSize, total: 0 };
  }

  // 2. the Core vendor page (server-paged, deterministic sort, bounded).
  let vq = c.from("vendors")
    .select("id, business_name, owner_name, phone, city, service_categories, status, is_active, remaining_credits, total_credits, created_at", { count: "exact" });
  if (crmIdFilter) vq = vq.in("id", crmIdFilter);
  if (q.search) vq = vq.or(`business_name.ilike.%${q.search}%,owner_name.ilike.%${q.search}%,phone.ilike.%${q.search}%`);
  if (q.category) vq = vq.contains("service_categories", [q.category]);
  if (q.city) vq = vq.ilike("city", `%${q.city}%`);
  if (q.verification) vq = vq.eq("status", q.verification);
  if (q.enabled === "true") vq = vq.eq("is_active", true);
  if (q.enabled === "false") vq = vq.eq("is_active", false);
  const from = (q.page - 1) * q.pageSize;
  vq = vq.order("created_at", { ascending: false }).order("id", { ascending: true }).range(from, from + q.pageSize - 1);
  const { data: vendors, count, error } = await vq;
  if (error) throw new Error(`vendor directory read failed: ${error.message}`);
  const vRows = (vendors ?? []) as Record<string, unknown>[];
  const ids = vRows.map((v) => v.id as string);
  if (ids.length === 0) return { rows: [], page: q.page, pageSize: q.pageSize, total: count ?? 0 };

  // 3. batch-load CRM extensions for exactly this page's vendor ids (no N+1).
  const [{ data: profs }, { data: asgs }, { data: tasks }, { data: contacts }] = await Promise.all([
    c.from(CRM_PROFILES).select("vendor_id, onboarding_stage, relationship_status, next_follow_up_at, last_interaction_at").in("vendor_id", ids),
    c.from(CRM_TAG_ASSIGNMENTS).select("vendor_id, tag_id, vendor_tags(id, name, is_active)").in("vendor_id", ids).is("removed_at", null),
    c.from(CRM_TASKS).select("vendor_id, status, due_at").in("vendor_id", ids).in("status", ["open", "in_progress"]),
    c.from(CRM_CONTACTS).select("vendor_id, name").in("vendor_id", ids).eq("is_primary", true).eq("is_active", true),
  ]);
  const profById = new Map((profs ?? []).map((p: any) => [p.vendor_id, p]));
  const tagsById = new Map<string, { id: string; name: string }[]>();
  for (const a of (asgs ?? []) as any[]) {
    const tag = a.vendor_tags; if (!tag || tag.is_active === false) continue;
    const list = tagsById.get(a.vendor_id) ?? []; list.push({ id: tag.id, name: tag.name }); tagsById.set(a.vendor_id, list);
  }
  const now = Date.now();
  const openById = new Map<string, number>(); const overdueById = new Map<string, number>();
  for (const t of (tasks ?? []) as any[]) {
    openById.set(t.vendor_id, (openById.get(t.vendor_id) ?? 0) + 1);
    if (t.due_at && Date.parse(t.due_at) < now) overdueById.set(t.vendor_id, (overdueById.get(t.vendor_id) ?? 0) + 1);
  }
  const primaryById = new Map((contacts ?? []).map((c2: any) => [c2.vendor_id, c2.name]));

  const rows: VendorCrmDirectoryRow[] = vRows.map((v) => {
    const p: any = profById.get(v.id as string) ?? {};
    return {
      vendor_id: v.id as string,
      business_name: (v.business_name as string) ?? null,
      owner_name: (v.owner_name as string) ?? null,
      phone: (v.phone as string) ?? null,
      city: (v.city as string) ?? null,
      service_categories: (v.service_categories as string[]) ?? null,
      status: (v.status as string) ?? null,
      is_active: (v.is_active as boolean) ?? null,
      remaining_credits: (v.remaining_credits as number) ?? null,
      total_credits: (v.total_credits as number) ?? null,
      onboarding_stage: p.onboarding_stage ?? null,
      relationship_status: p.relationship_status ?? null,
      next_follow_up_at: p.next_follow_up_at ?? null,
      last_interaction_at: p.last_interaction_at ?? null,
      active_tags: tagsById.get(v.id as string) ?? [],
      open_task_count: openById.get(v.id as string) ?? 0,
      overdue_task_count: overdueById.get(v.id as string) ?? 0,
      primary_contact_name: primaryById.get(v.id as string) ?? null,
    };
  });
  return { rows, page: q.page, pageSize: q.pageSize, total: count ?? rows.length };
}

// -- reads --------------------------------------------------------------------
export async function getVendorCoreFacts(vendorId: string) {
  const id = requireUuid(vendorId, "vendorId");
  const { data } = await db().from("vendors")
    .select("id, business_name, owner_name, phone, email, city, areas_covered, covers_full_city, service_categories, status, is_active, total_credits, remaining_credits, last_assigned_at, created_at")
    .eq("id", id).maybeSingle();
  return data ?? null;
}
export async function getVendorCrmProfile(vendorId: string) {
  const id = requireUuid(vendorId, "vendorId");
  const { data } = await db().from(CRM_PROFILES).select("*").eq("vendor_id", id).maybeSingle();
  return data ?? null;
}
export async function listVendorContacts(vendorId: string) {
  const id = requireUuid(vendorId, "vendorId");
  const { data } = await db().from(CRM_CONTACTS).select("*").eq("vendor_id", id)
    .order("is_primary", { ascending: false }).order("created_at", { ascending: false });
  return data ?? [];
}
export async function listVendorTags() {
  const { data } = await db().from(CRM_TAGS).select("*").order("normalized_name", { ascending: true });
  return data ?? [];
}
export async function listVendorTagAssignments(vendorId: string) {
  const id = requireUuid(vendorId, "vendorId");
  const { data } = await db().from(CRM_TAG_ASSIGNMENTS).select("id, tag_id, assigned_at, removed_at, vendor_tags(id, name, is_active)")
    .eq("vendor_id", id).is("removed_at", null);
  return data ?? [];
}
export async function listVendorNotes(vendorId: string) {
  const id = requireUuid(vendorId, "vendorId");
  const { data } = await db().from(CRM_NOTES).select("id, note, category, created_at, created_by, supersedes_note_id")
    .eq("vendor_id", id).order("created_at", { ascending: false });
  return data ?? [];
}
export async function listVendorTasks(vendorId: string, filters?: { status?: string }) {
  const id = requireUuid(vendorId, "vendorId");
  let q = db().from(CRM_TASKS).select("*").eq("vendor_id", id);
  if (filters?.status) q = q.eq("status", filters.status);
  const { data } = await q.order("due_at", { ascending: true, nullsFirst: false }).order("created_at", { ascending: false });
  return data ?? [];
}

// -- mutations (actor always from the authorized session) ---------------------
export async function upsertVendorCrmProfile(vendorId: string, input: Record<string, unknown>, actor: Actor) {
  const id = requireUuid(vendorId, "vendorId");
  const v = validateCrmProfile(input);
  const exists = await getVendorCrmProfile(id);
  const base = { ...v, vendor_id: id, updated_by: actor };
  if (exists) {
    const { error } = await db().from(CRM_PROFILES).update(base).eq("vendor_id", id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await db().from(CRM_PROFILES).insert({ ...base, created_by: actor });
    if (error) throw new Error(error.message);
  }
  return { ok: true as const };
}
export async function createVendorContact(vendorId: string, input: Record<string, unknown>, actor: Actor) {
  const id = requireUuid(vendorId, "vendorId");
  const v = validateContact(input);
  const { data, error } = await db().from(CRM_CONTACTS).insert({ ...v, vendor_id: id, created_by: actor, updated_by: actor }).select("id").single();
  if (error) throw new Error(error.message);
  return { ok: true as const, id: data.id };
}
export async function updateVendorContact(contactId: string, input: Record<string, unknown>, actor: Actor) {
  const id = requireUuid(contactId, "contactId");
  const v = validateContact(input);
  const { error } = await db().from(CRM_CONTACTS).update({ ...v, updated_by: actor }).eq("id", id);
  if (error) throw new Error(error.message);
  return { ok: true as const };
}
/** ARCHIVE — never a hard delete. */
export async function archiveVendorContact(contactId: string, actor: Actor) {
  const id = requireUuid(contactId, "contactId");
  const { error } = await db().from(CRM_CONTACTS).update({ is_active: false, is_primary: false, updated_by: actor }).eq("id", id);
  if (error) throw new Error(error.message);
  return { ok: true as const };
}
export async function createVendorTag(input: Record<string, unknown>, actor: Actor) {
  const v = validateTag(input);
  const { data, error } = await db().from(CRM_TAGS).insert({ ...v, created_by: actor }).select("id").single();
  if (error) throw new Error(error.message);
  return { ok: true as const, id: data.id };
}
export async function updateVendorTag(tagId: string, input: Record<string, unknown>, actor: Actor) {
  const id = requireUuid(tagId, "tagId");
  const v = validateTag(input);
  const { error } = await db().from(CRM_TAGS).update({ name: v.name, normalized_name: v.normalized_name, description: v.description }).eq("id", id);
  if (error) throw new Error(error.message);
  return { ok: true as const };
}
/** ARCHIVE a tag definition — never a hard delete. */
export async function archiveVendorTag(tagId: string, _actor: Actor) {
  const id = requireUuid(tagId, "tagId");
  const { error } = await db().from(CRM_TAGS).update({ is_active: false }).eq("id", id);
  if (error) throw new Error(error.message);
  return { ok: true as const };
}
export async function assignVendorTag(vendorId: string, tagId: string, actor: Actor) {
  const vid = requireUuid(vendorId, "vendorId"); const tid = requireUuid(tagId, "tagId");
  // idempotent: an active assignment already satisfies the request.
  const { data: existing } = await db().from(CRM_TAG_ASSIGNMENTS).select("id").eq("vendor_id", vid).eq("tag_id", tid).is("removed_at", null).maybeSingle();
  if (existing) return { ok: true as const, id: existing.id };
  const { data, error } = await db().from(CRM_TAG_ASSIGNMENTS).insert({ vendor_id: vid, tag_id: tid, assigned_by: actor }).select("id").single();
  if (error) throw new Error(error.message);
  return { ok: true as const, id: data.id };
}
/** ARCHIVE the active assignment (removed_at) — never a hard delete. */
export async function removeVendorTag(vendorId: string, tagId: string, actor: Actor) {
  const vid = requireUuid(vendorId, "vendorId"); const tid = requireUuid(tagId, "tagId");
  const { error } = await db().from(CRM_TAG_ASSIGNMENTS).update({ removed_at: new Date().toISOString(), removed_by: actor })
    .eq("vendor_id", vid).eq("tag_id", tid).is("removed_at", null);
  if (error) throw new Error(error.message);
  return { ok: true as const };
}
/** Append-only: create only. There is intentionally NO note update or delete. */
export async function createVendorNote(vendorId: string, input: Record<string, unknown>, actor: Actor) {
  const id = requireUuid(vendorId, "vendorId");
  const v = validateNote(input);
  const { data, error } = await db().from(CRM_NOTES).insert({ ...v, vendor_id: id, created_by: actor }).select("id").single();
  if (error) throw new Error(error.message);
  return { ok: true as const, id: data.id };
}
export async function createVendorTask(vendorId: string, input: Record<string, unknown>, actor: Actor) {
  const id = requireUuid(vendorId, "vendorId");
  const v = validateTaskCreate(input);
  if (v.idempotency_key) {
    const { data: existing } = await db().from(CRM_TASKS).select("id").eq("idempotency_key", v.idempotency_key).maybeSingle();
    if (existing) return { ok: true as const, id: existing.id, idempotent: true };
  }
  const { data, error } = await db().from(CRM_TASKS)
    .insert({ ...v, vendor_id: id, source: "manual", status: "open", created_by: actor, updated_by: actor }).select("id").single();
  if (error) throw new Error(error.message);
  return { ok: true as const, id: data.id };
}
export async function updateVendorTask(taskId: string, input: Record<string, unknown>, actor: Actor) {
  const id = requireUuid(taskId, "taskId");
  const v = validateTaskUpdate(input);
  const { error } = await db().from(CRM_TASKS).update({ ...v, updated_by: actor }).eq("id", id);
  if (error) throw new Error(error.message);
  return { ok: true as const };
}
export async function completeVendorTask(taskId: string, completionResult: unknown, actor: Actor) {
  const id = requireUuid(taskId, "taskId");
  const result = requireCompletionResult(completionResult);
  const { error } = await db().from(CRM_TASKS)
    .update({ status: "done", completion_result: result, completed_at: new Date().toISOString(), updated_by: actor }).eq("id", id);
  if (error) throw new Error(error.message);
  return { ok: true as const };
}
/** CANCEL (archive) — never a hard delete. */
export async function cancelVendorTask(taskId: string, actor: Actor) {
  const id = requireUuid(taskId, "taskId");
  const { error } = await db().from(CRM_TASKS).update({ status: "cancelled", updated_by: actor }).eq("id", id);
  if (error) throw new Error(error.message);
  return { ok: true as const };
}
