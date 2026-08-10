// ============================================================================
// QuickFurno — services/adminWhatsAppService.ts   (C-WA1, SERVER ONLY)
//
// The Admin V2 WhatsApp Command Center read layer.
//
// READ-ONLY BY CONSTRUCTION. There is no insert, update, upsert, delete or rpc
// call anywhere in this file, and no provider adapter is imported — so no code
// path here can send a message, submit a template, activate a mapping, change a
// runtime policy, override a delivery status or write a consent decision. It
// reuses the EXISTING communication authorities and renders what they hold.
//
// AUTHORITIES REUSED (none of them changed by C-WA1):
//   readiness      lib/communication/providers/metaRuntimeReadiness.ts (PURE)
//   config         lib/communication/providers/metaCloudWhatsAppConfig.ts
//   runtime rows   services/communicationProviderRuntimeService.ts
//   mapping rules  lib/communication/whatsappTemplate.ts
//   consent scope  lib/communication/outboundConsentScope.ts
//   families       lib/automation/actionRegistry.ts
//   governance     lib/admin/whatsappSourceCatalogue.ts (committed manifests)
//
// SECRECY. No secret VALUE is read, returned or logged. Readiness reports
// variable NAMES and closed states only. Destinations exist in the ledger solely
// as `destination_hash` / `destination_masked`; the hash is NEVER returned to the
// UI — only the already-masked form is, and only where the schema stores one.
//
// BOUNDING. Every list read is bounded AT THE QUERY with .range()/.limit(), and
// every total is a `head: true` count — no endpoint here loads a table to count
// it, and there is no page-size parameter, so no caller can request 50/100/all.
//
// FAIL-SOFT PROVISIONING. Several communication migrations are deliberately not
// applied in every environment. A missing relation is reported as a truthful
// NOT_PROVISIONED section rather than crashing the page or — far worse —
// rendering an empty table that reads as "zero messages".
// ============================================================================

import "server-only";

import { adminClient } from "../lib/supabase";
import { isMissingRelationError } from "../lib/errors";
import {
  ADMIN_DIRECTORY_PAGE_SIZE,
  ADMIN_EMBEDDED_PANEL_LIMIT,
  boundPage,
  pageRange,
  type DirectoryPage,
} from "../lib/adminPaging";
import {
  listTemplateLocalContracts,
  listTemplateRemoteEvidence,
  remoteEvidenceFor,
  type TemplateLocalContract,
  type TemplateRemoteEvidence,
} from "../lib/admin/whatsappSourceCatalogue";
import {
  evaluateMetaReadiness,
  META_OPERATIONS,
  ReadinessState,
  type OperationReadiness,
  type ReadinessStateValue,
} from "../lib/communication/providers/metaRuntimeReadiness";
import { resolveOutboundMetaConfig } from "../lib/communication/providers/metaCloudWhatsAppConfig";
import { resolveOutboundConsentScope } from "../lib/communication/outboundConsentScope";
import { META_WHATSAPP_CLOUD_PROVIDER_KEY } from "../lib/communication/providers/metaCloudWhatsAppProvider";
import type {
  ProviderAccountRow,
  ProviderRuntimePolicyRow,
} from "../lib/communication/providers/metaRuntimeGate";
import {
  AUTOMATION_ACTION_REGISTRY,
  type AutomationActionType,
  type AutomationWorkflowFamily,
} from "../lib/automation/actionRegistry";

const CHANNEL = "whatsapp";

/** The ledger's own status vocabulary — mirrors the CHECK constraint exactly. */
export const WHATSAPP_MESSAGE_STATUSES = Object.freeze([
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
] as const);
export type WhatsAppMessageStatus = (typeof WHATSAPP_MESSAGE_STATUSES)[number];

/** The delivery-event vocabulary — mirrors the CHECK constraint exactly. */
export const WHATSAPP_DELIVERY_EVENT_TYPES = Object.freeze([
  "accepted",
  "sent",
  "delivered",
  "read",
  "failed",
] as const);
export type WhatsAppDeliveryEventType = (typeof WHATSAPP_DELIVERY_EVENT_TYPES)[number];

export const WHATSAPP_LANES = Object.freeze(["authentication", "business"] as const);
export const WHATSAPP_CONSENT_SCOPES = Object.freeze([
  "authentication",
  "transactional",
  "marketing",
] as const);
export const WHATSAPP_SUPPRESSION_SCOPES = Object.freeze([
  "marketing",
  "transactional",
  "global",
] as const);

/**
 * A section that could not be read. `NOT_PROVISIONED` means the relation does
 * not exist in this environment — a fact, not a failure, and never rendered as
 * a zero. `UNAVAILABLE` means the read itself failed.
 */
export type SectionFault = "NOT_PROVISIONED" | "UNAVAILABLE";

/** Every list result carries its own fault, so one missing table cannot blank a page. */
export type SectionResult<T> = { readonly data: T; readonly fault: SectionFault | null };

function okSection<T>(data: T): SectionResult<T> {
  return { data, fault: null };
}

function faultSection<T>(empty: T, error: unknown): SectionResult<T> {
  return { data: empty, fault: isMissingRelationError(error) ? "NOT_PROVISIONED" : "UNAVAILABLE" };
}

const EMPTY_PAGE = <T,>(): DirectoryPage<T> => ({
  rows: [],
  page: 1,
  pageSize: ADMIN_DIRECTORY_PAGE_SIZE,
  total: 0,
});

/** Server-side diagnostic. Logs the error CLASS only — never `message`. */
function logWhatsAppReadFailure(scope: string, error: unknown): void {
  const safe = error as { name?: string; code?: string } | null;
  console.error("[admin-whatsapp] read failed", {
    scope,
    name: safe?.name ?? "Error",
    code: safe?.code ?? "UNKNOWN",
  });
}

/**
 * Bounded exact count of a whole relation. `head: true` never transfers rows.
 *
 * IMPORTANT — a null return means "could not be counted", NOT zero. PostgREST
 * does not raise an error for a head-count against a MISSING relation: it
 * answers `{ count: null, error: null }`. (A full select on the same missing
 * relation DOES raise PGRST205 — only the head-count is silent.) Coercing that
 * null to 0 would print a confident "0 rows" for a table that does not exist in
 * this environment, so null is preserved all the way to the UI, which renders
 * it as Unknown. Never write `count ?? 0` against one of these.
 */
async function countRows(table: string): Promise<number | null> {
  const { count, error } = await adminClient()
    .from(table)
    .select("id", { count: "exact", head: true });
  if (error) throw error;
  return count ?? null;
}

// ===========================================================================
// PROVIDER READINESS
// ===========================================================================

/** Non-secret projection of a provider-account row. No token, no raw metadata. */
export interface ProviderAccountView {
  readonly displayName: string;
  readonly providerKey: string;
  readonly readinessStatus: string;
  readonly configurationStatus: string;
  readonly businessVerificationStatus: string;
  readonly phoneNumberStatus: string;
  readonly webhookStatus: string;
  readonly billingStatus: string;
  readonly healthStatus: string;
  readonly lastHealthCheckAt: string | null;
  readonly lastSyncedAt: string | null;
}

export interface RuntimePolicyView {
  readonly providerKey: string;
  readonly activationStatus: string;
  readonly outboundEnabled: boolean;
  readonly webhookProcessingEnabled: boolean;
  readonly healthCheckEnabled: boolean;
  readonly updatedAt: string | null;
}

