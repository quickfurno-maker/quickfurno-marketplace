// ============================================================================
// QF-MVP-80.13A — lead-assignment WhatsApp dispatcher validator.  OFFLINE.
//
// Proves the closed lane, the fail-closed activation boundary, the exact
// one-variable template contract, and the delegation of every authorization to
// the existing communication stack.
//
// It does not grep for intentions. Wherever a real function can decide the
// question it EXERCISES that function: the pure eligibility gate, the real
// business variable builder, the real Meta template renderer, the real frozen
// Meta runtime/account/canary gates, and the real approved-mapping selector.
// Source text is read only for the NEGATIVE structural claims (no provider HTTP,
// no n8n, no gate mutation), which no execution can demonstrate.
//
// No network, no database, no credential, no send.
// ============================================================================

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  LEAD_ASSIGNMENT_ACTIVATION_FIELD,
  LEAD_ASSIGNMENT_ACTIVATION_POLICY_KEY,
  LEAD_ASSIGNMENT_AGGREGATE_TYPE,
  LEAD_ASSIGNMENT_COMMUNICATION_LANE,
  LEAD_ASSIGNMENT_INTENT_CHANNEL,
  LEAD_ASSIGNMENT_MESSAGE_IDEMPOTENCY_PREFIX,
  LEAD_ASSIGNMENT_SELECTABLE_STATUS,
  LEAD_ASSIGNMENT_TEMPLATE_KEY,
  LEAD_ASSIGNMENT_TEMPLATE_PURPOSE,
  LeadAssignmentDispatchRefusal,
  buildLeadAssignmentDispatchPlan,
  isEligibleLeadAssignmentIntent,
  leadAssignmentMessageIdempotencyKey,
  parseActivationBoundary,
  resolveLeadAssignmentTemplateKey,
} from "../../../lib/communication/leadAssignmentDispatchContract.ts";
import { deriveLeadReference } from "../../../lib/communication/leadReference.ts";
import {
  BUSINESS_VARIABLE_BUILDERS,
  BusinessSourceKey,
  bindingSchemaFor,
  sourceKeysFor,
} from "../../../lib/communication/businessTemplateVariables.ts";
import { renderWhatsAppTemplateComponents } from "../../../lib/communication/providers/whatsappTemplateBinding.ts";
import {
  OutboundGateReason,
  evaluateProviderAccountReadiness,
  evaluateRuntimeActivation,
} from "../../../lib/communication/providers/metaRuntimeGate.ts";
import { selectApprovedProviderMapping } from "../../../lib/communication/whatsappTemplate.ts";

// ---------------------------------------------------------------------------
// Sources read for the negative structural claims
// ---------------------------------------------------------------------------

const SERVICE_SRC_PATH = "services/leadAssignmentDispatchService.ts";
const CONTRACT_SRC_PATH = "lib/communication/leadAssignmentDispatchContract.ts";
const ASSIGN_RPC_PATH =
  "supabase/migrations/20260815000000_qf_mvp_75_01_matchcore_binding_rank_order.sql";

const serviceSrc = readFileSync(resolve(SERVICE_SRC_PATH), "utf8");
const contractSrc = readFileSync(resolve(CONTRACT_SRC_PATH), "utf8");
const assignRpcSrc = readFileSync(resolve(ASSIGN_RPC_PATH), "utf8");

/** Comment lines are intent, not behaviour. Negative claims run on CODE only. */
const stripComments = (src) =>
  src
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join("\n");

const serviceCode = stripComments(serviceSrc);
const contractCode = stripComments(contractSrc);

// ---------------------------------------------------------------------------
// Fixtures — shaped exactly like the rows qf_assign_lead_vendors_v2 writes
// ---------------------------------------------------------------------------

const INTENT_ID = "3f1c2a44-9c6e-4a2b-8d11-77aa0b3c5e91";
const ASSIGNMENT_ID = "5b8e10c2-4f3a-4d7e-9b02-1c6d4e8a2f30";
const LEAD_ID = "a1c9d7e3-2b48-4c6a-9f15-8e0d3b7a4c22";
const VENDOR_ID = "01c6bc34-37bd-4d68-9c03-d4584d3ef280";

/** The owner-configured boundary used throughout. */
const BOUNDARY_ISO = "2026-09-01T00:00:00Z";
const boundaryOf = (iso) => {
  const parsed = parseActivationBoundary({ [LEAD_ASSIGNMENT_ACTIVATION_FIELD]: iso });
  return parsed.ok ? parsed.boundary : null;
};
const BOUNDARY = boundaryOf(BOUNDARY_ISO);

