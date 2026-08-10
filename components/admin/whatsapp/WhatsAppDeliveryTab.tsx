"use client";

// ============================================================================
// QuickFurno Admin V2 — Delivery (C-WA1).
//
// A read-only window on the EXISTING append-only delivery trace. There is no
// second lifecycle here and no way to write one: the table's own grant gives
// service_role SELECT + INSERT only, and this screen offers neither
// "Mark delivered", "Retry failed" nor "Override status".
//
// The established semantics are stated on the page because an operator reading a
// trace needs them to interpret it correctly.
// ============================================================================

import { useRouter } from "next/navigation";
import { DataTable, SelectFilter, StatusBadge } from "../AdminPrimitives";
import { Pagination } from "../Pagination";
import type { SectionFault, WhatsAppDeliveryRow } from "@/services/adminWhatsAppService";
import type { DirectoryPage } from "@/lib/adminPaging";
import type { WhatsAppQuery } from "./whatsappAdminTypes";
import { FaultNotice, ReadOnlyNotice, messageStatusTone, when } from "./whatsappShared";

const EVENT_OPTIONS = ["All", "accepted", "sent", "delivered", "read", "failed"];

export function WhatsAppDeliveryTab({
  result,
  query,
  setParam,
}: {
  result?: { data: DirectoryPage<WhatsAppDeliveryRow>; fault: SectionFault | null };
  query: WhatsAppQuery;
  setParam: (key: string, value?: string) => void;
}) {
  const router = useRouter();

  if (!result) return <FaultNotice fault="UNAVAILABLE" />;
  if (result.fault) return <FaultNotice fault={result.fault} />;

  return (
    <div className="space-y-4">
      <ReadOnlyNotice>
        <strong>accepted</strong> originates from the outbound send response, not from a Meta webhook.
        Meta delivery callbacks map to <strong>sent</strong>, <strong>delivered</strong>,{" "}
        <strong>read</strong> and <strong>failed</strong>. A duplicate callback for a state already
        recorded is a no-op, transitions are forward-only, and an unknown outcome is never permission
        to resend. This trace is append-only and cannot be edited from the admin.
      </ReadOnlyNotice>

      <div className="flex flex-wrap items-center gap-2">
        <SelectFilter
          label="Event type"
          value={query.eventType ?? "All"}
          onChange={(value) => setParam("eventType", value)}
          options={EVENT_OPTIONS}
        />
      </div>

      <DataTable<WhatsAppDeliveryRow>
        density="compact"
        getRowKey={(row) => row.id}
        columns={[
          { header: "Occurred", cell: (row) => <span className="whitespace-nowrap">{when(row.occurredAt)}</span> },
          {
            header: "Event",
            cell: (row) => (
              <StatusBadge value={row.normalizedEventType} tone={messageStatusTone(row.normalizedEventType)} />
            ),
          },
          { header: "Provider", cell: (row) => row.provider },
          {
            // A real navigation to that message's on-demand detail — not a
            // decorative control. The target drawer loads server-side.
            header: "Message",
            cell: (row) => (
              <button
                type="button"
                onClick={() => router.push(`/admin/whatsapp?tab=messages&message=${row.messageId}`)}
                className="qfa-focus inline-flex min-h-10 appearance-none items-center rounded border-0 bg-transparent p-0 text-left text-[12px] font-semibold text-emerald-700 hover:underline sm:min-h-0"
              >
                {row.messageId.slice(0, 8)}…
              </button>
            ),
          },
          {
            header: "Classification",
            cell: (row) => row.failureClassification ?? <span className="text-slate-400">—</span>,
          },
          { header: "Recorded", cell: (row) => <span className="whitespace-nowrap">{when(row.createdAt)}</span> },
        ]}
        rows={[...result.data.rows]}
        emptyTitle="No delivery events"
        emptyMessage="No provider delivery callback has been recorded in this environment."
      />

      <Pagination
        page={result.data.page}
        pageSize={result.data.pageSize}
        total={result.data.total}
        onPageChange={(page) => setParam("page", String(page))}
        noun="delivery events"
      />

      <p className="text-[11px] leading-4 text-slate-500">
        Failure detail is limited to the sanitized classification the trace stores. Raw provider
        response bodies and raw webhook payloads are never read into this view.
      </p>
    </div>
  );
}
