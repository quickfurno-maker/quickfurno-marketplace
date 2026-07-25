// ============================================================================
// QF-MVP-30.3C — Vendor Segment service boundary (SERVER ONLY).
//
// The single canonical read/write authority for deterministic segment
// DEFINITIONS. SERVER ONLY: imports `server-only` and the service_role
// adminClient — it must NEVER be imported by a client component.
//
// LOCKED INVARIANTS
//  * writes touch ONLY public.vendor_segments — never a Core table, never
//    another CRM table, never a membership/campaign/provider object;
//  * NO membership is persisted: a preview is evaluated at request time and
//    discarded. No vendor id is ever written back into vendor_segments;
//  * there is NO delete method — archive is a lifecycle change, and the DB
//    grant withholds DELETE/TRUNCATE from service_role anyway;
//  * canonical definition, fingerprint and version are computed SERVER-SIDE
//    from the locked parser; a client-supplied fingerprint or version is
//    ignored entirely;
//  * definition_version increments ONLY when the canonical fingerprint changes —
//    a metadata-only edit never burns a version;
//  * every column name in a preview filter comes from the closed registry, and
//    every literal is enum-bound/uuid/integer/ISO — no raw user text;
//  * a segment is a saved question. Nothing here authorizes communication.
// ============================================================================

import "server-only";
import { adminClient } from "../lib/supabase";
import {
  normalizeSegmentDefinition, validateSegmentMeta, normalizeSegmentNameKey,
} from "../lib/crm/segmentRuleValidation";
import {
  planSegmentQuery, boundPreviewPaging, SEGMENT_PRERESOLVE_MAX, SegmentPlanError,
  type SegmentPreResolution,
} from "../lib/crm/segmentQueryPlan";
import { SEGMENT_SCHEMA_VERSION } from "../lib/crm/segmentRuleContracts";

const SEGMENTS = "vendor_segments" as const;

type Actor = string;
function db() { return adminClient(); }

/** Raised for expected, admin-facing conditions. Never carries a DB message. */
export class SegmentServiceError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "SegmentServiceError";
  }
}

export interface VendorSegmentRow {
  id: string;
  name: string;
  description: string | null;
  status: "draft" | "active" | "archived";
  schema_version: number;
  definition: unknown;
  definition_version: number;
  definition_fingerprint: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  created_by: string | null;
  updated_by: string | null;
}

export interface VendorSegmentListResult {
  rows: VendorSegmentRow[];
  page: number;
  pageSize: number;
  total: number;
}

const LIST_MAX_PAGE_SIZE = 100;
const LIST_DEFAULT_PAGE_SIZE = 25;

/** Bounded, deterministically ordered segment directory. */
export async function listVendorSegments(rawQuery: Record<string, unknown> = {}): Promise<VendorSegmentListResult> {
  const pageRaw = Number(rawQuery.page);
  const sizeRaw = Number(rawQuery.pageSize);
  const page = Number.isInteger(pageRaw) && pageRaw >= 1 ? pageRaw : 1;
  const pageSize = Number.isInteger(sizeRaw) && sizeRaw >= 1
    ? Math.min(sizeRaw, LIST_MAX_PAGE_SIZE) : LIST_DEFAULT_PAGE_SIZE;

  let q = db().from(SEGMENTS).select("*", { count: "exact" });
  const status = rawQuery.status;
  if (status === "draft" || status === "active" || status === "archived") {
    q = q.eq("status", status);
  }
  const from = (page - 1) * pageSize;
  // deterministic order with an id tie-breaker so paging is stable.
  q = q.order("updated_at", { ascending: false }).order("id", { ascending: true })
       .range(from, from + pageSize - 1);

  const { data, count, error } = await q;
  if (error) throw new SegmentServiceError("SEGMENT_READ_FAILED", "The segment list could not be loaded.");
  return { rows: (data ?? []) as VendorSegmentRow[], page, pageSize, total: count ?? 0 };
}