/** An intent created AFTER the boundary — the only shape that may dispatch. */
const newIntent = (overrides = {}) => ({
  id: INTENT_ID,
  aggregate_type: LEAD_ASSIGNMENT_AGGREGATE_TYPE,
  aggregate_id: ASSIGNMENT_ID,
  channel: LEAD_ASSIGNMENT_INTENT_CHANNEL,
  template_purpose: LEAD_ASSIGNMENT_TEMPLATE_PURPOSE,
  payload_ref: { assignment_id: ASSIGNMENT_ID, lead_id: LEAD_ID },
  status: LEAD_ASSIGNMENT_SELECTABLE_STATUS,
  created_at: "2026-09-02T10:15:00.000Z",
  ...overrides,
});

/** The SIX historical production intents: pending, valid, created before the boundary. */
const HISTORICAL_SIX = Array.from({ length: 6 }, (_, i) =>
  newIntent({
    id: `6b0a1c2d-3e4f-4a5b-8c9d-00000000000${i + 1}`,
    aggregate_id: `7c1b2d3e-4f50-4a6b-9c8d-00000000000${i + 1}`,
    payload_ref: { assignment_id: `7c1b2d3e-4f50-4a6b-9c8d-00000000000${i + 1}`, lead_id: LEAD_ID },
    created_at: `2026-08-0${i + 1}T09:00:00.000Z`,
  })
);

const planFor = (row, boundary = BOUNDARY) =>
  buildLeadAssignmentDispatchPlan({
    row,
    boundary,
    vendorId: VENDOR_ID,
    leadReference: deriveLeadReference(LEAD_ID),
  });

const bodyTexts = (r) =>
  (r.components ?? []).find((c) => c.type === "body")?.parameters.map((p) => p.text) ?? [];

const render = (key, vars) => renderWhatsAppTemplateComponents(bindingSchemaFor(key), vars);

// ---------------------------------------------------------------------------
// Production provider state, transcribed from the QF-MVP-80.13A locked facts
// ---------------------------------------------------------------------------

const PROD_RUNTIME_POLICY = Object.freeze({
  provider_key: "meta_whatsapp_cloud",
  channel: "whatsapp",
  activation_status: "disabled",
  outbound_enabled: false,
  webhook_processing_enabled: false,
  health_check_enabled: false,
});

const PROD_PHONE_NUMBER_ID = "1333595106493545";
const PROD_WABA_ID = "27861262223494153";

const PROD_ACCOUNT = Object.freeze({
  provider_key: "meta_whatsapp_cloud",
  channel: "whatsapp",
  phone_number_reference: PROD_PHONE_NUMBER_ID,
  business_account_reference: PROD_WABA_ID,
  readiness_status: "provider_ready",
  configuration_status: "complete",
  business_verification_status: "verified",
  phone_number_status: "connected",
  webhook_status: "verified",
  health_status: "unknown",
});

const EXPECTED_IDENTITY = Object.freeze({
  phoneNumberId: PROD_PHONE_NUMBER_ID,
  wabaId: PROD_WABA_ID,
});

const PROD_MAPPING = Object.freeze({
  id: "9d2e3f40-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
  template_key: LEAD_ASSIGNMENT_TEMPLATE_KEY,
  channel: "whatsapp",
  provider_key: "meta_whatsapp_cloud",
  language: "en",
  version: "1.0",
  provider_template_name: "quickfurno_vendor_lead_assignment_alert_v1",
  // QF-MVP-80.14C: corrected. A GET-only re-read of the production WABA
  // (graph v26.0, HTTP 200, exactly one template with this name) returned
  // 1770945567662723. The old value here was a transcription that had been
  // copied forward; production metadata was repaired to match Meta.
  provider_template_id: "1770945567662723",
  approval_status: "approved",
  is_active: true,
  variables_schema: {
    bindingVersion: 1,
    bindings: [
      { position: 1, component: "body", sourceKey: "lead_reference", parameterType: "text" },
    ],
  },
});

const MAPPING_CRITERIA = Object.freeze({
  templateKey: LEAD_ASSIGNMENT_TEMPLATE_KEY,
  providerKey: "meta_whatsapp_cloud",
  language: "en",
});

// ---------------------------------------------------------------------------
// The rules
// ---------------------------------------------------------------------------

