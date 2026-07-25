"use client";
// ============================================================================
// QF-MVP-30.4C — campaign editor + frozen-audience review (admin-only).
//
// Every choice comes from a CLOSED vocabulary: purpose, channel and consent
// scope from the locked contracts, segment and template from server-provided
// lists. There is no free-form field, no destination input and no message body
// — a template is PINNED by key/version, never rendered or edited here.
//
// The server result is authoritative for every action: the service re-validates
// the draft, re-resolves the audience through the consent authority, and the
// prepare/approve RPCs re-check the evidence under a row lock.
//
// There is NO send control, NO test-send control, NO provider control and NO
// delete control. Approval authorises an already-frozen audience for later
// execution; nothing here dispatches anything, and no campaign may send until
// QF-MVP-30.5 adds a fail-closed frequency gate.
// ============================================================================

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  PageHeader, SectionCard, InfoGrid, DataTable, StatusBadge,
  PrimaryButton, SecondaryButton, EmptyState,
} from "../../AdminPrimitives";
import {
  CAMPAIGN_PURPOSES, CAMPAIGN_CONSENT_SCOPES, CAMPAIGN_CHANNELS,
  CAMPAIGN_MAX_NAME_LENGTH, CAMPAIGN_MAX_DESCRIPTION_LENGTH,
} from "@/lib/crm/campaignContracts";
import {
  campaignCreate, campaignUpdate, campaignPrepare, campaignApprove,
  campaignReturnToDraft, campaignCancel, campaignArchive, campaignPreview,
} from "@/app/actions/vendorCampaignActions";

interface SegmentOption {
  id: string; name: string; status: string;
  definition_version: number; definition_fingerprint: string;
}
interface TemplateOption {
  template_key: string; version: string; category: string;
  readiness_status: string; channel: string | null;
}
interface CampaignShape {
  id: string; name: string; description: string | null; purpose: string;
  channel: string; consent_scope: string; status: string; revision: number;
  segment_id: string | null; template_key: string | null; template_version: string | null;
  prepared_snapshot_id: string | null; prepared_snapshot_revision: number | null;
  prepared_segment_version: number | null; prepared_segment_fingerprint: string | null;
  prepared_template_version: string | null; prepared_template_category: string | null;
  audience_evaluated_at: string | null; prepared_recipient_count: number | null;
  snapshot_fingerprint: string | null; exclusion_summary: Record<string, number>;
  created_at: string; updated_at: string; approved_at: string | null;
}
interface AudienceMember {
  vendor_id: string; ordinal: number; business_name: string | null;
  consent_disposition: string; consent_reason_code: string;
  consent_policy_version: string; suppression_reason: string;
}
interface CampaignEvent {
  id: string; event_type: string; campaign_revision: number;
  snapshot_revision: number | null; reason_code: string | null; occurred_at: string;
}

const EXCLUSION_LABEL: Record<string, string> = {
  consent_blocked: "Consent blocked",
  suppressed: "Suppressed",
  vendor_disabled: "Vendor disabled",
  vendor_unverified: "Vendor not verified",
  missing_contact_channel: "No usable contact channel",
  duplicate: "Duplicate candidate",
};

