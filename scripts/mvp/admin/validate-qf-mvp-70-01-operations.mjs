// ============================================================================
// QF-MVP-70.01 — Operations Control Center invariants harness.
//
// Offline: no database, no network, no provider call, no secret read, no n8n,
// no Meta. Locks the STRUCTURAL and BEHAVIOURAL guarantees of the read-only
// operations workspace:
//
//   * the route and nav item exist and are wired to the real shell
//   * the read layer is server-only and has no write surface at all
//   * it imports no provider adapter, no transport service, no recovery service
//   * it never imports safeCount — the fail-open counter is banned here
//   * every operational count is nullable and null is never coerced to zero
//   * HEALTHY is unreachable from partial data
//   * every incident read is bounded AT THE QUERY
//   * no migration, no new table, no new runtime control, no new env var
//   * the incident model stays derived — nothing persists an incident
//   * no retry / cancel / pause / resume control exists anywhere
//   * AttentionCenter renders an unreadable source as Unavailable, not 0
// ============================================================================
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (p) => readFileSync(join(root, p), "utf8");

/** Source with block and line comments removed — used where prose may
 *  legitimately discuss a forbidden identifier while the CODE must not
 *  contain it. */
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

const route = read("app/admin/operations/page.tsx");
const service = read("services/adminOperationsService.ts");
const config = read("components/admin/adminConfig.ts");
const shell = read("components/admin/operations/OperationsControlCenter.tsx");
const types = read("components/admin/operations/operationsTypes.ts");
const overview = read("components/admin/operations/OperationsOverviewTab.tsx");
const incidents = read("components/admin/operations/OperationsIncidentsTab.tsx");
const attention = read("components/admin/AttentionCenter.tsx");

const serviceCode = stripComments(service);
const routeCode = stripComments(route);

/** Every CLIENT component in the workspace. These ship to the browser. */
const clientSources = [shell, types, overview, incidents, attention];
/** Every source QF-MVP-70.01 added or changed. */
const allSources = [route, service, config, ...clientSources];
const allCode = allSources.map(stripComments).join("\n");