export interface WhatsAppProviderReadiness {
  /** Per-operation closed states from the EXISTING pure evaluator. */
  readonly operations: readonly OperationReadiness[];
  /** null = no provider account row exists for the configured identity. */
  readonly account: ProviderAccountView | null;
  readonly accountFault: SectionFault | null;
  readonly runtimePolicy: RuntimePolicyView | null;
  readonly runtimePolicyFault: SectionFault | null;
  readonly approvedActiveMappingCount: number | null;
  readonly activeCanaryDestinationCount: number | null;
  /**
   * Whether outbound CONFIGURATION resolved at all. When false the identity is
   * unknown, so no account row can be matched and none is claimed.
   */
  readonly outboundConfigurationResolved: boolean;
  /** Env var NAMES the outbound path is missing/invalid. Never values. */
  readonly outboundMissingVariables: readonly string[];
  readonly outboundInvalidVariables: readonly string[];
  /**
   * Webhook facts kept deliberately separate — configuration present is NOT
   * subscription verified, and neither implies a recent verified callback.
   */
  readonly webhook: {
    readonly getConfigurationState: ReadinessStateValue;
    readonly postConfigurationState: ReadinessStateValue;
    readonly accountWebhookStatus: string | null;
    readonly lastVerifiedReceiptAt: string | null;
    readonly verifiedReceiptCount: number | null;
    readonly rejectedReceiptCount: number | null;
    readonly receiptsFault: SectionFault | null;
  };
}

async function readProviderAccount(
  phoneNumberReference: string,
): Promise<SectionResult<ProviderAccountRow | null>> {
  try {
    const { data, error } = await adminClient()
      .from("communication_provider_accounts")
      .select(
        "display_name, provider_key, readiness_status, configuration_status, business_verification_status, phone_number_status, webhook_status, billing_status, health_status, last_health_check_at, last_synced_at, account_reference, business_account_reference, phone_number_reference",
      )
      .eq("provider_key", META_WHATSAPP_CLOUD_PROVIDER_KEY)
      .eq("channel", CHANNEL)
      .eq("phone_number_reference", phoneNumberReference)
      .maybeSingle();
    if (error) throw error;
    return okSection((data as ProviderAccountRow | null) ?? null);
  } catch (error) {
    logWhatsAppReadFailure("provider-account", error);
    return faultSection<ProviderAccountRow | null>(null, error);
  }
}

async function readRuntimePolicy(): Promise<SectionResult<ProviderRuntimePolicyRow | null>> {
  try {
    const { data, error } = await adminClient()
      .from("communication_provider_runtime_policies")
      .select(
        "provider_key, channel, activation_status, outbound_enabled, webhook_processing_enabled, health_check_enabled, updated_at",
      )
      .eq("provider_key", META_WHATSAPP_CLOUD_PROVIDER_KEY)
      .eq("channel", CHANNEL)
      .maybeSingle();
    if (error) throw error;
    return okSection((data as ProviderRuntimePolicyRow | null) ?? null);
  } catch (error) {
    logWhatsAppReadFailure("runtime-policy", error);
    return faultSection<ProviderRuntimePolicyRow | null>(null, error);
  }
}

async function readApprovedActiveMappingCount(): Promise<number | null> {
  try {
    // APPROVED + ACTIVE only — exactly the condition selectApprovedProviderMapping()
    // enforces at send time. A looser count here would overstate readiness.
    const { count, error } = await adminClient()
      .from("communication_provider_template_mappings")
      .select("id", { count: "exact", head: true })
      .eq("provider_key", META_WHATSAPP_CLOUD_PROVIDER_KEY)
      .eq("channel", CHANNEL)
      .eq("approval_status", "approved")
      .eq("is_active", true);
    if (error) throw error;
    return count ?? null;
  } catch (error) {
    logWhatsAppReadFailure("mapping-count", error);
    return null;
  }
}

async function readActiveCanaryCount(): Promise<number | null> {
  try {
    const { count, error } = await adminClient()
      .from("communication_provider_canary_destinations")
      .select("id", { count: "exact", head: true })
      .eq("provider_key", META_WHATSAPP_CLOUD_PROVIDER_KEY)
      .eq("channel", CHANNEL)
      .eq("is_active", true);
    if (error) throw error;
    return count ?? null;
  } catch (error) {
    logWhatsAppReadFailure("canary-count", error);
    return null;
  }
}

async function readWebhookReceiptFacts(): Promise<
  SectionResult<{
    lastVerifiedReceiptAt: string | null;
    verifiedCount: number | null;
    rejectedCount: number | null;
  }>
> {
  try {
    const client = adminClient();
    const [verified, rejected, latest] = await Promise.all([
      client
        .from("communication_webhook_receipts")
        .select("id", { count: "exact", head: true })
        .eq("provider", META_WHATSAPP_CLOUD_PROVIDER_KEY)
        .eq("signature_valid", true),
      client
        .from("communication_webhook_receipts")
        .select("id", { count: "exact", head: true })
        .eq("provider", META_WHATSAPP_CLOUD_PROVIDER_KEY)
        .eq("signature_valid", false),
      client
        .from("communication_webhook_receipts")
        .select("received_at")
        .eq("provider", META_WHATSAPP_CLOUD_PROVIDER_KEY)
        .eq("signature_valid", true)
        .order("received_at", { ascending: false })
        .limit(1),
    ]);
    if (verified.error) throw verified.error;
    if (rejected.error) throw rejected.error;
    if (latest.error) throw latest.error;

    const latestRow = (latest.data ?? [])[0] as { received_at?: string } | undefined;
    return okSection({
      lastVerifiedReceiptAt: latestRow?.received_at ?? null,
      verifiedCount: verified.count ?? null,
      rejectedCount: rejected.count ?? null,
    });
  } catch (error) {
    logWhatsAppReadFailure("webhook-receipts", error);
    return faultSection({ lastVerifiedReceiptAt: null, verifiedCount: null, rejectedCount: null }, error);
  }
}

function toAccountView(row: ProviderAccountRow | null): ProviderAccountView | null {
  if (!row) return null;
  const raw = row as unknown as Record<string, unknown>;
  const text = (key: string): string =>
    typeof raw[key] === "string" && raw[key] !== "" ? (raw[key] as string) : "unknown";
  const nullableText = (key: string): string | null =>
    typeof raw[key] === "string" && raw[key] !== "" ? (raw[key] as string) : null;

  return {
    displayName: text("display_name"),
    providerKey: text("provider_key"),
    readinessStatus: text("readiness_status"),
    configurationStatus: text("configuration_status"),
    businessVerificationStatus: text("business_verification_status"),
    phoneNumberStatus: text("phone_number_status"),
    webhookStatus: text("webhook_status"),
    billingStatus: text("billing_status"),
    healthStatus: text("health_status"),
    lastHealthCheckAt: nullableText("last_health_check_at"),
    lastSyncedAt: nullableText("last_synced_at"),
  };
}

/**
 * The provider readiness page model.
 *
 * Runtime rows are fetched here and INJECTED into the existing pure evaluator —
 * this service never re-implements a readiness rule, and the evaluator itself
 * still performs no I/O.
 */
