"use client";

// ============================================================================
// QuickFurno Admin V2 — WhatsApp Overview (C-WA1).
//
// A status rail that keeps the SIX independent truths apart:
//   configuration · provider account · runtime · mappings · webhook · failures
//
// A green tile on one of them says nothing about the others, and the copy says
// so. There is no health score, no delivery percentage, no response rate, no
// cost figure and no Meta quality rating anywhere on this page: none of those
// are derivable from what QuickFurno actually stores.
// ============================================================================

import { DataTable, SectionCard, StatusBadge } from "../AdminPrimitives";
import { AdminIcon } from "../AdminIcon";
import type { AdminIconName } from "../adminConfig";
import type { WhatsAppAdminOverview, WhatsAppDeliveryRow, WhatsAppMessageRow } from "@/services/adminWhatsAppService";
import {
  CountValue,
  FaultNotice,
  ReadOnlyNotice,
  humanize,
  messageStatusTone,
  readinessTone,
  when,
} from "./whatsappShared";

/**
 * One cell of the status rail. Each states its OWN fact and nothing more.
 *
 * The mark is the shared `qfa-glow-chip` at its designed 30px size holding an
 * AdminIcon. It is NOT sized down with utilities: `.admin-surface .qfa-glow-chip`
 * has specificity (0,2,0) and would win over a `h-2 w-2` utility (0,1,0),
 * leaving an empty 30px bordered square rather than the intended dot.
 */
function RailTile({
  label,
  state,
  tone,
  detail,
  glow,
  icon,
}: {
  label: string;
  state: string;
  tone: "emerald" | "blue" | "amber" | "rose" | "slate" | "violet" | "cyan";
  detail: string;
  glow: string;
  icon: AdminIconName;
}) {
  return (
    <article className="qfa-panel min-w-0 px-3.5 py-3">
      <div className="flex items-center gap-2">
        <span className={`qfa-glow-chip ${glow} shrink-0`} aria-hidden="true">
          <AdminIcon name={icon} className="h-3.5 w-3.5" />
        </span>
        <p className="min-w-0 truncate text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          {label}
        </p>
      </div>
      <div className="mt-2">
        <StatusBadge value={state} tone={tone} />
      </div>
      <p className="mt-2 text-[11px] leading-4 text-slate-500">{detail}</p>
    </article>
  );
}