export function VendorCampaignEditor({
  campaignId, campaign, audience, events, segments, templates, error,
}: {
  campaignId: string | null;
  campaign: CampaignShape | null;
  audience: { rows: AudienceMember[]; total: number; page: number; pageSize: number } | null;
  events: CampaignEvent[];
  segments: SegmentOption[];
  templates: TemplateOption[];
  error: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const [name, setName] = useState(campaign?.name ?? "");
  const [description, setDescription] = useState(campaign?.description ?? "");
  const [purpose, setPurpose] = useState(campaign?.purpose ?? CAMPAIGN_PURPOSES[0]);
  const [channel, setChannel] = useState(campaign?.channel ?? CAMPAIGN_CHANNELS[0]);
  const [consentScope, setConsentScope] = useState(campaign?.consent_scope ?? CAMPAIGN_CONSENT_SCOPES[0]);
  const [segmentId, setSegmentId] = useState(campaign?.segment_id ?? "");
  const [templateKey, setTemplateKey] = useState(campaign?.template_key ?? "");

  const [message, setMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    rows: Array<{ vendor_id: string; business_name: string | null; city: string | null; status: string | null; is_active: boolean | null }>;
    total: number; page: number; pageSize: number; evaluatedAt: string;
  } | null>(null);

  if (error) {
    return (
      <div className="space-y-5">
        <PageHeader title="Campaign" description="Vendor campaign" />
        <EmptyState title="Campaign unavailable" message={error} />
      </div>
    );
  }

  const status = campaign?.status ?? "draft";
  const isDraft = status === "draft";
  const isReady = status === "ready_for_review";
  const isApproved = status === "approved";
  const isClosed = status === "cancelled" || status === "archived";
  const revision = campaign?.revision ?? 0;

  // the pinned template version travels with the key; it is never typed by hand.
  const selectedTemplate = templates.find((t) => t.template_key === templateKey) ?? null;

  const act = (fn: () => Promise<{ ok: boolean; error?: string; data?: unknown }>, okMessage: string) =>
    start(async () => {
      setMessage(null);
      const res = await fn();
      if (res?.ok) {
        setMessage(okMessage);
        const data = res.data as { id?: string } | undefined;
        if (data?.id && !campaignId) router.push(`/admin/vendor-crm/campaigns/${data.id}`);
        else router.refresh();
      } else {
        setMessage(res?.error ?? "That action could not be completed.");
      }
    });

  const draftInput = {
    name, description, purpose, channel, consent_scope: consentScope,
    segment_id: segmentId || null,
    template_key: templateKey || null,
    template_version: selectedTemplate?.version ?? null,
  };

  const runPreview = (page = 1) => start(async () => {
    setMessage(null);
    if (!campaignId) { setMessage("Save the campaign before previewing its segment."); return; }
    const res = await campaignPreview(campaignId, { page });
    if (res.ok) setPreview(res.data as never);
    else { setPreview(null); setMessage(res.error); }
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title={campaignId ? name || "Campaign" : "New campaign"}
        description="A deterministic campaign over a saved segment, with an audience frozen at prepare."
      />

      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <strong>Approval is not a send.</strong> Preparing freezes an immutable audience; approving
        authorises that frozen audience for later execution. No message is rendered, no provider is
        contacted and no communication intent is created here. No campaign may send until
        QF-MVP-30.5 adds a fail-closed frequency gate.
      </div>

      {message && (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">{message}</div>
      )}

      <SectionCard title="Definition">
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block font-medium text-slate-600">Name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} disabled={!isDraft}
                maxLength={CAMPAIGN_MAX_NAME_LENGTH}
                className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-emerald-300" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium text-slate-600">Description</span>
              <input value={description} onChange={(e) => setDescription(e.target.value)} disabled={!isDraft}
                maxLength={CAMPAIGN_MAX_DESCRIPTION_LENGTH}
                className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-emerald-300" />
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-sm">
              <span className="mb-1 block font-medium text-slate-600">Purpose</span>
              <select value={purpose} onChange={(e) => setPurpose(e.target.value)} disabled={!isDraft}
                className="h-11 w-full rounded-xl border border-slate-200 px-2 text-sm">
                {CAMPAIGN_PURPOSES.map((p) => <option key={p} value={p}>{p.replace(/_/g, " ")}</option>)}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium text-slate-600">Channel</span>
              <select value={channel} onChange={(e) => setChannel(e.target.value)} disabled={!isDraft}
                className="h-11 w-full rounded-xl border border-slate-200 px-2 text-sm">
                {CAMPAIGN_CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium text-slate-600">Consent scope</span>
              <select value={consentScope} onChange={(e) => setConsentScope(e.target.value)} disabled={!isDraft}
                className="h-11 w-full rounded-xl border border-slate-200 px-2 text-sm">
                {CAMPAIGN_CONSENT_SCOPES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block font-medium text-slate-600">Source segment</span>
              <select value={segmentId} onChange={(e) => setSegmentId(e.target.value)} disabled={!isDraft}
                className="h-11 w-full rounded-xl border border-slate-200 px-2 text-sm">
                <option value="">— select a segment —</option>
                {segments.map((s) => (
                  <option key={s.id} value={s.id}>{s.name} (v{s.definition_version}, {s.status})</option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium text-slate-600">Template</span>
              <select value={templateKey} onChange={(e) => setTemplateKey(e.target.value)} disabled={!isDraft}
                className="h-11 w-full rounded-xl border border-slate-200 px-2 text-sm">
                <option value="">— select a template —</option>
                {templates.map((t) => (
                  <option key={t.template_key} value={t.template_key}>
                    {t.template_key} · v{t.version} · {t.category}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {consentScope === "marketing" && selectedTemplate && selectedTemplate.category !== "marketing" && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
              A marketing campaign requires a marketing-category template. This pairing will be
              refused when you prepare it.
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-2">
            {isDraft && (
              <PrimaryButton onClick={() => campaignId
                ? act(() => campaignUpdate(campaignId, draftInput, revision), "Campaign saved.")
                : act(() => campaignCreate(draftInput), "Campaign created.")}>
                {pending ? "Saving…" : campaignId ? "Save" : "Create"}
              </PrimaryButton>
            )}
            {campaignId && isDraft && (
              <SecondaryButton onClick={() => runPreview(1)}>
                {pending ? "Evaluating…" : "Preview segment matches"}
              </SecondaryButton>
            )}
            {campaignId && isDraft && (
              <SecondaryButton onClick={() => act(() => campaignPrepare(campaignId, revision),
                "Audience frozen. Review it below, then approve.")}>
                Prepare for review (freeze audience)
              </SecondaryButton>
            )}
            {campaignId && isReady && (
              <>
                <PrimaryButton onClick={() => act(() => campaignApprove(campaignId, revision),
                  "Campaign approved. The frozen audience is authorised — nothing has been sent.")}>
                  Approve frozen audience
                </PrimaryButton>
                <SecondaryButton onClick={() => act(() => campaignReturnToDraft(campaignId, revision),
                  "Campaign returned to draft. Preparing again creates a new snapshot revision.")}>
                  Return to draft
                </SecondaryButton>
              </>
            )}
            {campaignId && !isClosed && (
              <SecondaryButton onClick={() => act(() => campaignCancel(campaignId, revision), "Campaign cancelled.")}>
                Cancel
              </SecondaryButton>
            )}
            {campaignId && status !== "archived" && !isReady && (
              <SecondaryButton onClick={() => act(() => campaignArchive(campaignId, revision), "Campaign archived.")}>
                Archive
              </SecondaryButton>
            )}
          </div>
        </div>
      </SectionCard>

      {campaign && (
        <SectionCard title="Frozen evidence">
          <InfoGrid rows={[
            ["Status", <StatusBadge key="s" value={campaign.status.replace(/_/g, " ")} />],
            ["Revision", <span key="r" className="tabular-nums">{campaign.revision}</span>],
            ["Snapshot revision", <span key="sr" className="tabular-nums">{campaign.prepared_snapshot_revision ?? "—"}</span>],
            ["Frozen recipients", <span key="c" className="tabular-nums">{campaign.prepared_recipient_count ?? "—"}</span>],
            ["Segment version at freeze", <span key="sv" className="tabular-nums">{campaign.prepared_segment_version ?? "—"}</span>],
            ["Segment fingerprint", <code key="sf" className="text-xs">{campaign.prepared_segment_fingerprint ?? "—"}</code>],
            ["Template pinned", campaign.prepared_template_version
              ? `${campaign.template_key} · v${campaign.prepared_template_version} · ${campaign.prepared_template_category}`
              : "—"],
            ["Snapshot fingerprint", <code key="nf" className="text-xs">{campaign.snapshot_fingerprint ?? "—"}</code>],
            ["Audience evaluated", campaign.audience_evaluated_at
              ? new Date(campaign.audience_evaluated_at).toLocaleString() : "—"],
            ["Approved", campaign.approved_at ? new Date(campaign.approved_at).toLocaleString() : "—"],
          ]} />
        </SectionCard>
      )}

      {campaign && Object.keys(campaign.exclusion_summary ?? {}).length > 0 && (
        <SectionCard title="Why vendors were excluded (counts only — no identities are stored)">
          <ul className="space-y-1 text-sm text-slate-700">
            {Object.entries(campaign.exclusion_summary).map(([code, count]) => (
              <li key={code} className="flex justify-between border-b border-slate-100 py-1">
                <span>{EXCLUSION_LABEL[code] ?? code}</span>
                <span className="tabular-nums font-semibold">{count}</span>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      {audience && (
        <SectionCard title={`${isDraft ? "Last frozen" : "Frozen"} audience (snapshot revision ${campaign?.prepared_snapshot_revision ?? "—"})`}>
          <div className="space-y-3">
            {isDraft && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                This campaign is a draft, so this is the <strong>previous</strong> frozen snapshot, kept
                as evidence. It does not reflect the current definition. Preparing again creates a new
                snapshot revision.
              </div>
            )}
            <p className="text-sm text-slate-600">
              This audience is immutable. Preparing again after a return to draft creates a NEW
              snapshot revision; it never rewrites this one. No destination is stored here.
            </p>
            <DataTable<AudienceMember>
              columns={[
                { header: "#", cell: (m) => <span className="tabular-nums">{m.ordinal}</span> },
                { header: "Vendor", cell: (m) => m.business_name ?? m.vendor_id },
                { header: "Consent", cell: (m) => <StatusBadge value={m.consent_disposition.replace(/_/g, " ")} /> },
                { header: "Reason", cell: (m) => <code className="text-xs">{m.consent_reason_code}</code> },
                { header: "Policy", cell: (m) => m.consent_policy_version },
              ]}
              rows={audience.rows}
              emptyTitle="No frozen recipients"
              emptyMessage="This snapshot contains no recipients."
            />
            <div className="text-sm text-slate-600">
              {audience.total} frozen recipient{audience.total === 1 ? "" : "s"} · showing page{" "}
              {audience.page} (max {audience.pageSize})
            </div>
          </div>
        </SectionCard>
      )}

      {campaignId && isDraft && (
        <SectionCard title="Segment preview (evaluated now — nothing is stored)">
          {preview ? (
            <div className="space-y-3">
              <div className="text-sm text-slate-600">
                <strong className="tabular-nums">{preview.total}</strong> vendor
                {preview.total === 1 ? "" : "s"} match the source segment · evaluated{" "}
                {new Date(preview.evaluatedAt).toLocaleString()} · page {preview.page} (max {preview.pageSize})
              </div>
              <p className="text-xs text-slate-500">
                These are segment CANDIDATES, not the audience. Consent, suppression and vendor
                eligibility are applied when you prepare — the frozen audience is usually smaller.
              </p>
              <DataTable<{ vendor_id: string; business_name: string | null; city: string | null; status: string | null; is_active: boolean | null }>
                columns={[
                  { header: "Vendor", cell: (v) => v.business_name ?? "—" },
                  { header: "City", cell: (v) => v.city ?? "—" },
                  { header: "Verification", cell: (v) => <StatusBadge value={v.status} /> },
                  { header: "Enabled", cell: (v) => (v.is_active ? "Yes" : "No") },
                ]}
                rows={preview.rows}
                emptyTitle="No vendors match"
                emptyMessage="No vendor currently satisfies the source segment."
              />
              <div className="flex gap-2">
                <SecondaryButton onClick={() => runPreview(Math.max(1, preview.page - 1))}>Previous</SecondaryButton>
                <SecondaryButton onClick={() => runPreview(preview.page + 1)}>Next</SecondaryButton>
              </div>
            </div>
          ) : (
            <EmptyState title="No preview yet"
              message="Run a preview to see who matches the source segment right now." compact />
          )}
        </SectionCard>
      )}

      {campaignId && events.length > 0 && (
        <SectionCard title="Provenance (append-only)">
          <DataTable<CampaignEvent>
            columns={[
              { header: "Event", cell: (e) => e.event_type.replace(/_/g, " ") },
              { header: "Campaign rev", cell: (e) => <span className="tabular-nums">{e.campaign_revision}</span> },
              { header: "Snapshot rev", cell: (e) => <span className="tabular-nums">{e.snapshot_revision ?? "—"}</span> },
              { header: "When", cell: (e) => new Date(e.occurred_at).toLocaleString() },
            ]}
            rows={events}
            emptyTitle="No events"
            emptyMessage="No transition has been recorded for this campaign."
          />
        </SectionCard>
      )}

      {isApproved && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          This campaign is approved: its frozen audience is authorised for later execution.
          <strong> Nothing has been sent.</strong> Execution, message rendering and a fail-closed
          frequency gate are QF-MVP-30.5 concerns.
        </div>
      )}
    </div>
  );
}
