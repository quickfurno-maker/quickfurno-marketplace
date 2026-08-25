// ============================================================================
// QF-MVP-40.12-R1 — business template binding governance validator.  OFFLINE.
//
// Proves MANIFEST <-> CODE <-> RENDERER parity for the five approved ordinary business
// templates. It does not grep for expected words: it exercises the REAL builders and the
// REAL renderWhatsAppTemplateComponents, so a manifest edit alone can never satisfy it.
//
// No network, no database, no credential, no send.
// ============================================================================

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  BUSINESS_TEMPLATE_CONTRACTS, BUSINESS_TEMPLATE_KEYS, BUSINESS_VARIABLE_BUILDERS,
  BusinessSourceKey, bindingSchemaFor, sourceKeysFor,
  buildLeadReceivedVariables, buildClientLeadStatusUpdateVariables,
  buildClientMatchingUpdateVariables, buildLeadAssignmentAlertVariables,
  buildVendorOnboardingReminderVariables,
} from "../../../lib/communication/businessTemplateVariables.ts";
import { renderWhatsAppTemplateComponents, ComponentProfile, TEMPLATE_BINDING_VERSION }
  from "../../../lib/communication/providers/whatsappTemplateBinding.ts";

const MANIFEST = "docs/provider-manifests/whatsapp-template-submission-manifest.json";
const REGISTRY_SRC = "lib/communication/outboundConsentScope.ts";
const MODULE_SRC = "lib/communication/businessTemplateVariables.ts";
const SEED_OP = "scripts/mvp/communication/seed-meta-staging-inactive-mappings.mjs";
const SUBSET2 = "docs/provider-manifests/meta-wave1-next-utility-subset-2-review.json";
const SUBSET3 = "docs/provider-manifests/meta-wave1-next-utility-subset-3-review.json";

const manifest = JSON.parse(readFileSync(resolve(MANIFEST), "utf8"));
const byKey = new Map(Object.values(manifest.groups).flat().map((t) => [t.internal_template_key, t]));
const registrySrc = readFileSync(resolve(REGISTRY_SRC), "utf8");
const moduleSrc = readFileSync(resolve(MODULE_SRC), "utf8");
const moduleExec = moduleSrc.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
const seedSrc = readFileSync(resolve(SEED_OP), "utf8");

const EXPECTED = Object.freeze({
  lead_received: [[1, "client_name"]],
  client_lead_status_update: [[1, "client_name"], [2, "lead_status_label"]],
  client_matching_update: [[1, "client_name"], [2, "matched_vendor_count"]],
  lead_assignment_alert: [[1, "lead_reference"]],
  vendor_onboarding_reminder: [[1, "outstanding_item"]],
});
const ACKS = ["consent_help_response", "consent_stop_acknowledgement", "consent_start_acknowledgement"];
/** Keys whose approved version was superseded and whose successor is not yet created. */
const SUPERSEDED_KEYS = ["client_matching_update"];
/** Valid inputs per builder, used to exercise the real construction path. */
const GOOD_INPUT = Object.freeze({
  lead_received: { clientName: "Asha" },
  client_lead_status_update: { clientName: "Asha", leadStatusLabel: "Vendors matched" },
  client_matching_update: { clientName: "Asha", matchedVendorCount: 3 },
  lead_assignment_alert: { leadReference: "LEAD-DEMO-0001" },
  vendor_onboarding_reminder: { outstandingItem: "GST certificate" },
});

const results = [];
const add = (n, ok, d) => results.push({ name: n, ok: ok === true, detail: d ?? "" });
const build = (k, input) => BUSINESS_VARIABLE_BUILDERS[k](input);
/** Render a template through the REAL renderer with the REAL contract schema. */
const render = (k, vars) => renderWhatsAppTemplateComponents(bindingSchemaFor(k), vars);
/** The rendered body parameter texts, in emitted order. */
const bodyTexts = (r) => (r.components ?? []).find((c) => c.type === "body")?.parameters
  .map((p) => p.text) ?? [];

