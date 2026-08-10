"use client";

// ============================================================================
// QuickFurno Admin V2 — Messages (C-WA1).
//
// Two directions, two AUTHORITATIVE TABLES, never merged into a fake unified
// stream: outbound rows come from communication_messages, inbound rows from
// communication_inbound_messages. Direction is therefore a fact about which
// ledger a row lives in, not a guessed field.
//
// Message detail is loaded ON DEMAND via `?message=<uuid>` — closing the drawer
// removes the parameter and the query stops being issued.
//
// No plaintext destination exists in the schema and none is rendered: the ledger
// stores only a sha256 hash (never projected) and an already-masked form.
// There is no Send, Resend, Retry or Cancel control on this screen.
// ============================================================================

import { DataTable, Drawer, SectionCard, SelectFilter, StatusBadge } from "../AdminPrimitives";
import { Pagination } from "../Pagination";
import type {
  SectionFault,
  WhatsAppDeliveryRow,
  WhatsAppInboundRow,
  WhatsAppMessageDetail,
  WhatsAppMessageRow,
} from "@/services/adminWhatsAppService";
import type { DirectoryPage } from "@/lib/adminPaging";
import type { WhatsAppQuery } from "./whatsappAdminTypes";
import { FaultNotice, FactGrid, ReadOnlyNotice, humanize, messageStatusTone, when } from "./whatsappShared";

const OUTBOUND_STATUS_OPTIONS = [
  "All",
  "queued",
  "dispatching",
  "accepted",
  "sent",
  "delivered",
  "read",
  "failed",
  "retry_scheduled",
  "dead_letter",
  "cancelled",
];
const LANE_OPTIONS = ["All", "authentication", "business"];
const INBOUND_STATUS_OPTIONS = [
  "All",
  "captured",
  "normalized",
  "identity_resolved",
  "identity_ambiguous",
  "identity_unknown",
  "failed",
];

function MessageDetailBody({ detail }: { detail: WhatsAppMessageDetail }) {
  return (
    <div className="space-y-4">
      <SectionCard title="Message" description="Canonical ledger state.">
        <FactGrid
          rows={[
            ["Status", <StatusBadge key="s" value={humanize(detail.status)} tone={messageStatusTone(detail.status)} />],
            ["Message type", humanize(detail.messageType)],
            ["Template key", detail.templateKey ?? "—"],
            ["Lane", detail.lane],
            ["Consent scope", detail.consentScope ?? "Unclassified — blocked by the scope registry"],
            ["Recipient type", detail.recipientType],
            ["Destination (masked)", <code key="d" className="text-[12px]">{detail.destinationMasked}</code>],
            ["Destination source", humanize(detail.destinationSource)],
            ["Provider", detail.provider],
            ["Priority", detail.priority],
            ["Attempts", `${detail.attemptCount} of ${detail.maxAttempts}`],
            ["Entity", detail.entityType ? `${detail.entityType} · ${detail.entityId ?? "—"}` : "—"],
          ]}
        />
      </SectionCard>

      <SectionCard title="Lifecycle" description="Timestamps written by the existing delivery authority.">
        <FactGrid
          rows={[
            ["Created", when(detail.createdAt)],
            ["Scheduled", when(detail.scheduledAt)],
            ["Accepted", when(detail.acceptedAt)],
            ["Sent", when(detail.sentAt)],
            ["Delivered", when(detail.deliveredAt)],
            ["Read", when(detail.readAt)],
            ["Failed", when(detail.failedAt)],
            ["Next retry", when(detail.nextRetryAt)],
          ]}
        />
        <p className="mt-3 text-[11px] leading-4 text-slate-500">
          <strong>accepted</strong> originates from the outbound send response, not from a Meta
          webhook. Meta delivery callbacks map to sent / delivered / read / failed. Transitions are
          forward-only and a duplicate callback for the same state is a no-op.
        </p>
      </SectionCard>

      {detail.failureCode || detail.failureReasonSanitized ? (
        <SectionCard title="Failure" description="Sanitized classification only — never a provider body.">
          <FactGrid
            rows={[
              ["Failure code", detail.failureCode ?? "—"],
              ["Sanitized reason", detail.failureReasonSanitized ?? "—"],
            ]}
          />
        </SectionCard>
      ) : null}

      <SectionCard
        title="Delivery events"
        description="Bounded to the 10 most recent events for this message."
      >
        {detail.deliveryEventsFault ? (
          <FaultNotice fault={detail.deliveryEventsFault} />
        ) : (
          <>
            <DataTable<WhatsAppDeliveryRow>
              density="compact"
              columns={[
                { header: "Occurred", cell: (row) => <span className="whitespace-nowrap">{when(row.occurredAt)}</span> },
                { header: "Event", cell: (row) => <StatusBadge value={row.normalizedEventType} tone={messageStatusTone(row.normalizedEventType)} /> },
                { header: "Provider", cell: (row) => row.provider },
                { header: "Classification", cell: (row) => row.failureClassification ?? <span className="text-slate-400">—</span> },
              ]}
              rows={[...detail.deliveryEvents]}
              emptyTitle="No delivery events"
              emptyMessage="No provider callback has been recorded against this message."
            />
            {detail.deliveryEventsTruncated ? (
              <p className="mt-2 text-[11px] text-slate-500">
                Older events exist and are not shown here — open the Delivery tab for the full paged trace.
              </p>
            ) : null}
          </>
        )}
      </SectionCard>

      <SectionCard title="Correlation" description="Truncated references only.">
        <FactGrid
          rows={[
            ["Correlation reference", detail.correlationReference ?? "—"],
            ["Idempotency reference", detail.idempotencyReference ?? "—"],
            ["Policy decision", detail.policyDecisionId ?? "—"],
          ]}
        />
      </SectionCard>
    </div>
  );
}

