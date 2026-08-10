"use client";

// ============================================================================
// QuickFurno Admin V2 — Provider readiness (C-WA1).
//
// Renders the EXISTING pure readiness evaluator's verdict per operation, using
// its exact closed vocabulary:
//   READY · MISSING · INVALID · DISABLED_BY_RUNTIME_POLICY
//   ACCOUNT_NOT_READY · MAPPING_NOT_READY · CANARY_NOT_READY
//
// Environment variables appear by NAME and state only. No secret value — token,
// app secret, verify token, cron secret, service role — is read, sent to the
// client or rendered anywhere in this tree.
//
// The three webhook facts are shown SEPARATELY and one is never inferred from
// another: configuration present ≠ subscription verified ≠ a recent verified
// callback observed.
// ============================================================================

import { DataTable, SectionCard, StatusBadge } from "../AdminPrimitives";
import type { OperationReadiness, WhatsAppProviderReadiness } from "@/services/adminWhatsAppService";
import { CountValue, FactGrid, FaultNotice, ReadOnlyNotice, humanize, readinessTone, when } from "./whatsappShared";

export function WhatsAppProviderTab({ readiness }: { readiness?: WhatsAppProviderReadiness }) {
  if (!readiness) return <FaultNotice fault="UNAVAILABLE" />;

  const { account, runtimePolicy, webhook } = readiness;

  return (
    <div className="space-y-4">
      <ReadOnlyNotice>
        Configuration readiness is not provider-account readiness, provider-account readiness is not
        runtime activation, and runtime activation is not business authorization. A <strong>READY</strong>{" "}
        verdict means only that an operation is not blocked by configuration — consent, suppression,
        frequency, template approval and the policy engine remain separate authorities that must also
        pass. This page performs no activation and offers no toggle.
      </ReadOnlyNotice>

      <SectionCard
        title="Operation readiness"
        description="Per-operation verdicts from the existing evaluator. Variable names only — never values."
      >
        <DataTable<OperationReadiness>
          density="compact"
          getRowKey={(row) => row.operation}
          columns={[
            {
              header: "Operation",
              cell: (row) => <span className="font-semibold text-slate-950">{humanize(row.operation)}</span>,
            },
            {
              header: "State",
              cell: (row) => <StatusBadge value={row.state} tone={readinessTone(row.state)} />,
            },
            {
              header: "Missing variables",
              cell: (row) =>
                row.missing.length > 0 ? (
                  <code className="text-[12px] text-amber-700">{row.missing.join(", ")}</code>
                ) : (
                  <span className="text-slate-400">—</span>
                ),
            },
            {
              header: "Invalid variables",
              cell: (row) =>
                row.invalid.length > 0 ? (
                  <code className="text-[12px] text-rose-700">{row.invalid.join(", ")}</code>
                ) : (
                  <span className="text-slate-400">—</span>
                ),
            },
            { header: "Detail", cell: (row) => <span className="text-[12px]">{row.detail}</span> },
          ]}
          rows={[...readiness.operations]}
          emptyTitle="No operations evaluated"
          emptyMessage="The readiness evaluator returned no operations."
        />
      </SectionCard>

      <div className="grid gap-4 xl:grid-cols-2">
        <SectionCard
          title="Provider account"
          description="The communication_provider_accounts row for the configured identity."
        >
          {readiness.accountFault ? (
            <FaultNotice fault={readiness.accountFault} />
          ) : !readiness.outboundConfigurationResolved ? (
            <p className="text-[13px] leading-5 text-slate-600">
              Outbound configuration does not resolve, so the provider identity is unknown and no
              account row can be matched. Nothing is claimed about the account.
            </p>
          ) : !account ? (
            <p className="text-[13px] leading-5 text-slate-600">
              <strong>No provider account row exists</strong> for the configured phone number
              identity. The outbound gate therefore fails closed.
            </p>
          ) : (
            <FactGrid
              rows={[
                ["Display name", account.displayName],
                ["Provider key", account.providerKey],
                ["Readiness", <StatusBadge key="r" value={humanize(account.readinessStatus)} />],
                ["Configuration", <StatusBadge key="c" value={humanize(account.configurationStatus)} />],
                ["Business verification", humanize(account.businessVerificationStatus)],
                ["Phone number", humanize(account.phoneNumberStatus)],
                ["Billing", humanize(account.billingStatus)],
                ["Health", <StatusBadge key="h" value={humanize(account.healthStatus)} />],
                ["Last health check", when(account.lastHealthCheckAt)],
                ["Last synced", when(account.lastSyncedAt)],
              ]}
            />
          )}
        </SectionCard>

        <SectionCard
          title="Runtime policy"
          description="The activation state an operator controls outside this admin."
        >
          {readiness.runtimePolicyFault ? (
            <FaultNotice fault={readiness.runtimePolicyFault} />
          ) : !runtimePolicy ? (
            <p className="text-[13px] leading-5 text-slate-600">
              <strong>No runtime policy row exists.</strong> The provider is fail-closed by default:
              absent policy is treated as disabled, never as permitted.
            </p>
          ) : (
            <FactGrid
              rows={[
                ["Activation status", <StatusBadge key="a" value={humanize(runtimePolicy.activationStatus)} tone={runtimePolicy.activationStatus === "active" ? "emerald" : "slate"} />],
                ["Outbound enabled", runtimePolicy.outboundEnabled ? "Yes" : "No"],
                ["Webhook processing enabled", runtimePolicy.webhookProcessingEnabled ? "Yes" : "No"],
                ["Health check enabled", runtimePolicy.healthCheckEnabled ? "Yes" : "No"],
                ["Updated", when(runtimePolicy.updatedAt)],
              ]}
            />
          )}
          <p className="mt-3 text-[11px] leading-4 text-slate-500">
            Activation is deliberately not adjustable from the browser. Changing it is a separate,
            governed readiness/activation phase.
          </p>
        </SectionCard>
      </div>

      <SectionCard
        title="Webhook"
        description="Three separate facts. None of them implies another."
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="qfa-quiet px-3 py-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              1 · Configuration present
            </p>
            <div className="mt-1.5 space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-slate-500">GET (verify)</span>
                <StatusBadge value={webhook.getConfigurationState} tone={readinessTone(webhook.getConfigurationState)} />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-slate-500">POST (signature)</span>
                <StatusBadge value={webhook.postConfigurationState} tone={readinessTone(webhook.postConfigurationState)} />
              </div>
            </div>
            <p className="mt-2 text-[11px] leading-4 text-slate-500">
              Variables resolve. This does not mean Meta has verified a subscription.
            </p>
          </div>

          <div className="qfa-quiet px-3 py-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              2 · Subscription verified
            </p>
            <div className="mt-1.5">
              <StatusBadge
                value={webhook.accountWebhookStatus ? humanize(webhook.accountWebhookStatus) : "no account row"}
                tone={webhook.accountWebhookStatus === "verified" ? "emerald" : "slate"}
              />
            </div>
            <p className="mt-2 text-[11px] leading-4 text-slate-500">
              The account row&apos;s own webhook status. Not inferred from configuration.
            </p>
          </div>

          <div className="qfa-quiet px-3 py-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              3 · Verified callback observed
            </p>
            <div className="mt-1.5 text-[13px] text-slate-900">
              {webhook.receiptsFault ? (
                <span className="text-slate-400">Unknown</span>
              ) : webhook.lastVerifiedReceiptAt ? (
                when(webhook.lastVerifiedReceiptAt)
              ) : (
                <span className="text-slate-400">None observed</span>
              )}
            </div>
            <p className="mt-2 text-[11px] leading-4 text-slate-500">
              Verified receipts: <CountValue value={webhook.verifiedReceiptCount} /> · rejected:{" "}
              <CountValue value={webhook.rejectedReceiptCount} />
            </p>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Gating counts" description="What the outbound gate actually requires.">
        <FactGrid
          rows={[
            [
              "Approved + active template mappings",
              <CountValue key="m" value={readiness.approvedActiveMappingCount} />,
            ],
            [
              "Active canary destinations",
              <CountValue key="c" value={readiness.activeCanaryDestinationCount} />,
            ],
          ]}
        />
        <p className="mt-3 text-[11px] leading-4 text-slate-500">
          Secrets are never rendered. Where a variable matters, only its NAME and whether it is
          present, missing or invalid is shown — no access token, app secret, verify token, cron
          secret or service-role key is read into this page or sent to the browser.
        </p>
      </SectionCard>
    </div>
  );
}
