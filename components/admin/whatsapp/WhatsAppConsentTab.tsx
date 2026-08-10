"use client";

// ============================================================================
// QuickFurno Admin V2 — Consent (C-WA1).
//
// Preferences and suppressions are two different records answering two different
// questions, so they are two sub-views rather than one blended list:
//   preference  — a PRINCIPAL's state for a scope (allowed / blocked / unknown)
//   suppression — a DESTINATION-level block, keyed by hash
//
// The destination hash is deliberately NOT projected into this UI: it is a
// pseudonymous identifier with no admin use, and rendering it would create a
// correlatable handle for a phone number that the schema went out of its way to
// avoid storing.
//
// There is no manual consent override, no force-send, and no suppression bypass.
// ============================================================================

import { DataTable, SelectFilter, StatusBadge } from "../AdminPrimitives";
import { Pagination } from "../Pagination";
import type {
  WhatsAppConsentPageResult,
  WhatsAppPreferenceRow,
  WhatsAppSuppressionRow,
} from "@/services/adminWhatsAppService";
import type { WhatsAppQuery } from "./whatsappAdminTypes";
import { FaultNotice, ReadOnlyNotice, humanize, when } from "./whatsappShared";

const PREFERENCE_SCOPES = ["All", "authentication", "transactional", "marketing"];
const PREFERENCE_STATES = ["All", "allowed", "blocked", "unknown"];
const SUPPRESSION_SCOPES = ["All", "marketing", "transactional", "global"];

function stateTone(state: string): "emerald" | "rose" | "slate" {
  if (state === "allowed") return "emerald";
  if (state === "blocked") return "rose";
  return "slate";
}

export function WhatsAppConsentTab({
  result,
  query,
  setParam,
}: {
  result?: WhatsAppConsentPageResult;
  query: WhatsAppQuery;
  setParam: (key: string, value?: string) => void;
}) {
  if (!result) return <FaultNotice fault="UNAVAILABLE" />;

  const showSuppressions = query.view === "suppressions";

  return (
    <div className="space-y-4">
      <div className="rounded-[var(--qfa-radius)] border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[13px] leading-5 text-amber-900">
        <strong>A CRM contact existing is not WhatsApp consent.</strong> Consent is held only by the
        communication preference and suppression records below. A vendor or client having a phone
        number in the CRM grants nothing, and nothing on this page can override, bypass or force past
        a block.
      </div>

      <ReadOnlyNotice>
        STOP and START are written by the existing transactional consent writer from verified inbound
        commands. A STOP suppresses the marketing and transactional scopes only — authentication is
        deliberately unaffected, because that code is requested by the user at that moment.
      </ReadOnlyNotice>

      <div className="flex flex-wrap items-center gap-2">
        <SelectFilter
          label="Record"
          value={showSuppressions ? "suppressions" : "preferences"}
          onChange={(value) => setParam("view", value === "preferences" ? undefined : value)}
          options={["preferences", "suppressions"]}
        />
        <SelectFilter
          label="Scope"
          value={query.scope ?? "All"}
          onChange={(value) => setParam("scope", value)}
          options={showSuppressions ? SUPPRESSION_SCOPES : PREFERENCE_SCOPES}
        />
        {!showSuppressions ? (
          <SelectFilter
            label="State"
            value={query.state ?? "All"}
            onChange={(value) => setParam("state", value)}
            options={PREFERENCE_STATES}
          />
        ) : null}
      </div>

      {showSuppressions ? (
        result.suppressionsFault ? (
          <FaultNotice fault={result.suppressionsFault} />
        ) : (
          <>
            <DataTable<WhatsAppSuppressionRow>
              density="compact"
              getRowKey={(row) => row.id}
              columns={[
                { header: "Scope", cell: (row) => row.scope },
                { header: "Reason", cell: (row) => humanize(row.reason) },
                { header: "Source", cell: (row) => row.source },
                {
                  header: "State",
                  cell: (row) => (
                    <StatusBadge
                      value={row.isActive ? "active" : "inactive"}
                      tone={row.isActive ? "rose" : "slate"}
                    />
                  ),
                },
                { header: "Suppressed", cell: (row) => <span className="whitespace-nowrap">{when(row.suppressedAt)}</span> },
                { header: "Expires", cell: (row) => when(row.expiresAt) },
              ]}
              rows={[...result.suppressions.rows]}
              emptyTitle="No suppressions"
              emptyMessage="No WhatsApp suppression record exists in this environment."
            />
            <Pagination
              page={result.suppressions.page}
              pageSize={result.suppressions.pageSize}
              total={result.suppressions.total}
              onPageChange={(page) => setParam("page", String(page))}
              noun="suppressions"
            />
            <p className="text-[11px] leading-4 text-slate-500">
              Suppressions are keyed by destination hash. The hash is not shown — it identifies a
              phone number the schema deliberately never stores in plaintext.
            </p>
          </>
        )
      ) : result.preferencesFault ? (
        <FaultNotice fault={result.preferencesFault} />
      ) : (
        <>
          <DataTable<WhatsAppPreferenceRow>
            density="compact"
            getRowKey={(row) => row.id}
            columns={[
              { header: "Principal", cell: (row) => row.principalType },
              {
                header: "Reference",
                cell: (row) =>
                  row.principalId ? (
                    <code className="text-[12px]">{row.principalId.slice(0, 8)}…</code>
                  ) : (
                    <span className="text-slate-400">—</span>
                  ),
              },
              { header: "Scope", cell: (row) => row.scope },
              {
                header: "State",
                cell: (row) => <StatusBadge value={row.state} tone={stateTone(row.state)} />,
              },
              { header: "Source", cell: (row) => row.source },
              { header: "Consented", cell: (row) => when(row.consentedAt) },
              { header: "Withdrawn", cell: (row) => when(row.withdrawnAt) },
            ]}
            rows={[...result.preferences.rows]}
            emptyTitle="No preference records"
            emptyMessage="No WhatsApp communication preference exists in this environment."
          />
          <Pagination
            page={result.preferences.page}
            pageSize={result.preferences.pageSize}
            total={result.preferences.total}
            onPageChange={(page) => setParam("page", String(page))}
            noun="preferences"
          />
          <p className="text-[11px] leading-4 text-slate-500">
            An <strong>unknown</strong> preference state is not consent. The outbound path fails
            closed on a missing, malformed or unreadable consent authority.
          </p>
        </>
      )}
    </div>
  );
}
