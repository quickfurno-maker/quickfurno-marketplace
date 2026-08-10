// ============================================================================
// QuickFurno Admin V2 — WhatsApp Command Center shared view types (C-WA1).
//
// PURE type/vocabulary module. It imports ONLY types from the server-only read
// layer (erased at compile time), so nothing here can pull the service_role
// client or a provider adapter into a client bundle.
// ============================================================================

import type {
  SectionFault,
  WhatsAppAdminOverview,
  WhatsAppAutomationPageResult,
  WhatsAppConsentPageResult,
  WhatsAppDeliveryRow,
  WhatsAppInboundRow,
  WhatsAppMessageDetail,
  WhatsAppMessageRow,
  WhatsAppProviderBilling,
  WhatsAppProviderReadiness,
  WhatsAppTemplatePageResult,
} from "@/services/adminWhatsAppService";
import type { DirectoryPage } from "@/lib/adminPaging";

export const WHATSAPP_TABS = [
  "overview",
  "templates",
  "messages",
  "delivery",
  "consent",
  "provider",
  "automation",
] as const;

export type WhatsAppTab = (typeof WHATSAPP_TABS)[number];

/** Human tab labels, in the same order as WHATSAPP_TABS. */
export const WHATSAPP_TAB_LABELS: Readonly<Record<WhatsAppTab, string>> = Object.freeze({
  overview: "Overview",
  templates: "Templates",
  messages: "Messages",
  delivery: "Delivery",
  consent: "Consent",
  provider: "Provider",
  automation: "Automation",
});

/**
 * Only the ACTIVE tab's slice is ever populated — this shape is what makes the
 * lazy loading visible in the type system rather than merely intended.
 */
export interface WhatsAppControlCenterPayload {
  readonly tab: WhatsAppTab;
  readonly overview?: WhatsAppAdminOverview;
  readonly templates?: WhatsAppTemplatePageResult;
  readonly messages?: { readonly data: DirectoryPage<WhatsAppMessageRow>; readonly fault: SectionFault | null };
  readonly inbound?: { readonly data: DirectoryPage<WhatsAppInboundRow>; readonly fault: SectionFault | null };
  readonly messageDetail?: { readonly data: WhatsAppMessageDetail | null; readonly fault: SectionFault | null };
  readonly delivery?: { readonly data: DirectoryPage<WhatsAppDeliveryRow>; readonly fault: SectionFault | null };
  readonly consent?: WhatsAppConsentPageResult;
  readonly provider?: {
    readonly readiness: WhatsAppProviderReadiness;
    readonly billing: WhatsAppProviderBilling;
  };
  readonly automation?: WhatsAppAutomationPageResult;
}

export type WhatsAppQuery = Record<string, string | undefined> & { tab: WhatsAppTab };

/** Fixed, non-technical text for a section that could not be read. */
export function faultCopy(fault: SectionFault): { title: string; message: string } {
  return fault === "NOT_PROVISIONED"
    ? {
        title: "Not provisioned in this environment",
        message:
          "The underlying communication table does not exist here, so there is nothing to report. This is a deployment state, not an empty result — no count on this page should be read as zero.",
      }
    : {
        title: "Temporarily unavailable",
        message:
          "This section could not be read. Please retry — if it persists, contact engineering. No value is shown rather than a value that might be wrong.",
      };
}
