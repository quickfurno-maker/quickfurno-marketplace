// ============================================================================
// QF-MVP-30.2 — Vendor CRM input validation + normalization (pure, offline).
//
// Dependency-free (no zod). Validates and normalizes CRM inputs against the
// closed vocabularies in vendorCrmContracts.ts and the DB CHECK/uniqueness
// contracts from migration 20260723001100. NO DB access, NO Core-fact logic.
// Rejects unknown fields (mass-assignment defence). Actor identity is NEVER
// taken from these inputs — it comes from the authorized server session.
// ============================================================================

import {
  VENDOR_CRM_ONBOARDING_STAGES,
  VENDOR_CRM_RELATIONSHIP_STATUSES,
  VENDOR_CRM_RES_COM_SCOPES,
  VENDOR_CONTACT_CHANNELS,
  VENDOR_NOTE_CATEGORIES,
  VENDOR_TASK_TYPES,
  VENDOR_TASK_PRIORITIES,
  VENDOR_TASK_STATUSES,
  type VendorCrmOnboardingStage,
  type VendorCrmRelationshipStatus,
  type VendorTaskType,
  type VendorTaskPriority,
  type VendorTaskStatus,
} from "./vendorCrmContracts";

export class CrmValidationError extends Error {
  readonly code = "CRM_VALIDATION";
  constructor(message: string) {
    super(message);
    this.name = "CrmValidationError";
  }
}
const bad = (m: string): never => {
  throw new CrmValidationError(m);
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_TEXT = 2000;
const MAX_SHORT = 200;

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}
export function requireUuid(v: unknown, label: string): string {
  return isUuid(v) ? v : bad(`${label} must be a valid UUID`);
}
function optText(v: unknown, label: string, max = MAX_TEXT): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string") return bad(`${label} must be text`);
  const t = v.trim();
  if (t.length === 0) return null;
  if (t.length > max) return bad(`${label} is too long`);
  return t;
}
function reqText(v: unknown, label: string, max = MAX_SHORT): string {
  const t = optText(v, label, max);
  return t ?? bad(`${label} is required`);
}
function optInt(v: unknown, label: string, min = 0): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return bad(`${label} must be an integer`);
  if (n < min) return bad(`${label} must be >= ${min}`);
  return n;
}
function inSet<T extends readonly string[]>(v: unknown, set: T, label: string): T[number] {
  return typeof v === "string" && (set as readonly string[]).includes(v) ? (v as T[number]) : bad(`${label} is invalid`);
}
function optInSet<T extends readonly string[]>(v: unknown, set: T, label: string): T[number] | null {
  if (v === undefined || v === null || v === "") return null;
  return inSet(v, set, label);
}
function optStringArray(v: unknown, label: string, maxItems = 50): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) return bad(`${label} must be a list`);
  if (v.length > maxItems) return bad(`${label} has too many items`);
  return v.map((x, i) => reqText(x, `${label}[${i}]`, MAX_SHORT));
}
/** Reject any key not on the allow-list (mass-assignment defence). */
export function rejectUnknownKeys(input: Record<string, unknown>, allowed: readonly string[], label: string): void {
  for (const k of Object.keys(input ?? {})) {
    if (!allowed.includes(k)) bad(`${label}: unknown field "${k}"`);
  }
}

/** Hard cap on a directory search term, applied after normalization. */
export const CRM_SEARCH_MAX_LENGTH = 80;

/**
 * Normalize a directory search term so it can NEVER alter PostgREST filter
 * grammar or SQL LIKE semantics.
 *
 * The search feeds a PostgREST `or=(...)` expression, whose grammar is delimited
 * by commas, parentheses, dots and quotes; the `ilike` value is additionally a
 * SQL LIKE pattern in which `%` and `_` are wildcards. Rather than escape each of
 * those — which means stacking PostgREST string-quoting on top of SQL LIKE
 * escaping, and is easy to get subtly wrong — we allow-list the characters that
 * actually occur in business names, owner names and phone numbers and drop
 * everything else. Stripping is strictly stronger than escaping here: a
 * structural character cannot survive to be mis-escaped downstream.
 *
 * Kept:    Unicode letters/marks/digits (any script), space, ' - . + @ &
 * Dropped: , ( ) " \ % _ * and every control/format character.
 */
