// ============================================================================
// C6 — Final integrated Admin V2 invariants harness.
//
// This does NOT duplicate C-PERF1/C-PERF2/C4/C5/C-WA1. It locks the invariants
// that the C6 AUTHENTICATED RENDERED QA actually exercised, plus regression
// guards for the two defects that QA found:
//
//   D1  a status-rail mark sized with utilities lost to `.admin-surface
//       .qfa-glow-chip` (specificity 0,2,0 beats 0,1,0) and rendered as an
//       empty 30px bordered square instead of the intended mark.
//
//   D2  PostgREST does NOT error on a `head: true` count against a MISSING
//       relation — it answers { count: null, error: null }. `count ?? 0` then
//       printed a confident "0" for a table that does not exist, contradicting
//       the same page's own NOT_PROVISIONED state. Counts must stay null.
//
//   D3  implicit locale/time-zone timestamp rendering produced different
//       server and browser strings. Admin timestamps now share an explicit
//       en-IN / Asia-Kolkata convention.
//
//   D4  the obsolete AI Agents route and planned-agent catalogue implied a
//       roadmap surface that no longer exists. The real AOS readiness/runtime
//       control remains; the placeholder route, nav and catalogue do not.
//
// Offline: no database, no network, no provider call, no secret read.
// The harness does not replace the rendered QA; it prevents its findings from
// silently regressing.
// ============================================================================
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { ADMIN_DIRECTORY_PAGE_SIZE, ADMIN_EMBEDDED_PANEL_LIMIT } from "../../../lib/adminPaging.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

let passed = 0;
let failed = 0;
function check(name, condition) {
  if (condition) { passed += 1; console.log(`   ok    ${name}`); }
  else { failed += 1; console.log(`   FAIL  ${name}`); }
}

const pkg = JSON.parse(read("package.json"));
const service = read("services/adminWhatsAppService.ts");
const serviceCode = stripComments(service);
const route = read("app/admin/whatsapp/page.tsx");
const config = read("components/admin/adminConfig.ts");
const overview = read("components/admin/whatsapp/WhatsAppOverviewTab.tsx");
const shared = read("components/admin/whatsapp/whatsappShared.tsx");
const primitives = read("components/admin/AdminPrimitives.tsx");
const shell = read("components/admin/AdminShell.tsx");
const css = read("app/globals.css");
const adminUtils = read("components/admin/adminUtils.ts");
const sectionPage = read("components/admin/AdminSectionPage.tsx");
const miscSections = read("components/admin/sections/MiscSections.tsx");
const dynamicSectionRoute = read("app/admin/[section]/page.tsx");

const adminTimestampConsumers = [
  shared,
  read("components/admin/RequirementGroupsPanel.tsx"),
  read("components/admin/AosAutomationControl.tsx"),
  read("components/admin/AOSControlCenter.tsx"),
  read("components/admin/crm/campaigns/VendorCampaignDirectory.tsx"),
  read("components/admin/crm/campaigns/VendorCampaignEditor.tsx"),
  read("components/admin/crm/segments/VendorSegmentDirectory.tsx"),
  read("components/admin/crm/segments/VendorSegmentEditor.tsx"),
];

const waClients = [
  "WhatsAppControlCenter", "WhatsAppOverviewTab", "WhatsAppTemplatesTab",
  "WhatsAppMessagesTab", "WhatsAppDeliveryTab", "WhatsAppConsentTab",
  "WhatsAppProviderTab", "WhatsAppAutomationTab",
].map((n) => read(`components/admin/whatsapp/${n}.tsx`));

