// ============================================================================
// QF-MVP-70.02 — Attention queue + incident detail invariants harness.
//
// Offline: no database, no network, no provider call, no secret read, no n8n,
// no Meta. Locks the STRUCTURAL and BEHAVIOURAL guarantees this slice adds on
// top of the QF-MVP-70.01 read-only operations workspace:
//
//   * the founder attention queue is DERIVED from the summaries already read —
//     no second per-class query loop, no persistence, no new state machine
//   * the ranking is deterministic: severity, then age, then a stable id
//   * a cross-class duplicate row appears once, under the more specific class
//   * detail resolves from the ALREADY-LOADED payload; there is no by-id read
//   * an unresolvable selection fails closed instead of fabricating detail
//   * the panel states its read-only authority and exposes no control
//   * the Superadmin guard still runs before every loader
//   * no migration, no env var, no write surface, no provider/n8n/recovery reach
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
const shell = read("components/admin/operations/OperationsControlCenter.tsx");
const types = read("components/admin/operations/operationsTypes.ts");
const overview = read("components/admin/operations/OperationsOverviewTab.tsx");
const incidents = read("components/admin/operations/OperationsIncidentsTab.tsx");
const drawer = read("components/admin/operations/OperationsIncidentDrawer.tsx");
const attention = read("components/admin/AttentionCenter.tsx");

const serviceCode = stripComments(service);
const routeCode = stripComments(route);
const drawerCode = stripComments(drawer);
const attentionCode = stripComments(attention);

/** Every CLIENT component in the workspace. These ship to the browser. */
const clientSources = [shell, types, overview, incidents, drawer, attention];
/** Every source QF-MVP-70.01 and 70.02 own. */
const allSources = [route, service, ...clientSources];
const allCode = allSources.map(stripComments).join("\n");