export function sanitizeDirectorySearch(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const stripped = raw
    .normalize("NFKC")
    .replace(/\p{C}/gu, " ")                      // control + format characters
    .replace(/[^\p{L}\p{M}\p{N} '\-.+@&]/gu, " ") // structural + wildcard characters
    .replace(/\s+/g, " ")
    .trim();
  if (stripped.length === 0) return null;
  const capped = stripped.slice(0, CRM_SEARCH_MAX_LENGTH).trim();
  return capped.length === 0 ? null : capped;
}

/** Deterministic tag normalization — the SERVER owns this, never the client.
 *  Mirrors the DB uniqueness intent (vendor_tags.normalized_name unique). */
export function normalizeTagName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}
/** Phone stored consistently with the DB uniqueness index lower(btrim(phone)). */
export function normalizePhone(phone: string | null): string | null {
  if (phone === null) return null;
  const t = phone.trim();
  return t.length === 0 ? null : t;
}

// -- CRM profile --------------------------------------------------------------
export interface VendorCrmProfileInput {
  onboarding_stage?: VendorCrmOnboardingStage;
  relationship_status?: VendorCrmRelationshipStatus;
  next_follow_up_at?: string | null;
  last_interaction_at?: string | null;
  inactive_reason?: string | null;
  company_type?: string | null;
  years_in_business?: number | null;
  team_size?: string | null;
  capability_notes?: string | null;
  residential_commercial_scope?: string | null;
  budget_band?: string | null;
  monthly_capacity_notes?: string | null;
  material_notes?: string | null;
  warranty_notes?: string | null;
  preferred_localities?: string[];
  excluded_localities?: string[];
  travel_radius_km?: number | null;
  campaign_notes?: string | null;
}
const PROFILE_KEYS = ["onboarding_stage", "relationship_status", "next_follow_up_at", "last_interaction_at",
  "inactive_reason", "company_type", "years_in_business", "team_size", "capability_notes",
  "residential_commercial_scope", "budget_band", "monthly_capacity_notes", "material_notes", "warranty_notes",
  "preferred_localities", "excluded_localities", "travel_radius_km", "campaign_notes"];
function optTimestamp(v: unknown, label: string): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string") return bad(`${label} must be a timestamp`);
  const d = Date.parse(v);
  return Number.isNaN(d) ? bad(`${label} is not a valid date`) : v;
}
export function validateCrmProfile(input: Record<string, unknown>): VendorCrmProfileInput {
  rejectUnknownKeys(input, PROFILE_KEYS, "profile");
  return {
    onboarding_stage: optInSet(input.onboarding_stage, VENDOR_CRM_ONBOARDING_STAGES, "onboarding_stage") ?? undefined,
    relationship_status: optInSet(input.relationship_status, VENDOR_CRM_RELATIONSHIP_STATUSES, "relationship_status") ?? undefined,
    next_follow_up_at: optTimestamp(input.next_follow_up_at, "next_follow_up_at"),
    last_interaction_at: optTimestamp(input.last_interaction_at, "last_interaction_at"),
    inactive_reason: optText(input.inactive_reason, "inactive_reason"),
    company_type: optText(input.company_type, "company_type", MAX_SHORT),
    years_in_business: optInt(input.years_in_business, "years_in_business"),
    team_size: optText(input.team_size, "team_size", MAX_SHORT),
    capability_notes: optText(input.capability_notes, "capability_notes"),
    residential_commercial_scope: optInSet(input.residential_commercial_scope, VENDOR_CRM_RES_COM_SCOPES, "residential_commercial_scope"),
    budget_band: optText(input.budget_band, "budget_band", MAX_SHORT),
    monthly_capacity_notes: optText(input.monthly_capacity_notes, "monthly_capacity_notes"),
    material_notes: optText(input.material_notes, "material_notes"),
    warranty_notes: optText(input.warranty_notes, "warranty_notes"),
    preferred_localities: optStringArray(input.preferred_localities, "preferred_localities"),
    excluded_localities: optStringArray(input.excluded_localities, "excluded_localities"),
    travel_radius_km: optInt(input.travel_radius_km, "travel_radius_km"),
    campaign_notes: optText(input.campaign_notes, "campaign_notes"),
  };
}