export async function getVendorSegment(segmentId: string): Promise<VendorSegmentRow | null> {
  const id = requireUuid(segmentId);
  const { data, error } = await db().from(SEGMENTS).select("*").eq("id", id).maybeSingle();
  if (error) throw new SegmentServiceError("SEGMENT_READ_FAILED", "The segment could not be loaded.");
  return (data as VendorSegmentRow) ?? null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function requireUuid(v: unknown): string {
  if (typeof v !== "string" || !UUID_RE.test(v)) {
    throw new SegmentServiceError("SEGMENT_NOT_FOUND", "That segment could not be found.");
  }
  return v;
}

/** Bound on any helper read, so nothing materializes an unbounded set in memory. */
const HELPER_SCAN_LIMIT = 500;

/** Postgres unique_violation — the DB index is the AUTHORITATIVE name guard. */
const UNIQUE_VIOLATION = "23505";
function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === UNIQUE_VIOLATION;
}

/**
 * Friendly pre-check for a duplicate live name.
 *
 * This is advisory ONLY. `uq_vendor_segments_live_name` is the real guard: a
 * read-then-write check is inherently racy, so every write path also maps a
 * 23505 unique violation to the same admin-facing message.
 */
async function liveNameTaken(name: string, exceptId?: string): Promise<boolean> {
  const { data, error } = await db().from(SEGMENTS)
    .select("id, name").neq("status", "archived").limit(HELPER_SCAN_LIMIT);
  if (error) throw new SegmentServiceError("SEGMENT_READ_FAILED", "The segment list could not be checked.");
  const key = normalizeSegmentNameKey(name);
  return (data ?? []).some((r: { id: string; name: string }) =>
    normalizeSegmentNameKey(r.name) === key && r.id !== exceptId);
}

/** Other live segments sharing this exact canonical definition (surfaced, not blocked). */
export async function findDuplicateDefinition(fingerprint: string, exceptId?: string): Promise<{ id: string; name: string }[]> {
  const { data } = await db().from(SEGMENTS)
    .select("id, name").eq("definition_fingerprint", fingerprint)
    .neq("status", "archived").limit(HELPER_SCAN_LIMIT);
  return (data ?? []).filter((r: { id: string }) => r.id !== exceptId) as { id: string; name: string }[];
}

export async function createVendorSegment(input: Record<string, unknown>, actor: Actor) {
  const meta = validateSegmentMeta({
    name: input.name, description: input.description, status: "draft",
  } as Record<string, unknown>);
  const normalized = normalizeSegmentDefinition(input.definition);

  if (await liveNameTaken(meta.name)) {
    throw new SegmentServiceError("SEGMENT_NAME_TAKEN", "A live segment with that name already exists.");
  }
  const { data, error } = await db().from(SEGMENTS).insert({
    name: meta.name,
    description: meta.description,
    status: "draft",
    schema_version: SEGMENT_SCHEMA_VERSION,
    definition: normalized.definition,
    definition_version: 1,
    definition_fingerprint: normalized.fingerprint,
    created_by: actor,
    updated_by: actor,
  }).select("id").single();
  if (isUniqueViolation(error)) {
    throw new SegmentServiceError("SEGMENT_NAME_TAKEN", "A live segment with that name already exists.");
  }
  if (error) throw new SegmentServiceError("SEGMENT_WRITE_FAILED", "The segment could not be saved.");

  const duplicates = await findDuplicateDefinition(normalized.fingerprint, data.id);
  return { ok: true as const, id: data.id, fingerprint: normalized.fingerprint, duplicates };
}

/**
 * Update name/description and/or definition.
 * definition_version increments ONLY when the canonical fingerprint changes.
 */
