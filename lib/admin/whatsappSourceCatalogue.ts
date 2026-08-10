// ============================================================================
// QuickFurno — lib/admin/whatsappSourceCatalogue.ts   (C-WA1)
//
// The SOURCE GOVERNANCE projection of the committed, non-secret WhatsApp
// template manifests. PURE: no database, no network, no environment, no clock,
// no filesystem read at request time — the two manifests are imported as JSON so
// they are bundled with the build and cannot drift from the commit under review.
//
// WHAT THIS IS
//   A read-only adapter that turns two governance artifacts into typed rows:
//     • docs/provider-manifests/whatsapp-template-submission-manifest.json
//         → the LOCAL CONTRACT (what QuickFurno intends a template to be)
//     • docs/provider-manifests/meta-template-remote-state.json
//         → the PROVEN REMOTE EVIDENCE (what Meta was last observed to hold)
//
// WHAT THIS IS NOT
//   Not a second template catalogue, not a template registry, not a writer.
//   Nothing here mints a template, submits one, maps one or authorizes a send.
//   Source governance state is NOT runtime state: a template can be APPROVED at
//   Meta and still be unsendable because it is unmapped, the account is not
//   ready, or runtime policy is disabled. Those are separate authorities and the
//   admin surface must never collapse them (see getTemplateRuntimeEligibility in
//   services/adminWhatsAppService.ts).
//
// SECRECY
//   Every field below is copied through an EXPLICIT ALLOWLIST. No object from a
//   manifest is ever spread, so a field added to a manifest later cannot leak
//   into a rendered page by default. The remote-state artifact additionally
//   declares `contains_secrets`; a true value hard-fails the projection rather
//   than rendering it.
// ============================================================================

import remoteStateManifest from "../../docs/provider-manifests/meta-template-remote-state.json";
import submissionManifest from "../../docs/provider-manifests/whatsapp-template-submission-manifest.json";
import {
  BUSINESS_TEMPLATE_CONTRACTS,
  sourceKeysFor,
} from "../communication/businessTemplateVariables";
import { COMPONENT_PROFILES } from "../communication/providers/whatsappTemplateBinding";

/** Source-governance group the manifest files a template under. */
export type TemplateGovernanceGroup =
  | "authentication"
  | "consent_service"
  | "marketing"
  | "transactional_business";

/**
 * A single declared positional binding, projected for display. `sourceKey` is
 * null when the manifest's binding contract is UNRESOLVED — the admin surface
 * must show that honestly rather than inventing a name.
 */
export interface TemplateVariableBindingView {
  readonly position: number;
  readonly component: string;
  readonly sourceKey: string | null;
  readonly parameterType: string;
  /** Non-authoritative human description from the manifest, when present. */
  readonly description: string | null;
  /** Governed example value used ONLY for the read-only preview. */
  readonly example: string | null;
}

/** A quick-reply / OTP button as DECLARED locally. Never a live control. */
export interface TemplateButtonView {
  readonly type: string;
  readonly text: string | null;
  readonly index: number | null;
  readonly payload: string | null;
}

/** The LOCAL CONTRACT dimension of one internal template. */
export interface TemplateLocalContract {
  readonly internalTemplateKey: string;
  readonly group: TemplateGovernanceGroup;
  readonly category: string;
  readonly language: string;
  readonly recipientType: string;
  readonly consentScope: string;
  readonly purpose: string;
  readonly suppressionRule: string | null;
  readonly componentProfile: string;
  /** True when componentProfile is one of the profiles the renderer implements. */
  readonly componentProfileSupported: boolean;
  readonly bodySpec: string;
  readonly buttons: readonly TemplateButtonView[];
  readonly bindingReadiness: "resolved" | "unresolved";
  readonly bindingVersion: number | null;
  readonly bindings: readonly TemplateVariableBindingView[];
  /** True when lib/communication/businessTemplateVariables.ts proves the keys. */
  readonly codeProvenSourceKeys: readonly string[];
  readonly providerTemplateNameCandidate: string | null;
  /** Recorded local submission state — NOT proof of remote state. */
  readonly submissionState: string;
  readonly localApprovalStatus: string;
  readonly owningSubphase: string | null;
  readonly externalApprovalRequired: boolean;
  readonly providerAccountRequired: boolean;
}

