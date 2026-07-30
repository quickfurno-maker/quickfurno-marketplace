// ============================================================================
// QF-MVP-40.10A — deterministic Meta template submission packet generator.
//
// OFFLINE. Reads the catalogue manifest and emits ONE deterministic packet of
// non-secret creation payloads. It contacts no network, calls no Meta endpoint,
// submits nothing and reads no credential.
//
// The packet carries variable NAMES, fake examples and payload shapes only. It
// never contains an access token, app secret, verify token, WABA id,
// phone-number id, real phone number, real client/vendor name, OTP, or a
// provider_template_id or approval status claimed as real.
// ============================================================================

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const MANIFEST = "docs/provider-manifests/whatsapp-template-submission-manifest.json";
const PACKET = "docs/provider-manifests/meta-template-submission-packet.json";

const raw = readFileSync(resolve(MANIFEST), "utf8");
const manifest = JSON.parse(raw);
const manifestFingerprint = createHash("sha256").update(raw).digest("hex");

const entries = Object.values(manifest.groups).flat()
  .sort((a, b) => a.internal_template_key.localeCompare(b.internal_template_key));

/** Positional {{n}} placeholders in a body, in order. */
const bodyVars = (body) => [...String(body).matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));

/**
 * Build the Meta CREATION payload for one template.
 *
 * AUTHENTICATION is deliberately different: Meta generates the body text, so we
 * submit add_security_recommendation / code_expiration_minutes / an OTP button and
 * NEVER our own body string.
 */
function creationPayload(t) {
  const name = t.provider_template_name_candidate;
  const language = t.language;
  const profile = t.qf_mvp_40.component_profile;

  if (profile === "AUTH_OTP_COPY_CODE") {
    const c = t.meta_creation_contract;
    return {
      name, language, category: "authentication",
      components: [
        { type: "body", add_security_recommendation: c.body.add_security_recommendation },
        { type: "footer", code_expiration_minutes: c.footer.code_expiration_minutes },
        { type: "buttons", buttons: c.buttons },
      ],
    };
  }

  const vars = bodyVars(t.body_spec);
  const body = { type: "body", text: t.body_spec };
  if (vars.length > 0) {
    // Fake, non-PII examples drawn from the manifest fixture, positionally.
    const fx = t.qf_mvp_40.example_fixture ?? {};
    body.example = { body_text: [vars.map((n) => String(fx[String(n)] ?? `EXAMPLE_${n}`))] };
  }
  const components = [body];
  if (profile === "QUICK_REPLY") {
    components.push({
      type: "buttons",
      buttons: t.buttons_spec.map((b) => ({ type: "QUICK_REPLY", text: b.text })),
    });
  }
  return { name, language, category: t.category.toUpperCase(), components };
}

const templates = entries.map((t) => {
  const payload = creationPayload(t);
  return {
    internal_template_key: t.internal_template_key,
    provider_template_name: t.provider_template_name_candidate,
    provider_language: t.language,
    category: payload.category,
    component_profile: t.qf_mvp_40.component_profile,
    submission_wave: t.qf_mvp_40.submission_wave,
    submit_now: t.qf_mvp_40.submit_now,
    external_approval_required: true,
    local_state: {
      approval_status: t.approval_status,
      submission_state: t.submission_state,
      provider_template_id: t.provider_template_id,
    },
    creation_payload: payload,
    send_contract: t.meta_send_contract ?? null,
    payload_fingerprint: createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
  };
});

const waveCounts = templates.reduce((acc, t) => {
  acc[t.submission_wave] = (acc[t.submission_wave] ?? 0) + 1; return acc;
}, {});

const packet = {
  artifact: "meta-template-submission-packet",
  schema_version: "1.0",
  phase: "QF-MVP-40.10A",
  generator: "scripts/mvp/communication/generate-meta-template-submission-packet.mjs",
  note: "NON-SECRET. Every entry here is a LOCAL CANDIDATE: none is claimed approved, mapped or active, and no provider_template_id is real. WAVE 0 HISTORY — v1 was created on the QuickFurno WABA and returned PENDING, then was DELETED by the former AiSensy partner (Meta Activity Log); AiSensy access has since been removed and v1 is RETIRED. v2 was created and returned PENDING, and Meta later APPROVED it as MARKETING rather than the requested UTILITY — proven by a read-only reconciliation (RECONCILED_CATEGORY_MISMATCH, create_post_count 0). v2 is QUARANTINED_UNMAPPED with send and mapping authority DENIED, and is NOT deleted or appealed; see docs/provider-manifests/meta-template-remote-state.json. That reconciliation proves a CATEGORY mismatch and does NOT separately prove remote body/component equality. The current Wave 0 candidate is v3, a strict Utility rewrite that has NOT been submitted.",
  source_manifest: MANIFEST,
  source_manifest_fingerprint: manifestFingerprint,
  external_contract_references: [
    "https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/components/",
    "https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/authentication-templates/copy-code-button-authentication-templates/",
    "https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages/",
  ],
  waves: {
    "0": "API-contract canary — ONE no-variable utility template. Proves token/WABA/endpoint/name/language/category/response handling. No send, no mapping activation.",
    "1": "QF-MVP-40 launch transport templates (consent acknowledgements + client/vendor transactional).",
    "2": "Authentication templates. submit_now is FALSE because Wave 2 is HELD FROM THE WAVE 0 EXECUTION TASK — not because it depends on a send that cannot happen yet. Correct order: (1) component create/send shape proved offline [done]; (2) real WABA create API proved by Wave 0; (3) Wave 2 submitted under a separate explicit authorisation; (4) Meta approval; (5) approved INACTIVE mappings seeded; (6) one controlled OTP send AFTER approval; (7) authentication activation stays disabled until that send succeeds.",
    "3": "QF-MVP-50 marketing. May absorb approval latency but stays unusable without explicit marketing consent, a frequency policy, an approved active mapping and QF-MVP-50 orchestration.",
    "4": "QF-MVP-70 admin alerts. Payloads prepared but DEFERRED — not part of the MVP-40 activation track.",
  },
  wave_counts: waveCounts,
  total_templates: templates.length,
  templates,
};

writeFileSync(resolve(PACKET), JSON.stringify(packet, null, 2) + "\n", "utf8");
console.log(`packet written: ${PACKET}`);
console.log(`templates: ${templates.length} · waves: ${JSON.stringify(waveCounts)}`);
console.log(`manifest fingerprint: ${manifestFingerprint}`);
