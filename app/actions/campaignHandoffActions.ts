"use server";
// ============================================================================
// QF-MVP-30.5C1 — Campaign handoff + frequency policy server actions.
//
// Thin authorized wrappers, following the QF-MVP-30.4C convention exactly:
//   1. requireCrmAdmin()  — the strongest existing privileged boundary
//      (canonical profiles.role = 'admin' AND server-owned
//      app_metadata.admin_role = 'Superadmin'). No new role is invented.
//   2. the actor id is derived from the authorized session, NEVER from input;
//   3. the server-only service is called;
//   4. only the affected admin paths are revalidated;
//   5. a normalized Result is returned — a raw database error never reaches
//      the browser, and no service_role credential ever does.
//
// A vendor, a client and an ordinary authenticated user all fail at step 1.
//
// There is intentionally NO send / dispatch / test-send action, NO provider
// action, NO intent status override, NO policy edit action and NO policy delete
// action. Handing off creates provider-neutral intents; it does not send.
// ============================================================================

import { revalidatePath } from "next/cache";
import { requireCrmAdmin } from "@/lib/crm/crmAuth";
import { fail, type Result } from "@/lib/errors";
import * as handoff from "@/services/campaignHandoffService";
import * as results from "@/services/campaignCommunicationResultService";
import * as policies from "@/services/communicationFrequencyPolicyService";

const CAMPAIGN_LIST_PATH = "/admin/vendor-crm/campaigns";
const POLICY_PATH = "/admin/vendor-crm/frequency-policies";
function campaignPath(campaignId: string) { return `${CAMPAIGN_LIST_PATH}/${campaignId}`; }

/** Normalizes an expected service error into safe admin-facing text. */
function normalize(e: unknown): Result<never> {
  if (e instanceof handoff.HandoffServiceError) return { ok: false, code: e.code, error: e.message };
  if (e instanceof policies.FrequencyPolicyServiceError) {
    return { ok: false, code: e.code, error: e.message };
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

// -- campaign handoff --------------------------------------------------------

/** Read-only readiness: status, frozen audience size and whether an ACTIVE
 *  policy exists. Used to render a fail-closed control before any write. */
export async function campaignHandoffReadiness(campaignId: string) {
  return run(() => handoff.getHandoffReadiness(String(campaignId)));
}

export async function campaignIntentSummary(campaignId: string) {
  return run(() => handoff.getCampaignIntentSummary(String(campaignId)));
}

/**
 * QF-MVP-40.8 — the richer read-only campaign result projection: intent statuses
 * PLUS the canonical communication-message lifecycle behind them, so delivered and
 * read stay distinguishable and uncertain outcomes stay visible instead of being
 * collapsed into failure.
 *
 * Read-only and aggregate-only. It exposes no `recipient_ref`, destination, phone,
 * email, message body or provider payload, and there is deliberately still NO
 * status-override, retry or send action here — reconciliation derives the intent
 * status from the canonical message, and QF-MVP-70 owns operations controls.
 */
export async function campaignResultProjection(campaignId: string) {
  return run(() => results.getCampaignResultProjection(String(campaignId)));
}

/**
 * Create provider-neutral communication intents for an APPROVED campaign.
 * This is an EXPLICIT operator action — approval never triggers it.
 */
export async function campaignHandoff(
  campaignId: string,
  expectedRevision: unknown,
  options: { batchLimit?: unknown } = {},
) {
  const id = String(campaignId);
  return run(
    (actorId) => handoff.handoffCampaignIntents(id, asRevision(expectedRevision), actorId, {
      batchLimit: options?.batchLimit ?? handoff.HANDOFF_BATCH_DEFAULT,
    }),
    [campaignPath(id), CAMPAIGN_LIST_PATH],
  );
}

// -- frequency policy history ------------------------------------------------

export async function frequencyPolicyList() {
  return run(() => policies.listFrequencyPolicies());
}

/** Publish a NEW explicit policy version. Every value must come from the
 *  operator — this action supplies no default of any kind. */
export async function frequencyPolicyCreate(input: Record<string, unknown>) {
  return run(
    (actorId) => policies.createFrequencyPolicy({
      channel: input?.channel,
      scope: input?.scope,
      maxPerWindow: input?.maxPerWindow,
      windowHours: input?.windowHours,
      minIntervalHours: input?.minIntervalHours,
      policyReference: input?.policyReference,
      effectiveFrom: input?.effectiveFrom,
      effectiveTo: input?.effectiveTo,
    }, actorId),
    [POLICY_PATH],
  );
}

/** Retire an ACTIVE policy. The only transition the database permits; there is
 *  no reactivate and no delete. */
export async function frequencyPolicyRetire(policyId: string) {
  return run(() => policies.retireFrequencyPolicy(String(policyId)), [POLICY_PATH]);
}