export async function getWhatsAppProviderReadiness(): Promise<WhatsAppProviderReadiness> {
  const env = process.env as Record<string, string | undefined>;
  const outbound = resolveOutboundMetaConfig(env);

  const [accountSection, policySection, mappingCount, canaryCount, receipts] = await Promise.all([
    outbound.ok
      ? readProviderAccount(outbound.config.phoneNumberId)
      : Promise.resolve(okSection<ProviderAccountRow | null>(null)),
    readRuntimePolicy(),
    readApprovedActiveMappingCount(),
    readActiveCanaryCount(),
    readWebhookReceiptFacts(),
  ]);

  // The evaluator receives the snapshot ONLY when the rows were actually read.
  // Passing a fabricated empty snapshot would turn "unknown" into a confident
  // DISABLED_BY_RUNTIME_POLICY, which is a different and untrue claim.
  const snapshot =
    policySection.fault === null
      ? {
          policy: policySection.data,
          account: accountSection.data,
          approvedActiveMappingCount: mappingCount ?? 0,
          activeCanaryDestinationCount: canaryCount ?? 0,
        }
      : undefined;

  const operations = evaluateMetaReadiness(env, snapshot);
  const byOperation = new Map(operations.map((op) => [op.operation, op]));
  const outboundOperation = byOperation.get("outbound");
  const policy = policySection.data as unknown as Record<string, unknown> | null;

  return {
    operations,
    account: toAccountView(accountSection.data),
    accountFault: accountSection.fault,
    runtimePolicy: policy
      ? {
          providerKey: String(policy.provider_key ?? META_WHATSAPP_CLOUD_PROVIDER_KEY),
          activationStatus: String(policy.activation_status ?? "disabled"),
          outboundEnabled: policy.outbound_enabled === true,
          webhookProcessingEnabled: policy.webhook_processing_enabled === true,
          healthCheckEnabled: policy.health_check_enabled === true,
          updatedAt: typeof policy.updated_at === "string" ? policy.updated_at : null,
        }
      : null,
    runtimePolicyFault: policySection.fault,
    approvedActiveMappingCount: mappingCount,
    activeCanaryDestinationCount: canaryCount,
    outboundConfigurationResolved: outbound.ok,
    outboundMissingVariables: outbound.ok ? [] : (outboundOperation?.missing ?? []),
    outboundInvalidVariables: outbound.ok ? [] : (outboundOperation?.invalid ?? []),
    webhook: {
      getConfigurationState: byOperation.get("webhook_get")?.state ?? ReadinessState.MISSING,
      postConfigurationState: byOperation.get("webhook_post")?.state ?? ReadinessState.MISSING,
      accountWebhookStatus: toAccountView(accountSection.data)?.webhookStatus ?? null,
      lastVerifiedReceiptAt: receipts.data.lastVerifiedReceiptAt,
      verifiedReceiptCount: receipts.data.verifiedCount,
      rejectedReceiptCount: receipts.data.rejectedCount,
      receiptsFault: receipts.fault,
    },
  };
}

// ===========================================================================
// TEMPLATES
// ===========================================================================

/** Non-secret projection of a provider template mapping row. */
export interface TemplateMappingView {
  readonly templateKey: string;
  readonly providerKey: string;
  readonly language: string;
  readonly providerTemplateName: string | null;
  readonly providerCategory: string | null;
  readonly approvalStatus: string;
  readonly qualityStatus: string | null;
  readonly version: string;
  readonly isActive: boolean;
  readonly bindingVersion: number | null;
  readonly boundPositionCount: number;
  readonly submittedAt: string | null;
  readonly approvedAt: string | null;
  readonly lastSyncedAt: string | null;
}

/** Why a template is not runtime-eligible. Closed vocabulary, fail-closed. */
export const TemplateRuntimeEligibility = Object.freeze({
  ELIGIBLE: "ELIGIBLE",
  NO_MAPPING: "NO_MAPPING",
  MAPPING_NOT_APPROVED: "MAPPING_NOT_APPROVED",
  MAPPING_NOT_ACTIVE: "MAPPING_NOT_ACTIVE",
  MAPPING_STATE_UNKNOWN: "MAPPING_STATE_UNKNOWN",
  BLOCKED_BY_RUNTIME: "BLOCKED_BY_RUNTIME",
} as const);
export type TemplateRuntimeEligibilityValue =
  (typeof TemplateRuntimeEligibility)[keyof typeof TemplateRuntimeEligibility];

/** One template row across its four INDEPENDENT truth dimensions. */
export interface WhatsAppTemplateRow {
  readonly local: TemplateLocalContract;
  readonly remote: readonly TemplateRemoteEvidence[];
  readonly mappings: readonly TemplateMappingView[];
  readonly runtimeEligibility: TemplateRuntimeEligibilityValue;
  /** DB catalogue row state, when the communication_templates row exists. */
  readonly ledgerReadinessStatus: string | null;
}

export interface WhatsAppTemplateQuery {
  readonly page?: string;
  readonly group?: string;
  readonly lane?: string;
  readonly approval?: string;
  readonly mapping?: string;
  readonly search?: string;
}

export interface WhatsAppTemplatePageResult extends DirectoryPage<WhatsAppTemplateRow> {
  readonly mappingFault: SectionFault | null;
  readonly ledgerFault: SectionFault | null;
  /** Totals across the WHOLE governed catalogue, not the current page. */
  readonly totals: {
    readonly localTemplates: number;
    readonly remoteApproved: number;
    readonly mappedActiveApproved: number;
  };
}

function projectMapping(raw: Record<string, unknown>): TemplateMappingView {
  const schema = raw.variables_schema;
  const bindings =
    schema && typeof schema === "object" && Array.isArray((schema as { bindings?: unknown }).bindings)
      ? ((schema as { bindings: unknown[] }).bindings)
      : [];
  const bindingVersion =
    schema && typeof schema === "object" && typeof (schema as { bindingVersion?: unknown }).bindingVersion === "number"
      ? ((schema as { bindingVersion: number }).bindingVersion)
      : null;

  return {
    templateKey: String(raw.template_key ?? ""),
    providerKey: String(raw.provider_key ?? ""),
    language: String(raw.language ?? "en"),
    providerTemplateName: typeof raw.provider_template_name === "string" ? raw.provider_template_name : null,
    providerCategory: typeof raw.provider_category === "string" ? raw.provider_category : null,
    approvalStatus: String(raw.approval_status ?? "draft"),
    qualityStatus: typeof raw.quality_status === "string" ? raw.quality_status : null,
    version: String(raw.version ?? "1.0"),
    isActive: raw.is_active === true,
    bindingVersion,
    boundPositionCount: bindings.length,
    submittedAt: typeof raw.submitted_at === "string" ? raw.submitted_at : null,
    approvedAt: typeof raw.approved_at === "string" ? raw.approved_at : null,
    lastSyncedAt: typeof raw.last_synced_at === "string" ? raw.last_synced_at : null,
  };
}

/**
 * Derive runtime eligibility from the mapping rows ALONE, then let the runtime
 * gate veto. This mirrors selectApprovedProviderMapping()'s conditions; it never
 * upgrades a template past what that function would accept.
 */
function deriveRuntimeEligibility(
  mappings: readonly TemplateMappingView[],
  mappingFault: SectionFault | null,
  runtimeBlocked: boolean,
): TemplateRuntimeEligibilityValue {
  if (mappingFault) return TemplateRuntimeEligibility.MAPPING_STATE_UNKNOWN;
  if (mappings.length === 0) return TemplateRuntimeEligibility.NO_MAPPING;
  const active = mappings.filter((m) => m.isActive);
  if (active.length === 0) {
    return mappings.some((m) => m.approvalStatus === "approved")
      ? TemplateRuntimeEligibility.MAPPING_NOT_ACTIVE
      : TemplateRuntimeEligibility.MAPPING_NOT_APPROVED;
  }
  if (!active.some((m) => m.approvalStatus === "approved" && m.providerTemplateName)) {
    return TemplateRuntimeEligibility.MAPPING_NOT_APPROVED;
  }
  // A perfectly mapped template is still not sendable while runtime is closed.
  return runtimeBlocked
    ? TemplateRuntimeEligibility.BLOCKED_BY_RUNTIME
    : TemplateRuntimeEligibility.ELIGIBLE;
}

