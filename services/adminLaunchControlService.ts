// ============================================================================
// QuickFurno — services/adminLaunchControlService.ts   (QF-MVP-70.03, SERVER ONLY)
//
// The launch-control read model: control STATE plus a derived readiness verdict.
//
// A SIBLING, NOT AN EXTENSION. adminOperationsService owns incident classes and
// reads exactly four canonical incident tables. Control state is a different
// domain over different sources, so it lives here rather than blurring that
// boundary. Nothing in this file reads an incident table and nothing in the
// incident service reads a control source.
//
// READ-ONLY BY CONSTRUCTION. No row creation, no row modification, no row
// removal, no stored-procedure call, and no writer is imported — the canonical
// mutation functions (`updateMarketplaceRuntimeSetting`,
// `setAosN8nMasterRouterSetting`) are deliberately NOT referenced here.
//
// OPERATIONS IS A COCKPIT, NOT A SECOND CONTROL PLANE.
//   Every control below already has exactly one canonical home:
//
//   auto_assignment_mode        state  marketplace_runtime_settings
//                               UI     /admin/settings -> SettingsSection
//                                      "Paid-Only Auto Matching Controls"
//                               write  adminUpdateMarketplaceRuntimeSetting
//
//   aos_n8n_master_router       state  aos_runtime_settings + env Lock 1
//                               UI     /admin/automations -> AosAutomationControl
//                               write  POST /api/admin/aos-runtime-settings
//
//   whatsapp provider policy    state  communication_provider_runtime_policies
//                               UI     /admin/whatsapp?tab=provider (read-only)
//                               write  NONE in the product — armed only by
//                                      one-shot governed operators
//
//   lead queue recheck          state  none (an action, not a switch)
//                               UI     /admin/lead-distribution -> Queued Leads
//                               write  adminRecheckLeadAssignmentQueue
//
//   This file READS state and NAMES the canonical surface. It copies no
//   mutation, adds no server action, and exposes no second write path.
//
// FAIL CLOSED. The canonical readers deliberately fail OPEN — they answer with
// a safe default when their source cannot be read, which is right for the
// runtime (a lead must never be blocked by an unreadable settings table) and
// wrong for a console (an unreadable switch would render as a confident state
// nobody proved). Every control below therefore proves its source is readable
// with its own bounded read FIRST, and reports UNAVAILABLE when that fails —
// whatever default a canonical reader may have returned.
// ============================================================================

import "server-only";

import { adminClient } from "../lib/supabase";
import { isMissingRelationError } from "../lib/errors";
import {
  normalizeMarketplaceSettings,
  type AutoAssignmentMode,
} from "../lib/lead-assignment/runtimeSettings";
import {
  AOS_N8N_MASTER_ROUTER_KEY,
  resolveAosN8nActivation,
} from "../lib/aos/runtime/aosRuntimeSettings";
import type {
  OperationalClassSummary,
  OperationsOverview,
  SectionFault,
} from "./adminOperationsService";

type Row = Record<string, unknown>;

// ===========================================================================
// VOCABULARY
// ===========================================================================

/**
 * Control state, using source terminology wherever the source has its own.
 * `activation_status` values (`disabled`, `paused`, `active`) come straight
 * from the provider policy table's CHECK constraint.
 */
export const LAUNCH_CONTROL_STATES = Object.freeze([
  "ACTIVE",
  "PREVIEW",
  "PAUSED",
  "DISABLED",
  "AVAILABLE",
  "UNAVAILABLE",
] as const);
export type LaunchControlState = (typeof LAUNCH_CONTROL_STATES)[number];

/**
 * Whether a DISABLED state here gates the launch verdict.
 *
 * `blocking`  disabling this stops the marketplace's core lead flow.
 * `advisory`  disabled is an expected or deliberate state — it is reported
 *             truthfully but does not move the verdict. WhatsApp sending is
 *             advisory precisely because it is intentionally held disabled
 *             while template approval is outstanding; letting it force BLOCKED
 *             would pin the console to one verdict and make it useless.
 */
export type LaunchControlImpact = "blocking" | "advisory";

