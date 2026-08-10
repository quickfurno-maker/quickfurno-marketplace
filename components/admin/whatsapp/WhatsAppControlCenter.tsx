"use client";

// ============================================================================
// QuickFurno Admin V2 — WhatsApp Command Center shell (C-WA1).
//
// Tab state lives in the URL (`?tab=…`), so switching tabs is a server
// navigation that loads exactly one tab's data. A hidden tab has no data in
// props and issues no fetch of its own — there is no client-side data loading
// anywhere in this workspace.
//
// This shell renders NO send, retry, submit, activate, sync, approve or override
// control, because no such already-authorized Admin action exists to expose.
// ============================================================================

import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader, TabPanel, Tabs, EmptyState } from "../AdminPrimitives";
import { WhatsAppOverviewTab } from "./WhatsAppOverviewTab";
import { WhatsAppTemplatesTab } from "./WhatsAppTemplatesTab";
import { WhatsAppMessagesTab } from "./WhatsAppMessagesTab";
import { WhatsAppDeliveryTab } from "./WhatsAppDeliveryTab";
import { WhatsAppConsentTab } from "./WhatsAppConsentTab";
import { WhatsAppProviderTab } from "./WhatsAppProviderTab";
import { WhatsAppAutomationTab } from "./WhatsAppAutomationTab";
import {
  WHATSAPP_TABS,
  WHATSAPP_TAB_LABELS,
  type WhatsAppControlCenterPayload,
  type WhatsAppQuery,
  type WhatsAppTab,
} from "./whatsappAdminTypes";

const TAB_LABELS: string[] = WHATSAPP_TABS.map((tab) => WHATSAPP_TAB_LABELS[tab]);

function tabFromLabel(label: string): WhatsAppTab {
  const found = WHATSAPP_TABS.find((tab) => WHATSAPP_TAB_LABELS[tab] === label);
  return found ?? "overview";
}

export function WhatsAppControlCenter({
  payload,
  query,
  error,
}: {
  payload: WhatsAppControlCenterPayload;
  query: WhatsAppQuery;
  error: string | null;
}) {
  const router = useRouter();
  const params = useSearchParams();

  /**
   * Navigate by rewriting the URL.
   *
   *   * changing tab drops every filter — a Messages filter must never leak into
   *     Consent and silently narrow it;
   *   * changing the `view` sub-selector drops the filters that belong to the
   *     other sub-view, because their vocabularies differ (an outbound status
   *     is not an inbound processing status);
   *   * changing any filter resets paging.
   */
  const setParam = (key: string, value?: string) => {
    const sp = new URLSearchParams(params?.toString() ?? "");

    if (key === "tab") {
      const next = new URLSearchParams();
      if (value && value !== "overview") next.set("tab", value);
      const search = next.toString();
      router.push(search ? `/admin/whatsapp?${search}` : "/admin/whatsapp");
      return;
    }

    if (value === undefined || value === "" || value === "All") sp.delete(key);
    else sp.set(key, value);

    if (key !== "page") sp.delete("page");
    if (key === "view") {
      for (const dependent of ["status", "scope", "state", "lane", "message"]) sp.delete(dependent);
    }

    const search = sp.toString();
    router.push(search ? `/admin/whatsapp?${search}` : "/admin/whatsapp");
  };

  const activeLabel = WHATSAPP_TAB_LABELS[payload.tab];

  return (
    <div className="space-y-4">
      <PageHeader
        title="WhatsApp control center"
        description="Provider readiness, template governance, the message ledger, delivery, consent and automation visibility — read-only over the existing communication authority."
      />

      <Tabs
        tabs={TAB_LABELS}
        active={activeLabel}
        onChange={(label) => setParam("tab", tabFromLabel(label))}
        label="WhatsApp workspace sections"
        id="qf-whatsapp"
      />

      <TabPanel id="qf-whatsapp" active={activeLabel} className="qfa-profile-enter space-y-4 pt-1">
        {error ? (
          <EmptyState title="WhatsApp control center unavailable" message={error} />
        ) : payload.tab === "overview" ? (
          <WhatsAppOverviewTab overview={payload.overview} onNavigate={setParam} />
        ) : payload.tab === "templates" ? (
          <WhatsAppTemplatesTab result={payload.templates} query={query} setParam={setParam} />
        ) : payload.tab === "messages" ? (
          <WhatsAppMessagesTab
            messages={payload.messages}
            inbound={payload.inbound}
            detail={payload.messageDetail}
            query={query}
            setParam={setParam}
          />
        ) : payload.tab === "delivery" ? (
          <WhatsAppDeliveryTab result={payload.delivery} query={query} setParam={setParam} />
        ) : payload.tab === "consent" ? (
          <WhatsAppConsentTab result={payload.consent} query={query} setParam={setParam} />
        ) : payload.tab === "provider" ? (
          <WhatsAppProviderTab readiness={payload.provider} />
        ) : (
          <WhatsAppAutomationTab result={payload.automation} query={query} setParam={setParam} />
        )}
      </TabPanel>
    </div>
  );
}