// ── 1. Route + navigation ──────────────────────────────────────────────────
check("the /admin/operations route exists and is dynamic", /export const dynamic = "force-dynamic"/.test(route));
check("the route renders the operations control center shell", /<OperationsControlCenter/.test(route));
check("nav declares an operations section at /admin/operations", /key: "operations", href: "\/admin\/operations"/.test(config));
check("nav item is labelled Operations", /key: "operations"[^}]*label: "Operations"/.test(config));
check("operations is placed in a real nav group", /sections: \[[^\]]*"operations"/.test(config));
check("operations reuses the existing automations icon", /key: "operations"[^}]*icon: "automations"/.test(config));
check("no new AdminIcon glyph was added for this slice", !/\boperations:\s*\[/.test(read("components/admin/AdminIcon.tsx")));

// ── 2. Server-side authorization ───────────────────────────────────────────
check("the route uses the canonical admin session guard", /getAdminSession\(\)/.test(routeCode));
check("the route redirects a logged-out visitor", /if \(!session\.isLoggedIn\) redirect\("\/admin\/login"\)/.test(routeCode));
check("the route requires superadmin server-side", /if \(!session\.isSuperadmin\) redirect\("\/admin\/login\?error=unauthorized"\)/.test(routeCode));
// The comparison is against the CALL SITE, not the import statement — an import
// necessarily precedes the guard and would make this assertion meaningless.
check(
  "the guard runs BEFORE any operations loader",
  routeCode.indexOf("isSuperadmin") < routeCode.indexOf("await getOperationsOverview(") &&
    routeCode.indexOf("isSuperadmin") < routeCode.indexOf("await getOperationsIncidentPage("),
);
check("no new admin role or RBAC family is introduced", !/isOperationsAdmin|operationsRole|OPERATIONS_ADMIN|Operations Admin/.test(allCode));
check("no client component reads the admin session", clientSources.every((s) => !/getAdminSession/.test(s)));

// ── 3. Server-only, read-only boundary ─────────────────────────────────────
check("the read layer imports server-only", /^import "server-only";/m.test(service));
check("the read layer has no write surface", !/\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(/.test(serviceCode));
check("the route has no write surface", !/\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(/.test(routeCode));
check(
  "the read layer imports no recovery, transport or execution service",
  !/automationRecoveryService|automationTransportService|automationPersistenceService|automation(Client|Vendor|Campaign)ExecutionService|communicationService|runtimeCommunicationService/.test(
    serviceCode,
  ),
);
check(
  "the read layer imports no provider adapter or Meta module",
  !/metaWhatsAppOutboundService|metaCloudWhatsAppProvider|metaCloudWhatsAppConfig|whatsappProvider|smsProvider|providerTemplateMappingService|communicationProviderRuntimeService/i.test(
    serviceCode,
  ),
);
check("no source calls the Meta Graph API", allSources.every((s) => !/graph\.facebook\.com/.test(s)));
check("no source performs an outbound HTTP call", allSources.every((s) => !/\bfetch\s*\(|axios|https?:\/\/(?!admin)/.test(stripComments(s))));
check("no client component imports the service_role client", clientSources.every((s) => !/adminClient|lib\/supabase/.test(s)));
/**
 * Walk back from each reference to the read layer to the `import` keyword that
 * opens THAT statement. A regex spanning from the file's first import would
 * capture unrelated statements and prove nothing.
 */
function importsReadLayerAsTypeOnly(source) {
  const marker = '"@/services/adminOperationsService"';
  let index = source.indexOf(marker);
  while (index !== -1) {
    const start = source.lastIndexOf("import", index);
    if (start === -1) return false;
    if (!/^import\s+type\b/.test(source.slice(start, index))) return false;
    index = source.indexOf(marker, index + marker.length);
  }
  return true;
}
check(
  "client components import the read layer for TYPES only",
  clientSources.every(importsReadLayerAsTypeOnly),
);

// ── 4. The fail-open counter is banned ─────────────────────────────────────
check("the read layer never imports safeCount", !/safeCount/.test(serviceCode));
check("the read layer never imports adminService at all", !/from "\.\.\/services\/adminService"|from "\.\/adminService"|services\/adminService/.test(serviceCode));
check("no operations source coerces a count to zero", allSources.every((s) => !/count \?\? 0/.test(stripComments(s))));
check("the read layer declares nullable counts", /count: number \| null/.test(service));
check("the class summary count is nullable", /readonly count: number \| null/.test(service));
check("the subsystem total is nullable", /readonly incidentCount: number \| null/.test(service));
check("an uncountable read returns null and a fault", /count: null, fault: "UNAVAILABLE"/.test(serviceCode));
check("a missing relation is reported as NOT_PROVISIONED", /NOT_PROVISIONED/.test(service) && /Not provisioned in this environment/.test(types));
check(
  "a successful read with no count is treated as unknown, not zero",
  /typeof count !== "number"/.test(serviceCode),
);

// ── 5. Health fails closed ─────────────────────────────────────────────────
check("any unreadable class makes the subsystem UNAVAILABLE", /entry\.fault !== null \|\| entry\.count === null\)\) return "UNAVAILABLE"/.test(serviceCode));
check("HEALTHY requires every subsystem to be HEALTHY", /=== "UNAVAILABLE"\)\) return "UNAVAILABLE";\s*return "HEALTHY"/.test(serviceCode));
check("a partial subsystem total is reported as unknown", /incidentCount = null/.test(serviceCode));
check("the UI renders an unknown count as Unavailable", /Unavailable/.test(overview) && /Unavailable/.test(types));
check("the UI warns when overall health is UNAVAILABLE", /Health cannot be confirmed/.test(overview));

// ── 6. AttentionCenter adoption ────────────────────────────────────────────
check("AttentionCenter is actually imported by the operations overview", /from "\.\.\/AttentionCenter"/.test(overview));
check("AttentionCenter accepts a nullable value", /value: number \| null/.test(attention));
check("AttentionCenter has an explicit unavailable state", /"unavailable"/.test(stripComments(attention)));
check("a null value FORCES the unavailable state", /item\.value === null \? "unavailable" : item\.severity/.test(stripComments(attention)));
check("unavailable outranks warning, info and clear", /SEVERITY_ORDER[^=]*=\s*\[\s*"critical",\s*"unavailable",\s*"warning",\s*"info",\s*"clear"\s*\]/.test(attention));
check("an unknown value never sorts as a healthy zero", /\(b\.value \?\? -1\) - \(a\.value \?\? -1\)/.test(attention));
check("an unavailable row renders a dash plus screen-reader text, never 0", /<span className="sr-only">Unavailable<\/span>/.test(attention));
check("the header never claims all-clear while a source is unreadable", /health cannot be confirmed/i.test(attention));
check("the snapshot indicator degrades when a source is unreadable", /Partial snapshot/.test(attention));
check("severity is still conveyed by word, not colour alone", /word: "Unavailable"/.test(attention));

