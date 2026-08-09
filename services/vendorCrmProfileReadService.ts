// ============================================================================
// Admin Dashboard V2 C4 — bounded Vendor CRM profile child reads (SERVER ONLY).
//
// Kept separate from the foundation directory/write boundary so every profile
// child collection has an explicit, independently testable bounded contract.
// There are no mutations in this module and no browser import path.
// ============================================================================

import "server-only";
import { adminClient } from "../lib/supabase";
import {
  ADMIN_DIRECTORY_PAGE_SIZE,
  ADMIN_EMBEDDED_PANEL_LIMIT,
  boundPage,
  pageRange,
} from "../lib/adminPaging";
import { VENDOR_TASK_STATUSES, type VendorTaskStatus } from "../lib/crm/vendorCrmContracts";
import { requireUuid } from "../lib/crm/vendorCrmValidation";
import type {
  PagedResult,
  VendorContact,
  VendorCrmProfileSummary,
  VendorNote,
  VendorTask,
} from "../lib/crm/vendorCrmProfileTypes";

const CRM_NOTES = "vendor_internal_notes" as const;
const CRM_CONTACTS = "vendor_contacts" as const;
const CRM_TASKS = "vendor_tasks" as const;

function db() { return adminClient(); }

function assertCrmRead(error: { code?: string } | null, scope: string): void {
  if (!error) return;
  const safe = new Error(`Vendor CRM ${scope} read failed`);
  safe.name = "VendorCrmReadError";
  (safe as Error & { code?: string }).code = error.code ?? "CRM_READ_FAILED";
  throw safe;
}

/** Lightweight Overview read. Each child query returns only a count or a
 * bounded preview; it never materializes an entire child collection. */
export async function getVendorCrmProfileSummary(vendorId: string): Promise<VendorCrmProfileSummary> {
  const id = requireUuid(vendorId, "vendorId");
  const c = db();
  const now = new Date().toISOString();
  const [contacts, notes, openTasks, overdueTasks] = await Promise.all([
    c.from(CRM_CONTACTS)
      .select("id, vendor_id, name, role_title, phone, email, preferred_channel, is_primary, is_active, notes, created_at", { count: "exact" })
      .eq("vendor_id", id)
      .eq("is_active", true)
      .order("is_primary", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .limit(ADMIN_EMBEDDED_PANEL_LIMIT),
    c.from(CRM_NOTES)
      .select("id, note, category, created_at, created_by, supersedes_note_id", { count: "exact" })
      .eq("vendor_id", id)
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .limit(1),
    c.from(CRM_TASKS)
      .select("id", { count: "exact", head: true })
      .eq("vendor_id", id)
      .in("status", ["open", "in_progress"]),
    c.from(CRM_TASKS)
      .select("id", { count: "exact", head: true })
      .eq("vendor_id", id)
      .in("status", ["open", "in_progress"])
      .lt("due_at", now),
  ]);
  assertCrmRead(contacts.error, "contact summary");
  assertCrmRead(notes.error, "note summary");
  assertCrmRead(openTasks.error, "open task count");
  assertCrmRead(overdueTasks.error, "overdue task count");

  const contactRows = (contacts.data ?? []) as VendorContact[];
  const firstContact = contactRows[0] ?? null;
  const latest = ((notes.data ?? [])[0] as Omit<VendorNote, "author_name"> | undefined) ?? null;
  return {
    contacts_total: contacts.count ?? 0,
    notes_total: notes.count ?? 0,
    open_tasks: openTasks.count ?? 0,
    overdue_tasks: overdueTasks.count ?? 0,
    primary_contact: firstContact?.is_primary ? firstContact : null,
    latest_note: latest ? { ...latest, author_name: null } : null,
  };
}

export async function listVendorContactsPage(
  vendorId: string,
  rawQuery: { page?: unknown },
): Promise<PagedResult<VendorContact>> {
  const id = requireUuid(vendorId, "vendorId");
  const page = boundPage(rawQuery.page);
  const { from, to } = pageRange(page);
  const { data, count, error } = await db().from(CRM_CONTACTS)
    .select("id, vendor_id, name, role_title, phone, email, preferred_channel, is_primary, is_active, notes, created_at", { count: "exact" })
    .eq("vendor_id", id)
    .eq("is_active", true)
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: false })
    .order("id", { ascending: true })
    .range(from, to);
  assertCrmRead(error, "contacts page");
  return { rows: (data ?? []) as VendorContact[], page, pageSize: ADMIN_DIRECTORY_PAGE_SIZE, total: count ?? 0 };
}

export async function listVendorNotesPage(
  vendorId: string,
  rawQuery: { page?: unknown },
): Promise<PagedResult<VendorNote>> {
  const id = requireUuid(vendorId, "vendorId");
  const page = boundPage(rawQuery.page);
  const { from, to } = pageRange(page);
  const { data, count, error } = await db().from(CRM_NOTES)
    .select("id, note, category, created_at, created_by, supersedes_note_id", { count: "exact" })
    .eq("vendor_id", id)
    .order("created_at", { ascending: false })
    .order("id", { ascending: true })
    .range(from, to);
  assertCrmRead(error, "notes page");

  const rows = (data ?? []) as Array<Omit<VendorNote, "author_name">>;
  const authorIds = Array.from(new Set(rows.map((row) => row.created_by).filter((actor): actor is string => Boolean(actor))));
  const authorById = new Map<string, string>();
  if (authorIds.length > 0) {
    const authors = await db().from("profiles").select("id, full_name").in("id", authorIds);
    assertCrmRead(authors.error, "note authors");
    for (const author of (authors.data ?? []) as Array<{ id: string; full_name: string | null }>) {
      if (author.full_name) authorById.set(author.id, author.full_name);
    }
  }
  return {
    rows: rows.map((row) => ({ ...row, author_name: row.created_by ? authorById.get(row.created_by) ?? null : null })),
    page,
    pageSize: ADMIN_DIRECTORY_PAGE_SIZE,
    total: count ?? 0,
  };
}

export async function listVendorTasksPage(
  vendorId: string,
  rawQuery: { page?: unknown; status?: unknown },
): Promise<PagedResult<VendorTask>> {
  const id = requireUuid(vendorId, "vendorId");
  const page = boundPage(rawQuery.page);
  const status = typeof rawQuery.status === "string" && (VENDOR_TASK_STATUSES as readonly string[]).includes(rawQuery.status)
    ? rawQuery.status as VendorTaskStatus
    : undefined;
  const { from, to } = pageRange(page);
  let query = db().from(CRM_TASKS)
    .select("id, vendor_id, task_type, title, description, due_at, priority, status, completion_result, source, created_at, completed_at", { count: "exact" })
    .eq("vendor_id", id);
  if (status) query = query.eq("status", status);
  const { data, count, error } = await query
    .order("due_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false })
    .order("id", { ascending: true })
    .range(from, to);
  assertCrmRead(error, "tasks page");
  return { rows: (data ?? []) as VendorTask[], page, pageSize: ADMIN_DIRECTORY_PAGE_SIZE, total: count ?? 0 };
}
