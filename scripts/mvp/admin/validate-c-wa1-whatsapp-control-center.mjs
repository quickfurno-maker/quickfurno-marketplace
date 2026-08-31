// ============================================================================
// C-WA1 — WhatsApp Command Center invariants harness.
//
// Offline: no database, no network, no provider call, no secret read. Locks the
// STRUCTURAL and BEHAVIOURAL guarantees of the admin WhatsApp workspace:
//
//   * the route and nav item exist and are wired to the real shell
//   * the read layer is server-only, read-only, and bounded at the query
//   * no second WhatsApp backend: no new table, no new migration, no adapter
//   * no send / bulk send / retry / submit / activate / override control
//   * template UI keeps local, Meta, mapping and runtime states separate
//   * the EXISTING readiness vocabulary is reused verbatim, not re-invented
//   * 20/page primary, <=10 embedded, no page-size selector, no load-all
//   * message detail is on demand; hidden tabs fetch nothing
//   * no secret value can reach the browser
//   * dark command-center styling preserved; no fabricated metrics
//   * CRM-contact-is-not-consent semantics stated and preserved
// ============================================================================
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { ADMIN_DIRECTORY_PAGE_SIZE, ADMIN_EMBEDDED_PANEL_LIMIT } from "../../../lib/adminPaging.ts";
import {
  META_OPERATIONS,
  ReadinessState,
} from "../../../lib/communication/providers/metaRuntimeReadiness.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (p) => readFileSync(join(root, p), "utf8");

/** Source with block and line comments removed — used where prose may legitimately
 *  discuss a forbidden identifier while the CODE must never contain it. */
const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

let passed = 0;
let failed = 0;
function check(name, condition) {
  if (condition) {
    passed += 1;
    console.log(`   ok    ${name}`);
  } else {
    failed += 1;
    console.log(`   FAIL  ${name}`);
  }
}

const route = read("app/admin/whatsapp/page.tsx");
const service = read("services/adminWhatsAppService.ts");
const catalogue = read("lib/admin/whatsappSourceCatalogue.ts");
const config = read("components/admin/adminConfig.ts");
const shell = read("components/admin/whatsapp/WhatsAppControlCenter.tsx");
const types = read("components/admin/whatsapp/whatsappAdminTypes.ts");
const shared = read("components/admin/whatsapp/whatsappShared.tsx");
const overview = read("components/admin/whatsapp/WhatsAppOverviewTab.tsx");
const templates = read("components/admin/whatsapp/WhatsAppTemplatesTab.tsx");
const messages = read("components/admin/whatsapp/WhatsAppMessagesTab.tsx");
const delivery = read("components/admin/whatsapp/WhatsAppDeliveryTab.tsx");
const consent = read("components/admin/whatsapp/WhatsAppConsentTab.tsx");
const provider = read("components/admin/whatsapp/WhatsAppProviderTab.tsx");
const automation = read("components/admin/whatsapp/WhatsAppAutomationTab.tsx");

/** Every CLIENT component in the workspace. These ship to the browser. */
const clientSources = [
  shell, types, shared, overview, templates, messages, delivery, consent, provider, automation,
];
/** Every source C-WA1 added. */
const allSources = [route, service, catalogue, ...clientSources];

