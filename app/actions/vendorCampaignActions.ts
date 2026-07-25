"use server";
// ============================================================================
// QF-MVP-30.4C — Vendor Campaign server actions.
//
// Thin authorized wrappers over services/vendorCampaignService. Every action:
//   1. requireCrmAdmin()  — server-only guard (founder/admin only);
//   2. derives the actor id from the authorized session (NEVER from input);
//   3. calls the server-only campaign service;
//   4. revalidates only the affected admin campaign paths;
//   5. returns a normalized Result — a raw DB error never reaches the client.
// No service_role credential is ever returned to the browser.
//
// There is intentionally NO delete action, NO send / dispatch / test-send action,
// NO provider action and NO consent/suppression write action. Approving a
// campaign authorises an already-frozen audience; it does not send anything, and
// no campaign may send at all until the QF-MVP-30.5 fail-closed frequency gate
// exists.
// ============================================================================

import { revalidatePath } from "next/cache";
import { requireCrmAdmin } from "@/lib/crm/crmAuth";
import { fail, type Result } from "@/lib/errors";
import * as campaigns from "@/services/vendorCampaignService";

const LIST_PATH = "/admin/vendor-crm/campaigns";
function campaignPath(campaignId: string) { return `/admin/vendor-crm/campaigns/${campaignId}`; }

/** Normalizes an expected service error into safe admin-facing text. */
function normalize(e: unknown): Result<never> {
  if (e instanceof campaigns.CampaignServiceError) {
    return { ok: false, code: e.code, error: e.message };
  }
  if (e instanceof Error && e.name === "CampaignValidationError") {
    return { ok: false, code: "CAMPAIGN_VALIDATION", error: e.message };
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

/** An expected revision always comes from the loaded row the admin acted on. */
function asRevision(v: unknown): number {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 ? n : -1;
}

// -- reads --------------------------------------------------------------------
export async function campaignList(query: Record<string, unknown>) {
  return run(() => campaigns.listVendorCampaigns(query ?? {}));
}
export async function campaignDetail(campaignId: string) {
  return run(() => campaigns.getVendorCampaign(campaignId));
}
export async function campaignAudience(campaignId: string, snapshotId: string, paging: { page?: unknown }) {
  return run(() => campaigns.getCampaignAudience(campaignId, snapshotId, paging ?? {}));
}
export async function campaignEvents(campaignId: string) {
  return run(() => campaigns.listCampaignEvents(campaignId));
}
export async function campaignPickerOptions() {
  return run(async () => ({
    segments: await campaigns.listUsableSegments(),
    templates: await campaigns.listUsableTemplates(),
  }));
}

// -- draft lifecycle ----------------------------------------------------------
export async function campaignCreate(input: Record<string, unknown>) {
  return run((actor) => campaigns.createVendorCampaign(input ?? {}, actor), [LIST_PATH]);
}
export async function campaignUpdate(campaignId: string, input: Record<string, unknown>, expectedRevision: unknown) {
  return run((actor) => campaigns.updateVendorCampaign(campaignId, input ?? {}, asRevision(expectedRevision), actor),
    [campaignPath(campaignId), LIST_PATH]);
}
export async function campaignReturnToDraft(campaignId: string, expectedRevision: unknown) {
  return run((actor) => campaigns.returnCampaignToDraft(campaignId, asRevision(expectedRevision), actor),
    [campaignPath(campaignId), LIST_PATH]);
}
export async function campaignCancel(campaignId: string, expectedRevision: unknown) {
  return run((actor) => campaigns.cancelVendorCampaign(campaignId, asRevision(expectedRevision), actor),
    [campaignPath(campaignId), LIST_PATH]);
}
export async function campaignArchive(campaignId: string, expectedRevision: unknown) {
  return run((actor) => campaigns.archiveVendorCampaign(campaignId, asRevision(expectedRevision), actor),
    [campaignPath(campaignId), LIST_PATH]);
}

// -- dynamic candidate preview (evaluated now; nothing is persisted) ----------
export async function campaignPreview(campaignId: string, paging: { page?: unknown }) {
  return run(() => campaigns.previewCampaignCandidates(campaignId, paging ?? {}));
}

// -- freeze + approval --------------------------------------------------------
/** Freezes the audience and moves draft -> ready_for_review. It does not send. */
export async function campaignPrepare(campaignId: string, expectedRevision: unknown) {
  return run((actor) => campaigns.prepareCampaignForReview(campaignId, asRevision(expectedRevision), actor),
    [campaignPath(campaignId), LIST_PATH]);
}
/** Authorises an already-frozen audience. It does not send. */
export async function campaignApprove(campaignId: string, expectedRevision: unknown) {
  return run((actor) => campaigns.approveVendorCampaign(campaignId, asRevision(expectedRevision), actor),
    [campaignPath(campaignId), LIST_PATH]);
}
