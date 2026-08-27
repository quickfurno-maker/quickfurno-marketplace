// ============================================================================
// QF-MVP-70.03 — Launch control consolidation invariants harness.
//
// Offline: no database, no network, no provider call, no secret read, no n8n,
// no Meta. Locks the guarantees this slice adds on top of QF-MVP-70.01/70.02:
//
//   * Operations reports control STATE and routes to canonical control UI —
//     it copies no mutation, adds no server action, and creates no fifth
//     control system
//   * every surfaced control is proved to have an existing canonical source
//     AND an existing canonical home, both named in code
//   * control state fails closed: unreadable is UNKNOWN, never a default
//   * READY is unreachable from partial data
//   * the readiness precedence is BLOCKED > ATTENTION > UNAVAILABLE > READY
//   * launch health derives from the overview already loaded — no second
//     per-class read loop, no invented service-level target, no history
//   * the 70.02 attention queue and incident detail remain intact
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
const launchService = read("services/adminLaunchControlService.ts");
const opsService = read("services/adminOperationsService.ts");
const shell = read("components/admin/operations/OperationsControlCenter.tsx");
const types = read("components/admin/operations/operationsTypes.ts");
const overview = read("components/admin/operations/OperationsOverviewTab.tsx");
const incidents = read("components/admin/operations/OperationsIncidentsTab.tsx");
const drawer = read("components/admin/operations/OperationsIncidentDrawer.tsx");
const readiness = read("components/admin/operations/OperationsLaunchReadiness.tsx");
const controlState = read("components/admin/operations/OperationsControlState.tsx");
const attention = read("components/admin/AttentionCenter.tsx");

const launchCode = stripComments(launchService);
const opsCode = stripComments(opsService);
const routeCode = stripComments(route);

/** Every CLIENT component in the workspace. These ship to the browser. */
const clientSources = [shell, types, overview, incidents, drawer, readiness, controlState, attention];
/** Every source the operations workspace owns. */
const allSources = [route, launchService, opsService, ...clientSources];
const allCode = allSources.map(stripComments).join("\n");
/** The two components QF-MVP-70.03 adds. */
const launchClients = [readiness, controlState];