// ── 1. Every prior gate is still wired ─────────────────────────────────────
for (const script of ["test:admin:cperf1", "test:admin:cperf2", "test:admin:c4", "test:admin:c5", "test:admin:cwa1", "test:admin:cwa1b", "test:admin:c6"]) {
  check(`${script} is wired in package.json`, typeof pkg.scripts[script] === "string" && pkg.scripts[script].length > 0);
}
for (const f of [
  "scripts/mvp/admin/validate-c5-responsive-accessibility.mjs",
  "scripts/mvp/admin/validate-c-wa1-whatsapp-control-center.mjs",
  "scripts/mvp/admin/validate-cwa1b-whatsapp-billing.mjs",
  "scripts/mvp/admin/validate-c-perf2-data-loading.mjs",
]) {
  check(`${f.split("/").pop()} still exists`, existsSync(join(root, f)));
}

// ── 2. D2 REGRESSION — an uncountable count must never become zero ─────────
// Normalized: the doc comment wraps across lines with leading " * " markers, so
// the prose is matched against a whitespace-flattened copy.
const serviceProse = service.replace(/^\s*\*\s?/gm, " ").replace(/\s+/g, " ");
check(
  "countRows documents that null means 'could not be counted', not zero",
  /a null return means "could not be counted", NOT zero/i.test(serviceProse) &&
    /does not raise an error for a head-count against a MISSING relation/i.test(serviceProse),
);
check("countRows returns null rather than 0", /return count \?\? null;/.test(serviceCode));
check(
  "no head-count result is coerced with `?? 0`",
  (() => {
    // Every `?? 0` left in the service must belong to a FULL select (which does
    // raise PGRST205 and is therefore caught as a fault), never a head-count.
    const headCountBlocks = serviceCode.split(/head: true/);
    // After each `head: true` occurrence, the following ~400 chars must not coerce.
    return headCountBlocks.slice(1).every((tail) => !/count \?\? 0/.test(tail.slice(0, 400)));
  })(),
);
check("overview status counts preserve null", /return \[status, count\] as const;/.test(serviceCode));
check("a null status count makes the ledger total unknown", /if \(count === null\) total = null;/.test(serviceCode));
check("all-null status counts raise NOT_PROVISIONED", /results\.every\(\(\[, count\]\) => count === null\)\) messagesFault = "NOT_PROVISIONED"/.test(serviceCode));
check("consent counts preserve null", /preferenceBlockedCount = blocked\.count;/.test(serviceCode) && /activeSuppressionCount = suppressed\.count;/.test(serviceCode));
check("a null automation count raises NOT_PROVISIONED", /automationOpenJobCount = count;/.test(serviceCode) && /if \(count === null\) automationFault = "NOT_PROVISIONED"/.test(serviceCode));
check("consent page totals fail closed on a null head-count", /if \(count === null\) suppressionsFault = "NOT_PROVISIONED"/.test(serviceCode) && /if \(count === null\) preferencesFault = "NOT_PROVISIONED"/.test(serviceCode));
check("the UI renders a null count as Unknown, never 0", /if \(value === null\) return <UnknownValue/.test(shared));