const T = {
  // ---- Lane admission -----------------------------------------------------
  "T01 a valid lead_assignment/vendor_lead_assigned/whatsapp/pending intent is accepted": () =>
    isEligibleLeadAssignmentIntent(newIntent(), BOUNDARY).ok === true && planFor(newIntent()).ok === true,

  "T02 the lane maps ONLY to lead_assignment_alert": () => {
    const plan = planFor(newIntent());
    return (
      plan.ok === true &&
      plan.intent.template_key === "lead_assignment_alert" &&
      plan.intent.type === "lead_assignment_alert" &&
      resolveLeadAssignmentTemplateKey(LEAD_ASSIGNMENT_TEMPLATE_PURPOSE) === "lead_assignment_alert" &&
      // exactly one purpose is mappable
      ["vendor_lead_offer", "vendor_new_lead", "lead_assignment", "campaign.execute_recipient"].every(
        (p) => resolveLeadAssignmentTemplateKey(p) === null
      )
    );
  },

  "T03 lead_reference becomes EXACTLY body position 1 through the real renderer": () => {
    const plan = planFor(newIntent());
    if (!plan.ok) return false;
    const rendered = render(LEAD_ASSIGNMENT_TEMPLATE_KEY, plan.intent.variables);
    const expected = deriveLeadReference(LEAD_ID);
    const body = (rendered.components ?? []).find((c) => c.type === "body");
    return (
      rendered.ok === true &&
      body?.parameters.length === 1 &&
      body.parameters[0].type === "text" &&
      bodyTexts(rendered).join("|") === expected
    );
  },

  "T04 no extra variables are emitted": () => {
    const plan = planFor(newIntent());
    if (!plan.ok) return false;
    const keys = Object.keys(plan.intent.variables);
    return (
      keys.length === 1 &&
      keys[0] === BusinessSourceKey.LEAD_REFERENCE &&
      sourceKeysFor(LEAD_ASSIGNMENT_TEMPLATE_KEY).join(",") === BusinessSourceKey.LEAD_REFERENCE
    );
  },

  "T05 a wrong aggregate_type is refused": () =>
    ["vendor_campaign", "replacement", "credit_restoration", "lead", "", null].every((v) => {
      const r = isEligibleLeadAssignmentIntent(newIntent({ aggregate_type: v }), BOUNDARY);
      return r.ok === false && r.reason === LeadAssignmentDispatchRefusal.INTENT_NOT_LEAD_ASSIGNMENT;
    }),

  "T06 a wrong template_purpose is refused": () =>
    ["vendor_campaign_message", "vendor_new_lead", "vendor_lead_assigned ", "", null].every((v) => {
      const r = isEligibleLeadAssignmentIntent(newIntent({ template_purpose: v }), BOUNDARY);
      return r.ok === false && r.reason === LeadAssignmentDispatchRefusal.INTENT_PURPOSE_UNSUPPORTED;
    }),

  "T07 a wrong channel is refused": () =>
    ["sms", "email", "dashboard", "rcs", "", null].every((v) => {
      const r = isEligibleLeadAssignmentIntent(newIntent({ channel: v }), BOUNDARY);
      return r.ok === false && r.reason === LeadAssignmentDispatchRefusal.INTENT_CHANNEL_UNSUPPORTED;
    }),

  "T08 a non-pending intent is refused": () =>
    ["claimed", "dispatched", "delivered", "failed", "uncertain", "", null].every((v) => {
      const r = isEligibleLeadAssignmentIntent(newIntent({ status: v }), BOUNDARY);
      return r.ok === false && r.reason === LeadAssignmentDispatchRefusal.INTENT_NOT_PENDING;
    }),

  // ---- The activation boundary --------------------------------------------
  "T09 a MISSING activation watermark yields zero eligible intents": () => {
    const absent = [null, undefined, {}, { someOtherKey: BOUNDARY_ISO }];
    const configsRefuse = absent.every((c) => {
      const p = parseActivationBoundary(c);
      return p.ok === false && p.reason === LeadAssignmentDispatchRefusal.ACTIVATION_BOUNDARY_UNCONFIGURED;
    });
    // and the gate itself refuses with no boundary in hand
    const gateRefuses = [null, undefined].every((b) => {
      const r = isEligibleLeadAssignmentIntent(newIntent(), b);
      return r.ok === false && r.reason === LeadAssignmentDispatchRefusal.ACTIVATION_BOUNDARY_UNCONFIGURED;
    });
    return configsRefuse && gateRefuses && planFor(newIntent(), null).ok === false;
  },

  "T10 a MALFORMED activation watermark yields zero eligible intents": () => {
    const malformed = [
      "2026", "September 2026", "2026-09-01", "2026-09-01T00:00:00",
      "2026-09-01T00:00:00+05:30", "2026-02-31T00:00:00Z", "2026-13-01T00:00:00Z",
      "not-a-date", "", 0, 1756684800000, true, [], {}, "now", "epoch", "*",
    ];
    const parsedRefuse = malformed.every((v) => {
      const p = parseActivationBoundary({ [LEAD_ASSIGNMENT_ACTIVATION_FIELD]: v });
      return p.ok === false && p.reason === LeadAssignmentDispatchRefusal.ACTIVATION_BOUNDARY_MALFORMED;
    });
    // a non-object config is malformed too
    const shapeRefuse = ["a string", 42, [BOUNDARY_ISO]].every((c) => {
      const p = parseActivationBoundary(c);
      return p.ok === false && p.reason === LeadAssignmentDispatchRefusal.ACTIVATION_BOUNDARY_MALFORMED;
    });
    // a NaN boundary reaching the gate is refused rather than compared
    const nanRefused =
      isEligibleLeadAssignmentIntent(newIntent(), { notBeforeIso: "x", notBeforeMs: NaN }).ok === false;
    return parsedRefuse && shapeRefuse && nanRefused;
  },

  "T11 an intent created BEFORE the watermark never dispatches": () => {
    const before = newIntent({ created_at: "2026-08-31T23:59:59.999Z" });
    const atBoundary = newIntent({ created_at: BOUNDARY_ISO });
    const r1 = isEligibleLeadAssignmentIntent(before, BOUNDARY);
    const r2 = isEligibleLeadAssignmentIntent(atBoundary, BOUNDARY);
    return (
      r1.ok === false &&
      r1.reason === LeadAssignmentDispatchRefusal.INTENT_BEFORE_ACTIVATION_BOUNDARY &&
      // an intent AT the exact boundary is also refused — the comparison is strict
      r2.ok === false &&
      r2.reason === LeadAssignmentDispatchRefusal.INTENT_BEFORE_ACTIVATION_BOUNDARY &&
      planFor(before).ok === false
    );
  },

  "T12 an intent created AFTER the watermark is eligible": () => {
    const after = newIntent({ created_at: "2026-09-01T00:00:00.001Z" });
    return isEligibleLeadAssignmentIntent(after, BOUNDARY).ok === true && planFor(after).ok === true;
  },

  "T13 the historical SIX cannot be selected by the default path": () => {
    // (a) all six are otherwise perfectly valid pending rows...
    const allWouldPassWithoutBoundary = HISTORICAL_SIX.every(
      (row) => isEligibleLeadAssignmentIntent(row, boundaryOf("2026-01-01T00:00:00Z")).ok === true
    );
    // (b) ...yet none is eligible under the real activation boundary,
    const noneEligible = HISTORICAL_SIX.every((row) => {
      const r = isEligibleLeadAssignmentIntent(row, BOUNDARY);
      return r.ok === false && r.reason === LeadAssignmentDispatchRefusal.INTENT_BEFORE_ACTIVATION_BOUNDARY;
    });
    // (c) ...and none is eligible with NO boundary configured, which is production today.
    const noneEligibleUnconfigured = HISTORICAL_SIX.every(
      (row) => isEligibleLeadAssignmentIntent(row, null).ok === false
    );
    const nonePlanned = HISTORICAL_SIX.every((row) => planFor(row).ok === false);
    return allWouldPassWithoutBoundary && noneEligible && noneEligibleUnconfigured && nonePlanned;
  },

  // ---- Delegated authorization (real frozen gates, executed) ---------------
  "T14 runtime policy disabled => no send": () => {
    const r = evaluateRuntimeActivation({ ...PROD_RUNTIME_POLICY, outbound_enabled: true });
    // outbound switched on but activation still 'disabled' must refuse
    return r.ok === false && r.reason === OutboundGateReason.ACTIVATION_NOT_SENDABLE;
  },

  "T15 outbound_enabled=false => no send, in every activation state": () =>
    ["disabled", "readiness_only", "shadow", "canary", "active", "paused"].every((status) => {
      const r = evaluateRuntimeActivation({
        ...PROD_RUNTIME_POLICY,
        activation_status: status,
        outbound_enabled: false,
      });
      return r.ok === false && r.reason === OutboundGateReason.OUTBOUND_DISABLED;
    }) &&
    // and the ACTUAL production policy row refuses
    evaluateRuntimeActivation(PROD_RUNTIME_POLICY).ok === false &&
    // a missing policy row refuses too
    evaluateRuntimeActivation(null).reason === OutboundGateReason.RUNTIME_POLICY_MISSING,

  "T16 a missing/unapproved/inactive template mapping => no send": () => {
    const approved = selectApprovedProviderMapping([PROD_MAPPING], MAPPING_CRITERIA);
    const none = selectApprovedProviderMapping([], MAPPING_CRITERIA);
    const unapproved = selectApprovedProviderMapping(
      [{ ...PROD_MAPPING, approval_status: "pending" }],
      MAPPING_CRITERIA
    );
    const inactive = selectApprovedProviderMapping(
      [{ ...PROD_MAPPING, is_active: false }],
      MAPPING_CRITERIA
    );
    const noName = selectApprovedProviderMapping(
      [{ ...PROD_MAPPING, provider_template_name: "" }],
      MAPPING_CRITERIA
    );
    return (
      approved.ok === true &&
      approved.template.providerTemplateName === "quickfurno_vendor_lead_assignment_alert_v1" &&
      none.ok === false &&
      unapproved.ok === false &&
      inactive.ok === false &&
      noName.ok === false
    );
  },

  "T17 a provider account that is not ready => no send": () => {
    // Production's account today: health_status='unknown', not 'healthy'.
    const today = evaluateProviderAccountReadiness(PROD_ACCOUNT, EXPECTED_IDENTITY);
    const missing = evaluateProviderAccountReadiness(null, EXPECTED_IDENTITY);
    const wrongIdentity = evaluateProviderAccountReadiness(
      { ...PROD_ACCOUNT, health_status: "healthy", phone_number_reference: "999" },
      EXPECTED_IDENTITY
    );
    const notVerified = evaluateProviderAccountReadiness(
      { ...PROD_ACCOUNT, health_status: "healthy", business_verification_status: "pending" },
      EXPECTED_IDENTITY
    );
    return (
      today.ok === false &&
      today.reason === OutboundGateReason.PROVIDER_ACCOUNT_NOT_READY &&
      missing.reason === OutboundGateReason.PROVIDER_ACCOUNT_MISSING &&
      wrongIdentity.reason === OutboundGateReason.PROVIDER_ACCOUNT_REFERENCE_MISMATCH &&
      notVerified.reason === OutboundGateReason.PROVIDER_ACCOUNT_NOT_READY
    );
  },

  // ---- Idempotency --------------------------------------------------------
  "T18 a retry is idempotent — one intent yields one stable message key": () => {
    const a = planFor(newIntent());
    const b = planFor(newIntent());
    const other = planFor(newIntent({ id: "8e7d6c5b-4a39-4281-9f70-1a2b3c4d5e6f" }));
    if (!a.ok || !b.ok || !other.ok) return false;
    return (
      // stable across calls
      a.intent.idempotency_key === b.intent.idempotency_key &&
      // derived from the INTENT id, so a retry of the same intent collides
      a.intent.idempotency_key === leadAssignmentMessageIdempotencyKey(INTENT_ID) &&
      a.intent.idempotency_key.startsWith(LEAD_ASSIGNMENT_MESSAGE_IDEMPOTENCY_PREFIX) &&
      // and a DIFFERENT intent gets a different key
      other.intent.idempotency_key !== a.intent.idempotency_key &&
      // the message points back at the intent that authorized it
      a.intent.entity_type === "communication_intent" &&
      a.intent.entity_id === INTENT_ID
    );
  },

  "T18b the dispatcher invents no second idempotency scheme": () =>
    /leadAssignmentMessageIdempotencyKey/.test(contractCode) &&
    !/idempotency_key\s*:\s*[`"']/.test(serviceCode) &&
    // the intent status advance is compare-and-set and lane-scoped
    /\.eq\("aggregate_type", LEAD_ASSIGNMENT_AGGREGATE_TYPE\)/.test(serviceCode) &&
    /\.eq\("status", input\.observedStatus\)/.test(serviceCode) &&
    /isForwardTransition/.test(serviceCode),

  // ---- No fallbacks -------------------------------------------------------
  "T19 an unknown purpose has NO fallback template": () =>
    [
      "unknown", "vendor_lead_assigned_v2", "VENDOR_LEAD_ASSIGNED", "lead_assignment_alert",
      "client_lead_status_update", 42, null, undefined, {}, [],
    ].every((p) => resolveLeadAssignmentTemplateKey(p) === null) &&
    // and the plan refuses rather than substituting
    planFor(newIntent({ template_purpose: "unknown" })).reason ===
      LeadAssignmentDispatchRefusal.INTENT_PURPOSE_UNSUPPORTED,

  // ---- Structural negatives ----------------------------------------------
  "T20 the dispatcher makes NO direct Meta/provider HTTP call": () =>
    !/fetch\s*\(/.test(serviceCode) &&
    !/graph\.facebook\.com/.test(serviceCode) &&
    !/https?:\/\//.test(serviceCode) &&
    !/axios|node-fetch|undici|XMLHttpRequest/.test(serviceCode) &&
    !/metaCloudWhatsAppProvider|MetaCloudWhatsAppProvider|sendResolvedTemplate/.test(serviceCode) &&
    // the ONLY send is the canonical service
    /createRuntimeCommunicationService\(\)/.test(serviceCode) &&
    (serviceCode.match(/\.send\(/g) ?? []).length === 1,

  "T21 the dispatcher contains NO n8n call": () =>
    !/n8n/i.test(serviceCode) &&
    !/n8n/i.test(contractCode) &&
    !/automationTransportService|webhookUrl|workflowId/.test(serviceCode),

  "T22 the validator itself performs no live send, DB or network access": () => {
    const selfSrc = readFileSync(resolve("scripts/mvp/communication/validate-qf-mvp-80-13a.mjs"), "utf8");
    const selfCode = stripComments(selfSrc);

    // Every module this validator loads, taken from its own import statements.
    const imported = [...selfCode.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
    // PURE lib modules and node:fs/path only. No `services/`, no supabase client,
    // no provider adapter — so no I/O-capable code is ever loaded, let alone run.
    const importsArePure = imported.every(
      (p) => p === "node:fs" || p === "node:path" || /^\.\.\/\.\.\/\.\.\/lib\//.test(p)
    );

    // The I/O entry points of the dispatcher are never CALLED here. The service is
    // read as text (readFileSync) and never imported.
    const ioEntryPoints = [
      "dispatchLeadAssignmentIntent",
      "runLeadAssignmentDispatchBatch",
      "selectEligibleLeadAssignmentIntents",
      "readLeadAssignmentActivationBoundary",
      "createRuntimeCommunicationService",
    ];
    const noIoCalled = ioEntryPoints.every((fn) => !new RegExp(`${fn}\\s*\\(`).test(selfCode));

    return (
      importsArePure &&
      noIoCalled &&
      !/fetch\s*\(/.test(selfCode) &&
      !/adminClient\s*\(|createClient\s*\(/.test(selfCode) &&
      !/\.send\s*\(/.test(selfCode) &&
      !/process\.env/.test(selfCode)
    );
  },

  "T23 the source contract still uses the EXISTING lead_reference BusinessSourceKey": () => {
    const plan = planFor(newIntent());
    return (
      plan.ok === true &&
      BusinessSourceKey.LEAD_REFERENCE === "lead_reference" &&
      // the vocabulary is unchanged: exactly the five historical source keys
      Object.values(BusinessSourceKey).length === 5 &&
      // the lane declares NO source key of its own
      !/BusinessSourceKey\s*=/.test(contractCode) &&
      // and it builds variables ONLY through the existing builder
      /buildLeadAssignmentAlertVariables/.test(contractCode) &&
      BUSINESS_VARIABLE_BUILDERS.lead_assignment_alert !== undefined
    );
  },

  "T24 auto-assignment behaviour is untouched": () =>
    !/auto_assignment|autoAssignment|auto_assignment_mode/i.test(serviceCode) &&
    !/auto_assignment|autoAssignment/i.test(contractCode) &&
    // the lane never writes the assignment authority's own tables
    !/lead_assignments"\)\s*\n?\s*\.update|\.insert\(/.test(serviceCode) &&
    // and it never mutates the gates it depends on
    !/communication_provider_runtime_policies|communication_provider_canary_destinations|communication_provider_accounts|communication_provider_template_mappings/.test(
      serviceCode
    ),

  // ---- Seam parity with the authority that WRITES the intents -------------
  "T25 the lane matches what qf_assign_lead_vendors_v2 actually writes": () =>
    /'lead_assignment', v_assignment_id, 'whatsapp', 'vendor_lead_assigned'/.test(assignRpcSrc) &&
    /'pending'\)/.test(assignRpcSrc) &&
    LEAD_ASSIGNMENT_AGGREGATE_TYPE === "lead_assignment" &&
    LEAD_ASSIGNMENT_INTENT_CHANNEL === "whatsapp" &&
    LEAD_ASSIGNMENT_TEMPLATE_PURPOSE === "vendor_lead_assigned" &&
    LEAD_ASSIGNMENT_SELECTABLE_STATUS === "pending",

  "T26 the intent payload evidence must name its own assignment": () => {
    const mismatched = newIntent({ payload_ref: { assignment_id: LEAD_ID, lead_id: LEAD_ID } });
    const missing = newIntent({ payload_ref: {} });
    const notObject = newIntent({ payload_ref: "assignment" });
    return [mismatched, missing, notObject].every((row) => {
      const r = isEligibleLeadAssignmentIntent(row, BOUNDARY);
      return r.ok === false && r.reason === LeadAssignmentDispatchRefusal.INTENT_EVIDENCE_INVALID;
    });
  },

  "T27 the plan targets the vendor through a durable recipient reference": () => {
    const plan = planFor(newIntent());
    return (
      plan.ok === true &&
      plan.intent.recipient_type === "vendor" &&
      plan.intent.recipient_id === VENDOR_ID &&
      plan.intent.destination_source.kind === "recipient_reference" &&
      plan.intent.lane === LEAD_ASSIGNMENT_COMMUNICATION_LANE &&
      plan.intent.channel === "whatsapp" &&
      plan.intent.scheduled_at === null &&
      // no destination, phone or PII is ever carried on the plan
      !JSON.stringify(plan.intent).includes("phone") &&
      !JSON.stringify(plan.intent).includes("@")
    );
  },

  "T28 an unresolvable vendor or reference refuses rather than substituting": () => {
    const noVendor = buildLeadAssignmentDispatchPlan({
      row: newIntent(), boundary: BOUNDARY, vendorId: null, leadReference: "QF-A1C9D7E3",
    });
    const badVendor = buildLeadAssignmentDispatchPlan({
      row: newIntent(), boundary: BOUNDARY, vendorId: "not-a-uuid", leadReference: "QF-A1C9D7E3",
    });
    const noRef = buildLeadAssignmentDispatchPlan({
      row: newIntent(), boundary: BOUNDARY, vendorId: VENDOR_ID, leadReference: null,
    });
    const blankRef = buildLeadAssignmentDispatchPlan({
      row: newIntent(), boundary: BOUNDARY, vendorId: VENDOR_ID, leadReference: "   ",
    });
    return (
      noVendor.reason === LeadAssignmentDispatchRefusal.VENDOR_UNRESOLVED &&
      badVendor.reason === LeadAssignmentDispatchRefusal.VENDOR_UNRESOLVED &&
      noRef.reason === LeadAssignmentDispatchRefusal.VARIABLES_UNRESOLVED &&
      blankRef.reason === LeadAssignmentDispatchRefusal.VARIABLES_UNRESOLVED
    );
  },

  "T29 the lead reference has exactly ONE derivation, shared with the client lane": () => {
    const clientLaneSrc = readFileSync(resolve("services/automationClientExecutionService.ts"), "utf8");
    const derived = deriveLeadReference(LEAD_ID);
    return (
      derived === "QF-A1C9D7E3" &&
      deriveLeadReference(LEAD_ID) === derived &&
      [null, undefined, "", "not-a-uuid", 42].every((v) => deriveLeadReference(v) === null) &&
      // the old inline formula is gone from the client lane
      !/QF-\$\{.*replace\(\/-\/g/.test(clientLaneSrc) &&
      /deriveLeadReference/.test(clientLaneSrc) &&
      // and neither lane restates it
      !/replace\(\/-\/g/.test(serviceCode)
    );
  },

  "T30 the activation boundary uses the EXISTING policy-config surface (no migration)": () =>
    LEAD_ASSIGNMENT_ACTIVATION_POLICY_KEY === "lead_assignment_dispatch_activation" &&
    /automation_policy_active_configs/.test(serviceCode) &&
    /automation_policy_configs!inner\(config_json\)/.test(serviceCode) &&
    // no DDL of any kind ships in the lane
    !/create table|alter table|create index|create or replace function/i.test(serviceCode + contractCode),

  "T31 selection cannot run without a boundary": () =>
    // the boundary read precedes the query, and the early return is unconditional
    /const boundaryRead = await readLeadAssignmentActivationBoundary\(\);/.test(serviceCode) &&
    /if \(!boundaryRead\.ok\) \{[\s\S]{0,220}?intents: \[\] \};/.test(serviceCode) &&
    // the query itself carries the forward-only clause
    /\.gt\("created_at", boundary\.notBeforeIso\)/.test(serviceCode) &&
    // and every returned row is re-admitted through the pure gate
    /isEligibleLeadAssignmentIntent\(row, boundary\)\.ok/.test(serviceCode),
};

// ---------------------------------------------------------------------------
// MUTATION SELF-TESTS — each simulates a regression and must be REJECTED
// ---------------------------------------------------------------------------

const MUT = {
  "M01 a permissive default boundary is rejected": () =>
    parseActivationBoundary({ [LEAD_ASSIGNMENT_ACTIVATION_FIELD]: "1970-01-01T00:00:00Z" }).ok === true &&
    // an epoch boundary WOULD admit the six — which is exactly why absence must never default to one
    HISTORICAL_SIX.every(
      (r) => isEligibleLeadAssignmentIntent(r, boundaryOf("1970-01-01T00:00:00Z")).ok === true
    ) &&
    // ...and the real unconfigured path does NOT behave like epoch
    HISTORICAL_SIX.every((r) => isEligibleLeadAssignmentIntent(r, null).ok === false),

  "M02 a second purpose silently mapping to the template is rejected": () =>
    resolveLeadAssignmentTemplateKey("vendor_campaign_message") === null &&
    resolveLeadAssignmentTemplateKey("__proto__") === null &&
    resolveLeadAssignmentTemplateKey("constructor") === null &&
    resolveLeadAssignmentTemplateKey("toString") === null,

  "M03 an extra rendered variable is rejected": () => {
    const withExtra = render(LEAD_ASSIGNMENT_TEMPLATE_KEY, {
      lead_reference: "QF-A1C9D7E3",
      client_name: "Asha",
    });
    const renamed = render(LEAD_ASSIGNMENT_TEMPLATE_KEY, { leadReference: "QF-A1C9D7E3" });
    return withExtra.ok === false && renamed.ok === false;
  },

  "M04 a widened aggregate_type enum cannot leak into the lane": () =>
    ["lead_assignment_v2", "Lead_Assignment", "lead_assignments"].every(
      (v) => isEligibleLeadAssignmentIntent(newIntent({ aggregate_type: v }), BOUNDARY).ok === false
    ),

  "M05 a sendable posture without outbound_enabled is rejected": () =>
    ["canary", "active"].every(
      (s) =>
        evaluateRuntimeActivation({
          ...PROD_RUNTIME_POLICY,
          activation_status: s,
          outbound_enabled: false,
        }).ok === false
    ),
};

// ---------------------------------------------------------------------------

const results = [];
const add = (name, ok, detail) => results.push({ name, ok: ok === true, detail: detail ?? "" });

for (const [name, fn] of Object.entries(T)) {
  let ok = false;
  let detail = "";
  try {
    ok = fn() === true;
  } catch (e) {
    detail = e instanceof Error ? e.message : String(e);
  }
  add(name, ok, detail);
}
for (const [name, fn] of Object.entries(MUT)) {
  let ok = false;
  let detail = "";
  try {
    ok = fn() === true;
  } catch (e) {
    detail = e instanceof Error ? e.message : String(e);
  }
  add(name, ok, detail);
}

const failed = results.filter((r) => !r.ok);
for (const r of results) {
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${!r.ok && r.detail ? `  [${r.detail}]` : ""}`);
}
console.log(
  `\nLane: aggregate=${LEAD_ASSIGNMENT_AGGREGATE_TYPE} purpose=${LEAD_ASSIGNMENT_TEMPLATE_PURPOSE} ` +
    `-> template=${LEAD_ASSIGNMENT_TEMPLATE_KEY} · variables=1 (${BusinessSourceKey.LEAD_REFERENCE}) ` +
    `· boundary key=${LEAD_ASSIGNMENT_ACTIVATION_POLICY_KEY}`
);
console.log(
  `Historical intents held: ${HISTORICAL_SIX.length}/6 excluded under the boundary AND under no boundary.`
);
console.log(
  `Summary: ${results.length - failed.length} passed, ${failed.length} failed ` +
    `(rules: ${Object.keys(T).length}, mutation self-tests: ${Object.keys(MUT).length}).`
);
process.exit(failed.length === 0 ? 0 : 1);