/** The PROVEN REMOTE EVIDENCE dimension, keyed by provider template name. */
export interface TemplateRemoteEvidence {
  readonly internalTemplateKey: string;
  readonly providerTemplateName: string;
  readonly requestedCategory: string | null;
  readonly lastProvenStatus: string;
  readonly lastProvenRemoteCategory: string | null;
  readonly disposition: string;
  readonly sendAuthority: string;
  readonly mappingAuthority: string;
  readonly reconciliationOutcome: string | null;
  readonly readbackSemanticMatch: boolean | null;
  /** Sanitized evidence FILENAMES only — no Meta payload is referenced. */
  readonly evidenceReferences: readonly string[];
  readonly notes: string | null;
}

// ---------------------------------------------------------------------------
// Safe primitive readers. Each refuses to coerce; an unexpected shape becomes
// null rather than "[object Object]" or a misleading empty string.
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function bool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function int(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

// ---------------------------------------------------------------------------
// LOCAL CONTRACT projection
// ---------------------------------------------------------------------------

const GOVERNANCE_GROUPS: readonly TemplateGovernanceGroup[] = Object.freeze([
  "authentication",
  "consent_service",
  "marketing",
  "transactional_business",
]);

/**
 * Merge the manifest's positional `variables_schema` (which carries the human
 * description and the example) with its `binding_contract.bindings` (which
 * carries the authoritative source key). The binding contract wins on source
 * key; the schema only ever contributes non-authoritative colour.
 */
function projectBindings(entry: Record<string, unknown>): {
  readiness: "resolved" | "unresolved";
  version: number | null;
  bindings: TemplateVariableBindingView[];
} {
  const contract = isRecord(entry.binding_contract) ? entry.binding_contract : {};
  const readiness = str(contract.binding_readiness) === "resolved" ? "resolved" : "unresolved";
  const version = int(contract.binding_version);

  const schema = isRecord(entry.variables_schema) ? entry.variables_schema : {};
  const fixtureSource = isRecord(entry.qf_mvp_40) && isRecord(entry.qf_mvp_40.example_fixture)
    ? entry.qf_mvp_40.example_fixture
    : {};

  const declared = Array.isArray(contract.bindings) ? contract.bindings : [];
  const byPosition = new Map<number, Record<string, unknown>>();
  for (const raw of declared) {
    if (!isRecord(raw)) continue;
    const position = int(raw.position);
    if (position === null) continue;
    byPosition.set(position, raw);
  }

  // Positions come from the schema (always present) unioned with the declared
  // bindings, so a template with an unresolved contract still lists its slots.
  const positions = new Set<number>();
  for (const key of Object.keys(schema)) {
    const parsed = Number(key);
    if (Number.isSafeInteger(parsed) && parsed > 0) positions.add(parsed);
  }
  for (const position of byPosition.keys()) positions.add(position);

  const bindings: TemplateVariableBindingView[] = [...positions]
    .sort((a, b) => a - b)
    .map((position) => {
      const declaredBinding = byPosition.get(position);
      const slot = isRecord(schema[String(position)]) ? (schema[String(position)] as Record<string, unknown>) : {};
      // Fixtures are keyed either by position ("1") or by source key.
      const sourceKey = declaredBinding ? str(declaredBinding.source_key) : null;
      const exampleByPosition = str(fixtureSource[String(position)]);
      const exampleByKey = sourceKey ? str(fixtureSource[sourceKey]) : null;
      return {
        position,
        component: (declaredBinding ? str(declaredBinding.component) : null) ?? "body",
        sourceKey,
        parameterType:
          (declaredBinding ? str(declaredBinding.parameter_type) : null) ?? str(slot.type) ?? "text",
        description: str(slot.description),
        example: exampleByPosition ?? exampleByKey ?? str(slot.example),
      };
    });

  return { readiness, version, bindings };
}

function projectButtons(entry: Record<string, unknown>): TemplateButtonView[] {
  const declared = Array.isArray(entry.buttons_spec) ? entry.buttons_spec : [];
  const fromCreation =
    declared.length === 0 && isRecord(entry.meta_creation_contract) && Array.isArray(entry.meta_creation_contract.buttons)
      ? entry.meta_creation_contract.buttons
      : [];
  const source = declared.length > 0 ? declared : fromCreation;

  return source.filter(isRecord).map((raw) => ({
    type: str(raw.type) ?? str(raw.otp_type) ?? "unknown",
    text: str(raw.text),
    index: int(raw.index),
    payload: str(raw.payload),
  }));
}

function projectLocalContract(
  group: TemplateGovernanceGroup,
  entry: Record<string, unknown>,
): TemplateLocalContract | null {
  const internalTemplateKey = str(entry.internal_template_key);
  if (!internalTemplateKey) return null;

  const governance = isRecord(entry.qf_mvp_40) ? entry.qf_mvp_40 : {};
  const { readiness, version, bindings } = projectBindings(entry);
  const componentProfile = str(governance.component_profile) ?? "STANDARD_TEXT";

  return {
    internalTemplateKey,
    group,
    category: str(entry.category) ?? "unknown",
    language: str(entry.language) ?? "en",
    recipientType: str(governance.recipient_type) ?? "unknown",
    consentScope: str(governance.consent_scope) ?? "unknown",
    purpose: str(governance.purpose) ?? "No purpose recorded in the source manifest.",
    suppressionRule: str(governance.suppression_rule),
    componentProfile,
    componentProfileSupported: (COMPONENT_PROFILES as readonly string[]).includes(componentProfile),
    bodySpec: str(entry.body_spec) ?? "",
    buttons: projectButtons(entry),
    bindingReadiness: readiness,
    bindingVersion: version,
    bindings,
    codeProvenSourceKeys: internalTemplateKey in BUSINESS_TEMPLATE_CONTRACTS
      ? sourceKeysFor(internalTemplateKey)
      : [],
    providerTemplateNameCandidate: str(entry.provider_template_name_candidate),
    submissionState: str(entry.submission_state) ?? "UNKNOWN",
    localApprovalStatus: str(entry.approval_status) ?? "unknown",
    owningSubphase: str(governance.owning_subphase),
    externalApprovalRequired: bool(governance.external_approval_required) ?? true,
    providerAccountRequired: bool(governance.provider_account_required) ?? true,
  };
}

/**
 * Every internal template declared by the committed submission manifest, in a
 * deterministic order (governance group, then internal key).
 */
export function listTemplateLocalContracts(): readonly TemplateLocalContract[] {
  const manifest = submissionManifest as unknown as Record<string, unknown>;
  const groups = isRecord(manifest.groups) ? manifest.groups : {};
  const rows: TemplateLocalContract[] = [];

  for (const group of GOVERNANCE_GROUPS) {
    const entries = groups[group];
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!isRecord(entry)) continue;
      const projected = projectLocalContract(group, entry);
      if (projected) rows.push(projected);
    }
  }

  return Object.freeze(
    rows.sort(
      (a, b) =>
        GOVERNANCE_GROUPS.indexOf(a.group) - GOVERNANCE_GROUPS.indexOf(b.group) ||
        a.internalTemplateKey.localeCompare(b.internalTemplateKey),
    ),
  );
}