export async function updateVendorSegment(segmentId: string, input: Record<string, unknown>, actor: Actor) {
  const id = requireUuid(segmentId);
  const current = await getVendorSegment(id);
  if (!current) throw new SegmentServiceError("SEGMENT_NOT_FOUND", "That segment could not be found.");
  if (current.status === "archived") {
    throw new SegmentServiceError("SEGMENT_ARCHIVED", "An archived segment cannot be edited.");
  }

  const meta = validateSegmentMeta({
    name: input.name ?? current.name,
    description: input.description ?? current.description,
    status: current.status,
  } as Record<string, unknown>);

  const patch: Record<string, unknown> = {
    name: meta.name, description: meta.description, updated_by: actor,
  };

  let fingerprint = current.definition_fingerprint;
  let duplicates: { id: string; name: string }[] = [];
  if (input.definition !== undefined) {
    const normalized = normalizeSegmentDefinition(input.definition);
    fingerprint = normalized.fingerprint;
    if (normalized.fingerprint !== current.definition_fingerprint) {
      // a MEANINGFUL change: new canonical form => next version.
      patch.definition = normalized.definition;
      patch.definition_fingerprint = normalized.fingerprint;
      patch.definition_version = current.definition_version + 1;
    }
    // identical canonical form => metadata-only edit, version untouched.
    duplicates = await findDuplicateDefinition(normalized.fingerprint, id);
  }

  if (meta.name !== current.name && await liveNameTaken(meta.name, id)) {
    throw new SegmentServiceError("SEGMENT_NAME_TAKEN", "A live segment with that name already exists.");
  }

  const { error } = await db().from(SEGMENTS).update(patch).eq("id", id);
  if (isUniqueViolation(error)) {
    throw new SegmentServiceError("SEGMENT_NAME_TAKEN", "A live segment with that name already exists.");
  }
  if (error) throw new SegmentServiceError("SEGMENT_WRITE_FAILED", "The segment could not be saved.");
  return { ok: true as const, fingerprint, duplicates, versionBumped: patch.definition_version !== undefined };
}

/** Activate — only a segment whose stored definition still parses may go live. */
export async function activateVendorSegment(segmentId: string, actor: Actor) {
  const id = requireUuid(segmentId);
  const current = await getVendorSegment(id);
  if (!current) throw new SegmentServiceError("SEGMENT_NOT_FOUND", "That segment could not be found.");
  if (current.status === "archived") {
    throw new SegmentServiceError("SEGMENT_ARCHIVED", "An archived segment cannot be activated.");
  }
  // re-validate the stored definition; never trust a stored blob blindly.
  const normalized = normalizeSegmentDefinition(current.definition);
  if (normalized.fingerprint !== current.definition_fingerprint) {
    throw new SegmentServiceError("SEGMENT_DEFINITION_DRIFT",
      "This segment's stored rule no longer matches its fingerprint and cannot be activated.");
  }
  const { error } = await db().from(SEGMENTS)
    .update({ status: "active", updated_by: actor }).eq("id", id);
  if (error) throw new SegmentServiceError("SEGMENT_WRITE_FAILED", "The segment could not be activated.");
  return { ok: true as const };
}

/** ARCHIVE — a lifecycle change. There is intentionally NO delete method. */
export async function archiveVendorSegment(segmentId: string, actor: Actor) {
  const id = requireUuid(segmentId);
  const current = await getVendorSegment(id);
  if (!current) throw new SegmentServiceError("SEGMENT_NOT_FOUND", "That segment could not be found.");
  const { error } = await db().from(SEGMENTS).update({
    status: "archived", archived_at: new Date().toISOString(), archived_by: actor, updated_by: actor,
  }).eq("id", id);
  if (error) throw new SegmentServiceError("SEGMENT_WRITE_FAILED", "The segment could not be archived.");
  return { ok: true as const };
}

// -- dynamic evaluation -------------------------------------------------------

export interface SegmentPreviewVendor {
  vendor_id: string;
  business_name: string | null;
  city: string | null;
  status: string | null;
  is_active: boolean | null;
}
export interface SegmentPreviewResult {
  rows: SegmentPreviewVendor[];
  total: number;
  page: number;
  pageSize: number;
  evaluatedAt: string;
  fingerprint: string;
  definitionVersion: number;
}