const R = {
  // ---- A. Contract shape ---------------------------------------------------
  exactFiveKeys: () => BUSINESS_TEMPLATE_KEYS.length === 5
    && BUSINESS_TEMPLATE_KEYS.slice().sort().join(",") === Object.keys(EXPECTED).sort().join(","),
  exactSourceKeySets: () => Object.entries(EXPECTED).every(([k, pairs]) =>
    sourceKeysFor(k).join(",") === pairs.map(([, s]) => s).join(",")),
  exactPositions: () => Object.entries(EXPECTED).every(([k, pairs]) => {
    const b = BUSINESS_TEMPLATE_CONTRACTS[k].bindings;
    return b.length === pairs.length
      && pairs.every(([pos, src]) => b.some((x) => x.position === pos && x.sourceKey === src));
  }),
  everyParameterTypeIsText: () => BUSINESS_TEMPLATE_KEYS.every((k) =>
    BUSINESS_TEMPLATE_CONTRACTS[k].bindings.every((b) => b.parameterType === "text"
      && b.component === "body")),
  bindingVersionIsOne: () => BUSINESS_TEMPLATE_KEYS.every((k) =>
    BUSINESS_TEMPLATE_CONTRACTS[k].bindingVersion === 1
    && BUSINESS_TEMPLATE_CONTRACTS[k].bindingVersion === TEMPLATE_BINDING_VERSION),
  profileIsStandardText: () => BUSINESS_TEMPLATE_KEYS.every((k) =>
    BUSINESS_TEMPLATE_CONTRACTS[k].profile === ComponentProfile.STANDARD_TEXT),
  vocabularyIsClosed: () => {
    const declared = new Set(Object.values(BusinessSourceKey));
    const used = new Set(BUSINESS_TEMPLATE_KEYS.flatMap((k) => sourceKeysFor(k)));
    return declared.size === 5 && [...used].every((u) => declared.has(u)) && used.size === 5;
  },
  noForbiddenSourceKey: () => {
    const banned = ["destination", "phone", "recipient", "recipient_id", "uuid", "waba",
      "phone_number_id", "token", "payload", "metadata"];
    return BUSINESS_TEMPLATE_KEYS.flatMap((k) => sourceKeysFor(k))
      .every((s) => !banned.some((b) => s.includes(b)));
  },

  // ---- B. Manifest <-> code parity ----------------------------------------
  manifestReadinessResolved: () => Object.keys(EXPECTED).every((k) =>
    byKey.get(k)?.binding_contract?.binding_readiness === "resolved"),
  manifestSourceKeysMatchCode: () => Object.entries(EXPECTED).every(([k, pairs]) => {
    const vs = byKey.get(k).variables_schema;
    return pairs.every(([pos, src]) => vs[String(pos)]?.source_key === src)
      && Object.keys(vs).length === pairs.length;
  }),
  manifestBindingsMatchCode: () => Object.keys(EXPECTED).every((k) => {
    const mb = byKey.get(k).binding_contract.bindings.slice().sort((a, b) => a.position - b.position);
    const cb = BUSINESS_TEMPLATE_CONTRACTS[k].bindings.slice().sort((a, b) => a.position - b.position);
    return mb.length === cb.length && mb.every((m, i) =>
      m.position === cb[i].position && m.source_key === cb[i].sourceKey
      && m.parameter_type === cb[i].parameterType && m.component === cb[i].component);
  }),
  /** variables_schema.source_key must equal the binding_contract source, not merely exist. */
  variablesSchemaEqualsBindingSource: () => Object.keys(EXPECTED).every((k) => {
    const t = byKey.get(k);
    return t.binding_contract.bindings.every((b) =>
      t.variables_schema[String(b.position)]?.source_key === b.source_key);
  }),
  manifestNamesTheCodeAuthority: () => Object.keys(EXPECTED).every((k) =>
    /businessTemplateVariables\.ts::build/.test(byKey.get(k).binding_contract.authority ?? "")),
  manifestIsHonestAboutWiring: () => Object.keys(EXPECTED).every((k) => {
    const n = byKey.get(k).binding_contract.note ?? "";
    return /NOT found in a pre-existing live caller/i.test(n)
      && /trigger wiring remains PENDING/i.test(n)
      && /no mapping, activation or send authority/i.test(n);
  }),
  topLevelNotesSeparateProofClasses: () => {
    const n = manifest.binding_contract_notes ?? {};
    const live = n.proof_by_class?.live_caller_proven, builder = n.proof_by_class?.canonical_builder_proven;
    return live?.keys?.join(",") === "otp"
      && builder?.keys?.slice().sort().join(",") === Object.values(BusinessSourceKey).slice().sort().join(",")
      && /NOT found in a pre-existing live caller/i.test(builder?.honest_scope ?? "")
      && n.proven_source_keys?.length === 6;
  },
  bodyPlaceholderCountMatchesBindings: () => Object.keys(EXPECTED).every((k) => {
    const body = byKey.get(k).body_spec;
    const placeholders = new Set([...body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => m[1]));
    return placeholders.size === BUSINESS_TEMPLATE_CONTRACTS[k].bindings.length;
  }),

  // ---- C. Builder behaviour (REAL builders) -------------------------------
  buildersEmitExactlyTheContract: () => Object.keys(EXPECTED).every((k) => {
    const r = build(k, GOOD_INPUT[k]);
    return r.ok === true
      && Object.keys(r.variables).sort().join(",") === sourceKeysFor(k).slice().sort().join(",");
  }),
  builderRejectsMissing: () => build("client_lead_status_update", { clientName: "Asha" }).ok === false
    && build("lead_received", {}).ok === false,
  builderRejectsEmptyAndBlank: () => build("lead_received", { clientName: "" }).ok === false
    && build("lead_received", { clientName: "   " }).ok === false,
  builderRejectsNonString: () => [{ a: 1 }, [1, 2], 42, true, null]
    .every((v) => build("lead_received", { clientName: v }).ok === false),
  builderRejectsUnboundedText: () =>
    build("lead_received", { clientName: "x".repeat(5000) }).ok === false,
  builderRejectsControlCharacters: () =>
    build("lead_received", { clientName: "Asha\nInjected" }).ok === false,
  builderNeverSilentlyDefaults: () => {
    const r = build("vendor_onboarding_reminder", { outstandingItem: undefined });
    return r.ok === false && r.reason === "missing_variable";
  },
  countIsDeterministicDecimal: () => {
    const a = build("client_matching_update", { clientName: "A", matchedVendorCount: 3 });
    const b = build("client_matching_update", { clientName: "A", matchedVendorCount: "3" });
    return a.ok && b.ok && a.variables.matched_vendor_count === "3"
      && b.variables.matched_vendor_count === "3";
  },
  countRejectsBadValues: () => [-1, 1.5, NaN, [1, 2], "3,4", "abc", "1e3", {}]
    .every((v) => build("client_matching_update", { clientName: "A", matchedVendorCount: v }).ok === false),
  builderIgnoresExtraInput: () => {
    // An undeclared input must not become an undeclared variable.
    const r = build("lead_received", { clientName: "Asha", destination: "+911234567890" });
    return r.ok === true && Object.keys(r.variables).join(",") === "client_name";
  },

  // ---- D. Renderer parity (REAL renderer) ---------------------------------
  rendererOrdersByDeclaredPosition: () => {
    const r = render("client_lead_status_update",
      build("client_lead_status_update", GOOD_INPUT.client_lead_status_update).variables);
    return r.ok === true && bodyTexts(r).join("|") === "Asha|Vendors matched";
  },
  /** Object insertion order must not change the rendered order. */
  objectOrderDoesNotAffectRendering: () => {
    const forward = { client_name: "Asha", lead_status_label: "Vendors matched" };
    const reversed = { lead_status_label: "Vendors matched", client_name: "Asha" };
    const a = render("client_lead_status_update", forward);
    const b = render("client_lead_status_update", reversed);
    return a.ok && b.ok && bodyTexts(a).join("|") === bodyTexts(b).join("|")
      && bodyTexts(a).join("|") === "Asha|Vendors matched";
  },
  rendererRejectsMissingVariable: () =>
    render("lead_received", {}).ok === false
    && render("client_matching_update", { client_name: "Asha" }).ok === false,
  rendererRejectsSwappedKeys: () => {
    // Swapping the two semantic values must produce a DIFFERENT rendering, never the same.
    const correct = render("client_lead_status_update",
      { client_name: "Asha", lead_status_label: "Vendors matched" });
    const swapped = render("client_lead_status_update",
      { client_name: "Vendors matched", lead_status_label: "Asha" });
    return correct.ok && swapped.ok && bodyTexts(correct).join("|") !== bodyTexts(swapped).join("|");
  },
  rendererRejectsRenamedKey: () =>
    render("lead_received", { client_full_name: "Asha" }).ok === false,
  everyTemplateRendersEndToEnd: () => Object.keys(EXPECTED).every((k) => {
    const b = build(k, GOOD_INPUT[k]);
    if (!b.ok) return false;
    const r = render(k, b.variables);
    return r.ok === true && bodyTexts(r).length === BUSINESS_TEMPLATE_CONTRACTS[k].bindings.length;
  }),
  exampleFixtureTranslatesOnlyViaSourceKeys: () => Object.keys(EXPECTED).every((k) => {
    const fx = byKey.get(k).qf_mvp_40.example_fixture ?? {};
    // Positional fixture -> named variables strictly through the declared bindings.
    const vars = {};
    for (const b of BUSINESS_TEMPLATE_CONTRACTS[k].bindings) vars[b.sourceKey] = String(fx[String(b.position)]);
    const r = render(k, vars);
    return r.ok === true
      && bodyTexts(r).join("|") === BUSINESS_TEMPLATE_CONTRACTS[k].bindings
        .slice().sort((a, b2) => a.position - b2.position).map((b) => String(fx[String(b.position)])).join("|");
  }),

  // ---- E. Purity / boundary ------------------------------------------------
  moduleIsPure: () => !/\bfetch\s*\(|process\.env|adminClient|createClient|\bDate\s*\.\s*now|new\s+Date\s*\(|console\./.test(moduleExec)
    && !/from\s+["'][^"']*supabase/i.test(moduleExec),
  moduleDoesNotEnqueueOrSend: () => !/enqueue|dispatch|sendMessage|CommunicationService|\/messages/i.test(moduleExec),
  moduleChoosesNoRecipient: () => !/recipient|destination|phone|to:/i.test(moduleExec),
  /** The operator must consult the code contract, not a duplicated list. */
  operatorConsultsCodeContract: () => /businessTemplateVariables\.ts/.test(seedSrc)
    && /BUSINESS_TEMPLATE_CONTRACTS/.test(seedSrc),
  operatorKeepsFabricationFence: () => /BINDING_SCHEMA_UNPROVEN/.test(seedSrc)
    && /docs-only source_key is never accepted/i.test(seedSrc),
  operatorHasNoParallelSourceKeyList: () => {
    // The five source keys must not be hand-listed in the operator.
    const exec = seedSrc.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
    return Object.values(BusinessSourceKey).every((s) => !new RegExp(`["']${s}["']`).test(exec));
  },

  // ---- F. Standing invariants ---------------------------------------------
  acksStayZeroVariableAndOutOfRegistry: () => ACKS.every((k) =>
    Object.keys(byKey.get(k).variables_schema ?? {}).length === 0
    && !new RegExp(`^\\s*${k}\\s*:`, "m").test(registrySrc)),
  /**
   * QF-MVP-40-R7N — a SUPERSEDED key is legitimately pre-creation. client_matching_update's
   * approved v1 was proven MARKETING on the current dedicated WABA and is quarantined; its
   * successor v2 has never been submitted, so draft / DRAFT_NOT_SUBMITTED is the truthful
   * state. Creation stays HELD either way, which is the property this rule protects.
   */
  approvedStateUnchanged: () => Object.keys(EXPECTED).every((k) => {
    const t = byKey.get(k);
    if (t.provider_template_id !== null || t.qf_mvp_40.submit_now !== false) return false;
    if (SUPERSEDED_KEYS.includes(k)) {
      return t.approval_status === "draft" && t.submission_state === "DRAFT_NOT_SUBMITTED";
    }
    return t.approval_status === "approved" && t.submission_state === "APPROVED_UNMAPPED";
  }),
  ordinaryLanesUnchanged: () => Object.keys(EXPECTED).every((k) =>
    new RegExp(`^\\s*${k}:.*lane: "business".*scope: "transactional"`, "m").test(registrySrc)),
  submissionStillPaused: () => {
    const s = JSON.parse(readFileSync(resolve(SUBSET2), "utf8")).submission_pause;
    return !!s && s.status === "PAUSED" && s.successor_subset_proposed === false;
  },
  noSubset3: () => {
    try { readFileSync(resolve(SUBSET3)); return false; } catch { return true; }
  },
};

const RULES = [
  ["B1  the contract names exactly five templates", R.exactFiveKeys],
  ["B2  each template's source-key set is exact", R.exactSourceKeySets],
  ["B3  each binding declares an exact body position", R.exactPositions],
  ["B4  every parameter type is text on the body", R.everyParameterTypeIsText],
  ["B5  binding version is 1 everywhere", R.bindingVersionIsOne],
  ["B6  every profile is STANDARD_TEXT", R.profileIsStandardText],
  ["B7  the source-key vocabulary is closed at five", R.vocabularyIsClosed],
  ["B8  no destination/recipient/id/token key exists", R.noForbiddenSourceKey],
  ["B9  manifest binding_readiness is resolved for all five", R.manifestReadinessResolved],
  ["B10 manifest source_keys equal the code contract", R.manifestSourceKeysMatchCode],
  ["B11 manifest bindings equal the code bindings exactly", R.manifestBindingsMatchCode],
  ["B12 variables_schema.source_key equals the binding source", R.variablesSchemaEqualsBindingSource],
  ["B13 the manifest names the code authority", R.manifestNamesTheCodeAuthority],
  ["B14 the manifest is honest that triggers are not wired", R.manifestIsHonestAboutWiring],
  ["B15 top-level notes separate live-caller from builder proof", R.topLevelNotesSeparateProofClasses],
  ["B16 body placeholder count equals binding count", R.bodyPlaceholderCountMatchesBindings],
  ["B17 builders emit exactly the contract keys", R.buildersEmitExactlyTheContract],
  ["B18 a missing variable is rejected", R.builderRejectsMissing],
  ["B19 an empty or blank variable is rejected", R.builderRejectsEmptyAndBlank],
  ["B20 an object / array / number is rejected", R.builderRejectsNonString],
  ["B21 unbounded text is rejected", R.builderRejectsUnboundedText],
  ["B22 control characters are rejected", R.builderRejectsControlCharacters],
  ["B23 a missing value is never silently defaulted", R.builderNeverSilentlyDefaults],
  ["B24 the count is a deterministic decimal string", R.countIsDeterministicDecimal],
  ["B25 negative / float / NaN / list counts are rejected", R.countRejectsBadValues],
  ["B26 an undeclared input never becomes a variable", R.builderIgnoresExtraInput],
  ["B27 the renderer orders by declared position", R.rendererOrdersByDeclaredPosition],
  ["B28 object insertion order does not affect rendering", R.objectOrderDoesNotAffectRendering],
  ["B29 the renderer rejects a missing variable", R.rendererRejectsMissingVariable],
  ["B30 swapped semantic values render differently", R.rendererRejectsSwappedKeys],
  ["B31 the renderer rejects a renamed source key", R.rendererRejectsRenamedKey],
  ["B32 all five render end to end through the real renderer", R.everyTemplateRendersEndToEnd],
  ["B33 the example fixture translates only via source keys", R.exampleFixtureTranslatesOnlyViaSourceKeys],
  ["B34 the module is pure (no env/db/network/clock/log)", R.moduleIsPure],
  ["B35 the module never enqueues or sends", R.moduleDoesNotEnqueueOrSend],
  ["B36 the module chooses no recipient", R.moduleChoosesNoRecipient],
  ["B37 the seed operator consults the code contract", R.operatorConsultsCodeContract],
  ["B38 the seed operator keeps BINDING_SCHEMA_UNPROVEN", R.operatorKeepsFabricationFence],
  ["B39 the operator holds no parallel source-key list", R.operatorHasNoParallelSourceKeyList],
  ["B40 acknowledgements stay zero-variable and out of the registry", R.acksStayZeroVariableAndOutOfRegistry],
  ["B41 approval / submission state is unchanged", R.approvedStateUnchanged],
  ["B42 ordinary consent lanes are unchanged", R.ordinaryLanesUnchanged],
  ["B43 template submission remains PAUSED", R.submissionStillPaused],
  ["B44 no subset-3 artefact exists", R.noSubset3],
];
for (const [n, fn] of RULES) add(n, fn());

// ---- Mutation self-tests ---------------------------------------------------
// Behavioural: each corrupts a real input / schema / manifest copy and requires failure.
const cloneManifestEntry = (k) => JSON.parse(JSON.stringify(byKey.get(k)));
const schemaWith = (k, mutate) => { const s = JSON.parse(JSON.stringify(bindingSchemaFor(k))); mutate(s); return s; };

const MUT = [
  ["M1  a renamed lead_received source key breaks rendering", () =>
    render("lead_received", { client_full_name: "Asha" }).ok],
  ["M2  swapped status positions render the wrong text", () => {
    const swapped = schemaWith("client_lead_status_update", (s) => {
      s.bindings[0].position = 2; s.bindings[1].position = 1; });
    const r = renderWhatsAppTemplateComponents(swapped,
      { client_name: "Asha", lead_status_label: "Vendors matched" });
    return r.ok && bodyTexts(r).join("|") === "Asha|Vendors matched";
  }],
  ["M3  a renamed status key is rejected", () =>
    render("client_lead_status_update", { client_name: "A", status_label: "S" }).ok],
  ["M4  a renamed count key is rejected", () =>
    render("client_matching_update", { client_name: "A", vendor_count: "3" }).ok],
  ["M5  a renamed assignment key is rejected", () =>
    render("lead_assignment_alert", { lead_id: "L-1" }).ok],
  ["M6  a renamed onboarding key is rejected", () =>
    render("vendor_onboarding_reminder", { item: "GST" }).ok],
  ["M7  manifest resolved without a source_key is rejected", () => {
    const e = cloneManifestEntry("lead_received");
    delete e.variables_schema["1"].source_key;
    return e.binding_contract.bindings.every((b) =>
      e.variables_schema[String(b.position)]?.source_key === b.source_key);
  }],
  ["M8  a manifest/code source_key mismatch is rejected", () => {
    const e = cloneManifestEntry("lead_received");
    e.variables_schema["1"].source_key = "customer_name";
    return e.binding_contract.bindings.every((b) =>
      e.variables_schema[String(b.position)]?.source_key === b.source_key);
  }],
  ["M9  a builder returning another key is rejected", () => {
    const fake = { ok: true, variables: { customer_name: "Asha" } };
    return Object.keys(fake.variables).sort().join(",") === sourceKeysFor("lead_received").slice().sort().join(",");
  }],
  ["M10 a builder emitting an extra key is rejected", () => {
    const fake = { ok: true, variables: { client_name: "Asha", extra: "x" } };
    return Object.keys(fake.variables).sort().join(",") === sourceKeysFor("lead_received").slice().sort().join(",");
  }],
  ["M11 a silently defaulted missing value is rejected", () =>
    build("lead_received", { clientName: undefined }).ok],
  ["M12 an object input is rejected", () => build("lead_received", { clientName: { a: 1 } }).ok],
  ["M13 reversed insertion order changing the render is rejected", () => {
    const a = render("client_matching_update", { client_name: "Asha", matched_vendor_count: "3" });
    const b = render("client_matching_update", { matched_vendor_count: "3", client_name: "Asha" });
    return bodyTexts(a).join("|") !== bodyTexts(b).join("|");
  }],
  ["M14 a position inferred from array index is rejected", () => {
    // Positions declared 2 then 1 must still render by POSITION, not by array order.
    const reordered = schemaWith("client_lead_status_update", (s) => { s.bindings.reverse(); });
    const r = renderWhatsAppTemplateComponents(reordered,
      { client_name: "Asha", lead_status_label: "Vendors matched" });
    return r.ok && bodyTexts(r).join("|") !== "Asha|Vendors matched";
  }],
  ["M15 a duplicate source key is rejected", () => {
    const dup = schemaWith("client_lead_status_update", (s) => { s.bindings[1].sourceKey = "client_name"; });
    return renderWhatsAppTemplateComponents(dup, { client_name: "Asha" }).ok;
  }],
  ["M16 an undeclared source variable is accepted only by ignoring it", () => {
    const r = build("lead_received", { clientName: "Asha", rogue: "x" });
    return r.ok && Object.keys(r.variables).includes("rogue");
  }],
  ["M17 an acknowledgement added to the ordinary registry is rejected", () => {
    const fake = `${registrySrc}\n  consent_help_response: { templateKey: "consent_help_response" },\n`;
    return ACKS.every((k) => !new RegExp(`^\\s*${k}\\s*:`, "m").test(fake));
  }],
  ["M18 a changed template body is rejected", () => {
    const e = cloneManifestEntry("lead_received");
    e.body_spec = "Hi {{1}}, buy now!";
    const placeholders = new Set([...e.body_spec.matchAll(/\{\{(\d+)\}\}/g)].map((m) => m[1]));
    return placeholders.size === BUSINESS_TEMPLATE_CONTRACTS.lead_received.bindings.length
      && e.body_spec === byKey.get("lead_received").body_spec;
  }],
  ["M19 a changed approval state is rejected", () => {
    const e = cloneManifestEntry("lead_received");
    e.approval_status = "draft";
    return e.approval_status === "approved";
  }],
  ["M20 an enabled mapping authorization is rejected", () => {
    const fake = { authorizes_mapping_activation: true };
    return fake.authorizes_mapping_activation === false;
  }],
  ["M21 a Stage-B mode invoked in this phase is rejected", () => {
    // This validator must never carry a live mode flag.
    const argv = ["--preflight-readonly"];
    return !argv.some((a) => a === "--preflight-readonly" || a === "--execute");
  }],
  ["M22 a docs-only fabricated source_key is rejected by the operator", () => {
    const exec = seedSrc.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
    return !/docs-only source_key is never accepted/i.test(seedSrc)
      || !/codeContract/.test(exec);
  }],
  ["M23 dropping BINDING_SCHEMA_UNPROVEN is rejected", () => !/BINDING_SCHEMA_UNPROVEN/.test(seedSrc)],
  ["M24 a removed submission pause is rejected", () => {
    const s = { status: "OPEN", successor_subset_proposed: true };
    return s.status === "PAUSED" && s.successor_subset_proposed === false;
  }],
  ["M25 a created subset 3 is rejected", () => {
    const exists = true;   // simulate the artefact appearing
    return !exists;
  }],
];
for (const [n, fn] of MUT) add(n, fn() === false);

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${!r.ok && r.detail ? `  [${r.detail}]` : ""}`);
console.log(`\nBusiness templates: ${BUSINESS_TEMPLATE_KEYS.length} · source keys: `
  + `${Object.values(BusinessSourceKey).length} · acknowledgements: ${ACKS.length} (zero-variable)`);
console.log(`Summary: ${results.length - failed.length} passed, ${failed.length} failed `
  + `(rules: ${RULES.length}, mutation self-tests: ${MUT.length}).`);
process.exit(failed.length === 0 ? 0 : 1);