// ── 1. No new backend, no new control system ───────────────────────────────
const migrations = readdirSync(join(root, "supabase", "migrations")).filter((f) => f.endsWith(".sql"));
// QF-MVP-75.01 RE-PIN: 99 -> 100. This phase still adds no migration of its own;
// the new file belongs to QF-MVP-75.01 (20260815000000_qf_mvp_75_01_matchcore_binding_rank_order.sql). Phase 70 behaviour is unchanged.
// QF-MVP-75.02 RE-PIN: 100 -> 101. This phase still adds no migration of its own;
// the geo normalization / PostGIS shortlist foundation (20260816000000) is the only
// addition. Exact equality, never loosened.
check("migration count is unchanged at 101", migrations.length === 101);
check("QF-MVP-70 added no migration", !migrations.some((f) => /qf_mvp_70|mvp70|operations|incident/i.test(f)));
check("no source creates a table", allSources.every((s) => !/create table/i.test(s)));
check("no source creates a function, index or policy", allSources.every((s) => !/create (or replace )?function|create index|create policy/i.test(s)));
check("no incident table or incident model is persisted", !/operational_incidents|operations_incidents|incident_log|incident_state/i.test(allCode));
check("no new environment variable is introduced", (() => {
  const referenced = [...allCode.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((m) => m[1]);
  return referenced.length === 0;
})());
check("no new runtime setting, feature flag or kill switch is introduced", !/runtime_settings|RUNTIME_SETTING|featureFlag|FEATURE_FLAG|killSwitch|KILL_SWITCH/i.test(allCode));

// ── 2. Read-only boundary preserved ────────────────────────────────────────
check("the read layer still imports server-only", /^import "server-only";/m.test(service));
check("the read layer still has no write surface", !/\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(/.test(serviceCode));
check("the route still has no write surface", !/\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(/.test(routeCode));
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
check("the read layer never imports safeCount", !/safeCount/.test(serviceCode));
check("no source performs an outbound HTTP call", allSources.every((s) => !/\bfetch\s*\(|axios|graph\.facebook\.com/.test(stripComments(s))));
check("no client component imports the service_role client", clientSources.every((s) => !/adminClient|lib\/supabase/.test(s)));
check("no client component invokes a server action", clientSources.every((s) => !/useTransition|startTransition|from "@\/app\/actions"|<form\b/.test(stripComments(s))));
check(
  "client components import the read layer for TYPES only",
  clientSources.every((source) => {
    const marker = '"@/services/adminOperationsService"';
    let index = source.indexOf(marker);
    while (index !== -1) {
      const start = source.lastIndexOf("import", index);
      if (start === -1) return false;
      if (!/^import\s+type\b/.test(source.slice(start, index))) return false;
      index = source.indexOf(marker, index + marker.length);
    }
    return true;
  }),
);
check("no new API route was added for incident detail", (() => {
  const apiDir = join(root, "app", "api", "admin");
  return !readdirSync(apiDir).some((entry) => /operation|incident/i.test(entry));
})());

// ── 3. Attention projection derives from existing summaries ────────────────
check("the overview exposes a derived attention queue", /readonly attentionIncidents: readonly OperationalIncident\[\]/.test(service));
check("the projection reads the summaries' own oldest incident", /summaries\s*\n?\s*\.map\(\(entry\) => entry\.oldest\)/.test(serviceCode.replace(/\r/g, "")));
check("the projection is computed from the already-read summaries", /attentionIncidents: projectAttentionIncidents\(summaries\)/.test(serviceCode));
check("a class that was never read contributes no incident", /incident is OperationalIncident => incident !== null/.test(serviceCode));
check("the projection is not persisted", !/projectAttentionIncidents[\s\S]{0,1200}(\.insert\(|\.upsert\(|\.update\()/.test(serviceCode));

// The overview must still perform EXACTLY ONE read per class and nothing more.
// `OPERATIONAL_INCIDENT_CLASSES.map` is also used for the PURE vocabulary list,
// so the read loop is identified by the primitive it calls, not by the map.
check("there is exactly one per-class READ loop in the whole service", (() => {
  const loops = serviceCode.match(/OPERATIONAL_INCIDENT_CLASSES\.map\(\([\s\S]{0,200}?readClassSummary\(/g) ?? [];
  return loops.length === 1;
})());
check("only one call site invokes the per-class read primitive", (() => {
  const calls = serviceCode.match(/readClassSummary\(/g) ?? [];
  // one declaration + one call inside getOperationsOverview
  return calls.length === 2;
})());
check("the attention projection issues no query of its own", (() => {
  const start = serviceCode.indexOf("function projectAttentionIncidents");
  const end = serviceCode.indexOf("function findIncidentInPool");
  if (start === -1 || end === -1 || end <= start) return false;
  return !/adminClient\(|\.from\(|\.select\(/.test(serviceCode.slice(start, end));
})());

// ── 4. Deterministic ranking ───────────────────────────────────────────────
check("a severity rank table exists", /ATTENTION_SEVERITY_RANK[\s\S]{0,160}critical: 0[\s\S]{0,60}warning: 1[\s\S]{0,60}info: 2/.test(serviceCode));
check("the comparator ranks severity first", /const bySeverity =\s*\n?\s*ATTENTION_SEVERITY_RANK\[left\.severity\] - ATTENTION_SEVERITY_RANK\[right\.severity\]/.test(serviceCode.replace(/\r/g, "")));
check("the comparator then ranks the older incident first", /return right\.ageSeconds - left\.ageSeconds/.test(serviceCode));
check("an unknown age is never promoted above a proven one", /if \(left\.ageSeconds === null\) return 1;\s*\n?\s*if \(right\.ageSeconds === null\) return -1;/.test(serviceCode.replace(/\r/g, "")));
check("the comparator ends in a stable id tie-break", /return left\.id\.localeCompare\(right\.id\)/.test(serviceCode));
check("no commercial signal enters the ranking", (() => {
  const start = serviceCode.indexOf("function compareAttentionIncidents");
  const end = serviceCode.indexOf("function projectAttentionIncidents");
  if (start === -1 || end === -1) return false;
  return !/revenue|package|credit|amount|price|tier|vip/i.test(serviceCode.slice(start, end));
})());
check("the shared list component ranks by severity, age, value, then id", /SEVERITY_ORDER\.indexOf[\s\S]{0,900}rightAge - leftAge[\s\S]{0,400}a\.id\.localeCompare\(b\.id\)/.test(attentionCode));
check("an unknown age sorts last in the shared list too", /if \(leftAge === null\) return 1;\s*\n?\s*if \(rightAge === null\) return -1;/.test(attentionCode.replace(/\r/g, "")));

// ── 5. Cross-class duplicate suppression ───────────────────────────────────
check("underlying row identity is derived from the incident id", /function sourceRowKey[\s\S]{0,320}incident\.id\.slice\(incident\.class\.length \+ 1\)/.test(serviceCode));
check("the row key is scoped by subsystem", /\$\{incident\.subsystem\}\|/.test(serviceCode));
check("de-duplication happens over that row key", /const key = sourceRowKey\(incident\);\s*\n?\s*if \(seen\.has\(key\)\) continue;/.test(serviceCode.replace(/\r/g, "")));
check("ranking runs BEFORE de-duplication so the survivor is the higher-ranked class", (() => {
  const body = serviceCode.slice(serviceCode.indexOf("function projectAttentionIncidents"));
  const sortAt = body.indexOf(".sort(compareAttentionIncidents)");
  const dedupeAt = body.indexOf("seen.has(key)");
  return sortAt !== -1 && dedupeAt !== -1 && sortAt < dedupeAt;
})());
check("queue_overdue outranks queue_unresolved by severity, so overdue survives", (() => {
  // The suppression rule is only correct if the two classes' severities really
  // do order overdue first. Prove it from the descriptors, not from prose.
  const overdue = serviceCode.slice(serviceCode.indexOf('"lead_assignment.queue_overdue": {'));
  const unresolved = serviceCode.slice(serviceCode.indexOf('"lead_assignment.queue_unresolved": {'));
  return /severity: "critical"/.test(overdue.slice(0, 900)) && /severity: "info"/.test(unresolved.slice(0, 900));
})());
check("class counts and paged lists are NOT changed by the suppression", (() => {
  // The dedupe set is confined to the projection function: `sourceRowKey` is
  // DECLARED once and INVOKED once, and the single invocation is inside the
  // projection — so no count or paged list can be narrowed by it.
  const start = serviceCode.indexOf("function projectAttentionIncidents");
  const end = serviceCode.indexOf("export function findIncidentInPool");
  if (start === -1 || end === -1 || end <= start) return false;
  const inside = serviceCode.slice(start, end);
  const mentions = serviceCode.match(/sourceRowKey/g) ?? [];
  return (
    /new Set<string>\(\)/.test(inside) &&
    /sourceRowKey\(incident\)/.test(inside) &&
    mentions.length === 2
  );
})());

// ── 6. Selection resolves from the loaded payload, and fails closed ────────
check("a closed selection vocabulary exists", /"none"[\s\S]{0,400}"resolved"[\s\S]{0,400}"not_in_view"/.test(types));
check("the resolver is a pool lookup, not a query", /export function findIncidentInPool[\s\S]{0,400}pool\.find\(/.test(serviceCode));
check("the resolver performs no database access", (() => {
  // Comments are stripped from `serviceCode`, so the function is bounded by the
  // next top-level declaration rather than by a banner comment.
  const start = serviceCode.indexOf("export function findIncidentInPool");
  if (start === -1) return false;
  const rest = serviceCode.slice(start);
  const end = rest.indexOf("\nexport ", 1);
  return !/adminClient\(|\.from\(|\.select\(/.test(end === -1 ? rest : rest.slice(0, end));
})());
check("no by-id read exists anywhere in the read layer", !/\.eq\("id",|\.eq\(`id`|maybeSingle\(\)|\.single\(\)/.test(serviceCode));
check("the overview selection is resolved against the derived queue", /resolveSelection\(requestedIncidentId, overview\.attentionIncidents\)/.test(routeCode));
check("the incidents selection is resolved against the loaded page", /resolveSelection\(requestedIncidentId, incidents\.rows\)/.test(routeCode));
check("an unresolvable id fails closed", /return \{ state: "not_in_view", requestedId \}/.test(routeCode));
check("the requested id is length-bounded before it reaches the payload", /MAX_INCIDENT_ID_LENGTH/.test(routeCode) && /trimmed\.length > MAX_INCIDENT_ID_LENGTH/.test(routeCode));
check("the panel renders the fail-closed message", /Incident not available in this view/.test(drawer));
check("the fail-closed branch fabricates no incident field", (() => {
  const start = drawerCode.indexOf("function NotInView");
  const end = drawerCode.indexOf("export function OperationsIncidentDrawer");
  const body = drawerCode.slice(start, end);
  return start !== -1 && !/incident\.(currentStatus|safeCode|openedAt|ageSeconds|entityId)/.test(body);
})());
check("the panel can always be closed", /onClose=\{\(\) => setParam\(OPERATIONS_INCIDENT_PARAM, undefined\)\}/.test(stripComments(shell)));

// ── 7. Detail content ──────────────────────────────────────────────────────
check("detail shows the class label", /description\.label/.test(drawerCode));
check("detail shows severity", /\[\s*"Severity",/.test(drawerCode));
check("detail shows the subsystem", /\[\s*"Subsystem",/.test(drawerCode));
check("detail shows the current status", /\[\s*"Current status",/.test(drawerCode));
check("detail shows the entity type and id", /\[\s*"Entity",/.test(drawerCode) && /\[\s*"Entity ID",/.test(drawerCode));
check("detail shows the class's own opened-at label and timestamp", /description\.openedAtLabel,/.test(drawerCode) && /formatDateTime\(incident\.openedAt\)/.test(drawerCode));
check("detail shows the age", /\["Age", formatAge\(incident\.ageSeconds\)\]/.test(drawerCode));
check("detail shows the safe diagnostic code", /Safe diagnostic code/.test(drawer) && /incident\.safeCode/.test(drawerCode));
check("detail shows the evidence link when one exists", /incident\.evidenceHref/.test(drawerCode));
check("detail states when no evidence route exists", /No dedicated evidence route exists\./.test(drawer));
check("detail carries the class description and why it is listed", /description\.detail/.test(drawerCode) && /whyListed\(incident\.class\)/.test(drawerCode));

// ── 7b. Why-listed copy is class-specific and predicate-bounded ────────────
//
// Severity is a PRIORITY ordering, not incident semantics: two classes can share
// a severity and prove different things (an overdue lead-queue row and a
// dead-lettered job are both `critical`, but only one has stopped being
// retried). The sentence must therefore be keyed by class.
const typesCode = stripComments(types);
const WHY_LISTED_BLOCK = (() => {
  const start = typesCode.indexOf("const WHY_LISTED");
  if (start === -1) return "";
  const end = typesCode.indexOf("});", start);
  return end === -1 ? "" : typesCode.slice(start, end + 3);
})();

check("whyListed is keyed by incident class", /whyListed\(incidentClass: OperationalIncidentClass\)/.test(typesCode));
check("whyListed is NOT derived from severity", (() => {
  const start = typesCode.indexOf("export function whyListed");
  if (start === -1) return false;
  return !/severity/i.test(typesCode.slice(start, start + 300));
})());
check("the why-listed table is exhaustive over the closed class vocabulary", /Readonly<Record<OperationalIncidentClass, string>>/.test(typesCode));
check("all 11 canonical incident classes have why-listed copy", (() => {
  // Sourced from the READ LAYER's own vocabulary, so a future class cannot be
  // added there and silently left without copy here.
  const declared = [...service.matchAll(/^\s{2}"([a-z_]+\.[a-z_]+)",$/gm)].map((m) => m[1]);
  const classes = [...new Set(declared)];
  return classes.length === 11 && classes.every((key) => WHY_LISTED_BLOCK.includes(`"${key}":`));
})());
check("every why-listed line actually explains a listing", (() => {
  const lines = [...WHY_LISTED_BLOCK.matchAll(/"Listed because [^"]+"/g)];
  return lines.length === 11;
})());
check("no why-listed line claims the work will not recover on its own", !/will not resolve on its own|never recover|no automatic recovery|cannot be retried|permanently failed/i.test(WHY_LISTED_BLOCK));
check("no why-listed line blames an external system", !/n8n|provider is|worker is|outage|offline|is down/i.test(WHY_LISTED_BLOCK));
check("no why-listed line blames a vendor or client", !/vendor (fault|error|failed)|client (fault|error|failed)|their fault/i.test(WHY_LISTED_BLOCK));
check("no why-listed line exposes storage vocabulary", !/automation_jobs|communication_messages|communication_webhook_receipts|lead_assignment_queue|next_retry_at|locked_at|processing_status|queue_status|SELECT /i.test(WHY_LISTED_BLOCK));
check("the retired severity-generic copy is gone from the workspace", !/will not resolve on its own|may still be in flight|Listed for visibility/i.test(allCode));
check("detail states the read-only phase authority", /Read-only — no operational action is exposed in this phase\./.test(drawer));
check("detail states observation-only authority", /Observation only/.test(drawer));
check("detail states the exact absent authorities", /No retry, cancel, send, provider, or runtime-setting authority is exposed here\./.test(drawer));
check("no storage vocabulary reaches the founder panel", !/automation_jobs|communication_messages|communication_webhook_receipts|lead_assignment_queue|SELECT |postgrest/i.test(drawerCode));
check("entity types are rendered as plain words", /entityTypeLabel\(/.test(drawerCode) && /automation_job: "Automation job"/.test(types));

// ── 8. Incident table integration ──────────────────────────────────────────
check("the table has a dedicated Details affordance", /<GhostButton[\s\S]{0,240}Details/.test(stripComments(incidents)));
check("the Details affordance is not a whole-row link", !/onRowClick/.test(stripComments(incidents)));
check("the Evidence link is preserved alongside it", /header: "Evidence"/.test(incidents) && /row\.evidenceHref/.test(incidents));
check("pagination is preserved", /<Pagination/.test(incidents));
check("the class selector is preserved", /<SelectFilter/.test(incidents));
check("opening a detail does not reset the page", /key !== "page" && key !== OPERATIONS_INCIDENT_PARAM\) sp\.delete\("page"\)/.test(stripComments(shell)));
check("the selected row is marked active", /isRowActive=\{\(row\) => row\.id === selectedIncidentId\}/.test(incidents));
check("the list read is still bounded by the locked page range", /\.range\(from, to\)/.test(serviceCode));
check("there is still no page-size parameter", !/pageSize\?:/.test(service));

// ── 9. Attention rows open concrete incidents ──────────────────────────────
check("attention rows are built from the derived queue", /overview\.attentionIncidents\.map\(\(incident\) => \[incident\.class, incident\]\)/.test(stripComments(overview)));
check("a row with a concrete incident opens that incident", /incidentSelectionHref\(attentionIncident\.id\)/.test(stripComments(overview)));
check("a row without one falls back to the existing evidence route", /: \(entry\.evidenceHref \?\? undefined\)/.test(stripComments(overview)));
check("the row affordance says which it is", /actionLabel: attentionIncident \? "Open incident" : "Open evidence"/.test(stripComments(overview)));
check("the shared component keeps its default affordance wording", /item\.actionLabel \?\? "Open queue"/.test(attentionCode));
check("the shared component's new fields are optional", /ageSeconds\?: number \| null/.test(attention) && /actionLabel\?: string/.test(attention));
check("the shared component still forces unavailable on a null value", /item\.value === null \? "unavailable" : item\.severity/.test(attentionCode));
check("the shared component is not operations-specific", !/OperationalIncident|adminOperationsService|attentionIncidents/.test(attention));
check("the selection href is built in exactly one place", (() => {
  const builders = allCode.match(/incidentSelectionHref\s*\(/g) ?? [];
  const declarations = types.match(/export function incidentSelectionHref/g) ?? [];
  return declarations.length === 1 && builders.length >= 1;
})());
check("the route path literal is declared once", (() => {
  const literals = allCode.match(/"\/admin\/operations"/g) ?? [];
  return literals.length === 1 && /OPERATIONS_BASE_PATH = "\/admin\/operations"/.test(types);
})());

// ── 10. Authorization unchanged ────────────────────────────────────────────
check("the route still uses the canonical admin session guard", /getAdminSession\(\)/.test(routeCode));
check("the route still redirects a logged-out visitor", /if \(!session\.isLoggedIn\) redirect\("\/admin\/login"\)/.test(routeCode));
check("the route still requires superadmin server-side", /if \(!session\.isSuperadmin\) redirect\("\/admin\/login\?error=unauthorized"\)/.test(routeCode));
check(
  "the guard still runs BEFORE every loader",
  routeCode.indexOf("isSuperadmin") < routeCode.indexOf("await getOperationsOverview(") &&
    routeCode.indexOf("isSuperadmin") < routeCode.indexOf("await getOperationsIncidentPage("),
);
// Compared against the CALL SITE: the resolver is declared at module scope,
// which necessarily precedes the guard and would make this assertion vacuous.
check(
  "selection is resolved AFTER the guard, inside the same request",
  routeCode.indexOf("isSuperadmin") < routeCode.indexOf("resolveSelection(requestedIncidentId,"),
);
check("no new admin role or RBAC family is introduced", !/isOperationsAdmin|operationsRole|OPERATIONS_ADMIN|Operations Admin/.test(allCode));
check("no client component reads the admin session", clientSources.every((s) => !/getAdminSession/.test(s)));

// ── 11. Still no operational control ───────────────────────────────────────
check("incidents remain structurally non-actionable", /readonly actionable: false/.test(service) && /actionable: false/.test(serviceCode));
check("no retry / cancel / pause / resume / acknowledge control exists", clientSources.every((s) => !/\b(Retry|Cancel job|Pause|Resume|Acknowledge|Dismiss|Resolve incident|Force)\b/.test(stripComments(s))));
check("no acknowledgement or ownership state is introduced", !/acknowledgedBy|assignedTo|ownerId|resolvedBy|snoozedUntil/i.test(allCode));
check("no QF-MVP-40 one-shot operator is referenced", !/create-actual-staging|create-meta-staging|repair-meta-staging|activate-meta-staging|canary:mvp|r8a|r8b|r8c/i.test(allCode));
check("no Meta readiness, mapping or canary mutation is referenced", !/qf_arm_meta|qf_disable_meta_canary|subscribed_apps|message_templates/i.test(allCode));
check("no send path is referenced", !/sendWhatsApp|dispatchMessage|sendMessage|deliverMessage/i.test(allCode));
check("no n8n endpoint or transport route is referenced", !/n8n|claim_v1|complete_v1|recover_v1|reconcile_v1|execute_(client|vendor|campaign)/i.test(allCode));
check("no signed transport secret is referenced", !/QF_N8N|inboundSecret|responseSecret|transportAuth/i.test(allCode));
check("no secret or destination is ever selected", !/destination_hash|destination_masked|access_token|api_key|service_role/i.test(serviceCode));

// ── 12. Shared admin system reuse ──────────────────────────────────────────
check("the panel reuses the shared accessible Drawer primitive", /<Drawer/.test(drawer) && /from "\.\.\/AdminPrimitives"/.test(drawer));
check("the panel does not hand-roll a dialog", !/role="dialog"|aria-modal/.test(drawer));
check("the panel uses the shared InfoGrid rows", /<InfoGrid/.test(drawer));
check("the panel headings are real headings", /<h3/.test(drawer));
check("no fabricated randomness anywhere", allSources.every((s) => !/Math\.random/.test(s)));
check("no fabricated health score, uptime or trend", !/healthScore|uptimePercent|trendPercent|slaPercent|deliveryRate/i.test(allCode));

console.log(`\nQF-MVP-70.02 attention queue + incident detail: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
