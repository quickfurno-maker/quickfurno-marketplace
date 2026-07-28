"use client";
// ============================================================================
// QF-MVP-30.5C1 — Campaign execution handoff panel.
//
// Renders the EXPLICIT handoff control for an already-approved campaign.
//
// This control does NOT send anything. It asks QuickFurno Core to create
// provider-neutral communication intents from the frozen audience. Delivery is
// owned by a later phase, so there is deliberately no "send WhatsApp" button,
// no provider action, no retry and no delivery claim anywhere on this surface.
//
// It is fail-closed by construction: the button is disabled unless the campaign
// is approved AND an active frequency policy exists, and the server refuses
// again regardless of what the browser renders.
// ============================================================================

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  campaignHandoff, campaignHandoffReadiness, campaignIntentSummary,
} from "@/app/actions/campaignHandoffActions";
import { SectionCard, PrimaryButton, SecondaryButton, StatusBadge, InfoGrid, Toast } from "../../AdminPrimitives";

type Readiness = {
  campaignStatus: string | null;
  isApproved: boolean;
  frozenRecipientCount: number | null;
  channel: string | null;
  consentScope: string | null;
  hasActivePolicy: boolean;
  activePolicy: { maxPerWindow: number; windowLength: string; minInterval: string } | null;
  canHandOff: boolean;
  blockedReason: string | null;
};

type Counts = {
  considered: number; created: number; existing: number;
  skippedConsent: number; skippedSuppressed: number;
  skippedFrequency: number; skippedDestination: number; batchLimit: number;
};

type IntentSummary = { total: number; byStatus: Record<string, number>; latestCreatedAt: string | null };

export function CampaignHandoffPanel({
  campaignId, revision, readiness, intents,
}: {
  campaignId: string;
  revision: number;
  readiness: Readiness | null;
  intents: IntentSummary | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [ready, setReady] = useState<Readiness | null>(readiness);
  const [summary, setSummary] = useState<IntentSummary | null>(intents);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [mayHaveMore, setMayHaveMore] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" | "info" } | null>(null);
  // `pending` alone can lag a rapid double-click, so an explicit latch blocks a
  // second submission. The DATABASE remains the final authority: recipient
  // uniqueness is enforced by uq_communication_intents_idempotency, and a replay
  // returns `existing` rather than a duplicate row.
  const [inFlight, setInFlight] = useState(false);

  const busy = pending || inFlight;

  async function refresh() {
    const [r, s] = await Promise.all([
      campaignHandoffReadiness(campaignId),
      campaignIntentSummary(campaignId),
    ]);
    if (r.ok) setReady(r.data as Readiness);
    if (s.ok) setSummary(s.data as IntentSummary);
  }

  function runHandoff() {
    if (busy) return;
    setInFlight(true);
    startTransition(async () => {
      try {
        const res = await campaignHandoff(campaignId, revision, { batchLimit: 100 });
        if (!res.ok) {
          setCounts(null);
          setToast({ message: res.error, tone: "error" });
        } else {
          const data = res.data as { counts: Counts; mayHaveMore: boolean; reconciled: boolean };
          setCounts(data.counts);
          setMayHaveMore(Boolean(data.mayHaveMore));
          setToast({
            message: data.counts.created > 0
              ? `${data.counts.created} communication intent(s) authorised. Nothing has been sent.`
              : "No new intent was authorised — every recipient was already handled or excluded.",
            tone: "success",
          });
        }
        await refresh();
        router.refresh();
      } finally {
        setInFlight(false);
      }
    });
  }

  const blocked = !ready?.canHandOff;

  return (
    <SectionCard
      title="Execution handoff"
      description="Creates provider-neutral communication intents from the frozen audience. This does not send messages."
    >
      {toast ? <Toast message={toast.message} tone={toast.tone} /> : null}

      <InfoGrid
        rows={[
          ["Campaign status", <StatusBadge key="s" value={ready?.campaignStatus ?? "unknown"} />],
          ["Frozen audience", String(ready?.frozenRecipientCount ?? "—")],
          ["Channel / purpose", `${ready?.channel ?? "—"} / ${ready?.consentScope ?? "—"}`],
          [
            "Active frequency policy",
            ready?.hasActivePolicy && ready.activePolicy
              ? `Yes — max ${ready.activePolicy.maxPerWindow} per ${ready.activePolicy.windowLength}`
              : "None configured",
          ],
        ]}
      />

      {blocked ? (
        <p className="qf-warning" role="status">
          {ready?.blockedReason
            ?? "This campaign cannot hand off yet."}
        </p>
      ) : null}

      <div className="qf-actions">
        <PrimaryButton onClick={blocked || busy ? undefined : runHandoff}>
          {busy ? "Working…" : "Authorise communication intents"}
        </PrimaryButton>
        <SecondaryButton onClick={busy ? undefined : () => startTransition(refresh)}>
          Refresh
        </SecondaryButton>
      </div>

      {counts ? (
        <InfoGrid
          rows={[
            ["Examined", String(counts.considered)],
            ["Created", String(counts.created)],
            ["Already existed", String(counts.existing)],
            ["Excluded — consent", String(counts.skippedConsent)],
            ["Excluded — suppressed", String(counts.skippedSuppressed)],
            ["Excluded — frequency", String(counts.skippedFrequency)],
            ["Excluded — unusable target", String(counts.skippedDestination)],
            ["Batch size", String(counts.batchLimit)],
          ]}
        />
      ) : null}

      {mayHaveMore ? (
        <p className="qf-note" role="status">
          The batch was filled, so more recipients may remain. Run the handoff again to continue.
        </p>
      ) : null}

      {summary ? (
        <InfoGrid
          rows={[
            ["Intents for this campaign", String(summary.total)],
            [
              "By status",
              Object.entries(summary.byStatus).map(([k, v]) => `${k}: ${v}`).join(", ") || "—",
            ],
            ["Most recent", summary.latestCreatedAt ?? "—"],
          ]}
        />
      ) : null}

      <p className="qf-note">
        An intent is a record of authorised communication, not a delivery. Consent and suppression
        are re-checked here, and must be re-checked again immediately before any provider dispatch.
      </p>
    </SectionCard>
  );
}