// ── 3. D1 REGRESSION — the glow chip is never sized down by utilities ──────
check(
  "the status-rail mark uses qfa-glow-chip without conflicting size utilities",
  (() => {
    const chips = [...overview.matchAll(/className=\{`qfa-glow-chip[^`]*`\}/g)].map((m) => m[0]);
    return chips.length > 0 && chips.every((c) => !/\b[hw]-\d/.test(c) && !/rounded-full/.test(c));
  })(),
);
check("the rail mark carries an icon rather than being an empty box", /<AdminIcon name=\{icon\}/.test(overview));
check("the specificity trap is documented where it bites", /specificity \(0,2,0\)/.test(overview));
check("qfa-glow-chip still has its designed size in the stylesheet", /\.admin-surface \.qfa-glow-chip \{[^}]*width: 30px/.test(css));

// ── 3b. D3 REGRESSION — rendered timestamps are hydration-deterministic ────
const hasDeterministicAdminDateTime = (source) =>
  /ADMIN_LOCALE = "en-IN"/.test(source) &&
  /ADMIN_TIME_ZONE = "Asia\/Kolkata"/.test(source) &&
  /timeZone: ADMIN_TIME_ZONE/.test(source);
check("Admin timestamps declare the en-IN / Asia-Kolkata convention", hasDeterministicAdminDateTime(adminUtils));
check("the WhatsApp timestamp helper delegates to the deterministic formatter", /return formatDateTime\(value, "—"\);/.test(shared));
check("rendered Admin timestamp paths contain no implicit toLocaleString()", adminTimestampConsumers.every((source) => !/\.toLocaleString\(\)/.test(source)));
check(
  "timestamp mutation self-test rejects removal of the explicit business zone",
  !hasDeterministicAdminDateTime(adminUtils.replaceAll('timeZone: ADMIN_TIME_ZONE', "")),
);

// ── 4. WhatsApp route + navigation (verified rendered in C6 QA) ────────────
check("the whatsapp nav item exists", /key: "whatsapp", href: "\/admin\/whatsapp"/.test(config));
check("the route is server-guarded for superadmin", /session\.isSuperadmin/.test(route) && /getAdminSession\(\)/.test(route));
check("all seven tabs are declared", (() => {
  const t = read("components/admin/whatsapp/whatsappAdminTypes.ts");
  return ["overview", "templates", "messages", "delivery", "consent", "provider", "automation"].every((x) => t.includes(`"${x}"`));
})());

// ── 4b. D4 REGRESSION — obsolete AI Agents placeholder is gone ────────────
const aiPlaceholderSources = [config, sectionPage, miscSections, dynamicSectionRoute].join("\n");
const hasLegacyAiPlaceholder = (source) =>
  /ai-agents|AIAgentsPage|\baiAgents\b|label: "AI Agents"|Planned agent roles/.test(source);
check("the AI Agents nav, route dispatch and catalogue are absent", !hasLegacyAiPlaceholder(aiPlaceholderSources));
check("the real AOS readiness and runtime control remain", /AosReadinessPage/.test(sectionPage) && /AosAutomationControl/.test(miscSections));
check("no fake Admin Vision route or production claim was introduced", !/\/admin\/vision|Vision Supervisor|QF VISION/.test(aiPlaceholderSources));
check(
  "AI placeholder mutation self-test detects a reintroduced route",
  hasLegacyAiPlaceholder(`${aiPlaceholderSources}\n{ key: "ai-agents", label: "AI Agents" }`),
);

// ── 5. No provider call / no send / no activation from the browser ─────────
check("no client component calls the Meta Graph API", waClients.every((s) => !/graph\.facebook/.test(s)));
check("no client component imports the service_role client", waClients.every((s) => !/adminClient|lib\/supabase/.test(s)));
check("no client component fetches", waClients.every((s) => !/\bfetch\s*\(/.test(s)));
check("the read layer never writes", !/\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(/.test(serviceCode));
check("no send/activate/override control is rendered", waClients.every((s) =>
  !/>\s*(Send|Send now|Bulk send|Broadcast|Retry|Resend|Submit to Meta|Activate|Sync|Mark delivered|Override status|Force complete|Unclaim|Release|Run now)\s*</i.test(s)));
check("Provider retains the C-WA1B Billing & spend surface", /title="Billing & spend"/.test(waClients[6]));
check("C-WA1B keeps native recharge unsupported", /supported:\s*false/.test(serviceCode));
check("C-WA1B never turns an unavailable financial fact into zero", !/balance:\s*[^,]*\?\?\s*0|spend:\s*[^,]*\?\?\s*0/.test(serviceCode));

// ── 6. Data architecture (re-proved after the C6 corrections) ─────────────
check("primary page size is still 20", ADMIN_DIRECTORY_PAGE_SIZE === 20);
check("embedded panel limit is still 10", ADMIN_EMBEDDED_PANEL_LIMIT === 10);
check("no broad snapshot consumer anywhere in Admin V2", [
  read("app/admin/[section]/page.tsx"),
  read("app/admin/dashboard/page.tsx"),
  read("components/admin/AdminSectionPage.tsx"),
  route, service,
].every((s) => !/adminSnapshot|whatsappSnapshot/.test(s)));
check("no page-size selector is rendered", waClients.every((s) => !/Load all|Show all|per page/i.test(s)));
check("WhatsApp tabs are lazy — one loader per tab branch", (() => {
  const loaders = ["getWhatsAppAdminOverview", "getWhatsAppTemplatePage", "getWhatsAppDeliveryPage",
    "getWhatsAppConsentPage", "getWhatsAppProviderReadiness", "getWhatsAppAutomationPage"];
  return loaders.every((l) => (route.match(new RegExp(`${l}\\(`, "g")) ?? []).length === 1);
})());
check("message detail is fetched only on demand", /query\.message \? getWhatsAppMessageDetail\(query\.message\) : Promise\.resolve\(null\)/.test(route));
check("inbound and outbound are never both fetched", /inbound \? Promise\.resolve\(null\) : getWhatsAppMessagePage/.test(route));

// ── 7. Business semantics (verified in the rendered product) ───────────────
const vendorProfile = read("components/admin/crm/VendorCrmProfile.tsx");
const vendorSections = read("components/admin/crm/VendorCrmProfileSections.tsx");
check("accepting_leads wording is preserved", /Available for new assignments/.test(vendorProfile) && /Unavailable for new assignments/.test(vendorSections));
check("no vendor per-lead accept/reject control exists in admin", [vendorProfile, vendorSections, ...waClients].every((s) =>
  !/>\s*(Accept lead|Reject lead|Decline lead)\s*</i.test(s)));
check("CRM contact is distinguished from WhatsApp consent", /is\s*<strong>not<\/strong>\s*WhatsApp consent/.test(overview.replace(/\s+/g, " ")) || /not<\/strong> WhatsApp consent/.test(overview.replace(/\s+/g, " ")));

// ── 8. Shared a11y primitives retained (C5 carry-forward) ─────────────────
check("the shared modal focus hook still exists", existsSync(join(root, "components/admin/useAdminModalFocus.ts")));
check("the shared hook still closes on Escape", /event\.key === "Escape" && closeOnEscape/.test(read("components/admin/useAdminModalFocus.ts")));
check("the shared hook still restores focus", /if \(restoreTo\?\.isConnected\) restoreTo\.focus\(\)/.test(read("components/admin/useAdminModalFocus.ts")));
check("the Drawer uses the shared hook", /useAdminModalFocus\(\{ open: true, containerRef: panelRef, onClose \}\)/.test(primitives));
check("AdminShell owns the single main landmark", /<main/.test(shell));
check("reduced-motion handling is retained", /@media \(prefers-reduced-motion: reduce\)/.test(css));
check("the WhatsApp workspace uses the shared accessible Tabs", /<Tabs/.test(waClients[0]) && /<TabPanel/.test(waClients[0]));
check("tabs implement the ARIA tab pattern", /role="tablist"/.test(primitives) && /role="tab"/.test(primitives) && /ArrowRight/.test(primitives));

// ── 9. Dark UI ────────────────────────────────────────────────────────────
check("dark tokens remain scoped to .admin-surface", /\.admin-surface \{[^}]*--qfa-page/.test(css));
check("the WhatsApp workspace uses qfa dark surfaces", waClients.some((s) => /qfa-panel|qfa-quiet/.test(s)));
check("no consumer-green WhatsApp clone styling", waClients.every((s) => !/#25D366|#128C7E|#075E54|bg-green-500/i.test(s)));

// ── 10. Migration lock ────────────────────────────────────────────────────
const migrations = readdirSync(join(root, "supabase", "migrations")).filter((f) => f.endsWith(".sql"));
// QF-MVP-50.5 RE-PIN: 96 -> 97. This admin phase still adds no migration of its own.
check("migration count is unchanged at 97", migrations.length === 97);

console.log(`\nC6 integrated Admin V2: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