// ── 1. Route + navigation ──────────────────────────────────────────────────
check("the /admin/whatsapp route exists and is dynamic", /export const dynamic = "force-dynamic"/.test(route));
check("the route renders the WhatsApp control center shell", /<WhatsAppControlCenter/.test(route));
check("nav declares a whatsapp section at /admin/whatsapp", /key: "whatsapp", href: "\/admin\/whatsapp"/.test(config));
check("nav item is labelled WhatsApp", /label: "WhatsApp"/.test(config));
check("nav item carries the required description", /description: "Templates, message delivery, consent and provider readiness"/.test(config));
check("whatsapp is placed in a real nav group", /sections: \[[^\]]*"whatsapp"/.test(config));
check("the whatsapp icon uses the existing AdminIcon system", /whatsapp:\s*\[/.test(read("components/admin/AdminIcon.tsx")));

// ── 2. Server guard ────────────────────────────────────────────────────────
check("the route uses the canonical admin session guard", /getAdminSession\(\)/.test(route));
check("the route redirects a logged-out visitor", /if \(!session\.isLoggedIn\) redirect\("\/admin\/login"\)/.test(route));
check("the route requires superadmin", /if \(!session\.isSuperadmin\) redirect\("\/admin\/login\?error=unauthorized"\)/.test(route));
check("no new admin role is introduced", !/isWhatsAppAdmin|whatsappRole|WHATSAPP_ADMIN/.test(allSources.join("\n")));

// ── 3. Server-only, read-only boundary ─────────────────────────────────────
check("the read layer imports server-only", /^import "server-only";/m.test(service));
check("the read layer never writes", !/\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(/.test(service));
check("the read layer imports no provider adapter", !/metaCloudWhatsAppProvider["']|whatsappProvider["']|mockWhatsAppProvider|httpTransport/.test(service.replace(/META_WHATSAPP_CLOUD_PROVIDER_KEY[^\n]*\n/g, "")));
check("no client component imports the service_role client", clientSources.every((s) => !/adminClient|lib\/supabase/.test(s)));
check("no client component performs a fetch", clientSources.every((s) => !/\bfetch\s*\(/.test(s)));
check("no client component references the Meta Graph API", clientSources.every((s) => !/graph\.facebook\.com|facebook\.com\/v\d/.test(s)));
check("no source calls the Meta Graph API at all", allSources.every((s) => !/graph\.facebook\.com/.test(s)));

// ── 4. No second WhatsApp backend ──────────────────────────────────────────
const migrations = readdirSync(join(root, "supabase", "migrations")).filter((f) => f.endsWith(".sql"));
// QF-MVP-70.04 RE-PIN: 98 -> 99. This admin phase still adds no migration of its own;
// the new file belongs to QF-MVP-40 (20260814000000_qf_mvp_40_marketing_consent_writer.sql).
// QF-MVP-75.01 RE-PIN: 99 -> 100. This admin phase still adds no migration of its own;
// the new file belongs to QF-MVP-75.01 (20260815000000_qf_mvp_75_01_matchcore_binding_rank_order.sql).
// QF-MVP-75.02 RE-PIN: 100 -> 101. This phase still adds no migration of its own;
// the geo normalization / PostGIS shortlist foundation (20260816000000) is the only
// addition. Exact equality, never loosened.
// QF-MVP-80.03 RE-PIN: 101 -> 102. This phase still adds no migration of its own;
// the audit_logs forward repair (20260817000000) is the only addition. Exact
// equality, never loosened.
check("migration count is unchanged at 102", migrations.length === 102);
check("C-WA1 added no migration", !migrations.some((f) => /wa1|whatsapp_admin|admin_whatsapp/i.test(f)));
check("no source creates a table", allSources.every((s) => !/create table/i.test(s)));
check("the read layer only reads EXISTING communication relations", (() => {
  const referenced = [...service.matchAll(/\.from\("([a-z_]+)"\)/g)].map((m) => m[1]);
  const allowed = new Set([
    "communication_messages",
    "communication_delivery_events",
    "communication_inbound_messages",
    "communication_webhook_receipts",
    "communication_preferences",
    "communication_suppressions",
    "communication_provider_accounts",
    "communication_provider_runtime_policies",
    "communication_provider_template_mappings",
    "communication_provider_canary_destinations",
    "communication_templates",
    "automation_jobs",
  ]);
  return referenced.length > 0 && referenced.every((t) => allowed.has(t));
})());

// ── 5. Reuse of existing authorities (never re-implemented) ────────────────
check("readiness comes from the existing pure evaluator", /evaluateMetaReadiness/.test(service));
check("runtime rows are INJECTED into that evaluator, not re-judged", /evaluateMetaReadiness\(env, snapshot\)/.test(service));
check("outbound config comes from the existing resolver", /resolveOutboundMetaConfig/.test(service));
check("consent scope comes from the existing closed registry", /resolveOutboundConsentScope/.test(service));
check("workflow family comes from the frozen action registry", /AUTOMATION_ACTION_REGISTRY/.test(service));
check("no parallel consent rule is implemented", !/function\s+\w*[Cc]onsent\w*(Decision|Allow|Permit)/.test(service));
check("template governance reuses the committed manifests", /provider-manifests\/whatsapp-template-submission-manifest\.json/.test(catalogue) && /provider-manifests\/meta-template-remote-state\.json/.test(catalogue));
check("the catalogue is pure — no fs, network or env read", !/node:fs|require\(|process\.env|fetch\(/.test(catalogue));

// ── 6. Existing readiness vocabulary reused verbatim ───────────────────────
for (const state of Object.values(ReadinessState)) {
  check(`readiness state ${state} is honoured by the UI tone map`, shared.includes(state));
}
for (const operation of META_OPERATIONS) {
  check(`operation ${operation} is reachable through the evaluator output`, service.includes("META_OPERATIONS") || service.includes(operation));
}
check("no invented readiness vocabulary", !/"(HEALTHY|OK|GREEN|ALL_GOOD|LIVE)"/.test(provider + shared));

// ── 7. No send / mutate / override controls anywhere in the UI ─────────────
const FORBIDDEN_CONTROLS = [
  /onClick=\{[^}]*\b(send|resend|retry|dispatch|broadcast|submitTemplate|activateMapping|deactivate|approveTemplate|deleteTemplate|appeal|overrideStatus|forceComplete|unclaim|release|runNow)\b/i,
  />\s*(Send|Send now|Bulk send|Broadcast|Retry|Retry now|Resend|Submit to Meta|Create in Meta|Activate mapping|Deactivate|Delete template|Appeal|Mark delivered|Override status|Force complete|Unclaim|Release|Run now|Activate n8n)\s*</i,
];
for (const source of clientSources) {
  check(
    "no send/retry/submit/activate/override control is rendered",
    FORBIDDEN_CONTROLS.every((pattern) => !pattern.test(source)),
  );
}
check("no consent override control", !/(overrideConsent|forceSend|bypassSuppression|unsuppress)\s*[({]/.test(clientSources.join("\n")));
check("no delivery status override control", !/(setStatus|markDelivered|updateStatus)\s*[({]/.test(clientSources.join("\n")));
check("no vendor accept/reject control leaked into this workspace", clientSources.every((s) => !/lead_offer_accept["']\s*\)|acceptLead|rejectLead|declineLead/.test(s)));
check("delivery tab states the append-only semantics", /append-only/.test(delivery));
check("automation tab preserves the Core-decides authority statement", /Core decides/.test(automation) && /n8n orchestrates/.test(automation));

// ── 8. Template state separation ───────────────────────────────────────────
check("templates render a LOCAL CONTRACT section", /Local contract/.test(templates));
check("templates render META / REMOTE evidence separately", /Meta \/ remote evidence/.test(templates));
check("templates render the MAPPING dimension separately", /Provider mapping/.test(templates));
check("templates render RUNTIME ELIGIBILITY separately", /Runtime eligibility/.test(templates));
check("the four dimensions are separate table columns too", /header: "Local state"/.test(templates) && /header: "Meta proven"/.test(templates) && /header: "Mapping"/.test(templates) && /header: "Runtime"/.test(templates));
check("runtime eligibility is a closed fail-closed vocabulary", /TemplateRuntimeEligibility = Object\.freeze\(/.test(service) && /NO_MAPPING/.test(service) && /BLOCKED_BY_RUNTIME/.test(service));
check("only ELIGIBLE renders as success", /value === "ELIGIBLE"\) return "emerald"/.test(templates));
check("mapping eligibility mirrors approved AND active AND named", /approvalStatus === "approved" && m\.providerTemplateName/.test(service));
check("an unreadable mapping state never reads as eligible", /if \(mappingFault\) return TemplateRuntimeEligibility\.MAPPING_STATE_UNKNOWN/.test(service));
check("preview is labelled as an example, never a send", /Example preview/.test(templates) && /sends nothing|not a send|Not a send/i.test(templates));
check("an unresolved variable contract is stated verbatim", /VARIABLE CONTRACT UNRESOLVED/.test(templates));
check("only implemented component profiles are claimed supported", /COMPONENT_PROFILES as readonly string\[\]\)\.includes\(componentProfile\)/.test(catalogue));
check("no admin-authored source key or free JSON variable input", !/<textarea|contentEditable|JSON\.parse\(/.test(templates));

// ── 9. Bounding + pagination policy ────────────────────────────────────────
check("primary page size is still 20", ADMIN_DIRECTORY_PAGE_SIZE === 20);
check("embedded panel limit is still 10", ADMIN_EMBEDDED_PANEL_LIMIT === 10);
check("the read layer imports the locked constants", /ADMIN_DIRECTORY_PAGE_SIZE/.test(service) && /ADMIN_EMBEDDED_PANEL_LIMIT/.test(service));
// Body is fenced to non-`}` characters so the match cannot run past the
// interface it started in and pick up an unrelated later `pageSize`.
check("no query type declares a page size", !/interface \w*Query \{[^}]*pageSize/.test(service));
check("page size is never read from caller input", !/query[^\n]{0,60}\.pageSize/.test(service) && !/\.pageSize/.test(route));
check("every page size resolves to a locked constant", (() => {
  const bindings = [...service.matchAll(/(?:const pageSize[^=]*=|pageSize:)\s*([^,;\n]+)/g)].map((m) => m[1].trim());
  return (
    bindings.length > 0 &&
    bindings.every((rhs) =>
      /ADMIN_DIRECTORY_PAGE_SIZE|ADMIN_EMBEDDED_PANEL_LIMIT/.test(rhs) || rhs === "pageSize",
    )
  );
})());
check("no page-size selector is rendered", clientSources.every((s) => !/options=\{\[\s*"?(10|20|25|50|100)"?/.test(s) && !/Load all|Show all|per page/i.test(s)));
check("list reads are bounded at the query", (() => {
  const ranged = (service.match(/\.range\(/g) ?? []).length;
  const limited = (service.match(/\.limit\(/g) ?? []).length;
  return ranged >= 4 && limited >= 2;
})());
check("overview samples are capped at the embedded limit", (service.match(/\.limit\(ADMIN_EMBEDDED_PANEL_LIMIT\)/g) ?? []).length >= 2);
check("embedded delivery reads use the embedded limit", /query\.embedded \? ADMIN_EMBEDDED_PANEL_LIMIT : ADMIN_DIRECTORY_PAGE_SIZE/.test(service));
check("totals come from exact count queries, not loaded rows", /count: "exact", head: true/.test(service));
check("no broad snapshot consumer is introduced", allSources.every((s) => !/adminSnapshot|whatsappSnapshot/.test(s)));
check("every primary list renders the shared Pagination control", [templates, messages, delivery, consent, automation].every((s) => /<Pagination/.test(s)));

// ── 10. Lazy tabs + on-demand detail ───────────────────────────────────────
check("tab state lives in the URL", /parseTab\(one\("tab"\)\)/.test(route) && /searchParams/.test(route));
for (const [loader, tab] of [
  ["getWhatsAppAdminOverview", "overview"],
  ["getWhatsAppTemplatePage", "templates"],
  ["getWhatsAppDeliveryPage", "delivery"],
  ["getWhatsAppConsentPage", "consent"],
  ["getWhatsAppProviderReadiness", "provider"],
  ["getWhatsAppAutomationPage", "automation"],
]) {
  const branch = new RegExp(`tab === "${tab}"[\\s\\S]{0,400}?${loader}\\(`);
  check(`${tab} data loads ONLY inside its own tab branch`, branch.test(route));
  check(`${loader} is called exactly once in the route`, (route.match(new RegExp(`${loader}\\(`, "g")) ?? []).length === 1);
}
check("message detail is fetched only when a message id is present", /query\.message \? getWhatsAppMessageDetail\(query\.message\) : Promise\.resolve\(null\)/.test(route));
check("inbound and outbound are never both fetched", /inbound \? Promise\.resolve\(null\) : getWhatsAppMessagePage/.test(route) && /inbound \? getWhatsAppInboundPage[\s\S]{0,80}: Promise\.resolve\(null\)/.test(route));
check("the payload type makes lazy loading explicit (all slices optional)", /readonly overview\?:/.test(types) && /readonly templates\?:/.test(types));
check("no client-side data loading hook exists in the workspace", clientSources.every((s) => !/useEffect\([^)]*\)\s*=>\s*\{[\s\S]{0,200}(fetch|load|refresh)/.test(s)));
check("message detail loads bounded delivery events", /getWhatsAppDeliveryPage\(\{ messageId, embedded: true \}\)/.test(service));

// ── 11. Secrets ────────────────────────────────────────────────────────────
const SECRET_NAMES = [
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_APP_SECRET",
  "WHATSAPP_WEBHOOK_VERIFY_TOKEN",
  "QF_CRON_SECRET",
  "SUPABASE_SERVICE_ROLE_KEY",
];
for (const name of SECRET_NAMES) {
  check(`no client component references ${name}`, clientSources.every((s) => !s.includes(name)));
}
check("the read layer reads no secret value", !/process\.env\.(WHATSAPP|SUPABASE_SERVICE|QF_CRON)/.test(service));
check("env is passed to the evaluator wholesale, never destructured for values", /const env = process\.env as Record<string, string \| undefined>/.test(service));
check("readiness exposes variable NAMES only", /missing: readonly string\[\]/.test(read("lib/communication/providers/metaRuntimeReadiness.ts")));
check("no hash column appears in read-layer CODE at all", (() => {
  // Comments discuss the hash columns on purpose (explaining why they are not
  // projected); the CODE must never name one, in a select list or anywhere else.
  const code = stripComments(service);
  return !/destination_hash|sender_hash|payload_hash/.test(code);
})());
check("no returned view type exposes a hash field", !/readonly \w*[Hh]ash\??:/.test(service));
check("only the masked destination is rendered", /destinationMasked/.test(messages) && !/destinationHash/.test(messages));
check("no raw provider body or webhook payload is projected", !/raw_?[Bb]ody|payload_json|providerResponse|rawResponse/.test(allSources.join("\n")));
check("inbound content is not rendered", !/content_minimized/.test(messages) && !/contentMinimized/.test(messages));
check("delivery metadata is narrowed, never spread", /sanitized_metadata/.test(service) && !/\.\.\.\s*sanitizedMetadata|\.\.\.\s*metadata\b/.test(service));
check("the remote-state artifact is refused if it ever declares secrets", /contains_secrets\) === true\) return Object\.freeze\(\[\]\)/.test(catalogue));
check("route errors never render a raw exception message", /name: safe\?\.name \?\? "Error"/.test(route) && !/error\.message/.test(route));

// ── 12. Truthfulness ───────────────────────────────────────────────────────
check("no fabricated randomness anywhere", allSources.every((s) => !/Math\.random/.test(s)));
check("no fake health score / quality rating / cost metric", allSources.every((s) => !/healthScore|qualityRating|deliveryRate|responseRate|costPerMessage|conversionRate/i.test(s)));
check("an uncountable value renders Unknown, never zero", /if \(value === null\) return <UnknownValue/.test(shared));
check("a missing relation is reported as NOT_PROVISIONED, not as empty", /NOT_PROVISIONED/.test(service) && /Not provisioned in this environment/.test(types));
check("bounded samples are labelled as samples", /Bounded sample/.test(overview));
check("no percentage is rendered from a bounded sample", !/%<\/|toFixed\(\d\)\s*\}\s*%/.test(overview));
check("configuration/provider/runtime/authorization are stated as separate authorities", /separate authorit/i.test(overview) && /separate authorit/i.test(provider));
check("webhook facts are kept separate", /Configuration present/.test(provider) && /Subscription verified/.test(provider) && /Verified callback observed/.test(provider));
check("a missing provider account is stated truthfully", /No provider account row exists/.test(provider));
check("an absent runtime policy is treated as fail-closed", /fail-closed by default/.test(provider));
// Markup is stripped first: the sentence is split by <strong> tags in the JSX,
// so matching the rendered TEXT is what actually proves the statement is shown.
const plainText = (source) => source.replace(/<[^>]+>/g, "").replace(/\s+/g, " ");
check(
  "CRM contact is explicitly distinguished from consent on both surfaces",
  /A CRM contact existing is not WhatsApp consent/i.test(plainText(consent)) &&
    /is not WhatsApp consent/i.test(plainText(overview)),
);
check("consent tab states no override is possible", /override, bypass or force past/.test(consent));

// ── 13. Dark command-center UI preserved ───────────────────────────────────
check("the workspace renders through AdminPrimitives", clientSources.filter((s) => /from "\.\.\/AdminPrimitives"/.test(s)).length >= 6);
check("dark qfa surface classes are used", /qfa-panel|qfa-quiet/.test(overview + provider + templates));
check("the status rail uses the restrained qfa glow chips", /qfa-glow-(blue|cyan|green|amber|red|violet)/.test(overview));
check("no consumer-green WhatsApp clone styling", allSources.every((s) => !/#25D366|#128C7E|#075E54|bg-green-500|bg-\[#25/i.test(s)));
check("tabs use the accessible shared Tabs primitive", /<Tabs/.test(shell) && /<TabPanel/.test(shell));
check("no light-theme-only hardcoded page background", clientSources.every((s) => !/bg-white\b(?![^"]*qfa)/.test(s) || !/className="[^"]*\bbg-white\b[^"]*min-h-screen/.test(s)));

console.log(`\nC-WA1 WhatsApp control center: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