/** How the state was established. Three different facts, never collapsed. */
export type LaunchControlSourceStatus =
  /** A stored row was read. */
  | "READ"
  /** The source was readable and holds no row, so the built-in default is in force. */
  | "DEFAULT"
  /** The source could not be read. The state is UNKNOWN, not a default. */
  | "UNAVAILABLE";

export interface LaunchControl {
  readonly key: string;
  readonly label: string;
  readonly state: LaunchControlState;
  /** Short, non-secret explanation of what this state means for launch. */
  readonly stateDetail: string;
  readonly impact: LaunchControlImpact;
  /** True only when an EXISTING admin surface can change this control. */
  readonly actionable: boolean;
  /** The canonical admin route. Never a route invented by Operations. */
  readonly href: string | null;
  readonly actionLabel: string;
  readonly sourceStatus: LaunchControlSourceStatus;
  readonly fault: SectionFault | null;
  readonly updatedAt: string | null;
}

export const LAUNCH_READINESS_VERDICTS = Object.freeze([
  "BLOCKED",
  "ATTENTION",
  "UNAVAILABLE",
  "READY",
] as const);
export type LaunchReadiness = (typeof LAUNCH_READINESS_VERDICTS)[number];

export interface LaunchReadinessVerdict {
  readonly verdict: LaunchReadiness;
  readonly reason: string;
  readonly blockingControls: readonly string[];
  readonly unreadableControls: readonly string[];
}

export interface LaunchHealthFacts {
  readonly totalIncidents: number | null;
  readonly oldestAttentionAgeSeconds: number | null;
  readonly leadQueueOverdueCount: number | null;
  readonly leadQueueOldestOverdueAgeSeconds: number | null;
  readonly automationOverdueRetryCount: number | null;
  readonly automationOldestOverdueRetryAgeSeconds: number | null;
  readonly communicationFailedCount: number | null;
  readonly webhookFailedCount: number | null;
  readonly unavailableSubsystems: number;
}

export interface OperationsLaunchSnapshot {
  readonly generatedAt: string;
  readonly readiness: LaunchReadinessVerdict;
  readonly controls: readonly LaunchControl[];
  readonly health: LaunchHealthFacts;
}

// ===========================================================================
// FAIL-CLOSED SOURCE READ
// ===========================================================================

function faultFor(error: unknown): SectionFault {
  return isMissingRelationError(error) ? "NOT_PROVISIONED" : "UNAVAILABLE";
}

/** Logs the error CLASS only — never `message`, a row value, SQL or a credential. */
function logControlReadFailure(scope: string, error: unknown): void {
  const safe = error as { name?: string; code?: string } | null;
  console.error("[admin-launch-control] read failed", {
    scope,
    name: safe?.name ?? "Error",
    code: safe?.code ?? "UNKNOWN",
  });
}

type SourceRead = { readonly rows: Row[]; readonly fault: SectionFault | null };

/**
 * One bounded read of one control source.
 *
 * A bounded real select is used rather than a head-count for the same reason the
 * incident layer does: PostgREST answers a head-count against a MISSING relation
 * with `{ count: null, error: null }`, so a missing table would be silent. A real
 * select raises PGRST205 and the fault is honest.
 */