export function WhatsAppMessagesTab({
  messages,
  inbound,
  detail,
  query,
  setParam,
}: {
  messages?: { data: DirectoryPage<WhatsAppMessageRow>; fault: SectionFault | null };
  inbound?: { data: DirectoryPage<WhatsAppInboundRow>; fault: SectionFault | null };
  detail?: { data: WhatsAppMessageDetail | null; fault: SectionFault | null };
  query: WhatsAppQuery;
  setParam: (key: string, value?: string) => void;
}) {
  const showInbound = query.view === "inbound";

  return (
    <div className="space-y-4">
      <ReadOnlyNotice>
        The outbound ledger and the inbound message store are two separate authoritative tables and
        are shown separately. No plaintext destination exists in either schema — only a hash, which
        is never shown, and an already-masked form. There is no send, resend or retry control here.
      </ReadOnlyNotice>

      <div className="flex flex-wrap items-center gap-2">
        <SelectFilter
          label="Direction"
          value={showInbound ? "inbound" : "outbound"}
          onChange={(value) => setParam("view", value === "outbound" ? undefined : value)}
          options={["outbound", "inbound"]}
        />
        {showInbound ? (
          <SelectFilter
            label="Processing"
            value={query.status ?? "All"}
            onChange={(value) => setParam("status", value)}
            options={INBOUND_STATUS_OPTIONS}
          />
        ) : (
          <>
            <SelectFilter
              label="Status"
              value={query.status ?? "All"}
              onChange={(value) => setParam("status", value)}
              options={OUTBOUND_STATUS_OPTIONS}
            />
            <SelectFilter
              label="Lane"
              value={query.lane ?? "All"}
              onChange={(value) => setParam("lane", value)}
              options={LANE_OPTIONS}
            />
          </>
        )}
      </div>

      {showInbound ? (
        inbound?.fault ? (
          <FaultNotice fault={inbound.fault} />
        ) : inbound ? (
          <>
            <DataTable<WhatsAppInboundRow>
              density="compact"
              getRowKey={(row) => row.id}
              columns={[
                { header: "Received", cell: (row) => <span className="whitespace-nowrap">{when(row.receivedAt)}</span> },
                { header: "Sender (masked)", cell: (row) => row.senderMasked ?? <span className="text-slate-400">—</span> },
                { header: "Type", cell: (row) => humanize(row.messageType) },
                {
                  header: "Consent command",
                  cell: (row) =>
                    row.consentCommand ? (
                      <StatusBadge value={row.consentCommand.toUpperCase()} tone="violet" />
                    ) : (
                      <span className="text-[11px] text-slate-400">—</span>
                    ),
                },
                {
                  header: "Identity",
                  cell: (row) => (
                    <span className="text-[12px]">
                      {row.resolvedPrincipalType ?? "unresolved"} · {row.identityConfidence}
                    </span>
                  ),
                },
                { header: "Processing", cell: (row) => <StatusBadge value={humanize(row.processingStatus)} /> },
              ]}
              rows={[...inbound.data.rows]}
              emptyTitle="No inbound messages"
              emptyMessage="No verified inbound WhatsApp message has been persisted in this environment."
            />
            <Pagination
              page={inbound.data.page}
              pageSize={inbound.data.pageSize}
              total={inbound.data.total}
              onPageChange={(page) => setParam("page", String(page))}
              noun="inbound messages"
            />
            <p className="text-[11px] leading-4 text-slate-500">
              Message content is not rendered. Only the stored classification and, for consent
              commands, the normalized STOP / START / HELP verdict are shown. Raw webhook payloads are
              never exposed.
            </p>
          </>
        ) : (
          <FaultNotice fault="UNAVAILABLE" />
        )
      ) : messages?.fault ? (
        <FaultNotice fault={messages.fault} />
      ) : messages ? (
        <>
          <DataTable<WhatsAppMessageRow>
            density="compact"
            getRowKey={(row) => row.id}
            onRowClick={(row) => setParam("message", row.id)}
            isRowActive={(row) => query.message === row.id}
            columns={[
              { header: "Created", cell: (row) => <span className="whitespace-nowrap">{when(row.createdAt)}</span> },
              { header: "Type", cell: (row) => humanize(row.messageType) },
              { header: "Template", cell: (row) => row.templateKey ?? <span className="text-slate-400">—</span> },
              { header: "Lane", cell: (row) => row.lane },
              { header: "Recipient", cell: (row) => row.recipientType },
              { header: "Destination", cell: (row) => <code className="text-[12px]">{row.destinationMasked}</code> },
              {
                header: "Status",
                cell: (row) => <StatusBadge value={humanize(row.status)} tone={messageStatusTone(row.status)} />,
              },
              { header: "Provider", cell: (row) => row.provider },
            ]}
            rows={[...messages.data.rows]}
            emptyTitle="No messages"
            emptyMessage="The communication ledger holds no WhatsApp rows matching these filters."
          />
          <Pagination
            page={messages.data.page}
            pageSize={messages.data.pageSize}
            total={messages.data.total}
            onPageChange={(page) => setParam("page", String(page))}
            noun="messages"
          />
        </>
      ) : (
        <FaultNotice fault="UNAVAILABLE" />
      )}

      {query.message ? (
        <Drawer
          title="Message detail"
          subtitle="Loaded on demand"
          onClose={() => setParam("message", undefined)}
          width="2xl"
        >
          {detail?.fault ? (
            <FaultNotice fault={detail.fault} />
          ) : detail?.data ? (
            <MessageDetailBody detail={detail.data} />
          ) : (
            <FaultNotice fault="UNAVAILABLE" />
          )}
        </Drawer>
      ) : null}
    </div>
  );
}