// -- contact ------------------------------------------------------------------
export interface VendorContactInput {
  name: string;
  role_title: string | null;
  phone: string | null;
  email: string | null;
  preferred_channel: string | null;
  is_primary: boolean;
  notes: string | null;
}
const CONTACT_KEYS = ["name", "role_title", "phone", "email", "preferred_channel", "is_primary", "notes"];
export function validateContact(input: Record<string, unknown>): VendorContactInput {
  rejectUnknownKeys(input, CONTACT_KEYS, "contact");
  const phone = normalizePhone(optText(input.phone, "phone", MAX_SHORT));
  const emailRaw = optText(input.email, "email", MAX_SHORT);
  const email = emailRaw && !EMAIL_RE.test(emailRaw) ? bad("email is not valid") : emailRaw;
  if (!phone && !email) bad("a contact needs at least a phone or an email");
  return {
    name: reqText(input.name, "name", MAX_SHORT),
    role_title: optText(input.role_title, "role_title", MAX_SHORT),
    phone,
    email,
    preferred_channel: optInSet(input.preferred_channel, VENDOR_CONTACT_CHANNELS, "preferred_channel"),
    is_primary: input.is_primary === true,
    notes: optText(input.notes, "notes"),
  };
}

// -- tag ----------------------------------------------------------------------
export interface VendorTagInput { name: string; normalized_name: string; description: string | null; }
const TAG_KEYS = ["name", "description"];
export function validateTag(input: Record<string, unknown>): VendorTagInput {
  rejectUnknownKeys(input, TAG_KEYS, "tag");
  const name = reqText(input.name, "name", MAX_SHORT);
  const normalized_name = normalizeTagName(name);
  if (normalized_name.length === 0) bad("tag name is empty after normalization");
  return { name, normalized_name, description: optText(input.description, "description") };
}

// -- note (append-only; no author from client) --------------------------------
export interface VendorNoteInput { note: string; category: string | null; supersedes_note_id: string | null; }
const NOTE_KEYS = ["note", "category", "supersedes_note_id"];
export function validateNote(input: Record<string, unknown>): VendorNoteInput {
  rejectUnknownKeys(input, NOTE_KEYS, "note");
  return {
    note: reqText(input.note, "note", MAX_TEXT),
    category: optInSet(input.category, VENDOR_NOTE_CATEGORIES, "category"),
    supersedes_note_id: input.supersedes_note_id ? requireUuid(input.supersedes_note_id, "supersedes_note_id") : null,
  };
}