// ── 7. Bounded reads ───────────────────────────────────────────────────────
check("the summary read is bounded to a single row", /\.limit\(1\)/.test(serviceCode));
check("the incident list is bounded by the locked page range", /\.range\(from, to\)/.test(serviceCode));
check("the locked admin page size is reused, not redefined", /ADMIN_DIRECTORY_PAGE_SIZE/.test(serviceCode) && !/pageSize\s*[:=]\s*\d/.test(serviceCode));
check("there is no page-size parameter", !/pageSize\?:/.test(service));
check("every read carries an exact count", (() => {
  const selects = [...serviceCode.matchAll(/\.select\(([\s\S]*?)\)\s*;/g)];
  return selects.length > 0 && selects.every((m) => /count: "exact"/.test(m[1]));
})());
check("no unbounded table scan is performed in application memory", !/\.select\([^)]*\)\s*$/m.test(serviceCode.replace(/\{ count: "exact" \}/g, "")));
check("the oldest incident is found by ordering, not by loading the set", /\.order\(descriptor\.openedAtColumn, \{ ascending: true[^)]*\)\s*\.limit\(1\)/.test(serviceCode));
check("the page parameter is normalized through boundPage", /boundPage\(/.test(serviceCode));

// ── 8. No second backend, no new control system ────────────────────────────
const migrations = readdirSync(join(root, "supabase", "migrations")).filter((f) => f.endsWith(".sql"));
check("migration count is unchanged at 99", migrations.length === 99);
check("QF-MVP-70 added no migration", !migrations.some((f) => /qf_mvp_70|mvp70|operations/i.test(f)));
check("no source creates a table", allSources.every((s) => !/create table/i.test(s)));
check("no source creates a function, index or policy", allSources.every((s) => !/create (or replace )?function|create index|create policy/i.test(s)));
check("no incident table or incident model is persisted", !/operational_incidents|operations_incidents|incident_log/i.test(allCode));
check("the incident model is explicitly derived", /derived|projection/i.test(service));
check("incidents are structurally non-actionable", /readonly actionable: false/.test(service) && /actionable: false/.test(serviceCode));
check("no new environment variable is introduced", (() => {
  const referenced = [...allCode.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((m) => m[1]);
  return referenced.length === 0;
})());
check("no new runtime setting, feature flag or kill switch is introduced", !/runtime_settings|RUNTIME_SETTING|featureFlag|FEATURE_FLAG|killSwitch|KILL_SWITCH/i.test(allCode));
check("no automation policy config is written or read", !/automation_policy/i.test(allCode));

// ── 9. Read-only UI: no operational control exists ─────────────────────────
check("no retry / cancel / pause / resume control exists", clientSources.every((s) => !/\b(Retry|Cancel job|Pause|Resume|Resolve|Acknowledge|Dead-letter now|Force)\b/.test(stripComments(s))));
// `action={…}` is excluded deliberately: SectionCard takes a presentational
// `action` slot. What must not exist is a server action import, a transition
// that would submit one, or a form.
check("no client component invokes a server action", clientSources.every((s) => !/useTransition|startTransition|from "@\/app\/actions"|<form\b/.test(stripComments(s))));
check("no client component performs a fetch", clientSources.every((s) => !/\bfetch\s*\(/.test(s)));
check("the shell states it renders no control", /renders NO retry, cancel, pause, resume/.test(shell));

// ── 10. QF-MVP-40 containment ──────────────────────────────────────────────
check("no QF-MVP-40 one-shot operator is imported or referenced", !/create-actual-staging|create-meta-staging|repair-meta-staging|activate-meta-staging|canary:mvp|r8a|r8b|r8c/i.test(allCode));
check("no Meta readiness, mapping or canary mutation is referenced", !/qf_arm_meta|qf_disable_meta_canary|subscribed_apps|message_templates/i.test(allCode));
check("no send path is referenced", !/sendWhatsApp|dispatchMessage|sendMessage|deliverMessage/i.test(allCode));
check("no n8n endpoint or transport route is referenced", !/n8n|claim_v1|complete_v1|recover_v1|reconcile_v1|execute_(client|vendor|campaign)/i.test(allCode));
check("no signed transport secret is referenced", !/QF_N8N|inboundSecret|responseSecret|transportAuth/i.test(allCode));

// ── 11. Canonical sources and vocabularies ─────────────────────────────────
check("the read layer only reads EXISTING canonical relations", (() => {
  const referenced = [...serviceCode.matchAll(/table: "([a-z_]+)"/g)].map((m) => m[1]);
  const allowed = new Set([
    "automation_jobs",
    "communication_messages",
    "communication_webhook_receipts",
    "lead_assignment_queue",
  ]);
  return referenced.length > 0 && referenced.every((t) => allowed.has(t));
})());
check("the frozen stale threshold is imported, not re-chosen", /AUTOMATION_STALE_ATTEMPT_THRESHOLD_SECONDS/.test(serviceCode) && !/= 900\b/.test(serviceCode));
check("status literals are centralized in the read layer", (() => {
  const banned = /"(dead_letter|retry_scheduled|matched_preview)"/;
  return clientSources.every((s) => !banned.test(stripComments(s)));
})());
check("status constants mirror the database constraints", /AUTOMATION_JOB_STATUS/.test(serviceCode) && /COMMUNICATION_MESSAGE_STATUS/.test(serviceCode) && /WEBHOOK_PROCESSING_STATUS/.test(serviceCode));
check("the lead queue predicate is not-resolved rather than an allow-list", /\.neq\("queue_status", LEAD_QUEUE_RESOLVED\)/.test(serviceCode));
check("the incident class vocabulary is closed and validated", /isOperationalIncidentClass/.test(serviceCode) && /isOperationalIncidentClass\(query\.incidentClass\)/.test(serviceCode));
check("all five automation incident classes are covered", ["automation.dead_letter", "automation.failed", "automation.uncertain", "automation.retry_overdue", "automation.processing_stale"].every((k) => service.includes(`"${k}"`)));
check("both communication incident classes are covered", ["communication.failed", "communication.dead_letter"].every((k) => service.includes(`"${k}"`)));
check("both webhook incident classes are covered", ["webhook.failed", "webhook.rejected"].every((k) => service.includes(`"${k}"`)));
check("both lead assignment queue classes are covered", ["lead_assignment.queue_unresolved", "lead_assignment.queue_overdue"].every((k) => service.includes(`"${k}"`)));
check("count and list share one predicate builder", /descriptor\s*\.apply\(base, clock\)/.test(serviceCode.replace(/\s+/g, " ").replace(/descriptor \.apply/g, "descriptor.apply")) || /\.apply\(base, clock\)/.test(serviceCode));

// ── 12. Truthfulness ───────────────────────────────────────────────────────
check("no fabricated randomness anywhere", allSources.every((s) => !/Math\.random/.test(s)));
check("no fabricated health score, uptime or trend", !/healthScore|uptimePercent|trendPercent|slaPercent|deliveryRate/i.test(allCode));
check("recovery liveness is stated as an inference", /Recovery may be delayed/.test(service));
check("no source claims an external system is down", !/n8n is down|provider is down|worker is dead|is offline/i.test(allCode));
check("the inference names its own limits", /no external system was contacted/i.test(service));
check("a proven zero is distinguished from an unreadable source in the UI", /proven zero/i.test(incidents));
check("no secret or destination is ever selected", !/destination_hash|destination_masked|access_token|api_key|service_role/i.test(serviceCode));
check("server logs carry the error class only, never the message", /name: safe\?\.name \?\? "Error"/.test(serviceCode) && !/error\.message/.test(serviceCode));
check("the browser never receives a raw database error", /could not be loaded\. Please retry/.test(route));

// ── 13. Existing evidence routes only ──────────────────────────────────────
check("every evidence route already exists", (() => {
  const hrefs = [...serviceCode.matchAll(/evidenceHref: "([^"]+)"/g)].map((m) => m[1]);
  const existing = new Set([
    "/admin/whatsapp?tab=automation",
    "/admin/whatsapp?tab=messages",
    "/admin/whatsapp?tab=provider",
    "/admin/lead-distribution",
  ]);
  return hrefs.length > 0 && hrefs.every((h) => existing.has(h));
})());
// Anchored to a quoted ROUTE string so a module path such as
// "@/components/admin/operations/operationsTypes" is not mistaken for one.
check("no per-incident detail route is fabricated", !/["'`]\/admin\/(operations\/[a-z]|incidents|jobs)/.test(allCode));

// ── 14. Shared admin system reuse ──────────────────────────────────────────
check("the workspace renders through AdminPrimitives", clientSources.filter((s) => /from "\.\.\/AdminPrimitives"/.test(s)).length >= 2);
check("tabs use the accessible shared Tabs primitive", /<Tabs/.test(shell) && /<TabPanel/.test(shell));
check("paging uses the shared Pagination control", /<Pagination/.test(incidents));
check("the shell does not print its own h1", /titleHidden/.test(shell));
check("dark qfa surface classes are used", /qfa-panel|qfa-focus/.test(overview + incidents + attention));

console.log(`\nQF-MVP-70.01 operations control center: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
