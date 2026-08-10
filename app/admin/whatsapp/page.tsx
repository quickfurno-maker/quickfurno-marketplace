// ============================================================================
// QuickFurno Admin V2 — WhatsApp Command Center route (C-WA1).
//
// Server-guarded, server-paged, LAZY BY TAB. Only the active tab's loader runs:
// a hidden tab performs no database work at all, so opening Overview never pays
// for the message ledger, the consent tables or the automation join.
//
// The message detail loader runs ONLY when `?message=<uuid>` is present — it is
// on-demand by construction, not merely hidden after loading.
//
// This route reads. It never sends, submits, activates, maps, overrides or
// mutates anything: every function it calls lives in the read-only
// services/adminWhatsAppService.ts boundary.
// ============================================================================

import { redirect } from "next/navigation";
import { getAdminSession } from "@/app/actions";
import { WhatsAppControlCenter } from "@/components/admin/whatsapp/WhatsAppControlCenter";
import {
  getWhatsAppAdminOverview,
  getWhatsAppAutomationPage,
  getWhatsAppConsentPage,
  getWhatsAppDeliveryPage,
  getWhatsAppInboundPage,
  getWhatsAppMessageDetail,
  getWhatsAppMessagePage,
  getWhatsAppProviderBilling,
  getWhatsAppProviderReadiness,
  getWhatsAppTemplatePage,
} from "@/services/adminWhatsAppService";
import type { WhatsAppControlCenterPayload, WhatsAppTab } from "@/components/admin/whatsapp/whatsappAdminTypes";
import { WHATSAPP_TABS } from "@/components/admin/whatsapp/whatsappAdminTypes";

export const dynamic = "force-dynamic";

// Fixed administrator-facing text. A raw exception or database message is NEVER
// rendered: it can embed SQL, column names, row values or connection detail.
const WHATSAPP_LOAD_ERROR =
  "The WhatsApp control center could not be loaded. Please retry — if this persists, contact engineering.";

function logWhatsAppRouteFailure(scope: string, error: unknown) {
  const safe = error as { name?: string; code?: string } | null;
  console.error("[admin-whatsapp-route] load failed", {
    scope,
    name: safe?.name ?? "Error",
    code: safe?.code ?? "UNKNOWN",
  });
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseTab(raw: unknown): WhatsAppTab {
  return typeof raw === "string" && (WHATSAPP_TABS as readonly string[]).includes(raw)
    ? (raw as WhatsAppTab)
    : "overview";
}

export default async function AdminWhatsAppPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const session = await getAdminSession();
  if (!session.isLoggedIn) redirect("/admin/login");
  if (!session.isSuperadmin) redirect("/admin/login?error=unauthorized");

  const sp = searchParams ?? {};
  const one = (key: string) => first(sp[key]);
  const tab = parseTab(one("tab"));
  const page = one("page");

  const query = {
    tab,
    page,
    view: one("view"),
    group: one("group"),
    lane: one("lane"),
    approval: one("approval"),
    mapping: one("mapping"),
    search: one("search"),
    status: one("status"),
    scope: one("scope"),
    state: one("state"),
    eventType: one("eventType"),
    family: one("family"),
    message: one("message"),
    template: one("template"),
  };

  let payload: WhatsAppControlCenterPayload = { tab };
  let error: string | null = null;

  try {
    if (tab === "overview") {
      payload = { tab, overview: await getWhatsAppAdminOverview() };
    } else if (tab === "templates") {
      payload = {
        tab,
        templates: await getWhatsAppTemplatePage({
          page,
          group: query.group,
          lane: query.lane,
          approval: query.approval,
          mapping: query.mapping,
          search: query.search,
        }),
      };
    } else if (tab === "messages") {
      const inbound = query.view === "inbound";
      // The two directions live in two different authoritative tables. Only the
      // selected one is read — never both.
      const [messages, inboundPage, detail] = await Promise.all([
        inbound ? Promise.resolve(null) : getWhatsAppMessagePage({
          page,
          status: query.status,
          lane: query.lane,
        }),
        inbound ? getWhatsAppInboundPage({ page, processingStatus: query.status }) : Promise.resolve(null),
        // ON DEMAND: no message id in the URL means no detail query at all.
        query.message ? getWhatsAppMessageDetail(query.message) : Promise.resolve(null),
      ]);
      payload = {
        tab,
        messages: messages ?? undefined,
        inbound: inboundPage ?? undefined,
        messageDetail: detail ?? undefined,
      };
    } else if (tab === "delivery") {
      payload = { tab, delivery: await getWhatsAppDeliveryPage({ page, eventType: query.eventType }) };
    } else if (tab === "consent") {
      payload = {
        tab,
        consent: await getWhatsAppConsentPage({
          page,
          view: query.view,
          scope: query.scope,
          state: query.state,
        }),
      };
    } else if (tab === "provider") {
      const readiness = await getWhatsAppProviderReadiness();
      payload = {
        tab,
        provider: {
          readiness,
          billing: getWhatsAppProviderBilling(readiness),
        },
      };
    } else if (tab === "automation") {
      payload = {
        tab,
        automation: await getWhatsAppAutomationPage({
          page,
          family: query.family,
          status: query.status,
        }),
      };
    }
  } catch (caught) {
    logWhatsAppRouteFailure(`whatsapp/${tab}`, caught);
    error = WHATSAPP_LOAD_ERROR;
  }

  return <WhatsAppControlCenter payload={payload} query={query} error={error} />;
}