/**
 * The template directory.
 *
 * The LOCAL CONTRACT catalogue is a bundled, deterministic 25-row governance
 * artifact, so it is filtered and paged in memory — this performs no unbounded
 * database read. The mapping rows fetched from the database are bounded to the
 * keys ON THE CURRENT PAGE via an IN() lookup, so page size caps the query.
 */
export async function getWhatsAppTemplatePage(
  query: WhatsAppTemplateQuery = {},
): Promise<WhatsAppTemplatePageResult> {
  const localContracts = listTemplateLocalContracts();
  const remoteEvidence = listTemplateRemoteEvidence();

  const search = String(query.search ?? "").trim().toLowerCase().slice(0, 80);
  const group = String(query.group ?? "").trim();
  const lane = String(query.lane ?? "").trim();
  const approval = String(query.approval ?? "").trim();

  let filtered = localContracts.filter((row) => {
    if (group && group !== "All" && row.group !== group) return false;
    if (lane && lane !== "All" && row.consentScope !== lane) return false;
    if (approval && approval !== "All") {
      const proven = remoteEvidenceFor(remoteEvidence, row.internalTemplateKey);
      const provenApproved = proven.some((e) => e.lastProvenStatus === "APPROVED");
      if (approval === "approved" && !provenApproved) return false;
      if (approval === "not_approved" && provenApproved) return false;
    }
    if (search) {
      const haystack = `${row.internalTemplateKey} ${row.category} ${row.purpose} ${row.providerTemplateNameCandidate ?? ""}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });

  const page = boundPage(query.page);
  const pageSize = ADMIN_DIRECTORY_PAGE_SIZE;

  // Mapping + ledger state are read ONLY for the keys on this page.
  const readiness = await getWhatsAppProviderReadiness();
  const runtimeBlocked =
    readiness.runtimePolicy === null || readiness.runtimePolicy.outboundEnabled !== true;

  const totals = {
    localTemplates: localContracts.length,
    remoteApproved: remoteEvidence.filter((e) => e.lastProvenStatus === "APPROVED").length,
    mappedActiveApproved: readiness.approvedActiveMappingCount ?? 0,
  };

  let mappingFault: SectionFault | null = null;
  let ledgerFault: SectionFault | null = null;
  let mappingRows: Record<string, unknown>[] = [];
  let ledgerRows: Record<string, unknown>[] = [];

  const windowStart = (page - 1) * pageSize;
  let pageKeys = filtered.slice(windowStart, windowStart + pageSize).map((r) => r.internalTemplateKey);

  // A mapping filter needs mapping truth for the WHOLE filtered set, so it is
  // applied after a bounded read over the filtered keys (max 25 — the entire
  // governed catalogue — never an unbounded table scan).
  const mappingFilter = String(query.mapping ?? "").trim();
  const keysToRead =
    mappingFilter && mappingFilter !== "All" ? filtered.map((r) => r.internalTemplateKey) : pageKeys;

  if (keysToRead.length > 0) {
    try {
      const { data, error } = await adminClient()
        .from("communication_provider_template_mappings")
        .select(
          "template_key, provider_key, language, provider_template_name, provider_category, approval_status, quality_status, version, is_active, variables_schema, submitted_at, approved_at, last_synced_at",
        )
        .eq("channel", CHANNEL)
        .in("template_key", keysToRead)
        .order("template_key", { ascending: true })
        .limit(keysToRead.length * 4);
      if (error) throw error;
      mappingRows = (data ?? []) as Record<string, unknown>[];
    } catch (error) {
      logWhatsAppReadFailure("template-mappings", error);
      mappingFault = isMissingRelationError(error) ? "NOT_PROVISIONED" : "UNAVAILABLE";
    }

    try {
      const { data, error } = await adminClient()
        .from("communication_templates")
        .select("template_key, readiness_status")
        .in("template_key", keysToRead)
        .limit(keysToRead.length);
      if (error) throw error;
      ledgerRows = (data ?? []) as Record<string, unknown>[];
    } catch (error) {
      logWhatsAppReadFailure("template-ledger", error);
      ledgerFault = isMissingRelationError(error) ? "NOT_PROVISIONED" : "UNAVAILABLE";
    }
  }

  const mappingsByKey = new Map<string, TemplateMappingView[]>();
  for (const raw of mappingRows) {
    const view = projectMapping(raw);
    const list = mappingsByKey.get(view.templateKey) ?? [];
    list.push(view);
    mappingsByKey.set(view.templateKey, list);
  }
  const ledgerByKey = new Map<string, string>();
  for (const raw of ledgerRows) {
    if (typeof raw.template_key === "string" && typeof raw.readiness_status === "string") {
      ledgerByKey.set(raw.template_key, raw.readiness_status);
    }
  }

  if (mappingFilter && mappingFilter !== "All") {
    filtered = filtered.filter((row) => {
      const mapped = (mappingsByKey.get(row.internalTemplateKey) ?? []).length > 0;
      const activeMapped = (mappingsByKey.get(row.internalTemplateKey) ?? []).some((m) => m.isActive);
      if (mappingFilter === "mapped") return mapped;
      if (mappingFilter === "unmapped") return !mapped;
      if (mappingFilter === "active") return activeMapped;
      return true;
    });
    pageKeys = filtered.slice(windowStart, windowStart + pageSize).map((r) => r.internalTemplateKey);
  }

  const pageKeySet = new Set(pageKeys);
  const rows: WhatsAppTemplateRow[] = filtered
    .filter((row) => pageKeySet.has(row.internalTemplateKey))
    .map((local) => {
      const mappings = mappingsByKey.get(local.internalTemplateKey) ?? [];
      return {
        local,
        remote: remoteEvidenceFor(remoteEvidence, local.internalTemplateKey),
        mappings,
        runtimeEligibility: deriveRuntimeEligibility(mappings, mappingFault, runtimeBlocked),
        ledgerReadinessStatus: ledgerByKey.get(local.internalTemplateKey) ?? null,
      };
    });

  return {
    rows,
    page,
    pageSize,
    total: filtered.length,
    mappingFault,
    ledgerFault,
    totals,
  };
}

// ===========================================================================
// MESSAGES (outbound ledger)
// ===========================================================================

/**
 * One outbound ledger row.
 *
 * `destinationMasked` is the ONLY destination form that exists in the schema
 * besides the sha256 hash, and the hash is deliberately not projected: it is a
 * stable pseudonymous identifier and has no operational use in this UI.
 */
export interface WhatsAppMessageRow {
  readonly id: string;
  readonly createdAt: string;
  readonly messageType: string;
  readonly templateKey: string | null;
  readonly lane: string;
  readonly channel: string;
  readonly recipientType: string;
  readonly destinationMasked: string;
  readonly destinationSource: string;
  readonly entityType: string | null;
  readonly entityId: string | null;
  readonly status: string;
  readonly provider: string;
  readonly attemptCount: number;
  readonly failureCode: string | null;
}

export interface WhatsAppMessageQuery {
  readonly page?: string;
  readonly status?: string;
  readonly lane?: string;
  readonly messageType?: string;
  readonly entityType?: string;
}

export interface WhatsAppMessageDetail extends WhatsAppMessageRow {
  readonly maxAttempts: number;
  readonly priority: string;
  readonly scheduledAt: string | null;
  readonly acceptedAt: string | null;
  readonly sentAt: string | null;
  readonly deliveredAt: string | null;
  readonly readAt: string | null;
  readonly failedAt: string | null;
  readonly nextRetryAt: string | null;
  readonly failureReasonSanitized: string | null;
  /** Truncated one-way references — never the full idempotency material. */
  readonly correlationReference: string | null;
  readonly idempotencyReference: string | null;
  readonly policyDecisionId: string | null;
  readonly consentScope: string | null;
  readonly deliveryEvents: readonly WhatsAppDeliveryRow[];
  readonly deliveryEventsFault: SectionFault | null;
  readonly deliveryEventsTruncated: boolean;
}

const MESSAGE_LIST_COLUMNS =
  "id, created_at, message_type, template_key, lane, channel, recipient_type, destination_masked, destination_source, entity_type, entity_id, status, provider, attempt_count, failure_code";

function projectMessage(raw: Record<string, unknown>): WhatsAppMessageRow {
  return {
    id: String(raw.id ?? ""),
    createdAt: String(raw.created_at ?? ""),
    messageType: String(raw.message_type ?? ""),
    templateKey: typeof raw.template_key === "string" ? raw.template_key : null,
    lane: String(raw.lane ?? ""),
    channel: String(raw.channel ?? CHANNEL),
    recipientType: String(raw.recipient_type ?? ""),
    destinationMasked: String(raw.destination_masked ?? ""),
    destinationSource: String(raw.destination_source ?? "recipient_reference"),
    entityType: typeof raw.entity_type === "string" ? raw.entity_type : null,
    entityId: typeof raw.entity_id === "string" ? raw.entity_id : null,
    status: String(raw.status ?? "queued"),
    provider: String(raw.provider ?? ""),
    attemptCount: typeof raw.attempt_count === "number" ? raw.attempt_count : 0,
    failureCode: typeof raw.failure_code === "string" ? raw.failure_code : null,
  };
}

/** A one-way, truncated reference. Enough to correlate, never the full secret material. */
function reference(value: unknown): string | null {
  if (typeof value !== "string" || value === "") return null;
  return value.length <= 12 ? value : `${value.slice(0, 12)}…`;
}

export async function getWhatsAppMessagePage(
  query: WhatsAppMessageQuery = {},
): Promise<SectionResult<DirectoryPage<WhatsAppMessageRow>>> {
  const page = boundPage(query.page);
  const { from, to } = pageRange(page);

  try {
    let listQuery = adminClient()
      .from("communication_messages")
      .select(MESSAGE_LIST_COLUMNS, { count: "exact" })
      .eq("channel", CHANNEL);

    // Filters are applied only from the CLOSED vocabularies — an arbitrary
    // string can never reach PostgREST as a filter value.
    if (query.status && (WHATSAPP_MESSAGE_STATUSES as readonly string[]).includes(query.status)) {
      listQuery = listQuery.eq("status", query.status);
    }
    if (query.lane && (WHATSAPP_LANES as readonly string[]).includes(query.lane)) {
      listQuery = listQuery.eq("lane", query.lane);
    }
    if (query.messageType && /^[a-z0-9_]{1,64}$/.test(query.messageType)) {
      listQuery = listQuery.eq("message_type", query.messageType);
    }
    if (query.entityType && /^[a-z0-9_]{1,64}$/.test(query.entityType)) {
      listQuery = listQuery.eq("entity_type", query.entityType);
    }

    const { data, error, count } = await listQuery
      .order("created_at", { ascending: false })
      .range(from, to);
    if (error) throw error;

    return okSection({
      rows: ((data ?? []) as Record<string, unknown>[]).map(projectMessage),
      page,
      pageSize: ADMIN_DIRECTORY_PAGE_SIZE,
      total: count ?? 0,
    });
  } catch (error) {
    logWhatsAppReadFailure("messages", error);
    return faultSection(EMPTY_PAGE<WhatsAppMessageRow>(), error);
  }
}

/** ON DEMAND only — called solely when a message id is present in the URL. */
export async function getWhatsAppMessageDetail(
  messageId: string,
): Promise<SectionResult<WhatsAppMessageDetail | null>> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(messageId)) {
    return okSection(null);
  }

  try {
    const { data, error } = await adminClient()
      .from("communication_messages")
      .select(
        `${MESSAGE_LIST_COLUMNS}, max_attempts, priority, scheduled_at, accepted_at, sent_at, delivered_at, read_at, failed_at, next_retry_at, failure_reason_sanitized, correlation_id, idempotency_key, policy_decision_id`,
      )
      .eq("id", messageId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return okSection(null);

    const raw = data as Record<string, unknown>;
    const events = await getWhatsAppDeliveryPage({ messageId, embedded: true });

    // Consent scope comes from the EXISTING closed registry, keyed on the exact
    // (messageType, templateKey, lane) triple the ledger stored. An unregistered
    // type resolves to null rather than being guessed from the lane.
    const scopeResolution = resolveOutboundConsentScope({
      messageType: String(raw.message_type ?? ""),
      templateKey: typeof raw.template_key === "string" ? raw.template_key : null,
      lane: String(raw.lane ?? "") as "authentication" | "business",
    });

    return okSection({
      ...projectMessage(raw),
      maxAttempts: typeof raw.max_attempts === "number" ? raw.max_attempts : 0,
      priority: String(raw.priority ?? "normal"),
      scheduledAt: typeof raw.scheduled_at === "string" ? raw.scheduled_at : null,
      acceptedAt: typeof raw.accepted_at === "string" ? raw.accepted_at : null,
      sentAt: typeof raw.sent_at === "string" ? raw.sent_at : null,
      deliveredAt: typeof raw.delivered_at === "string" ? raw.delivered_at : null,
      readAt: typeof raw.read_at === "string" ? raw.read_at : null,
      failedAt: typeof raw.failed_at === "string" ? raw.failed_at : null,
      nextRetryAt: typeof raw.next_retry_at === "string" ? raw.next_retry_at : null,
      failureReasonSanitized:
        typeof raw.failure_reason_sanitized === "string" ? raw.failure_reason_sanitized : null,
      correlationReference: reference(raw.correlation_id),
      idempotencyReference: reference(raw.idempotency_key),
      policyDecisionId: typeof raw.policy_decision_id === "string" ? raw.policy_decision_id : null,
      consentScope: scopeResolution.ok ? scopeResolution.scope : null,
      deliveryEvents: events.data.rows,
      deliveryEventsFault: events.fault,
      deliveryEventsTruncated: events.data.total > events.data.rows.length,
    });
  } catch (error) {
    logWhatsAppReadFailure("message-detail", error);
    return faultSection<WhatsAppMessageDetail | null>(null, error);
  }
}

// ===========================================================================
// DELIVERY EVENTS
// ===========================================================================

export interface WhatsAppDeliveryRow {
  readonly id: string;
  readonly messageId: string;
  readonly provider: string;
  readonly normalizedEventType: string;
  readonly occurredAt: string;
  readonly createdAt: string;
  /** Sanitized failure classification only — no provider body, no raw error. */
  readonly failureClassification: string | null;
}

export interface WhatsAppDeliveryQuery {
  readonly page?: string;
  readonly eventType?: string;
  readonly messageId?: string;
  /** Embedded reads are capped at the 10-row embedded panel limit. */
  readonly embedded?: boolean;
}

/**
 * Delivery events, bounded.
 *
 * `sanitized_metadata` is NOT returned wholesale — only a narrow, known-safe
 * classification field is lifted out of it, so a provider payload that ever
 * lands in that column cannot reach the browser.
 */
function projectDeliveryEvent(raw: Record<string, unknown>): WhatsAppDeliveryRow {
  const metadata = raw.sanitized_metadata;
  let classification: string | null = null;
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    const record = metadata as Record<string, unknown>;
    for (const key of ["classification", "failure_code", "code", "reason"]) {
      const value = record[key];
      // Bounded + character-fenced: a long or exotic value is dropped, not shown.
      if (typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(value)) {
        classification = value;
        break;
      }
    }
  }

  return {
    id: String(raw.id ?? ""),
    messageId: String(raw.communication_message_id ?? ""),
    provider: String(raw.provider ?? ""),
    normalizedEventType: String(raw.normalized_event_type ?? ""),
    occurredAt: String(raw.occurred_at ?? ""),
    createdAt: String(raw.created_at ?? ""),
    failureClassification: classification,
  };
}

export async function getWhatsAppDeliveryPage(
  query: WhatsAppDeliveryQuery = {},
): Promise<SectionResult<DirectoryPage<WhatsAppDeliveryRow>>> {
  const pageSize = query.embedded ? ADMIN_EMBEDDED_PANEL_LIMIT : ADMIN_DIRECTORY_PAGE_SIZE;
  const page = boundPage(query.page);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  try {
    let listQuery = adminClient()
      .from("communication_delivery_events")
      .select(
        "id, communication_message_id, provider, normalized_event_type, occurred_at, created_at, sanitized_metadata",
        { count: "exact" },
      );

    if (
      query.eventType &&
      (WHATSAPP_DELIVERY_EVENT_TYPES as readonly string[]).includes(query.eventType)
    ) {
      listQuery = listQuery.eq("normalized_event_type", query.eventType);
    }
    if (
      query.messageId &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(query.messageId)
    ) {
      listQuery = listQuery.eq("communication_message_id", query.messageId);
    }

    const { data, error, count } = await listQuery
      .order("occurred_at", { ascending: false })
      .range(from, to);
    if (error) throw error;

    return okSection({
      rows: ((data ?? []) as Record<string, unknown>[]).map(projectDeliveryEvent),
      page,
      pageSize,
      total: count ?? 0,
    });
  } catch (error) {
    logWhatsAppReadFailure("delivery-events", error);
    return faultSection({ ...EMPTY_PAGE<WhatsAppDeliveryRow>(), pageSize }, error);
  }
}

// ===========================================================================
// INBOUND
// ===========================================================================

export interface WhatsAppInboundRow {
  readonly id: string;
  readonly receivedAt: string;
  readonly providerOccurredAt: string | null;
  readonly provider: string;
  readonly senderMasked: string | null;
  readonly resolvedPrincipalType: string | null;
  readonly identityConfidence: string;
  readonly messageType: string;
  readonly processingStatus: string;
  /** Consent command classification ONLY — never the message body. */
  readonly consentCommand: string | null;
  readonly failureReasonSanitized: string | null;
}

export interface WhatsAppInboundQuery {
  readonly page?: string;
  readonly processingStatus?: string;
}

const INBOUND_PROCESSING_STATUSES = Object.freeze([
  "captured",
  "normalized",
  "identity_resolved",
  "identity_ambiguous",
  "identity_unknown",
  "failed",
]);

/**
 * `content_minimized` is NOT projected. The only thing lifted out of it is a
 * STOP/START/HELP classification, matched against the closed consent-command
 * vocabulary — so no inbound message text can reach the browser.
 */
function projectInbound(raw: Record<string, unknown>): WhatsAppInboundRow {
  const content = raw.content_minimized;
  let consentCommand: string | null = null;
  if (content && typeof content === "object" && !Array.isArray(content)) {
    const record = content as Record<string, unknown>;
    for (const key of ["normalized_command", "consent_command", "command"]) {
      const value = record[key];
      if (typeof value === "string" && ["stop", "start", "help"].includes(value.toLowerCase())) {
        consentCommand = value.toLowerCase();
        break;
      }
    }
  }

  return {
    id: String(raw.id ?? ""),
    receivedAt: String(raw.received_at ?? ""),
    providerOccurredAt: typeof raw.provider_occurred_at === "string" ? raw.provider_occurred_at : null,
    provider: String(raw.provider ?? ""),
    senderMasked: typeof raw.sender_masked === "string" ? raw.sender_masked : null,
    resolvedPrincipalType:
      typeof raw.resolved_principal_type === "string" ? raw.resolved_principal_type : null,
    identityConfidence: String(raw.identity_confidence ?? "unknown"),
    messageType: String(raw.message_type ?? "unsupported"),
    processingStatus: String(raw.processing_status ?? "captured"),
    consentCommand,
    failureReasonSanitized:
      typeof raw.failure_reason_sanitized === "string" ? raw.failure_reason_sanitized : null,
  };
}

export async function getWhatsAppInboundPage(
  query: WhatsAppInboundQuery = {},
): Promise<SectionResult<DirectoryPage<WhatsAppInboundRow>>> {
  const page = boundPage(query.page);
  const { from, to } = pageRange(page);

  try {
    let listQuery = adminClient()
      .from("communication_inbound_messages")
      .select(
        "id, received_at, provider_occurred_at, provider, sender_masked, resolved_principal_type, identity_confidence, message_type, processing_status, content_minimized, failure_reason_sanitized",
        { count: "exact" },
      );

    if (query.processingStatus && INBOUND_PROCESSING_STATUSES.includes(query.processingStatus)) {
      listQuery = listQuery.eq("processing_status", query.processingStatus);
    }

    const { data, error, count } = await listQuery
      .order("received_at", { ascending: false })
      .range(from, to);
    if (error) throw error;

    return okSection({
      rows: ((data ?? []) as Record<string, unknown>[]).map(projectInbound),
      page,
      pageSize: ADMIN_DIRECTORY_PAGE_SIZE,
      total: count ?? 0,
    });
  } catch (error) {
    logWhatsAppReadFailure("inbound", error);
    return faultSection(EMPTY_PAGE<WhatsAppInboundRow>(), error);
  }
}

// ===========================================================================
// CONSENT
// ===========================================================================

export interface WhatsAppPreferenceRow {
  readonly id: string;
  readonly principalType: string;
  readonly principalId: string | null;
  readonly scope: string;
  readonly state: string;
  readonly source: string;
  readonly consentedAt: string | null;
  readonly withdrawnAt: string | null;
  readonly updatedAt: string;
}

export interface WhatsAppSuppressionRow {
  readonly id: string;
  readonly scope: string;
  readonly reason: string;
  readonly source: string;
  readonly isActive: boolean;
  readonly suppressedAt: string;
  readonly expiresAt: string | null;
}

export interface WhatsAppConsentPageResult {
  readonly preferences: DirectoryPage<WhatsAppPreferenceRow>;
  readonly preferencesFault: SectionFault | null;
  readonly suppressions: DirectoryPage<WhatsAppSuppressionRow>;
  readonly suppressionsFault: SectionFault | null;
}

export interface WhatsAppConsentQuery {
  readonly page?: string;
  readonly view?: string;
  readonly scope?: string;
  readonly state?: string;
}

/**
 * Consent records.
 *
 * A suppression row is keyed by `destination_hash` — a pseudonymous identifier
 * with no admin use — so the hash is NOT projected. The row is shown by scope,
 * reason, source and lifecycle instead.
 */
export async function getWhatsAppConsentPage(
  query: WhatsAppConsentQuery = {},
): Promise<WhatsAppConsentPageResult> {
  const page = boundPage(query.page);
  const { from, to } = pageRange(page);
  const view = query.view === "suppressions" ? "suppressions" : "preferences";

  let preferences = EMPTY_PAGE<WhatsAppPreferenceRow>();
  let preferencesFault: SectionFault | null = null;
  let suppressions = EMPTY_PAGE<WhatsAppSuppressionRow>();
  let suppressionsFault: SectionFault | null = null;

  // Only the ACTIVE sub-view is read; the other is fetched as a bare count so
  // the tab can show its size without loading its rows.
  if (view === "preferences") {
    try {
      let listQuery = adminClient()
        .from("communication_preferences")
        .select(
          "id, principal_type, principal_id, scope, state, source, consented_at, withdrawn_at, updated_at",
          { count: "exact" },
        )
        .eq("channel", CHANNEL);
      if (query.scope && (WHATSAPP_CONSENT_SCOPES as readonly string[]).includes(query.scope)) {
        listQuery = listQuery.eq("scope", query.scope);
      }
      if (query.state && ["allowed", "blocked", "unknown"].includes(query.state)) {
        listQuery = listQuery.eq("state", query.state);
      }
      const { data, error, count } = await listQuery
        .order("updated_at", { ascending: false })
        .range(from, to);
      if (error) throw error;
      preferences = {
        rows: ((data ?? []) as Record<string, unknown>[]).map((raw) => ({
          id: String(raw.id ?? ""),
          principalType: String(raw.principal_type ?? ""),
          principalId: typeof raw.principal_id === "string" ? raw.principal_id : null,
          scope: String(raw.scope ?? ""),
          state: String(raw.state ?? "unknown"),
          source: String(raw.source ?? "system"),
          consentedAt: typeof raw.consented_at === "string" ? raw.consented_at : null,
          withdrawnAt: typeof raw.withdrawn_at === "string" ? raw.withdrawn_at : null,
          updatedAt: String(raw.updated_at ?? ""),
        })),
        page,
        pageSize: ADMIN_DIRECTORY_PAGE_SIZE,
        total: count ?? 0,
      };
    } catch (error) {
      logWhatsAppReadFailure("preferences", error);
      preferencesFault = isMissingRelationError(error) ? "NOT_PROVISIONED" : "UNAVAILABLE";
    }

    try {
      // Head-count: a null is the silent missing-relation case, not zero.
      const count = await countRows("communication_suppressions");
      if (count === null) suppressionsFault = "NOT_PROVISIONED";
      else suppressions = { ...suppressions, total: count };
    } catch (error) {
      suppressionsFault = isMissingRelationError(error) ? "NOT_PROVISIONED" : "UNAVAILABLE";
    }
  } else {
    try {
      let listQuery = adminClient()
        .from("communication_suppressions")
        .select("id, scope, reason, source, is_active, suppressed_at, expires_at", { count: "exact" })
        .eq("channel", CHANNEL);
      if (query.scope && (WHATSAPP_SUPPRESSION_SCOPES as readonly string[]).includes(query.scope)) {
        listQuery = listQuery.eq("scope", query.scope);
      }
      const { data, error, count } = await listQuery
        .order("suppressed_at", { ascending: false })
        .range(from, to);
      if (error) throw error;
      suppressions = {
        rows: ((data ?? []) as Record<string, unknown>[]).map((raw) => ({
          id: String(raw.id ?? ""),
          scope: String(raw.scope ?? ""),
          reason: String(raw.reason ?? "unspecified"),
          source: String(raw.source ?? "system"),
          isActive: raw.is_active === true,
          suppressedAt: String(raw.suppressed_at ?? ""),
          expiresAt: typeof raw.expires_at === "string" ? raw.expires_at : null,
        })),
        page,
        pageSize: ADMIN_DIRECTORY_PAGE_SIZE,
        total: count ?? 0,
      };
    } catch (error) {
      logWhatsAppReadFailure("suppressions", error);
      suppressionsFault = isMissingRelationError(error) ? "NOT_PROVISIONED" : "UNAVAILABLE";
    }

    try {
      // Head-count: a null is the silent missing-relation case, not zero.
      const count = await countRows("communication_preferences");
      if (count === null) preferencesFault = "NOT_PROVISIONED";
      else preferences = { ...preferences, total: count };
    } catch (error) {
      preferencesFault = isMissingRelationError(error) ? "NOT_PROVISIONED" : "UNAVAILABLE";
    }
  }

  return { preferences, preferencesFault, suppressions, suppressionsFault };
}

// ===========================================================================
// AUTOMATION
// ===========================================================================

export interface WhatsAppAutomationRow {
  readonly jobId: string;
  readonly actionType: string;
  readonly workflowFamily: AutomationWorkflowFamily | "unknown";
  readonly entityType: string;
  readonly status: string;
  readonly attemptCount: number;
  readonly maxAttempts: number;
  readonly lastResultClassification: string | null;
  readonly lastSafeCode: string | null;
  readonly availableAt: string;
  readonly nextRetryAt: string | null;
  readonly completedAt: string | null;
  readonly createdAt: string;
  readonly requestSource: string;
}

export interface WhatsAppAutomationQuery {
  readonly page?: string;
  readonly family?: string;
  readonly status?: string;
}

export interface WhatsAppAutomationPageResult extends DirectoryPage<WhatsAppAutomationRow> {
  readonly fault: SectionFault | null;
}

const AUTOMATION_JOB_STATUSES = Object.freeze([
  "pending",
  "processing",
  "retry_scheduled",
  "succeeded",
  "failed",
  "uncertain",
  "dead_letter",
  "cancelled",
]);

const WORKFLOW_FAMILIES = Object.freeze([
  "client_whatsapp",
  "vendor_whatsapp",
  "campaign_execution",
] as const);

/** Action types belonging to a family, from the EXISTING frozen registry. */
function actionTypesForFamily(family: string): string[] {
  return Object.values(AUTOMATION_ACTION_REGISTRY)
    .filter((definition) => definition.workflowFamily === family)
    .map((definition) => definition.actionType);
}

/**
 * Communication-related automation jobs.
 *
 * The workflow family is re-derived from the frozen action registry, exactly as
 * the executor does — it is never read from a request or inferred from a string
 * prefix. This view is READ-ONLY: there is no claim, release, retry or complete
 * path here, and n8n remains an orchestrator with no business authority.
 */
export async function getWhatsAppAutomationPage(
  query: WhatsAppAutomationQuery = {},
): Promise<WhatsAppAutomationPageResult> {
  const page = boundPage(query.page);
  const { from, to } = pageRange(page);

  try {
    let listQuery = adminClient()
      .from("automation_jobs")
      .select(
        "id, status, attempt_count, max_attempts, last_result_classification, last_safe_code, available_at, next_retry_at, completed_at, created_at, automation_action_requests!inner(action_type, entity_type, source)",
        { count: "exact" },
      );

    if (query.status && AUTOMATION_JOB_STATUSES.includes(query.status)) {
      listQuery = listQuery.eq("status", query.status);
    }
    if (query.family && (WORKFLOW_FAMILIES as readonly string[]).includes(query.family)) {
      listQuery = listQuery.in("automation_action_requests.action_type", actionTypesForFamily(query.family));
    }

    const { data, error, count } = await listQuery
      .order("created_at", { ascending: false })
      .range(from, to);
    if (error) throw error;

    const rows: WhatsAppAutomationRow[] = ((data ?? []) as Record<string, unknown>[]).map((raw) => {
      const joined = raw.automation_action_requests;
      const request = (Array.isArray(joined) ? joined[0] : joined) as Record<string, unknown> | undefined;
      const actionType = String(request?.action_type ?? "");
      const definition = AUTOMATION_ACTION_REGISTRY[actionType as AutomationActionType];

      return {
        jobId: String(raw.id ?? ""),
        actionType,
        workflowFamily: definition ? definition.workflowFamily : "unknown",
        entityType: String(request?.entity_type ?? ""),
        status: String(raw.status ?? "pending"),
        attemptCount: typeof raw.attempt_count === "number" ? raw.attempt_count : 0,
        maxAttempts: typeof raw.max_attempts === "number" ? raw.max_attempts : 0,
        lastResultClassification:
          typeof raw.last_result_classification === "string" ? raw.last_result_classification : null,
        lastSafeCode: typeof raw.last_safe_code === "string" ? raw.last_safe_code : null,
        availableAt: String(raw.available_at ?? ""),
        nextRetryAt: typeof raw.next_retry_at === "string" ? raw.next_retry_at : null,
        completedAt: typeof raw.completed_at === "string" ? raw.completed_at : null,
        createdAt: String(raw.created_at ?? ""),
        requestSource: String(request?.source ?? ""),
      };
    });

    return { rows, page, pageSize: ADMIN_DIRECTORY_PAGE_SIZE, total: count ?? 0, fault: null };
  } catch (error) {
    logWhatsAppReadFailure("automation-jobs", error);
    return {
      ...EMPTY_PAGE<WhatsAppAutomationRow>(),
      fault: isMissingRelationError(error) ? "NOT_PROVISIONED" : "UNAVAILABLE",
    };
  }
}

// ===========================================================================
// OVERVIEW
// ===========================================================================

export interface WhatsAppAdminOverview {
  readonly readiness: WhatsAppProviderReadiness;
  /** Exact per-status counts from count queries. Null = could not be counted. */
  readonly messageStatusCounts: Readonly<Record<WhatsAppMessageStatus, number | null>>;
  readonly messageTotal: number | null;
  readonly messagesFault: SectionFault | null;
  readonly inboundTotal: number | null;
  readonly inboundFault: SectionFault | null;
  readonly preferenceBlockedCount: number | null;
  readonly activeSuppressionCount: number | null;
  readonly consentFault: SectionFault | null;
  readonly templateTotals: {
    readonly localTemplates: number;
    readonly remoteApproved: number;
    readonly mappedActiveApproved: number | null;
  };
  /** Bounded samples — explicitly labelled as such in the UI. */
  readonly recentMessages: readonly WhatsAppMessageRow[];
  readonly recentFailures: readonly WhatsAppDeliveryRow[];
  readonly recentSamplesFault: SectionFault | null;
  readonly automationOpenJobCount: number | null;
  readonly automationFault: SectionFault | null;
}

export async function getWhatsAppAdminOverview(): Promise<WhatsAppAdminOverview> {
  const readiness = await getWhatsAppProviderReadiness();

  const localContracts = listTemplateLocalContracts();
  const remoteEvidence = listTemplateRemoteEvidence();

  // Status counts are exact head-counts, one bounded query per status — never a
  // select-all-and-tally, which is what a broad snapshot would have done.
  const statusCounts: Record<string, number | null> = {};
  let messagesFault: SectionFault | null = null;
  let messageTotal: number | null = null;
  try {
    const results = await Promise.all(
      WHATSAPP_MESSAGE_STATUSES.map(async (status) => {
        const { count, error } = await adminClient()
          .from("communication_messages")
          .select("id", { count: "exact", head: true })
          .eq("channel", CHANNEL)
          .eq("status", status);
        if (error) throw error;
        // null is preserved — see countRows(). A silent null must never become 0.
        return [status, count] as const;
      }),
    );
    let total: number | null = 0;
    for (const [status, count] of results) {
      statusCounts[status] = count;
      if (count === null) total = null;
      else if (total !== null) total += count;
    }
    messageTotal = total;
    // Every status unknown means the ledger itself could not be read here.
    if (results.every(([, count]) => count === null)) messagesFault = "NOT_PROVISIONED";
  } catch (error) {
    logWhatsAppReadFailure("overview-status-counts", error);
    messagesFault = isMissingRelationError(error) ? "NOT_PROVISIONED" : "UNAVAILABLE";
    for (const status of WHATSAPP_MESSAGE_STATUSES) statusCounts[status] = null;
  }

  let inboundTotal: number | null = null;
  let inboundFault: SectionFault | null = null;
  try {
    inboundTotal = await countRows("communication_inbound_messages");
  } catch (error) {
    inboundFault = isMissingRelationError(error) ? "NOT_PROVISIONED" : "UNAVAILABLE";
  }

  let preferenceBlockedCount: number | null = null;
  let activeSuppressionCount: number | null = null;
  let consentFault: SectionFault | null = null;
  try {
    const client = adminClient();
    const [blocked, suppressed] = await Promise.all([
      client
        .from("communication_preferences")
        .select("id", { count: "exact", head: true })
        .eq("channel", CHANNEL)
        .eq("state", "blocked"),
      client
        .from("communication_suppressions")
        .select("id", { count: "exact", head: true })
        .eq("channel", CHANNEL)
        .eq("is_active", true),
    ]);
    if (blocked.error) throw blocked.error;
    if (suppressed.error) throw suppressed.error;
    // null-preserving: an uncountable relation stays Unknown, never 0.
    preferenceBlockedCount = blocked.count;
    activeSuppressionCount = suppressed.count;
    if (blocked.count === null && suppressed.count === null) consentFault = "NOT_PROVISIONED";
  } catch (error) {
    logWhatsAppReadFailure("overview-consent-counts", error);
    consentFault = isMissingRelationError(error) ? "NOT_PROVISIONED" : "UNAVAILABLE";
  }

  let recentMessages: WhatsAppMessageRow[] = [];
  let recentFailures: WhatsAppDeliveryRow[] = [];
  let recentSamplesFault: SectionFault | null = null;
  try {
    const client = adminClient();
    const [messages, failures] = await Promise.all([
      client
        .from("communication_messages")
        .select(MESSAGE_LIST_COLUMNS)
        .eq("channel", CHANNEL)
        .order("created_at", { ascending: false })
        .limit(ADMIN_EMBEDDED_PANEL_LIMIT),
      client
        .from("communication_delivery_events")
        .select(
          "id, communication_message_id, provider, normalized_event_type, occurred_at, created_at, sanitized_metadata",
        )
        .eq("normalized_event_type", "failed")
        .order("occurred_at", { ascending: false })
        .limit(ADMIN_EMBEDDED_PANEL_LIMIT),
    ]);
    if (messages.error) throw messages.error;
    if (failures.error) throw failures.error;
    recentMessages = ((messages.data ?? []) as Record<string, unknown>[]).map(projectMessage);
    recentFailures = ((failures.data ?? []) as Record<string, unknown>[]).map(projectDeliveryEvent);
  } catch (error) {
    logWhatsAppReadFailure("overview-recent", error);
    recentSamplesFault = isMissingRelationError(error) ? "NOT_PROVISIONED" : "UNAVAILABLE";
  }

  let automationOpenJobCount: number | null = null;
  let automationFault: SectionFault | null = null;
  try {
    const { count, error } = await adminClient()
      .from("automation_jobs")
      .select("id", { count: "exact", head: true })
      .in("status", ["pending", "processing", "retry_scheduled"]);
    if (error) throw error;
    automationOpenJobCount = count;
    // A silent null here is the missing-relation case the head-count does not
    // report as an error — the Automation tab's own join DOES fail on it, and
    // the two surfaces must not contradict each other.
    if (count === null) automationFault = "NOT_PROVISIONED";
  } catch (error) {
    automationFault = isMissingRelationError(error) ? "NOT_PROVISIONED" : "UNAVAILABLE";
  }

  return {
    readiness,
    messageStatusCounts: statusCounts as Readonly<Record<WhatsAppMessageStatus, number | null>>,
    messageTotal,
    messagesFault,
    inboundTotal,
    inboundFault,
    preferenceBlockedCount,
    activeSuppressionCount,
    consentFault,
    templateTotals: {
      localTemplates: localContracts.length,
      remoteApproved: remoteEvidence.filter((e) => e.lastProvenStatus === "APPROVED").length,
      mappedActiveApproved: readiness.approvedActiveMappingCount,
    },
    recentMessages,
    recentFailures,
    recentSamplesFault,
    automationOpenJobCount,
    automationFault,
  };
}

export { META_OPERATIONS, ReadinessState };
export type { OperationReadiness, TemplateLocalContract, TemplateRemoteEvidence };