// ── 1. No new backend, no fifth control system ─────────────────────────────
const migrations = readdirSync(join(root, "supabase", "migrations")).filter((f) => f.endsWith(".sql"));
// QF-MVP-75.01 RE-PIN: 99 -> 100. This phase still adds no migration of its own;
// the new file belongs to QF-MVP-75.01 (20260815000000_qf_mvp_75_01_matchcore_binding_rank_order.sql). Phase 70 behaviour is unchanged.
// QF-MVP-75.02 RE-PIN: 100 -> 101. This phase still adds no migration of its own;
// the geo normalization / PostGIS shortlist foundation (20260816000000) is the only
// addition. Exact equality, never loosened.
check("migration count remains 101", migrations.length === 101);
// Narrow to names THIS phase could plausibly introduce: "control" and
// "readiness" already appear in three pre-existing migration filenames.
check("no launch-control migration was added", !migrations.some((f) => /qf_mvp_70|mvp70|launch_control|launch_readiness/i.test(f)));
check("no source creates a table, function, index or policy", allSources.every((s) => !/create table|create (or replace )?function|create index|create policy/i.test(s)));
check("no new RPC is called anywhere", allSources.every((s) => !/\.rpc\(/.test(stripComments(s))));
check("no new runtime-setting table or key family is introduced", (() => {
  const tables = [...launchCode.matchAll(/\.from\("([a-z_]+)"\)/g)].map((m) => m[1]);
  const allowed = new Set([
    "marketplace_runtime_settings",
    "aos_runtime_settings",
    "communication_provider_runtime_policies",
  ]);
  return tables.length > 0 && tables.every((t) => allowed.has(t));
})());
check("no new kill switch or feature-flag family is introduced", !/featureFlag|FEATURE_FLAG|killSwitch|KILL_SWITCH|newSwitch|launch_mode|launch_enabled/i.test(allCode));
// Case-SENSITIVE: the snake_case forms would be storage names, while the
// upper-case LAUNCH_READINESS_* constants are this phase's own vocabulary.
check("no readiness verdict is persisted", !/readiness_(table|row|cache|state)|launch_readiness|persistReadiness/.test(allCode));
check("the verdict is explicitly derived-only", /stored nowhere|presentation only/i.test(launchService));
check("no new environment variable is introduced", (() => {
  const referenced = [...allCode.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((m) => m[1]);
  return referenced.length === 0;
})());
// `schedule` is excluded: `retry_scheduled` is a canonical job status and
// "scheduled retry time" is the honest description of it.
check("no scheduler, poller or interval is introduced", !/setInterval|setTimeout|cron|requestAnimationFrame/i.test(allCode));

// ── 2. Read-only boundary ──────────────────────────────────────────────────
check("the launch service is server-only", /^import "server-only";/m.test(launchService));
check("the launch service has no write surface", !/\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(/.test(launchCode));
check("the route still has no write surface", !/\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(/.test(routeCode));
check("the incident service is unchanged in its read-only guarantee", !/\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(/.test(opsCode));
// Scoped to IMPORT statements: this phase legitimately names its own
// readWhatsAppProviderControl, which a bare identifier scan would flag.
check("no provider adapter or Meta module is imported", (() => {
  const imports = [...launchCode.matchAll(/^import[\s\S]*?from "([^"]+)";/gm)].map((m) => m[1]);
  return !imports.some((m) => /meta|provider|whatsapp|sms|transport|recovery|runtimeCommunication/i.test(m));
})());
check("no recovery, transport or execution service is imported", !/automationRecoveryService|automationTransportService|automationPersistenceService|automation(Client|Vendor|Campaign)ExecutionService|communicationService|runtimeCommunicationService/.test(launchCode));
check("no outbound HTTP call exists", allSources.every((s) => !/\bfetch\s*\(|axios|graph\.facebook\.com/.test(stripComments(s))));
check("no client component imports the service_role client", clientSources.every((s) => !/adminClient|lib\/supabase/.test(s)));
check("no client component invokes a server action", clientSources.every((s) => !/useTransition|startTransition|from "@\/app\/actions"|<form\b/.test(stripComments(s))));
check(
  "launch client components import the read layer for TYPES only",
  launchClients.every((source) => {
    let ok = true;
    for (const marker of ['"@/services/adminLaunchControlService"', '"@/services/adminOperationsService"']) {
      let index = source.indexOf(marker);
      while (index !== -1) {
        const start = source.lastIndexOf("import", index);
        if (start === -1 || !/^import\s+type\b/.test(source.slice(start, index))) ok = false;
        index = source.indexOf(marker, index + marker.length);
      }
    }
    return ok;
  }),
);
check("no new API route was added for launch control", (() => {
  const apiDir = join(root, "app", "api", "admin");
  return !readdirSync(apiDir).some((entry) => /launch|readiness|control/i.test(entry));
})());
check("no new server action was added", (() => {
  const actions = read("app/actions.ts");
  return !/launchControl|LaunchReadiness|adminLaunchControlService|OperationsLaunchSnapshot/.test(actions);
})());

// ── 3. No duplicate mutation authority ─────────────────────────────────────
check("the canonical marketplace writer is never referenced", !/updateMarketplaceRuntimeSetting|adminUpdateMarketplaceRuntimeSetting/.test(launchCode));
check("the canonical AOS writer is never referenced", !/setAosN8nMasterRouterSetting/.test(launchCode));
check("the canonical lead-queue actions are never invoked", !/adminRecheckLeadAssignmentQueue\s*\(|adminProcessDueLeadAssignmentQueue\s*\(|processDueLeadAssignmentQueue\s*\(|recheckQueuedLead\s*\(/.test(launchCode));
check("no launch client renders a toggle, switch or save control", launchClients.every((s) => !/<ToggleSwitch|<PrimaryButton|<DangerButton|<ConfirmDialog|onChange=\{|onClick=\{/.test(stripComments(s))));
check("control rows route with a link, never an action", /<Link/.test(controlState) && !/onClick/.test(stripComments(controlState)));
check("a control with no mutation surface says Observation only", /actionLabel: "Observation only"/.test(launchCode) && /actionable: false/.test(launchCode));
check("every control href is an EXISTING admin route", (() => {
  const hrefs = [...launchCode.matchAll(/href: "([^"]+)"/g)].map((m) => m[1]);
  const existing = new Set([
    "/admin/settings",
    "/admin/automations",
    "/admin/whatsapp?tab=provider",
    "/admin/lead-distribution",
  ]);
  return hrefs.length === 4 && hrefs.every((h) => existing.has(h));
})());

// ── 4. Every surfaced control has a proven canonical source and home ───────
// The audit is recorded in the service header so a reviewer can check each
// claim against source without re-deriving it.
check("the control audit is documented in the service", /OPERATIONS IS A COCKPIT, NOT A SECOND CONTROL PLANE/.test(launchService));
check("the audit names each control's canonical state source", ["marketplace_runtime_settings", "aos_runtime_settings", "communication_provider_runtime_policies"].every((t) => launchService.includes(t)));
check("the audit names each control's canonical UI", ["/admin/settings", "/admin/automations", "/admin/whatsapp?tab=provider", "/admin/lead-distribution"].every((h) => launchService.includes(h)));
check("the audit names each control's canonical writer", /adminUpdateMarketplaceRuntimeSetting/.test(launchService) && /aos-runtime-settings/.test(launchService) && /adminRecheckLeadAssignmentQueue/.test(launchService));
check("the marketplace control reuses the canonical normalizer", /normalizeMarketplaceSettings\(/.test(launchCode));
check("the AOS control reuses the canonical two-lock resolver", /resolveAosN8nActivation\(\)/.test(launchCode));
check("the AOS two-lock rule is NOT reimplemented", !/bothEnabled\s*&&/.test(launchCode) && !/n8nEnabled\s*&&/.test(launchCode));
check("the WhatsApp send rule is applied exactly as the policy states it", /outboundEnabled && \(activationStatus === "canary" \|\| activationStatus === "active"\)/.test(launchCode));
check("the provider projection selects no secret or payload column", (() => {
  const select = launchCode.match(/\.select\("provider_key[^"]*"\)/);
  return Boolean(select) && !/metadata|token|secret|credential/i.test(select[0]);
})());
check("no secret, token or credential is read anywhere", !/access_token|api_key|service_role|bearer|password|secret/i.test(launchCode));
check("no raw environment value is rendered", clientSources.every((s) => !/N8N_ENABLED|N8N_OUTBOUND_WEBHOOK_ENABLED|SUPABASE_|process\.env/.test(s)));

// ── 5. Fail-closed control state ───────────────────────────────────────────
check("an unreadable control resolves to UNAVAILABLE", /state: "UNAVAILABLE"/.test(launchCode));
check("an unreadable control is never given a default state", /function unreadableControl[\s\S]{0,700}sourceStatus: "UNAVAILABLE"/.test(launchCode));
check("every control read checks its own fault before using a value", (() => {
  const guards = launchCode.match(/if \(source\.fault\) return unreadableControl\(/g) ?? [];
  return guards.length === 3;
})());
check("read, default and unreadable are three distinct facts", /"READ"[\s\S]{0,200}"DEFAULT"[\s\S]{0,200}"UNAVAILABLE"/.test(launchService));
check("the fail-open behaviour of the canonical readers is documented", /fail OPEN/i.test(launchService));
check("a missing relation is distinguished from a failed read", /isMissingRelationError/.test(launchCode) && /NOT_PROVISIONED/.test(launchCode));
check("the UI renders an unavailable control state explicitly", /UNAVAILABLE: "Unavailable"/.test(types));
// Asserted over the FUNCTION BODY: the return type annotation lists every
// tone, so a proximity scan over the whole file proves nothing.
check("an unavailable control is not tinted as healthy", (() => {
  const start = types.indexOf("export function controlStateTone");
  if (start === -1) return false;
  const rest = types.slice(start);
  const end = rest.indexOf("\nexport ", 1);
  const body = end === -1 ? rest : rest.slice(0, end);
  const emeraldBranch = body.match(/return "emerald"/g) ?? [];
  return (
    /if \(state === "ACTIVE"\) return "emerald"/.test(body) &&
    emeraldBranch.length === 1 &&
    /return "slate"/.test(body)
  );
})());

// ── 6. Readiness precedence and unreachability of READY ────────────────────
check("the verdict vocabulary is closed", /LAUNCH_READINESS_VERDICTS = Object\.freeze\(\[\s*\n?\s*"BLOCKED",\s*\n?\s*"ATTENTION",\s*\n?\s*"UNAVAILABLE",\s*\n?\s*"READY",/.test(launchCode.replace(/\r/g, "")));
check("BLOCKED is evaluated first", (() => {
  const body = launchCode.slice(launchCode.indexOf("export function deriveLaunchReadiness"));
  return body.indexOf('verdict: "BLOCKED"') < body.indexOf('verdict: "ATTENTION"');
})());
check("ATTENTION is evaluated before UNAVAILABLE", (() => {
  const body = launchCode.slice(launchCode.indexOf("export function deriveLaunchReadiness"));
  return body.indexOf('verdict: "ATTENTION"') < body.indexOf('verdict: "UNAVAILABLE"');
})());
check("UNAVAILABLE is evaluated before READY", (() => {
  const body = launchCode.slice(launchCode.indexOf("export function deriveLaunchReadiness"));
  return body.indexOf('verdict: "UNAVAILABLE"') < body.indexOf('verdict: "READY"');
})());
check("BLOCKED requires a proven DISABLED launch-critical control", /impact === "blocking"[\s\S]{0,400}state === "DISABLED"/.test(launchCode));
check("an unreadable launch-critical control forces UNAVAILABLE", /impact === "blocking"[\s\S]{0,600}state === "UNAVAILABLE"/.test(launchCode) && /unreadableControls\.length > 0/.test(launchCode));
check("an unreadable overview also forces UNAVAILABLE", /overview\.overallHealth === "UNAVAILABLE"/.test(launchCode));
check("READY is the final fallthrough only", (() => {
  const body = launchCode.slice(launchCode.indexOf("export function deriveLaunchReadiness"));
  const readyAt = body.indexOf('verdict: "READY"');
  // Nothing may be returned after READY inside the function.
  return readyAt !== -1 && !/verdict: "(BLOCKED|ATTENTION|UNAVAILABLE)"/.test(body.slice(readyAt));
})());
check("the UI warns when the verdict rests on incomplete control data", /unconfirmed, not as clear/i.test(readiness));

// ── 6b. The verdict's SCOPE is stated, not implied ─────────────────────────
//
// A bare "Ready" beside a deliberately disabled WhatsApp provider reads as full
// launch certification. The verdict covers Core operational health and the
// launch-critical controls evaluated here — nothing wider — so the title, the
// READY label and a disclosure beside the badge must all say so.
check("the panel is titled as CORE operations readiness", /title="Core Operations Readiness"/.test(readiness));
check("the READY label carries its own scope", /READY: "Core operations ready"/.test(types));
check("a scope disclosure is declared once and shared", /export const READINESS_SCOPE_DISCLOSURE/.test(types));
check("the disclosure names Core operational health", /Core operational health/.test(types));
check("the disclosure states WhatsApp and Meta are tracked separately", /WhatsApp and Meta readiness are tracked separately/.test(types));
check("the disclosure states they do not gate this verdict", /do not gate this verdict/.test(types));
check("the disclosure is rendered beside the verdict", /\{READINESS_SCOPE_DISCLOSURE\}/.test(readiness));
check("the READY reason is scoped to Core operations", /Core operations are ready under the controls evaluated here/.test(launchCode));
check("no unqualified full-launch claim is rendered anywhere", (() => {
  // Phrase-level bans only: "Launch-critical" and "launch verdict" are legitimate
  // and must not trip this, so the patterns match completion claims, not the word.
  const banned = [
    /ready to launch/i,
    /launch[- ]ready/i,
    /\bPune\b/i,
    /all (launch )?systems (are )?(ready|go)/i,
    /fully ready/i,
    /cleared for launch/i,
    /launch certif/i,
  ];
  return clientSources.concat([launchService]).every((s) => {
    const code = stripComments(s);
    return !banned.some((re) => re.test(code));
  });
})());
check("the health panel is scoped too, so the two titles agree", /title="Core operations health"/.test(readiness));
check("WhatsApp remains advisory and read-only after the scope correction", (() => {
  const block = launchCode.slice(launchCode.indexOf("const WHATSAPP_PROVIDER_BASE"));
  const head = block.slice(0, 400);
  return /impact: "advisory"/.test(head) && /actionable: false/.test(head) && /actionLabel: "Observation only"/.test(head);
})());
check("the WhatsApp provider is advisory so it cannot pin the verdict", (() => {
  const block = launchCode.slice(launchCode.indexOf("const WHATSAPP_PROVIDER_BASE"));
  return /impact: "advisory"/.test(block.slice(0, 400));
})());
check("automatic lead assignment is the launch-critical control", (() => {
  const block = launchCode.slice(launchCode.indexOf("const AUTO_ASSIGNMENT_BASE"));
  return /impact: "blocking"/.test(block.slice(0, 400));
})());

// ── 7. Launch health: derived, bounded, no invented SLA ────────────────────
check("launch health takes the overview as an argument", /export function deriveLaunchHealth\(overview: OperationsOverview\)/.test(launchCode));
check("launch health performs no query", (() => {
  const start = launchCode.indexOf("export function deriveLaunchHealth");
  const rest = launchCode.slice(start);
  const end = rest.indexOf("\nexport ", 1);
  return !/adminClient\(|\.from\(|\.select\(/.test(end === -1 ? rest : rest.slice(0, end));
})());
check("the snapshot re-reads no incident source", (() => {
  const start = launchCode.indexOf("export async function getOperationsLaunchSnapshot");
  return start !== -1 && !/getOperationsOverview\(|readClassSummary\(/.test(launchCode.slice(start));
})());
check("there is no second per-incident-class read loop", !/OPERATIONAL_INCIDENT_CLASSES/.test(launchCode));
check("the incident service still has exactly one per-class read loop", (() => {
  const loops = opsCode.match(/OPERATIONAL_INCIDENT_CLASSES\.map\(\([\s\S]{0,200}?readClassSummary\(/g) ?? [];
  return loops.length === 1;
})());
check("a partial sum stays UNKNOWN rather than understating", /function sumProven[\s\S]{0,300}return null/.test(launchCode));
check("every launch health figure is nullable", (() => {
  const start = launchService.indexOf("export interface LaunchHealthFacts");
  const block = launchService.slice(start, launchService.indexOf("}", start));
  const fields = [...block.matchAll(/readonly \w+: ([^;]+);/g)].map((m) => m[1].trim());
  // Every field is nullable except the already-proven subsystem counter.
  return fields.length === 9 && fields.filter((f) => f === "number | null").length === 8;
})());
check("no launch health value is coerced to zero", !/\?\? 0/.test(launchCode));
check("the UI renders an unknown count as Unavailable, never zero", /value === null \? \(/.test(readiness) && /Unavailable/.test(readiness));
check("the UI renders an unknown age as Unknown, never zero", /seconds === null \? \(/.test(readiness) && /Unknown/.test(readiness));
// SLA, case-sensitive: an /sla/i scan matches every `text-slate-*` class.
check("no service-level target or duration threshold is invented", !/SLA|slaSeconds|thresholdMinutes|targetMinutes|breachedAfter|within \d+ (minute|hour)/.test(allCode));
check("aging uses only the existing canonical age fields", /ageSeconds/.test(launchCode) && !/Date\.now\(\)|new Date\(\)\.getTime/.test(launchCode));
check("the frozen stale threshold is not redefined", !/= 900\b|STALE_THRESHOLD\s*=/.test(launchCode));
// Matched on RENDERED elements: the word "trend" also appears in this
// phase's own copy stating that no trend is shown.
check("no chart, sparkline or trend is rendered", launchClients.every((s) => !/<svg|<canvas|<Chart|ChartCard|Sparkline|<ProgressBar|<DonutPanel/.test(stripComments(s))));
check("no metric history is stored or read", !/metric_history|metrics_history|snapshot_history|previousValue/i.test(allCode));

// ── 8. Authorization unchanged ─────────────────────────────────────────────
check("the route still uses the canonical admin session guard", /getAdminSession\(\)/.test(routeCode));
check("the route still redirects a logged-out visitor", /if \(!session\.isLoggedIn\) redirect\("\/admin\/login"\)/.test(routeCode));
check("the route still requires superadmin server-side", /if \(!session\.isSuperadmin\) redirect\("\/admin\/login\?error=unauthorized"\)/.test(routeCode));
check("the guard runs BEFORE the launch snapshot loader", routeCode.indexOf("isSuperadmin") < routeCode.indexOf("await getOperationsLaunchSnapshot("));
check("the guard runs BEFORE every operations loader", routeCode.indexOf("isSuperadmin") < routeCode.indexOf("await getOperationsOverview("));
check("no new admin role or RBAC family is introduced", !/isOperationsAdmin|operationsRole|OPERATIONS_ADMIN|Operations Admin|launchAdmin/.test(allCode));
check("no client component reads the admin session", clientSources.every((s) => !/getAdminSession/.test(s)));

// ── 9. QF-MVP-40 containment ───────────────────────────────────────────────
check("no QF-MVP-40 one-shot operator is referenced", !/create-actual-staging|create-meta-staging|repair-meta-staging|activate-meta-staging|canary:mvp|r8a|r8b|r8c/i.test(allCode));
check("no Meta readiness, mapping or canary mutation is referenced", !/qf_arm_meta|qf_disable_meta_canary|subscribed_apps|message_templates/i.test(allCode));
check("no send path is referenced", !/sendWhatsApp|dispatchMessage|sendMessage|deliverMessage/i.test(allCode));
check("no n8n endpoint or transport route is referenced", !/claim_v1|complete_v1|recover_v1|reconcile_v1|execute_(client|vendor|campaign)|QF_N8N|transportAuth/i.test(allCode));
check("the provider policy is read, never written", (() => {
  const start = launchCode.indexOf("async function readWhatsAppProviderControl");
  const rest = launchCode.slice(start);
  const end = rest.indexOf("\n// ===");
  const body = end === -1 ? rest : rest.slice(0, end);
  return /\.select\(/.test(body) && !/\.insert\(|\.update\(|\.upsert\(|\.delete\(/.test(body);
})());

// ── 10. QF-MVP-70.02 remains intact ────────────────────────────────────────
check("the attention queue is still rendered", /<AttentionCenter items=\{items\} \/>/.test(overview));
check("the derived attention projection is unchanged", /attentionIncidents: projectAttentionIncidents\(summaries\)/.test(opsCode));
check("cross-class duplicate suppression is unchanged", /if \(seen\.has\(key\)\) continue;/.test(opsCode));
check("the incident detail panel is still mounted", /<OperationsIncidentDrawer/.test(shell));
check("incident selection still resolves from the loaded payload", /resolveSelection\(requestedIncidentId, overview\.attentionIncidents\)/.test(routeCode) && /resolveSelection\(requestedIncidentId, incidents\.rows\)/.test(routeCode));
check("incidents remain structurally non-actionable", /readonly actionable: false/.test(opsService));
// Matched on ACTION LABELS, not prose: "Retry time already passed" describes a
// stored timestamp, whereas a control would render the word as its own label.
check("no retry / cancel / pause / resume / send control exists anywhere", clientSources.every((s) => {
  const code = stripComments(s);
  const asJsxLabel = />\s*(Retry|Pause|Resume|Cancel|Acknowledge|Send|Force)\b[^<]*</;
  const asPropLabel = /(actionLabel|label|children|title)[:=]\s*"(Retry|Pause|Resume|Cancel|Acknowledge|Send|Force)\b/;
  return !asJsxLabel.test(code) && !asPropLabel.test(code);
}));
check("the launch section renders above the queue without replacing it", (() => {
  const body = stripComments(overview);
  return body.indexOf("<OperationsLaunchReadiness") < body.indexOf("<AttentionCenter");
})());

// ── 11. Shared admin system reuse ──────────────────────────────────────────
check("the launch components render through AdminPrimitives", launchClients.every((s) => /from "\.\.\/AdminPrimitives"/.test(s)));
check("no fabricated randomness anywhere", allSources.every((s) => !/Math\.random/.test(s)));
check("no fabricated health score or uptime figure", !/healthScore|uptimePercent|availabilityPercent|deliveryRate/i.test(allCode));

console.log(`\nQF-MVP-70.03 launch control: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
