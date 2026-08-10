"use server";
// ============================================================================
// QF-MVP-30.2 — Vendor CRM server actions.
//
// Thin authorized wrappers over services/vendorCrmService. Every action:
//   1. requireCrmAdmin()  — server-only guard (founder/admin only);
//   2. derives the actor id from the authorized session (NEVER from input);
//   3. calls the server-only CRM service;
//   4. revalidates only the affected admin CRM paths;
//   5. returns a normalized Result — raw DB errors never reach the client.
// No service_role credential is ever returned to the browser.
// ============================================================================

import { revalidatePath } from "next/cache";
import { requireCrmAdmin } from "@/lib/crm/crmAuth";
import { fail, type Result } from "@/lib/errors";
import * as crm from "@/services/vendorCrmService";

const DIRECTORY_PATH = "/admin/vendor-crm";
function vendorPath(vendorId: string) { return `/admin/vendor-crm/${vendorId}`; }

async function run<T>(fn: (actorId: string) => Promise<T>, revalidate?: string[]): Promise<Result<T>> {
  try {
    const actor = await requireCrmAdmin();
    const data = await fn(actor.id);
    for (const p of revalidate ?? []) revalidatePath(p);
    return { ok: true, data };
  } catch (e) {
    return fail(e);
  }
}

// -- reads --------------------------------------------------------------------
export async function crmDirectory(query: Record<string, unknown>) {
  return run(() => crm.listVendorCrmDirectory(query ?? {}));
}

// -- profile ------------------------------------------------------------------
export async function crmUpsertProfile(vendorId: string, input: Record<string, unknown>) {
  return run((actor) => crm.upsertVendorCrmProfile(vendorId, input, actor), [vendorPath(vendorId), DIRECTORY_PATH]);
}

// -- contacts -----------------------------------------------------------------
export async function crmCreateContact(vendorId: string, input: Record<string, unknown>) {
  return run((actor) => crm.createVendorContact(vendorId, input, actor), [vendorPath(vendorId)]);
}
export async function crmUpdateContact(vendorId: string, contactId: string, input: Record<string, unknown>) {
  return run((actor) => crm.updateVendorContact(contactId, input, actor), [vendorPath(vendorId)]);
}
export async function crmArchiveContact(vendorId: string, contactId: string) {
  return run((actor) => crm.archiveVendorContact(contactId, actor), [vendorPath(vendorId)]);
}

// -- tags ---------------------------------------------------------------------
export async function crmCreateTag(input: Record<string, unknown>) {
  return run((actor) => crm.createVendorTag(input, actor), [DIRECTORY_PATH]);
}
export async function crmUpdateTag(tagId: string, input: Record<string, unknown>) {
  return run((actor) => crm.updateVendorTag(tagId, input, actor), [DIRECTORY_PATH]);
}
export async function crmArchiveTag(tagId: string) {
  return run((actor) => crm.archiveVendorTag(tagId, actor), [DIRECTORY_PATH]);
}
export async function crmAssignTag(vendorId: string, tagId: string) {
  return run((actor) => crm.assignVendorTag(vendorId, tagId, actor), [vendorPath(vendorId), DIRECTORY_PATH]);
}
export async function crmRemoveTag(vendorId: string, tagId: string) {
  return run((actor) => crm.removeVendorTag(vendorId, tagId, actor), [vendorPath(vendorId), DIRECTORY_PATH]);
}

// -- notes (append-only) ------------------------------------------------------
export async function crmCreateNote(vendorId: string, input: Record<string, unknown>) {
  return run((actor) => crm.createVendorNote(vendorId, input, actor), [vendorPath(vendorId)]);
}

// -- tasks --------------------------------------------------------------------
export async function crmCreateTask(vendorId: string, input: Record<string, unknown>) {
  return run((actor) => crm.createVendorTask(vendorId, input, actor), [vendorPath(vendorId), DIRECTORY_PATH]);
}
export async function crmUpdateTask(vendorId: string, taskId: string, input: Record<string, unknown>) {
  return run((actor) => crm.updateVendorTask(taskId, input, actor), [vendorPath(vendorId), DIRECTORY_PATH]);
}
export async function crmCompleteTask(vendorId: string, taskId: string, completionResult: string) {
  return run((actor) => crm.completeVendorTask(taskId, completionResult, actor), [vendorPath(vendorId), DIRECTORY_PATH]);
}
export async function crmCancelTask(vendorId: string, taskId: string) {
  return run((actor) => crm.cancelVendorTask(taskId, actor), [vendorPath(vendorId), DIRECTORY_PATH]);
}