export function WhatsAppOverviewTab({
  overview,
  onNavigate,
}: {
  overview?: WhatsAppAdminOverview;
  onNavigate: (key: string, value?: string) => void;
}) {
  if (!overview) return <FaultNotice fault="UNAVAILABLE" />;

  const { readiness } = overview;
  // Configuration readiness is the OUTBOUND config alone — deliberately not a
  // roll-up of every operation, because a ready webhook says nothing about it.
  const configurationState = readiness.outboundConfigurationResolved
    ? "READY"
    : readiness.outboundInvalidVariables.length > 0
      ? "INVALID"
      : "MISSING";

  const accountState = readiness.accountFault
    ? "UNKNOWN"
    : readiness.account
      ? readiness.account.readinessStatus
      : "NO ACCOUNT ROW";

  const runtimeState = readiness.runtimePolicyFault
    ? "UNKNOWN"
    : readiness.runtimePolicy
      ? readiness.runtimePolicy.activationStatus
      : "NO POLICY ROW";

  const mappingState =
    readiness.approvedActiveMappingCount === null
      ? "UNKNOWN"
      : readiness.approvedActiveMappingCount > 0
        ? `${readiness.approvedActiveMappingCount} ACTIVE`
        : "NONE ACTIVE";

  // Three separate webhook facts; the tile shows the WEAKEST proven one and the
  // Provider tab breaks all three out. Configuration is never dressed up as
  // "verified", and a verified subscription is never inferred from config.
  const webhookState = readiness.webhook.lastVerifiedReceiptAt
    ? "VERIFIED CALLBACK SEEN"
    : readiness.webhook.postConfigurationState === "READY"
      ? "CONFIGURED, NO CALLBACK SEEN"
      : readiness.webhook.postConfigurationState;

  const failureCount = overview.recentFailures.length;

  const statusCountRows = Object.entries(overview.messageStatusCounts).map(([status, count]) => ({
    status,
    count,
  }));

  return (
    <div className="space-y-4">
      <ReadOnlyNotice>
        This workspace is <strong>read-only visibility</strong> over the existing QuickFurno
        communication foundation. Configuration readiness, provider-account readiness, runtime
        activation and business authorization are four separate authorities — a READY state on one
        never implies any of the others, and nothing on this page sends, submits, maps or overrides.
      </ReadOnlyNotice>

      <section aria-label="WhatsApp status rail" className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
        <RailTile
          label="Configuration"
          state={configurationState}
          tone={readinessTone(configurationState)}
          glow="qfa-glow-blue"
          icon="settings"
          detail={
            readiness.outboundConfigurationResolved
              ? "Outbound variables resolve. This is not permission to send."
              : `Missing/invalid: ${[...readiness.outboundMissingVariables, ...readiness.outboundInvalidVariables].join(", ") || "see Provider tab"}`
          }
        />
        <RailTile
          label="Provider account"
          state={accountState}
          tone={readiness.account ? readinessTone("READY") : "slate"}
          glow="qfa-glow-cyan"
          icon="whatsapp"
          detail={
            readiness.accountFault
              ? "The provider-account table could not be read here."
              : readiness.account
                ? `Configuration ${readiness.account.configurationStatus} · health ${readiness.account.healthStatus}`
                : "No provider-account row exists for the configured identity."
          }
        />
        <RailTile
          label="Runtime policy"
          state={runtimeState}
          tone={readiness.runtimePolicy?.outboundEnabled ? "emerald" : "slate"}
          glow="qfa-glow-violet"
          icon="automations"
          detail={
            readiness.runtimePolicy
              ? `Outbound ${readiness.runtimePolicy.outboundEnabled ? "enabled" : "disabled"} · webhook processing ${readiness.runtimePolicy.webhookProcessingEnabled ? "enabled" : "disabled"}`
              : "No runtime policy row — the provider is fail-closed by default."
          }
        />
        <RailTile
          label="Template mappings"
          state={mappingState}
          tone={(readiness.approvedActiveMappingCount ?? 0) > 0 ? "emerald" : "amber"}
          glow="qfa-glow-green"
          icon="categories"
          detail="Approved AND active provider mappings. An approved Meta template is not a mapping."
        />
        <RailTile
          label="Webhook"
          state={webhookState}
          tone={readiness.webhook.lastVerifiedReceiptAt ? "emerald" : "amber"}
          glow="qfa-glow-amber"
          icon="notifications"
          detail={
            readiness.webhook.lastVerifiedReceiptAt
              ? `Last verified callback ${when(readiness.webhook.lastVerifiedReceiptAt)}`
              : "Configuration present is not subscription verified, and neither is a callback."
          }
        />
        <RailTile
          label="Recent delivery failures"
          state={overview.recentSamplesFault ? "UNKNOWN" : `${failureCount} IN SAMPLE`}
          tone={failureCount > 0 ? "rose" : "slate"}
          glow="qfa-glow-red"
          icon="reports"
          detail="Bounded sample of the 10 most recent failed delivery events — not a total."
        />
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <SectionCard
          title="Message ledger by status"
          description="Exact counts from count queries over the whole ledger — not a sample."
        >
          {overview.messagesFault ? (
            <FaultNotice fault={overview.messagesFault} />
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {statusCountRows.map((row) => (
                  <div
                    key={row.status}
                    className="qfa-quiet flex items-center justify-between gap-2 px-3 py-2"
                  >
                    <span className="min-w-0 truncate text-[12px] text-slate-600">
                      {humanize(row.status)}
                    </span>
                    <span className="shrink-0 text-[13px] font-semibold text-slate-900">
                      <CountValue value={row.count} />
                    </span>
                  </div>
                ))}
              </div>
              <p className="pt-1 text-[11px] text-slate-500">
                Total ledger rows: <CountValue value={overview.messageTotal} /> · inbound messages:{" "}
                <CountValue value={overview.inboundTotal} />
              </p>
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Template governance"
          description="Local contract, proven remote evidence and active mapping are three separate counts."
        >
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="qfa-quiet px-3 py-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Local contracts
              </p>
              <p className="mt-1 text-[22px] font-semibold leading-none tabular-nums text-slate-950">
                {overview.templateTotals.localTemplates}
              </p>
              <p className="mt-1 text-[11px] text-slate-500">Declared in the committed manifest</p>
            </div>
            <div className="qfa-quiet px-3 py-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Proven approved at Meta
              </p>
              <p className="mt-1 text-[22px] font-semibold leading-none tabular-nums text-slate-950">
                {overview.templateTotals.remoteApproved}
              </p>
              <p className="mt-1 text-[11px] text-slate-500">Approval is not send authority</p>
            </div>
            <div className="qfa-quiet px-3 py-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Approved + active mappings
              </p>
              <p className="mt-1 text-[22px] font-semibold leading-none tabular-nums text-slate-950">
                <CountValue value={overview.templateTotals.mappedActiveApproved} />
              </p>
              <p className="mt-1 text-[11px] text-slate-500">What the runtime gate actually counts</p>
            </div>
          </div>
          <div className="mt-3">
            <button
              type="button"
              onClick={() => onNavigate("tab", "templates")}
              className="qfa-focus inline-flex min-h-10 items-center rounded border-0 bg-transparent p-0 text-left text-[13px] font-semibold text-emerald-700 hover:underline sm:min-h-0"
            >
              Open the template workspace
            </button>
          </div>
        </SectionCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <SectionCard
          title="Recent messages"
          description="Bounded sample — the 10 most recent ledger rows, newest first."
        >
          {overview.recentSamplesFault ? (
            <FaultNotice fault={overview.recentSamplesFault} />
          ) : (
            <DataTable<WhatsAppMessageRow>
              density="compact"
              columns={[
                { header: "Created", cell: (row) => <span className="whitespace-nowrap">{when(row.createdAt)}</span> },
                { header: "Type", cell: (row) => humanize(row.messageType) },
                {
                  header: "Status",
                  cell: (row) => <StatusBadge value={humanize(row.status)} tone={messageStatusTone(row.status)} />,
                },
                { header: "Lane", cell: (row) => row.lane },
              ]}
              rows={[...overview.recentMessages]}
              emptyTitle="No messages yet"
              emptyMessage="The communication ledger holds no WhatsApp rows in this environment."
            />
          )}
        </SectionCard>

        <SectionCard
          title="Recent delivery failures"
          description="Bounded sample — the 10 most recent failed delivery events."
        >
          {overview.recentSamplesFault ? (
            <FaultNotice fault={overview.recentSamplesFault} />
          ) : (
            <DataTable<WhatsAppDeliveryRow>
              density="compact"
              columns={[
                { header: "Occurred", cell: (row) => <span className="whitespace-nowrap">{when(row.occurredAt)}</span> },
                { header: "Provider", cell: (row) => row.provider },
                {
                  header: "Classification",
                  cell: (row) => row.failureClassification ?? <span className="text-slate-400">Not recorded</span>,
                },
              ]}
              rows={[...overview.recentFailures]}
              emptyTitle="No delivery failures in the sample"
              emptyMessage="No failed delivery event appears in the 10 most recent events."
            />
          )}
        </SectionCard>
      </div>

      <SectionCard
        title="Consent and automation"
        description="Counts only. Consent decisions and automation execution are owned elsewhere."
      >
        <div className="grid gap-2 sm:grid-cols-3">
          <div className="qfa-quiet px-3 py-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Blocked preferences
            </p>
            <p className="mt-1 text-[20px] font-semibold leading-none tabular-nums text-slate-950">
              {overview.consentFault ? <FaultInline /> : <CountValue value={overview.preferenceBlockedCount} />}
            </p>
          </div>
          <div className="qfa-quiet px-3 py-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Active suppressions
            </p>
            <p className="mt-1 text-[20px] font-semibold leading-none tabular-nums text-slate-950">
              {overview.consentFault ? <FaultInline /> : <CountValue value={overview.activeSuppressionCount} />}
            </p>
          </div>
          <div className="qfa-quiet px-3 py-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Open automation jobs
            </p>
            <p className="mt-1 text-[20px] font-semibold leading-none tabular-nums text-slate-950">
              {overview.automationFault ? <FaultInline /> : <CountValue value={overview.automationOpenJobCount} />}
            </p>
          </div>
        </div>
        <p className="mt-3 text-[11px] leading-4 text-slate-500">
          A CRM contact existing is <strong>not</strong> WhatsApp consent. Consent is held only by the
          communication preference and suppression records shown on the Consent tab.
        </p>
      </SectionCard>
    </div>
  );
}

/** Inline "unknown" marker for a stat whose source could not be read. */
function FaultInline() {
  return <span className="text-[13px] font-medium text-slate-400">Unknown</span>;
}