// ---------------------------------------------------------------------------
// PROVEN REMOTE EVIDENCE projection
// ---------------------------------------------------------------------------

/**
 * Remote evidence rows. Hard-fails to EMPTY if the artifact ever declares that
 * it carries secrets — an admin page must not be the thing that publishes them.
 */
export function listTemplateRemoteEvidence(): readonly TemplateRemoteEvidence[] {
  const manifest = remoteStateManifest as unknown as Record<string, unknown>;
  if (bool(manifest.contains_secrets) === true) return Object.freeze([]);

  const entries = Array.isArray(manifest.entries) ? manifest.entries : [];
  const rows: TemplateRemoteEvidence[] = [];

  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    const internalTemplateKey = str(entry.internal_template_key);
    const providerTemplateName = str(entry.provider_template_name);
    if (!internalTemplateKey || !providerTemplateName) continue;

    rows.push({
      internalTemplateKey,
      providerTemplateName,
      requestedCategory: str(entry.requested_category),
      lastProvenStatus: str(entry.last_proven_status) ?? "UNKNOWN",
      lastProvenRemoteCategory: str(entry.last_proven_remote_category),
      disposition: str(entry.disposition) ?? "UNKNOWN",
      // Absent authority is DENIED, never "unknown-so-probably-fine".
      sendAuthority: str(entry.send_authority) ?? "DENIED",
      mappingAuthority: str(entry.mapping_authority) ?? "DENIED",
      reconciliationOutcome: str(entry.reconciliation_outcome),
      readbackSemanticMatch: bool(entry.readback_semantic_match),
      evidenceReferences: Object.freeze(
        (Array.isArray(entry.evidence) ? entry.evidence : [])
          .map(str)
          .filter((value): value is string => value !== null),
      ),
      notes: str(entry.notes),
    });
  }

  return Object.freeze(rows);
}

/** Remote evidence rows for one internal template key (may be several names). */
export function remoteEvidenceFor(
  evidence: readonly TemplateRemoteEvidence[],
  internalTemplateKey: string,
): readonly TemplateRemoteEvidence[] {
  return evidence.filter((row) => row.internalTemplateKey === internalTemplateKey);
}
