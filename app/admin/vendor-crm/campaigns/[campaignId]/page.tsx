import { redirect, notFound } from "next/navigation";
import { getAdminSession } from "@/app/actions";
import {
  getVendorCampaign, getCampaignAudience, listCampaignEvents,
  listUsableSegments, listUsableTemplates,
} from "@/services/vendorCampaignService";
import { VendorCampaignEditor } from "@/components/admin/crm/campaigns/VendorCampaignEditor";
import { getHandoffReadiness, getCampaignIntentSummary } from "@/services/campaignHandoffService";
import { CampaignHandoffPanel } from "@/components/admin/crm/campaigns/CampaignHandoffPanel";

export const dynamic = "force-dynamic";

// Fixed administrator-facing text. A raw exception/database message is NEVER
// rendered: it can embed SQL, column names, row values or connection detail.
const CAMPAIGN_LOAD_ERROR =
  "This campaign could not be loaded. Please retry — if this persists, contact engineering.";

/** Server-side diagnostic. Logs the error CLASS only — never `message`, and
 *  never the campaign id. */
function logCampaignRouteFailure(scope: string, e: unknown) {
  const err = e as { name?: string; code?: string } | null;
  console.error("[campaign-route] load failed", {
    scope,
    name: err?.name ?? "Error",
    code: err?.code ?? "UNKNOWN",
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Admin-only campaign editor + frozen-audience review.
export default async function VendorCampaignEditorPage({ params }: { params: { campaignId: string } }) {
  const session = await getAdminSession();
  if (!session.isLoggedIn) redirect("/admin/login");
  if (!session.isSuperadmin) redirect("/admin/login?error=unauthorized");

  const campaignId = params.campaignId;
  const isNew = campaignId === "new";
  if (!isNew && !UUID_RE.test(campaignId)) notFound();

  let campaign = null;
  let audience = null;
  let events: unknown[] = [];
  let segments: unknown[] = [];
  let templates: unknown[] = [];
  // Handoff is a SEPARATE explicit step: approving a campaign never creates an
  // intent, so this data only drives a control the operator must still press.
  let readiness: unknown = null;
  let intents: unknown = null;
  let error: string | null = null;

  try {
    [segments, templates] = await Promise.all([listUsableSegments(), listUsableTemplates()]);
    if (!isNew) {
      campaign = await getVendorCampaign(campaignId);
      if (campaign) {
        events = await listCampaignEvents(campaignId);
        // the frozen audience is only readable once prepare has created it.
        if (campaign.prepared_snapshot_id) {
          audience = await getCampaignAudience(campaignId, campaign.prepared_snapshot_id, { page: 1 });
        }
        if (campaign.status === "approved") {
          [readiness, intents] = await Promise.all([
            getHandoffReadiness(campaignId),
            getCampaignIntentSummary(campaignId),
          ]);
        }
      }
    }
  } catch (e) {
    logCampaignRouteFailure("vendor-crm/campaigns/detail", e);
    error = CAMPAIGN_LOAD_ERROR;
  }
  if (!isNew && !error && !campaign) notFound();

  return (
    <>
      <VendorCampaignEditor
        campaignId={isNew ? null : campaignId}
        campaign={campaign}
        audience={audience}
        events={events as never[]}
        segments={segments as never[]}
        templates={templates as never[]}
        error={error}
      />
      {campaign && campaign.status === "approved" ? (
        <CampaignHandoffPanel
          campaignId={campaignId}
          revision={Number(campaign.revision)}
          readiness={readiness as never}
          intents={intents as never}
        />
      ) : null}
    </>
  );
}