async function readControlSource(
  scope: string,
  build: (query: any) => any,
): Promise<SourceRead> {
  try {
    const { data, error } = await build(adminClient());
    if (error) throw error;
    return { rows: (data ?? []) as Row[], fault: null };
  } catch (error) {
    logControlReadFailure(scope, error);
    return { rows: [], fault: faultFor(error) };
  }
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** The shared shape of a control whose source could not be read. */
function unreadableControl(
  base: Pick<LaunchControl, "key" | "label" | "impact" | "actionable" | "href" | "actionLabel">,
  fault: SectionFault,
): LaunchControl {
  return {
    ...base,
    state: "UNAVAILABLE",
    stateDetail:
      fault === "NOT_PROVISIONED"
        ? "This control does not exist in this environment, so its state cannot be reported."
        : "This control's state could not be read. It is reported as unknown rather than assumed safe.",
    sourceStatus: "UNAVAILABLE",
    fault,
    updatedAt: null,
  };
}

// ===========================================================================
// CONTROL 1 — AUTOMATIC LEAD ASSIGNMENT
// ===========================================================================

const AUTO_ASSIGNMENT_KEY = "auto_assignment_mode";

const AUTO_ASSIGNMENT_BASE = Object.freeze({
  key: AUTO_ASSIGNMENT_KEY,
  label: "Automatic lead assignment",
  impact: "blocking" as const,
  actionable: true,
  href: "/admin/settings",
  actionLabel: "Open control",
});

/**
 * The engine branches on `off` alone: an `off` mode queues every new lead with
 * reason `auto_assignment_off` instead of matching it. `preview` and
 * `auto_suggest` both run matching and both record `auto_suggested` — the
 * difference is not an execution difference, so neither is described as
 * finalizing an assignment.
 */
async function readAutoAssignmentControl(): Promise<LaunchControl> {
  const source = await readControlSource("marketplace-runtime-settings", (db) =>
    db
      .from("marketplace_runtime_settings")
      .select("key, value")
      .eq("key", AUTO_ASSIGNMENT_KEY)
      .limit(1),
  );

  if (source.fault) return unreadableControl(AUTO_ASSIGNMENT_BASE, source.fault);

  // The CANONICAL normalizer decides the value — this file never parses the
  // stored representation itself, so Operations and /admin/settings can never
  // disagree about what the same row means.
  const mode: AutoAssignmentMode = normalizeMarketplaceSettings(source.rows).auto_assignment_mode;
  const stored = source.rows.length > 0;

  if (mode === "off") {
    return {
      ...AUTO_ASSIGNMENT_BASE,
      state: "DISABLED",
      stateDetail:
        "Automatic matching is switched off. New leads are placed on the assignment queue instead of being matched to vendors.",
      sourceStatus: "READ",
      fault: null,
      updatedAt: null,
    };
  }

  return {
    ...AUTO_ASSIGNMENT_BASE,
    state: "ACTIVE",
    stateDetail: `Automatic matching is running in '${mode}' mode. It selects and records suggested vendors for each lead; it does not finalize an assignment on its own.${
      stored ? "" : " No stored override exists, so the built-in default is in force."
    }`,
    sourceStatus: stored ? "READ" : "DEFAULT",
    fault: null,
    updatedAt: null,
  };
}

// ===========================================================================
// CONTROL 2 — AOS TO n8n FORWARDING
// ===========================================================================

const AOS_FORWARDING_BASE = Object.freeze({
  key: AOS_N8N_MASTER_ROUTER_KEY,
  label: "Agent event forwarding",
  impact: "advisory" as const,
  actionable: true,
  href: "/admin/automations",
  actionLabel: "Open control",
});

/**
 * Two locks: a server-side environment lock and the stored admin switch. The
 * combined verdict is NOT recomputed here — `resolveAosN8nActivation()` is the
 * single source of truth both the dispatch path and the admin API already use,
 * and it is called rather than reimplemented so the rule cannot drift.
 *
 * Its answer is only TRUSTED when the bounded probe proves the stored row was
 * readable: the resolver falls back to a safe OFF default on any error, and an
 * unproven "off" must not be printed as a fact. Both run concurrently, so the
 * proof costs no added latency.
 */
async function readAosForwardingControl(): Promise<LaunchControl> {
  const [source, activation] = await Promise.all([
    readControlSource("aos-runtime-settings", (db) =>
      db
        .from("aos_runtime_settings")
        .select("setting_key, enabled, mode, updated_at")
        .eq("setting_key", AOS_N8N_MASTER_ROUTER_KEY)
        .limit(1),
    ),
    resolveAosN8nActivation(),
  ]);

  if (source.fault) return unreadableControl(AOS_FORWARDING_BASE, source.fault);

  const stored = source.rows.length > 0;
  const updatedAt = stored ? text(source.rows[0]?.updated_at) : null;

  if (activation.shouldCallN8n) {
    return {
      ...AOS_FORWARDING_BASE,
      state: "ACTIVE",
      stateDetail:
        "Agent events are being forwarded to the preview router. Both the server lock and the admin switch are on.",
      sourceStatus: "READ",
      fault: null,
      updatedAt,
    };
  }

  if (activation.runtime.enabled) {
    return {
      ...AOS_FORWARDING_BASE,
      state: "PREVIEW",
      stateDetail:
        "The admin switch is on but the server lock is not, so nothing is forwarded. Events are handled in safe mock mode.",
      sourceStatus: stored ? "READ" : "DEFAULT",
      fault: null,
      updatedAt,
    };
  }

  return {
    ...AOS_FORWARDING_BASE,
    state: "DISABLED",
    stateDetail: stored
      ? "The admin switch is off. Agent events are handled in safe mock mode and nothing is forwarded."
      : "No switch has been configured, so forwarding stays off and agent events are handled in safe mock mode.",
    sourceStatus: stored ? "READ" : "DEFAULT",
    fault: null,
    updatedAt,
  };
}

// ===========================================================================
// CONTROL 3 — WHATSAPP PROVIDER SENDING
// ===========================================================================

const WHATSAPP_PROVIDER_KEY = "meta_whatsapp_cloud";
const WHATSAPP_CHANNEL = "whatsapp";

/**
 * Observation only. This policy has NO mutation surface in the product — it is
 * armed exclusively by governed one-shot operators — so Operations names the
 * read-only evidence route and offers no action.
 */
const WHATSAPP_PROVIDER_BASE = Object.freeze({
  key: "whatsapp_provider_policy",
  label: "WhatsApp sending",
  impact: "advisory" as const,
  actionable: false,
  href: "/admin/whatsapp?tab=provider",
  actionLabel: "Observation only",
});

/**
 * The canonical send rule, stated by the policy table itself: outbound delivery
 * is permitted only when `outbound_enabled` is true AND `activation_status` is
 * `canary` or `active`. It is applied here exactly, never approximated.
 *
 * No token, secret, phone number or provider payload is read: the projection is
 * the status flags and a timestamp. `metadata` is deliberately not selected.
 */
async function readWhatsAppProviderControl(): Promise<LaunchControl> {
  const source = await readControlSource("provider-runtime-policy", (db) =>
    db
      .from("communication_provider_runtime_policies")
      .select("provider_key, channel, activation_status, outbound_enabled, updated_at")
      .eq("provider_key", WHATSAPP_PROVIDER_KEY)
      .eq("channel", WHATSAPP_CHANNEL)
      .limit(1),
  );

  if (source.fault) return unreadableControl(WHATSAPP_PROVIDER_BASE, source.fault);

  const row = source.rows[0];
  if (!row) {
    return {
      ...WHATSAPP_PROVIDER_BASE,
      state: "DISABLED",
      stateDetail:
        "No provider policy exists, so outbound sending stays closed. Nothing can be sent in this state.",
      sourceStatus: "DEFAULT",
      fault: null,
      updatedAt: null,
    };
  }

  const activationStatus = text(row.activation_status) ?? "disabled";
  const outboundEnabled = row.outbound_enabled === true;
  const sendingPermitted =
    outboundEnabled && (activationStatus === "canary" || activationStatus === "active");
  const updatedAt = text(row.updated_at);

  if (sendingPermitted) {
    return {
      ...WHATSAPP_PROVIDER_BASE,
      state: "ACTIVE",
      stateDetail: `Outbound sending is permitted — the provider is '${activationStatus}' with outbound delivery enabled.`,
      sourceStatus: "READ",
      fault: null,
      updatedAt,
    };
  }

  if (activationStatus === "paused") {
    return {
      ...WHATSAPP_PROVIDER_BASE,
      state: "PAUSED",
      stateDetail: "The provider is paused, so no message is sent.",
      sourceStatus: "READ",
      fault: null,
      updatedAt,
    };
  }

  if (activationStatus === "disabled") {
    return {
      ...WHATSAPP_PROVIDER_BASE,
      state: "DISABLED",
      stateDetail:
        "Outbound sending is switched off. This is the expected state while template approval is outstanding, and it does not gate the launch verdict.",
      sourceStatus: "READ",
      fault: null,
      updatedAt,
    };
  }

  return {
    ...WHATSAPP_PROVIDER_BASE,
    state: "PREVIEW",
    stateDetail: `The provider is '${activationStatus}' and outbound delivery is ${
      outboundEnabled ? "enabled" : "not enabled"
    }, so no message is sent under the canonical send rule.`,
    sourceStatus: "READ",
    fault: null,
    updatedAt,
  };
}

// ===========================================================================
// CONTROL 4 — LEAD QUEUE RECHECK
// ===========================================================================

/**
 * An action, not a switch: it holds no stored state, so it is always AVAILABLE
 * and can never be UNAVAILABLE. It is listed because a founder looking at an
 * overdue queue needs to know where the existing control lives — it is a row
 * action on the Queued Leads panel of /admin/lead-distribution, wired to the
 * already-authorized `adminRecheckLeadAssignmentQueue` server action.
 *
 * Operations LINKS to it. It does not call it.
 */
function leadQueueRecheckControl(): LaunchControl {
  return {
    key: "lead_queue_recheck",
    label: "Queued lead recheck",
    state: "AVAILABLE",
    stateDetail:
      "A queued lead can be rechecked against paid vendors from the Queued Leads panel. This is a manual control; it runs only when an admin triggers it there.",
    impact: "advisory",
    actionable: true,
    href: "/admin/lead-distribution",
    actionLabel: "Open control",
    sourceStatus: "READ",
    fault: null,
    updatedAt: null,
  };
}

// ===========================================================================
// LAUNCH HEALTH — DERIVED, ZERO ADDITIONAL READS
// ===========================================================================

function classOf(
  overview: OperationsOverview,
  key: string,
): OperationalClassSummary | undefined {
  for (const subsystem of overview.subsystems) {
    for (const entry of subsystem.classes) {
      if (entry.key === key) return entry;
    }
  }
  return undefined;
}

/** Sum that stays UNKNOWN if any contributor is unknown. A partial sum would
 *  understate the real number while looking exact. */
function sumProven(values: readonly (number | null | undefined)[]): number | null {
  let total = 0;
  for (const value of values) {
    if (typeof value !== "number") return null;
    total += value;
  }
  return total;
}

/**
 * Every figure here is read off the overview the page ALREADY loaded. There is
 * no query in this function and no second per-class read loop anywhere in this
 * file — launch health is arithmetic over facts already proven.
 */
export function deriveLaunchHealth(overview: OperationsOverview): LaunchHealthFacts {
  const leadOverdue = classOf(overview, "lead_assignment.queue_overdue");
  const commFailed = classOf(overview, "communication.failed");
  const commDeadLetter = classOf(overview, "communication.dead_letter");
  const webhookFailed = classOf(overview, "webhook.failed");
  const webhookRejected = classOf(overview, "webhook.rejected");

  let oldestAttentionAgeSeconds: number | null = null;
  for (const incident of overview.attentionIncidents) {
    if (incident.ageSeconds === null) continue;
    if (oldestAttentionAgeSeconds === null || incident.ageSeconds > oldestAttentionAgeSeconds) {
      oldestAttentionAgeSeconds = incident.ageSeconds;
    }
  }

  return {
    totalIncidents: sumProven(overview.subsystems.map((entry) => entry.incidentCount)),
    oldestAttentionAgeSeconds,
    leadQueueOverdueCount: leadOverdue?.fault ? null : (leadOverdue?.count ?? null),
    leadQueueOldestOverdueAgeSeconds: leadOverdue?.oldest?.ageSeconds ?? null,
    automationOverdueRetryCount: overview.recovery.overdueRetryCount,
    automationOldestOverdueRetryAgeSeconds: overview.recovery.oldestOverdueAgeSeconds,
    communicationFailedCount: sumProven([
      commFailed?.fault ? null : commFailed?.count,
      commDeadLetter?.fault ? null : commDeadLetter?.count,
    ]),
    webhookFailedCount: sumProven([
      webhookFailed?.fault ? null : webhookFailed?.count,
      webhookRejected?.fault ? null : webhookRejected?.count,
    ]),
    unavailableSubsystems: overview.unavailableSubsystems,
  };
}

// ===========================================================================
// READINESS VERDICT — DERIVED PRESENTATION ONLY, NEVER PERSISTED
// ===========================================================================

/**
 * Deterministic, in strict precedence order:
 *
 *   BLOCKED      a control whose impact is `blocking` is proven DISABLED
 *   ATTENTION    the operations overview has proven incidents needing attention
 *   UNAVAILABLE  nothing above is proven, but a required source is unreadable —
 *                either the overview itself or a `blocking` control
 *   READY        every required source read cleanly, no blocking control is
 *                disabled, and no incident needs attention
 *
 * READY is therefore unreachable from partial data: an unreadable blocking
 * control or an unreadable subsystem lands on UNAVAILABLE, never on READY.
 *
 * No threshold is invented anywhere. "Needs attention" is the overview's own
 * verdict, which is built from the existing canonical predicates: overdue means
 * a stored retry instant has passed, stale means the frozen automation
 * threshold, and failed / dead-letter / uncertain are stored statuses.
 *
 * This verdict is presentation only. It is computed per request and stored
 * nowhere — there is no readiness table, column or cache.
 */
export function deriveLaunchReadiness(
  overview: OperationsOverview,
  controls: readonly LaunchControl[],
): LaunchReadinessVerdict {
  const blocking = controls.filter((control) => control.impact === "blocking");

  const blockingControls = blocking
    .filter((control) => control.state === "DISABLED")
    .map((control) => control.label);

  const unreadableControls = blocking
    .filter((control) => control.state === "UNAVAILABLE")
    .map((control) => control.label);

  if (blockingControls.length > 0) {
    return {
      verdict: "BLOCKED",
      reason: `${blockingControls.join(", ")} ${blockingControls.length === 1 ? "is" : "are"} switched off, so the marketplace is not operating normally.`,
      blockingControls,
      unreadableControls,
    };
  }

  if (overview.overallHealth === "ATTENTION") {
    return {
      verdict: "ATTENTION",
      reason:
        "Operational work needs a decision: at least one subsystem holds proven open incidents.",
      blockingControls,
      unreadableControls,
    };
  }

  if (unreadableControls.length > 0 || overview.overallHealth === "UNAVAILABLE") {
    return {
      verdict: "UNAVAILABLE",
      reason:
        unreadableControls.length > 0
          ? `Readiness cannot be confirmed: ${unreadableControls.join(", ")} could not be read.`
          : "Readiness cannot be confirmed: at least one operational source could not be read.",
      blockingControls,
      unreadableControls,
    };
  }

  return {
    verdict: "READY",
    // SCOPED ON PURPOSE. READY means Core operations are ready under the
    // controls evaluated here — never that QuickFurno as a whole is ready to
    // launch. Advisory controls, WhatsApp included, are reported but do not
    // gate this verdict, so it cannot speak for them.
    reason:
      "Core operations are ready under the controls evaluated here: every required source was read, no launch-critical control is switched off, and no subsystem holds an open incident.",
    blockingControls,
    unreadableControls,
  };
}

// ===========================================================================
// SNAPSHOT
// ===========================================================================

/**
 * The overview is passed IN, never re-read: health and the verdict are derived
 * from the reads the page already performed. Only the control sources are read
 * here, and they are read concurrently — three bounded, single-row reads.
 */
export async function getOperationsLaunchSnapshot(
  overview: OperationsOverview,
): Promise<OperationsLaunchSnapshot> {
  const [autoAssignment, aosForwarding, whatsAppProvider] = await Promise.all([
    readAutoAssignmentControl(),
    readAosForwardingControl(),
    readWhatsAppProviderControl(),
  ]);

  const controls: readonly LaunchControl[] = Object.freeze([
    autoAssignment,
    aosForwarding,
    whatsAppProvider,
    leadQueueRecheckControl(),
  ]);

  return {
    generatedAt: overview.generatedAt,
    readiness: deriveLaunchReadiness(overview, controls),
    controls,
    health: deriveLaunchHealth(overview),
  };
}
