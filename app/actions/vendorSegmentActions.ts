"use server";
// ============================================================================
// QF-MVP-30.3C — Vendor Segment server actions.
//
// Thin authorized wrappers over services/vendorSegmentService. Every action:
//   1. requireCrmAdmin()  — server-only guard (founder/admin only);
//   2. derives the actor id from the authorized session (NEVER from input);
//   3. calls the server-only segment service;
//   4. revalidates only the affected admin segment paths;
//   5. returns a normalized Result — raw DB errors never reach the client.
// No service_role credential is ever returned to the browser.
//
// There is intentionally NO delete action, NO campaign action, NO send/test-send
// action and NO consent/suppression action. A segment is a saved question.
// ============================================================================

import { revalidatePath } from "next/cache";
import { requireCrmAdmin } from "@/lib/crm/crmAuth";
import { fail, type Result } from "@/lib/errors";
import * as segments from "@/services/vendorSegmentService";

const LIST_PATH = "/admin/vendor-crm/segments";
function segmentPath(segmentId: string) { return `/admin/vendor-crm/segments/${segmentId}`; }

/** Normalizes an expected service error into safe admin-facing text. */
function normalize(e: unknown): Result<never> {
  if (e instanceof segments.SegmentServiceError) {
    return { ok: false, code: e.code, error: e.message };
  }
  if (e instanceof Error && e.name === "SegmentValidationError") {
    return { ok: false, code: "SEGMENT_VALIDATION", error: e.message };
  }
  return fail(e);
}

async function run<T>(fn: (actorId: string) => Promise<T>, revalidate?: string[]): Promise<Result<T>> {
  try {
    const actor = await requireCrmAdmin();
    const data = await fn(actor.id);
    for (const p of revalidate ?? []) revalidatePath(p);
    return { ok: true, data };
  } catch (e) {
    return normalize(e);
  }
}

// -- reads --------------------------------------------------------------------
export async function segmentList(query: Record<string, unknown>) {
  return run(() => segments.listVendorSegments(query ?? {}));
}
export async function segmentDetail(segmentId: string) {
  return run(() => segments.getVendorSegment(segmentId));
}

// -- lifecycle ----------------------------------------------------------------
export async function segmentCreate(input: Record<string, unknown>) {
  return run((actor) => segments.createVendorSegment(input, actor), [LIST_PATH]);
}
export async function segmentUpdate(segmentId: string, input: Record<string, unknown>) {
  return run((actor) => segments.updateVendorSegment(segmentId, input, actor),
    [segmentPath(segmentId), LIST_PATH]);
}
export async function segmentActivate(segmentId: string) {
  return run((actor) => segments.activateVendorSegment(segmentId, actor),
    [segmentPath(segmentId), LIST_PATH]);
}
export async function segmentArchive(segmentId: string) {
  return run((actor) => segments.archiveVendorSegment(segmentId, actor),
    [segmentPath(segmentId), LIST_PATH]);
}

// -- dynamic preview (evaluated at request time; nothing is persisted) --------
export async function segmentPreview(
  definition: unknown,
  paging: { page?: unknown; pageSize?: unknown },
  meta: { fingerprint?: string; definitionVersion?: number },
) {
  return run(() => segments.previewVendorSegment(definition, paging ?? {}, meta ?? {}));
}