/** Execute ONE batched query per distinct CRM pre-resolution. Never per vendor. */
async function runPreResolution(pre: SegmentPreResolution): Promise<string[]> {
  const c = db();
  let q = c.from(pre.relation).select("vendor_id");

  switch (pre.mode) {
    case "eq": q = q.eq(pre.column, pre.value as string); break;
    case "in": q = q.in(pre.column, pre.value as string[]); break;
    case "not_null": q = q.not(pre.column, "is", null); break;
    case "is_null": q = q.is(pre.column, null); break;
    case "lt": q = q.lt(pre.column, pre.value as number); break;
    case "lte": q = q.lte(pre.column, pre.value as number); break;
    case "gt": q = q.gt(pre.column, pre.value as number); break;
    case "gte": q = q.gte(pre.column, pre.value as number); break;
    case "between": {
      const [lo, hi] = pre.value as number[];
      q = q.gte(pre.column, lo).lte(pre.column, hi); break;
    }
    case "before": q = q.lt(pre.column, pre.value as string); break;
    case "after": q = q.gte(pre.column, pre.value as string); break;
    case "active_tag":
      q = q.is("removed_at", null);
      if (Array.isArray(pre.value)) q = q.in("tag_id", pre.value as string[]);
      else if (pre.value !== undefined) q = q.eq("tag_id", pre.value as string);
      break;
    case "open_task": q = q.in("status", ["open", "in_progress"]); break;
    case "overdue_task":
      q = q.in("status", ["open", "in_progress"]).lt("due_at", new Date().toISOString()); break;
    case "active_primary_contact": q = q.eq("is_primary", true).eq("is_active", true); break;
    default: throw new SegmentServiceError("SEGMENT_PLAN_FAILED", "This segment rule could not be evaluated.");
  }

  // bounded: never materialize an unbounded id set in memory.
  const { data, error } = await q.limit(SEGMENT_PRERESOLVE_MAX + 1);
  if (error) throw new SegmentServiceError("SEGMENT_PLAN_FAILED", "This segment rule could not be evaluated.");
  const ids = Array.from(new Set((data ?? []).map((r: { vendor_id: string }) => r.vendor_id)));
  if (ids.length > SEGMENT_PRERESOLVE_MAX) {
    throw new SegmentServiceError("SEGMENT_TOO_BROAD",
      "This segment matches too many vendors to preview. Narrow the rule and try again.");
  }
  return ids.sort();
}

/**
 * Evaluate a segment definition against CURRENT Core/CRM facts.
 * Count and rows come from the SAME query and the SAME canonical definition, so
 * they can never disagree. Nothing is persisted.
 */
export async function previewVendorSegment(
  definition: unknown,
  paging: { page?: unknown; pageSize?: unknown } = {},
  meta: { fingerprint?: string; definitionVersion?: number } = {},
): Promise<SegmentPreviewResult> {
  const normalized = normalizeSegmentDefinition(definition);
  // ONE instant for the whole preview — never a per-predicate now().
  const evaluatedAt = new Date();
  const { page, pageSize } = boundPreviewPaging(paging.page, paging.pageSize);

  let plan;
  try {
    plan = planSegmentQuery(normalized.definition, evaluatedAt);
  } catch (e) {
    if (e instanceof SegmentPlanError) throw new SegmentServiceError("SEGMENT_PLAN_FAILED", "This segment rule could not be evaluated.");
    throw e;
  }

  const resolved = new Map<string, readonly string[]>();
  for (const pre of plan.preResolutions) {
    resolved.set(pre.key, await runPreResolution(pre));
  }

  let expression: string;
  try {
    expression = plan.buildExpression(resolved);
  } catch (e) {
    if (e instanceof SegmentPlanError) {
      throw new SegmentServiceError("SEGMENT_TOO_BROAD",
        "This segment matches too many vendors to preview. Narrow the rule and try again.");
    }
    throw e;
  }

  const from = (page - 1) * pageSize;
  const { data, count, error } = await db().from("vendors")
    // minimum admin-safe identity/context only — no PII beyond the business name.
    .select("id, business_name, city, status, is_active", { count: "exact" })
    .or(expression)
    .order("created_at", { ascending: false })
    .order("id", { ascending: true })
    .range(from, from + pageSize - 1);
  if (error) throw new SegmentServiceError("SEGMENT_PLAN_FAILED", "This segment rule could not be evaluated.");

  return {
    rows: (data ?? []).map((v: Record<string, unknown>) => ({
      vendor_id: v.id as string,
      business_name: (v.business_name as string) ?? null,
      city: (v.city as string) ?? null,
      status: (v.status as string) ?? null,
      is_active: (v.is_active as boolean) ?? null,
    })),
    total: count ?? 0,
    page,
    pageSize,
    evaluatedAt: evaluatedAt.toISOString(),
    fingerprint: meta.fingerprint ?? normalized.fingerprint,
    definitionVersion: meta.definitionVersion ?? 0,
  };
}