// -- task ---------------------------------------------------------------------
export interface VendorTaskInput {
  task_type: VendorTaskType;
  title: string;
  description: string | null;
  priority: VendorTaskPriority;
  due_at: string | null;
  idempotency_key: string | null;
}
const TASK_CREATE_KEYS = ["task_type", "title", "description", "priority", "due_at", "idempotency_key"];
export function validateTaskCreate(input: Record<string, unknown>): VendorTaskInput {
  rejectUnknownKeys(input, TASK_CREATE_KEYS, "task");
  return {
    task_type: inSet(input.task_type, VENDOR_TASK_TYPES, "task_type"),
    title: reqText(input.title, "title", MAX_SHORT),
    description: optText(input.description, "description"),
    priority: optInSet(input.priority, VENDOR_TASK_PRIORITIES, "priority") ?? "medium",
    due_at: optTimestamp(input.due_at, "due_at"),
    idempotency_key: optText(input.idempotency_key, "idempotency_key", MAX_SHORT),
  };
}
export interface VendorTaskUpdateInput {
  task_type?: VendorTaskType;
  title?: string;
  description?: string | null;
  priority?: VendorTaskPriority;
  due_at?: string | null;
  status?: VendorTaskStatus;
}
const TASK_UPDATE_KEYS = ["task_type", "title", "description", "priority", "due_at", "status"];
export function validateTaskUpdate(input: Record<string, unknown>): VendorTaskUpdateInput {
  rejectUnknownKeys(input, TASK_UPDATE_KEYS, "task");
  const out: VendorTaskUpdateInput = {};
  if (input.task_type !== undefined) out.task_type = inSet(input.task_type, VENDOR_TASK_TYPES, "task_type");
  if (input.title !== undefined) out.title = reqText(input.title, "title", MAX_SHORT);
  if (input.description !== undefined) out.description = optText(input.description, "description");
  if (input.priority !== undefined) out.priority = inSet(input.priority, VENDOR_TASK_PRIORITIES, "priority");
  if (input.due_at !== undefined) out.due_at = optTimestamp(input.due_at, "due_at");
  if (input.status !== undefined) {
    const s = inSet(input.status, VENDOR_TASK_STATUSES, "status");
    if (s === "done") bad("use completeVendorTask to mark a task done");
    if (s === "cancelled") bad("use cancelVendorTask to cancel a task");
    out.status = s;
  }
  return out;
}
export function requireCompletionResult(v: unknown): string {
  return reqText(v, "completion_result", MAX_TEXT);
}

// -- directory query ----------------------------------------------------------
export const CRM_DIRECTORY_MAX_PAGE_SIZE = 100;
export const CRM_DIRECTORY_DEFAULT_PAGE_SIZE = 20; // C-PERF1 locked admin directory page size
export interface VendorCrmDirectoryQuery {
  page: number;
  pageSize: number;
  search: string | null;
  category: string | null;
  city: string | null;
  verification: string | null;
  enabled: string | null;
  onboarding_stage: VendorCrmOnboardingStage | null;
  relationship_status: VendorCrmRelationshipStatus | null;
  tagId: string | null;
  taskState: "open" | "overdue" | null;
}
export function validateDirectoryQuery(input: Record<string, unknown> = {}): VendorCrmDirectoryQuery {
  const page = Math.max(1, optInt(input.page, "page", 1) ?? 1);
  let pageSize = optInt(input.pageSize, "pageSize", 1) ?? CRM_DIRECTORY_DEFAULT_PAGE_SIZE;
  pageSize = Math.min(Math.max(pageSize, 1), CRM_DIRECTORY_MAX_PAGE_SIZE); // hard bound — never load-all
  return {
    page,
    pageSize,
    // sanitized, never raw: see sanitizeDirectorySearch.
    search: sanitizeDirectorySearch(input.search),
    category: optText(input.category, "category", MAX_SHORT),
    city: optText(input.city, "city", MAX_SHORT),
    verification: optText(input.verification, "verification", MAX_SHORT),
    enabled: optText(input.enabled, "enabled", MAX_SHORT),
    onboarding_stage: optInSet(input.onboarding_stage, VENDOR_CRM_ONBOARDING_STAGES, "onboarding_stage"),
    relationship_status: optInSet(input.relationship_status, VENDOR_CRM_RELATIONSHIP_STATUSES, "relationship_status"),
    tagId: input.tagId ? requireUuid(input.tagId, "tagId") : null,
    taskState: (input.taskState === "open" || input.taskState === "overdue") ? input.taskState : null,
  };
}
