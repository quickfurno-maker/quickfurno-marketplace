// ============================================================================
// QF-MVP-70.04 — Phase 70 FINAL CERTIFICATION harness.
//
// Offline: no database, no network, no provider call, no secret read, no n8n,
// no Meta, no auth bypass. This harness certifies the MERGED Phase 70 surface
// (70.01 + 70.02 + 70.03) as one contract and locks the phase for freeze.
//
// It is deliberately a NEGATIVE certification. 70.01/70.02/70.03 each prove
// what their own slice adds; this one proves what the finished phase must
// never do — no weaker role, no second mutation plane, no fabricated zero, no
// unbounded or per-row read, no migration, no RPC, no env var, no Meta send,
// no n8n call, no recovery execution, and no claim the evidence cannot carry.
//
// SOURCE-AWARE, NOT TEXT-AWARE. Every containment assertion runs against
// COMMENT-STRIPPED source. The Phase 70 files document the very identifiers
// they must not call — `safeCount`, `adminUpdateMarketplaceRuntimeSetting`,
// `head: true`, `?? 0` all appear in prose — so a naive text scan would either
// fail on honest documentation or pass on a real call hidden beside it.
// ============================================================================
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (p) => readFileSync(join(root, p), "utf8");

/** Source with block and line comments removed. Used for every assertion about
 *  what the CODE does, so documentation of a forbidden identifier can never be
 *  mistaken for a call to it. */
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

// ── Sources under certification ────────────────────────────────────────────
const route = read("app/admin/operations/page.tsx");
const opsService = read("services/adminOperationsService.ts");
const launchService = read("services/adminLaunchControlService.ts");
const shell = read("components/admin/operations/OperationsControlCenter.tsx");
const overview = read("components/admin/operations/OperationsOverviewTab.tsx");
const incidents = read("components/admin/operations/OperationsIncidentsTab.tsx");
const drawer = read("components/admin/operations/OperationsIncidentDrawer.tsx");
const readiness = read("components/admin/operations/OperationsLaunchReadiness.tsx");
const controlState = read("components/admin/operations/OperationsControlState.tsx");
const types = read("components/admin/operations/operationsTypes.ts");
const attention = read("components/admin/AttentionCenter.tsx");
const adminConfig = read("components/admin/adminConfig.ts");
const actions = read("app/actions.ts");
const pkg = JSON.parse(read("package.json"));

const routeCode = stripComments(route);
const opsCode = stripComments(opsService);
const launchCode = stripComments(launchService);

/** Everything that ships to the BROWSER. `operationsTypes.ts` is included: it
 *  carries no "use client" of its own but is imported by client components, so
 *  it lands in the client bundle and is held to the same rule. */
const clientSources = [
  ["OperationsControlCenter.tsx", shell],
  ["OperationsOverviewTab.tsx", overview],
  ["OperationsIncidentsTab.tsx", incidents],
  ["OperationsIncidentDrawer.tsx", drawer],
  ["OperationsLaunchReadiness.tsx", readiness],
  ["OperationsControlState.tsx", controlState],
  ["operationsTypes.ts", types],
  ["AttentionCenter.tsx", attention],
];

/** Every source the Phase 70 workspace owns. */
const phase70 = [
  ["page.tsx", route],
  ["adminOperationsService.ts", opsService],
  ["adminLaunchControlService.ts", launchService],
  ...clientSources,
];
const phase70Code = phase70.map(([, s]) => stripComments(s));

/** Parse ES import statements: `import [type] [default,] [{…}] from "spec";` */
const IMPORT_RE =
  /import\s+(type\s+)?(?:[\w*$]+\s*,?\s*)?(?:\{[^}]*\}\s*)?from\s+"([^"]+)"/g;
function importsOf(source) {
  return [...stripComments(source).matchAll(IMPORT_RE)].map((m) => ({
    typeOnly: Boolean(m[1]),
    spec: m[2],
  }));
}

/** The body of a named function/const, so ordering can be proved inside it
 *  without an import list at the top of the file skewing every index. */
function bodyOf(source, startMarker, endMarker) {
  const from = source.indexOf(startMarker);
  if (from < 0) return "";
  const to = endMarker ? source.indexOf(endMarker, from) : -1;
  return source.slice(from, to < 0 ? undefined : to);
}

console.log("QF-MVP-70.04 final certification — offline, negative-boundary\n");

// ===========================================================================
// 1. AUTH / RBAC
// ===========================================================================
console.log("── AUTH / RBAC ──");

const routeBody = bodyOf(routeCode, "export default async function AdminOperationsPage");
const LOADERS = [
  "getOperationsOverview(",
  "getOperationsIncidentPage(",
  "getOperationsLaunchSnapshot(",
];

// 1 — /admin/operations remains Superadmin-gated SERVER-side.
check("the operations route is a server component", !/^\s*"use client"/m.test(route));
check("the route reads the admin session on the server", /getAdminSession\(\)/.test(routeBody));
check(
  "an unauthenticated visitor is redirected before anything else",
  /if\s*\(!session\.isLoggedIn\)\s*redirect\("\/admin\/login"\)/.test(routeBody),
);
check(
  "a non-superadmin is redirected — superadmin is proved, not assumed",
  /if\s*\(!session\.isSuperadmin\)\s*redirect\("\/admin\/login\?error=unauthorized"\)/.test(routeBody),
);
check(
  "the operations route gates exactly as the rest of admin does",
  /if\s*\(!session\.isSuperadmin\)\s*redirect\("\/admin\/login\?error=unauthorized"\)/.test(
    stripComments(read("app/admin/[section]/page.tsx")),
  ),
);

// 2 — authorization happens BEFORE any operational loader runs.
const iSession = routeBody.indexOf("getAdminSession()");
const iSuperadmin = routeBody.indexOf("!session.isSuperadmin");
const iFirstLoader = Math.min(
  ...LOADERS.map((l) => {
    const i = routeBody.indexOf(l);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  }),
);
check("the session is read before any loader is called", iSession >= 0 && iSession < iFirstLoader);
check(
  "the superadmin guard precedes every operational loader",
  iSuperadmin >= 0 && iFirstLoader < Number.MAX_SAFE_INTEGER && iSuperadmin < iFirstLoader,
);
check(
  "every operational loader lives after the guard, inside the same request",
  LOADERS.every((l) => {
    const i = routeBody.indexOf(l);
    return i < 0 || i > iSuperadmin;
  }),
);

// 3 — client components cannot import a privileged Supabase or server client.
check(
  "no client component imports the service_role client",
  clientSources.every(([, s]) => !importsOf(s).some((i) => /lib\/supabase|adminClient/.test(i.spec))),
);
check(
  "no client component names adminClient at all",
  clientSources.every(([, s]) => !/\badminClient\b/.test(stripComments(s))),
);
check(
  "no client component imports server-only",
  clientSources.every(([, s]) => !/import\s+"server-only"/.test(stripComments(s))),
);
check(
  "every client import of a service is TYPE-ONLY, so no server module is bundled",
  clientSources.every(([, s]) =>
    importsOf(s)
      .filter((i) => /^@?\/?services\//.test(i.spec) || i.spec.startsWith("@/services/"))
      .every((i) => i.typeOnly),
  ),
);
check(
  "both services are server-only modules",
  /import\s+"server-only"/.test(opsCode) && /import\s+"server-only"/.test(launchCode),
);
check("no client component reads the admin session", clientSources.every(([, s]) => !/getAdminSession/.test(s)));

// 4 — no Operations-specific weaker role was introduced.
// "Operations Admin" ALREADY EXISTS in the pre-existing role vocabulary. The
// real hazard is not inventing a role — it is quietly accepting that weaker
// one for this route. The route must require Superadmin and nothing less.
check("the pre-existing role vocabulary is unchanged by Phase 70", /"Operations Admin"/.test(actions));
check(
  "no Phase 70 source accepts the weaker Operations Admin role",
  phase70.every(([, s]) => !/Operations Admin/.test(s)),
);
check(
  "no Phase 70 source introduces a role name, role check or RBAC family",
  phase70Code.every((s) => !/AdminRoleName|adminRole\s*===|ADMIN_ROLES|hasRole\(|requireRole\(/.test(s)),
);
check(
  "the route never settles for isAdmin where isSuperadmin is required",
  !/session\.isAdmin/.test(routeBody),
);
check(
  "the nav entry is presentation only — it grants nothing",
  /key: "operations"/.test(adminConfig) && !/isSuperadmin|adminRole/.test(stripComments(adminConfig)),
);

// 5 — an unauthorized request receives no operational data.
check(
  "redirect() is the guard mechanism, so no code below it can run",
  /import\s*\{\s*redirect\s*\}\s*from\s*"next\/navigation"/.test(routeCode),
);
check(
  "the payload starts as the tab alone and is filled only after the guard",
  /let payload: OperationsControlCenterPayload = \{ tab \};/.test(routeBody) &&
    routeBody.indexOf("let payload") > iSuperadmin,
);
check(
  "no operational data is read at module scope",
  !LOADERS.some((l) => {
    const i = routeCode.indexOf(l);
    return i >= 0 && i < routeCode.indexOf("export default async function AdminOperationsPage");
  }),
);

// ===========================================================================
// 2. READ-ONLY AUTHORITY
// ===========================================================================
console.log("\n── READ-ONLY AUTHORITY ──");

const MUTATION_RE = /\.(insert|update|upsert|delete)\s*\(/;

// 6 — the 70.01/70.02 incident surfaces hold no mutation authority.
check(
  "neither read service writes a row",
  ![opsCode, launchCode].some((s) => MUTATION_RE.test(s)),
);
// The browser layer cannot write because it holds no database client AT ALL —
// a stronger statement than scanning it for verb names, and one that does not
// confuse a URLSearchParams.delete() with a row deletion.
check(
  "no browser-side source can reach the database at all",
  clientSources.every(([, s]) => !/adminClient|\.from\(|\.rpc\(/.test(stripComments(s))),
);
check(
  "the route itself issues no query — it calls the read layer only",
  !/adminClient|\.from\(/.test(routeCode),
);
check("no Phase 70 source calls an RPC", phase70Code.every((s) => !/\.rpc\s*\(/.test(s)));
check(
  "the incident read layer never imports the fail-open counter",
  !/safeCount/.test(opsCode) && !/safeCount/.test(launchCode),
);
check(
  "no Phase 70 source imports a writer, executor or dispatch service",
  phase70.every(([, s]) =>
    importsOf(s).every((i) => !/services\/(automation|lead|vendor|client|communication)\w*Service/.test(i.spec)),
  ),
);
check(
  "no incident client renders a retry, cancel, pause, resume or resolve control",
  [drawer, incidents, overview, attention].every(
    (s) => !/>\s*(Retry|Cancel|Pause|Resume|Resolve|Acknowledge|Dismiss|Send|Activate|Arm)\s*</i.test(s),
  ),
);
check(
  "the drawer states its authority boundary in fixed copy",
  /No retry, cancel, send, provider, or runtime-setting authority is exposed here\./.test(drawer),
);

// 7 — incident detail is never an arbitrary fetch by URL-selected raw id.
check(
  "detail resolves from the payload this request already loaded",
  /findIncidentInPool\(/.test(routeCode) && /resolveSelection\(/.test(routeCode),
);
check(
  "findIncidentInPool is a pure in-memory lookup, not a query",
  (() => {
    const body = bodyOf(
      opsCode,
      "export function findIncidentInPool",
      "export interface OperationalRecoveryInference",
    );
    return body.includes("pool.find(") && !/await|\.from\(|adminClient/.test(body);
  })(),
);
check(
  "there is no by-id read of any table anywhere in the read layer",
  !/\.eq\("id",/.test(opsCode) && !/\.single\(\)|\.maybeSingle\(\)/.test(opsCode),
);
check(
  "a requested id outside the loaded pool fails closed to not_in_view",
  /return \{ state: "not_in_view", requestedId \};/.test(routeCode),
);
check(
  "the drawer fetches nothing of its own",
  !/fetch\s*\(|useEffect|useSWR|useQuery/.test(stripComments(drawer)),
);
check(
  "the raw requested id is length-bounded before it reaches the payload",
  /MAX_INCIDENT_ID_LENGTH/.test(routeCode) && /trimmed\.length > MAX_INCIDENT_ID_LENGTH/.test(routeCode),
);

// 8 — 70.03 duplicates no existing mutation authority.
check(
  "the canonical marketplace writer is never called",
  !/\b(admin)?[uU]pdateMarketplaceRuntimeSetting\s*\(/.test(launchCode),
);
check(
  "the canonical AOS writer is never called",
  !/setAosN8nMasterRouterSetting\s*\(/.test(launchCode),
);
check(
  "the canonical lead-queue action is never invoked",
  !/adminRecheckLeadAssignmentQueue\s*\(|processDueLeadAssignmentQueue\s*\(/.test(launchCode),
);
check(
  "the launch layer reads the provider policy and never writes it",
  /communication_provider_runtime_policies/.test(launchCode) && !MUTATION_RE.test(launchCode),
);
check(
  "no server action or route handler is declared in the workspace",
  phase70Code.every((s) => !/"use server"|export async function (GET|POST|PATCH|PUT|DELETE)\b/.test(s)),
);

// 9 — existing controls are reused and DEEP-LINKED, never re-implemented.
const CONTROL_HREFS = [...launchCode.matchAll(/href: "([^"]+)"/g)].map((m) => m[1]);
const REGISTERED_SECTIONS = new Set(
  [...adminConfig.matchAll(/href: "(\/admin\/[^"]+)"/g)].map((m) => m[1]),
);
check("exactly four controls are surfaced", CONTROL_HREFS.length === 4);
check(
  "every control href resolves to a REGISTERED canonical admin section",
  CONTROL_HREFS.length === 4 &&
    CONTROL_HREFS.every((h) => REGISTERED_SECTIONS.has(h.split("?")[0])),
);
check(
  "control rows route with a Link and expose no handler",
  /<Link/.test(controlState) && !/onClick|onChange|onSubmit/.test(stripComments(controlState)),
);
check(
  "no launch client renders a toggle, save or confirm control",
  [readiness, controlState].every(
    (s) => !/<ToggleSwitch|<PrimaryButton|<DangerButton|<ConfirmDialog|<form\b/.test(stripComments(s)),
  ),
);

// 10 — WhatsApp / Meta stays observation and advisory only.
const whatsappBase = bodyOf(launchCode, "const WHATSAPP_PROVIDER_BASE", "async function readWhatsAppProviderControl");
check("the WhatsApp control is not actionable", /actionable: false/.test(whatsappBase));
check("the WhatsApp control is labelled Observation only", /actionLabel: "Observation only"/.test(whatsappBase));
check("the WhatsApp control is advisory, so it cannot gate the verdict", /impact: "advisory"/.test(whatsappBase));
check(
  "the WhatsApp control links to the read-only evidence surface",
  /href: "\/admin\/whatsapp\?tab=provider"/.test(whatsappBase),
);
// `metadata` in the route is Next.js page metadata, so the rule is placed where
// the risk actually lives: the PROJECTION. No select list may name a column that
// can carry a token, a destination or free-form provider payload.
check(
  "no select list anywhere names a secret-bearing or free-form column",
  [...opsCode.matchAll(/\.select\("([^"]*)"/g), ...launchCode.matchAll(/\.select\("([^"]*)"/g)]
    .map((m) => m[1])
    .every((cols) => !/token|secret|api_key|password|phone|waba|metadata|payload|credential/i.test(cols)),
);
check(
  "the provider projection deliberately omits the free-form metadata column",
  !/metadata/.test(launchCode.slice(launchCode.indexOf("readWhatsAppProviderControl"))),
);

// ===========================================================================
// 3. FAIL-CLOSED
// ===========================================================================
console.log("\n── FAIL-CLOSED ──");

// 11 — an unreadable count is null, never zero.
check(
  "an uncountable read returns null plus a fault, never 0",
  /return \{ \.\.\.shared, count: null, fault: "UNAVAILABLE", oldest: null \};/.test(opsCode) &&
    /return \{ \.\.\.shared, count: null, fault: faultFor\(error\), oldest: null \};/.test(opsCode),
);
check(
  "no count is ever coerced to zero",
  phase70Code.every((s) => !/count[\w.]*\s*(\?\?|\|\|)\s*0/.test(s)),
);
check(
  "a bounded real select is used, never a head-count that hides a missing table",
  !/head:\s*true/.test(opsCode) && !/head:\s*true/.test(launchCode) && /count: "exact"/.test(opsCode),
);
check(
  "HEALTHY is unreachable while any class is unread or uncounted",
  /if \(classes\.some\(\(entry\) => entry\.fault !== null \|\| entry\.count === null\)\) return "UNAVAILABLE";/.test(
    opsCode,
  ),
);
check(
  "an unknown count renders as an explicit Unavailable, not a figure",
  /count === null \? null :/.test(stripComments(overview)) &&
    /<span className="sr-only">Unavailable<\/span>/.test(overview),
);

// 12 — an unreadable required control source cannot produce READY.
const verdictBody = bodyOf(launchCode, "export function deriveLaunchReadiness", "export async function getOperationsLaunchSnapshot");
check(
  "unreadable BLOCKING controls are collected separately from disabled ones",
  /unreadableControls = blocking[\s\S]*?state === "UNAVAILABLE"/.test(verdictBody),
);
check(
  "an unreadable blocking control forces UNAVAILABLE",
  /if \(unreadableControls\.length > 0 \|\| overview\.overallHealth === "UNAVAILABLE"\)/.test(verdictBody),
);
check(
  "an unreadable control source is UNKNOWN, never a default",
  /state: "UNAVAILABLE"/.test(launchCode) && /sourceStatus: "UNAVAILABLE"/.test(launchCode),
);
check(
  "READ, DEFAULT and UNAVAILABLE are three distinct facts, never collapsed",
  /"READ"[\s\S]{0,400}"DEFAULT"[\s\S]{0,400}"UNAVAILABLE"/.test(launchService),
);
check(
  "the control panel tells the reader that Unavailable is not 'off' or 'safe'",
  /it is never assumed\s*\n?\s*to be off, on, or safe\./.test(controlState.replace(/\s+/g, " ")) ||
    /never assumed to be off, on, or safe/.test(controlState.replace(/\s+/g, " ")),
);

// 13 — the verdict precedence is strict and source-ordered.
const iBlocked = verdictBody.indexOf('verdict: "BLOCKED"');
const iAttention = verdictBody.indexOf('verdict: "ATTENTION"');
const iUnavailable = verdictBody.indexOf('verdict: "UNAVAILABLE"');
const iReady = verdictBody.indexOf('verdict: "READY"');
check("all four verdicts are reachable in the derivation", [iBlocked, iAttention, iUnavailable, iReady].every((i) => i >= 0));
check("precedence holds: BLOCKED before ATTENTION", iBlocked >= 0 && iBlocked < iAttention);
check("precedence holds: ATTENTION before UNAVAILABLE", iAttention >= 0 && iAttention < iUnavailable);
check("precedence holds: UNAVAILABLE before READY", iUnavailable >= 0 && iUnavailable < iReady);
check("READY is the final fallthrough — nothing can promote to it later", iReady === Math.max(iBlocked, iAttention, iUnavailable, iReady));
check(
  "the verdict vocabulary is frozen and exactly these four",
  /LAUNCH_READINESS_VERDICTS = Object\.freeze\(\[\s*"BLOCKED",\s*"ATTENTION",\s*"UNAVAILABLE",\s*"READY",?\s*\]/.test(
    launchCode,
  ),
);
check(
  "the verdict is derived per request and persisted nowhere",
  !MUTATION_RE.test(launchCode) && !/readiness_/.test(launchCode),
);

// 14 — READY is explicitly scoped to Core Operations.
check(
  "the READY label carries its scope",
  /READY: "Core operations ready"/.test(types),
);
check(
  "the READY reason claims Core operations only, under the controls evaluated",
  /Core operations are ready under the controls evaluated here/.test(verdictBody),
);
check(
  "a single scope disclosure is declared once and shared",
  /export const READINESS_SCOPE_DISCLOSURE =/.test(types),
);
check(
  "the disclosure states WhatsApp and Meta do not gate this verdict",
  /WhatsApp and Meta readiness are tracked separately and do not gate this verdict\./.test(types),
);
// The rule belongs on SHIPPED text. The readiness header legitimately quotes the
// very phrase it exists to refuse ("would be read as 'QuickFurno is ready to
// launch'"), and documenting the trap must not be mistaken for falling into it.
check(
  "no SHIPPED string claims full launch, Pune launch or Meta certification",
  phase70Code.every(
    (s) => !/launch certified|ready to launch|fully launched|pune launch|launch certification is complete/i.test(s),
  ),
);

// 15 — a missing or invalid incident URL state fails closed.
check(
  "a non-string incident parameter yields null",
  /if \(typeof raw !== "string"\) return null;/.test(routeCode),
);
check("an empty or over-long incident id yields null", /if \(!trimmed \|\| trimmed\.length > MAX_INCIDENT_ID_LENGTH\) return null;/.test(routeCode));
check('no requested id resolves to state "none", not to a guess', /if \(!requestedId\) return \{ state: "none" \};/.test(routeCode));
check(
  "an unknown tab falls back to overview rather than reaching the read layer",
  /: "overview";/.test(routeCode) && /OPERATIONS_TABS as readonly string\[\]\)\.includes\(raw\)/.test(routeCode),
);
check(
  "an unknown incident class falls back to the default before PostgREST",
  /isOperationalIncidentClass\(query\.incidentClass\)[\s\S]{0,80}: DEFAULT_INCIDENT_CLASS;/.test(opsCode),
);
check(
  "the not-in-view panel assembles no field from an unverified lookup",
  /Nothing is shown rather than detail assembled from an unverified lookup\./.test(drawer),
);

// ===========================================================================
// 4. DATA / PERFORMANCE
// ===========================================================================
console.log("\n── DATA / PERFORMANCE ──");

const opsFroms = (opsCode.match(/\.from\(/g) ?? []).length;
const launchFroms = (launchCode.match(/\.from\(/g) ?? []).length;

// 16 — no unbounded operational read exists.
check("the incident layer holds exactly two query sites", opsFroms === 2);
check(
  "the summary read is bounded to a single oldest row",
  /\.order\(descriptor\.openedAtColumn, \{ ascending: true, nullsFirst: false \}\)\s*\.limit\(1\)/.test(opsCode),
);
check(
  "the list read is bounded by the shared paging range",
  /\.range\(from, to\)/.test(opsCode) && /pageRange\(page\)/.test(opsCode) && /boundPage\(query\.page\)/.test(opsCode),
);
check("paging reuses the canonical admin paging authority", importsOf(opsService).some((i) => /adminPaging/.test(i.spec)));
check(
  "every launch control read is bounded to one row",
  launchFroms === 3 && (launchCode.match(/\.limit\(1\)/g) ?? []).length === 3,
);
check(
  "no operational read is issued without a bound",
  opsFroms + launchFroms ===
    (opsCode.match(/\.limit\(1\)|\.range\(from, to\)/g) ?? []).length +
      (launchCode.match(/\.limit\(1\)/g) ?? []).length,
);

// 17 — there is no per-row / N+1 detail path.
check(
  "no query is issued inside a map, forEach or for-of body",
  [opsCode, launchCode].every((s) => !/\.(map|forEach)\([^)]*\)\s*=>\s*[\s\S]{0,200}?adminClient\(/.test(s)),
);
check(
  "the overview fans out over the CLOSED class vocabulary, not over rows",
  /OPERATIONAL_INCIDENT_CLASSES\.map\(\(key\) =>[\s\S]{0,120}readClassSummary\(/.test(opsCode),
);
check(
  "the class fan-out is concurrent, not a sequential per-class loop",
  /const summaries = await Promise\.all\(/.test(opsCode),
);
check(
  "the three control reads are concurrent, not sequential",
  /await Promise\.all\(\[\s*readAutoAssignmentControl\(\),\s*readAosForwardingControl\(\),\s*readWhatsAppProviderControl\(\),?\s*\]\)/.test(
    launchCode,
  ),
);
check(
  "opening incident detail issues no read at all",
  (() => {
    const body = bodyOf(routeCode, "function resolveSelection", "export default async function");
    return !/await|adminClient|\.from\(/.test(body);
  })(),
);

// 18 — the attention queue is projected, with zero new reads.
check(
  "the projection takes the summaries the overview already read",
  /function projectAttentionIncidents\(\s*summaries: readonly OperationalClassSummary\[\],?\s*\)/.test(opsCode),
);
check(
  "the projection performs no query, no await and no client call",
  (() => {
    const body = bodyOf(opsCode, "function projectAttentionIncidents", "export function findIncidentInPool");
    return !/await|adminClient|\.from\(/.test(body);
  })(),
);
check(
  "the overview passes its own summaries into the projection",
  /attentionIncidents: projectAttentionIncidents\(summaries\)/.test(opsCode),
);
check(
  "launch health is arithmetic over the overview, with no read of its own",
  (() => {
    const body = bodyOf(launchCode, "export function deriveLaunchHealth", "export function deriveLaunchReadiness");
    return body.length > 0 && !/await|adminClient|\.from\(/.test(body);
  })(),
);
check(
  "the launch snapshot is handed the overview instead of re-reading it",
  /getOperationsLaunchSnapshot\(\s*overview: OperationsOverview,?\s*\)/.test(launchCode) &&
    /launch: await getOperationsLaunchSnapshot\(overview\)/.test(routeCode),
);
check(
  "a partial sum stays UNKNOWN rather than understating the real number",
  /function sumProven\(/.test(launchCode) && /if \(typeof value !== "number"\) return null;/.test(launchCode),
);

// 19 — the lead queue overlap de-duplicates overdue vs unresolved correctly.
check(
  "overdue is critical and unresolved is info, so overdue always outranks it",
  /"lead_assignment\.queue_overdue": \{[\s\S]{0,600}?severity: "critical"/.test(opsCode) &&
    /"lead_assignment\.queue_unresolved": \{[\s\S]{0,600}?severity: "info"/.test(opsCode),
);
check(
  "duplicate identity is the UNDERLYING row, with the class prefix stripped",
  /incident\.id\.slice\(incident\.class\.length \+ 1\)/.test(opsCode),
);
check(
  "ranking happens BEFORE de-duplication, so the survivor is the higher-ranked one",
  (() => {
    const body = bodyOf(opsCode, "function projectAttentionIncidents", "export function findIncidentInPool");
    const iSort = body.indexOf(".sort(compareAttentionIncidents)");
    const iSeen = body.indexOf("seen.has(");
    return iSort >= 0 && iSeen >= 0 && iSort < iSeen;
  })(),
);
check(
  "the subsystem TOTAL excludes the superset class so a lead is not counted twice",
  /NON_ADDITIVE_CLASSES[\s\S]{0,120}"lead_assignment\.queue_unresolved"/.test(opsCode) && /isAdditive\(/.test(opsCode),
);
check(
  "de-duplication touches the attention queue alone, never the class counts",
  /suppression applies to the founder attention queue alone/.test(opsService),
);

// 20 — the stale threshold comes from the canonical recovery contract.
check(
  "the stale threshold is imported from the canonical automation contract",
  importsOf(opsService).some(
    (i) => i.spec.includes("lib/automation/recoveryContract"),
  ) && /AUTOMATION_STALE_ATTEMPT_THRESHOLD_SECONDS/.test(opsCode),
);
check(
  "no Phase 70 source declares a stale threshold of its own",
  phase70Code.every(
    (s) => !/(STALE|stale)[\w]*(THRESHOLD|Threshold)[\w]*\s*[:=]\s*\d/.test(s),
  ),
);
check(
  "the threshold is surfaced, not re-derived, in the recovery inference",
  /staleThresholdSeconds: AUTOMATION_STALE_ATTEMPT_THRESHOLD_SECONDS/.test(opsCode),
);
check(
  "no client component invents an operational threshold or target",
  clientSources.every(([, s]) => !/threshold\s*[:=]\s*\d|slaSeconds|targetSeconds/i.test(stripComments(s))),
);

// ===========================================================================
// 5. SAFETY CONTAINMENT
// ===========================================================================
console.log("\n── SAFETY CONTAINMENT ──");

const migrations = readdirSync(join(root, "supabase", "migrations")).filter((f) => f.endsWith(".sql"));

// 21 / 22 — migration containment.
// QF-MVP-75.01 RE-PIN: 99 -> 100. This phase still adds no migration of its own;
// the new file belongs to QF-MVP-75.01 (20260815000000_qf_mvp_75_01_matchcore_binding_rank_order.sql). Phase 70 behaviour is unchanged.
// QF-MVP-75.02 RE-PIN: 100 -> 101. This phase still adds no migration of its own;
// the geo normalization / PostGIS shortlist foundation (20260816000000) is the only
// addition. Exact equality, never loosened.
// QF-MVP-80.03 RE-PIN: 101 -> 102. This phase still adds no migration of its own;
// the audit_logs forward repair (20260817000000) is the only addition. Exact
// equality, never loosened.
// QF-MVP-80.14A RE-PIN: 102 -> 103, adding ONLY the SOURCE-PENDING Meta production
// activation authority (20260903040000). This phase still adds no migration of its
// own; the count is re-pinned by exact equality, never loosened.
check("migration count remains 103", migrations.length === 103);
check(
  "no Phase 70 migration exists",
  !migrations.some((f) => /qf_mvp_70|mvp_?70|operations_control|launch_control|launch_readiness|attention_queue/i.test(f)),
);
check(
  "no Phase 70 source creates a table, function, index, policy or trigger",
  phase70Code.every(
    (s) => !/create (table|or replace function|function|index|policy|trigger|view)/i.test(s),
  ),
);

// 23 — no new RPC.
check("no Phase 70 source calls any RPC", phase70Code.every((s) => !/\.rpc\s*\(/.test(s)));
check(
  "the read layer touches only canonical existing relations",
  (() => {
    const tables = [
      ...opsCode.matchAll(/table: "([a-z_]+)"/g),
      ...launchCode.matchAll(/\.from\("([a-z_]+)"\)/g),
    ].map((m) => m[1]);
    const allowed = new Set([
      // Four canonical incident tables (QF-MVP-70.01) …
      "automation_jobs",
      "communication_messages",
      "communication_webhook_receipts",
      "lead_assignment_queue",
      // … and three canonical control sources (QF-MVP-70.03).
      "marketplace_runtime_settings",
      "aos_runtime_settings",
      "communication_provider_runtime_policies",
    ]);
    return tables.length > 0 && tables.every((t) => allowed.has(t));
  })(),
);

// 24 — no new env var.
check("no Phase 70 source reads process.env", phase70Code.every((s) => !/process\.env/.test(s)));
check(
  "no Phase 70 source names an env-shaped identifier",
  phase70Code.every((s) => !/\bNEXT_PUBLIC_[A-Z_]+|\bSUPABASE_[A-Z_]+|SERVICE_ROLE/.test(s)),
);

// 25 — no Meta mutation, send or provider call.
check("no source reaches the Meta Graph API", phase70.every(([, s]) => !/graph\.facebook\.com/.test(s)));
check("no source performs any network call", phase70Code.every((s) => !/\bfetch\s*\(|axios|XMLHttpRequest/.test(s)));
check(
  "no send, arm, canary or template-submission authority is referenced",
  phase70Code.every(
    (s) =>
      !/sendWhatsApp|sendMessage\(|dispatchMessage|armCanary|activateCanary|submitTemplate|createTemplate|setProviderPolicy/i.test(
        s,
      ),
  ),
);
check(
  "the provider policy is projected without secrets and never written",
  /select\("provider_key, channel, activation_status, outbound_enabled, updated_at"\)/.test(launchCode),
);

// 26 — no n8n call. The AOS SWITCH is read; the ROUTER is never called.
check(
  "no n8n endpoint, webhook or transport URL is referenced",
  phase70Code.every((s) => !/n8n\.[a-z]|\/webhook\/|https?:\/\//.test(s)),
);
// The AOS switch is READ through the canonical resolver. Naming its stored
// setting key and reading its own `shouldCallN8n` verdict are observation; only
// INVOKING a forwarder would be a call, so the rule targets invocation.
check(
  "the AOS resolver is called to READ the two locks, never to forward",
  /resolveAosN8nActivation\(\)/.test(launchCode) &&
    !/\b(dispatchToN8n|forwardToN8n|callN8n|postToN8n|sendToN8n)\s*\(/i.test(launchCode),
);
check(
  "the AOS switch is read through its canonical setting key, not a new one",
  /\.eq\("setting_key", AOS_N8N_MASTER_ROUTER_KEY\)/.test(launchCode),
);
check(
  "no automation transport or signing module is imported",
  phase70.every(([, s]) => importsOf(s).every((i) => !/transportAuth|automationTransportService|transportTypes/.test(i.spec))),
);

// 27 — no recovery execution is introduced.
check(
  "no recovery, reconciliation or execution service is imported",
  phase70.every(([, s]) =>
    importsOf(s).every((i) => !/RecoveryService|ExecutionService|PersistenceService|actionRegistry|retryPolicy/.test(i.spec)),
  ),
);
check(
  "no claim, attempt or finalize authority is called",
  phase70Code.every(
    (s) => !/claim\w*Job|open\w*Attempt|finalize\w*Attempt|executeRecovery|runRecovery|reconcile\w*\(/i.test(s),
  ),
);
check(
  "recovery is READ as an inference and never triggered",
  /function inferRecovery\(/.test(opsCode) && !/triggerRecovery|startRecovery/i.test(opsCode),
);

// 28 — QF-MVP-40 mutation operators are untouched by Phase 70.
check(
  "no Phase 70 source imports or names a QF-MVP-40 one-shot operator",
  phase70Code.every(
    (s) => !/one-shot|oneShot|create-meta-staging|create-actual-staging|repair-meta-staging|activate-meta-staging/i.test(s),
  ),
);
check(
  "no Meta readiness, mapping or account authority is referenced",
  phase70Code.every(
    (s) => !/meta_template_mappings|communication_provider_accounts|readiness_state|canary_state|providerReadiness/i.test(s),
  ),
);
check(
  "the QF-MVP-40 operator scripts have no knowledge of Operations",
  readdirSync(join(root, "scripts", "mvp", "communication"))
    .filter((f) => /^(create|repair|activate|seed)-/.test(f))
    .every((f) => !/adminOperationsService|adminLaunchControlService|admin\/operations/.test(
      readFileSync(join(root, "scripts", "mvp", "communication", f), "utf8"),
    )),
);

// 29 — QF-MVP-50 runtime source is unmodified; only a PURE contract is reused.
check(
  "the ONLY QF-MVP-50 module Phase 70 reuses is the pure recovery contract",
  phase70
    .flatMap(([, s]) => importsOf(s))
    .filter((i) => /lib\/automation\//.test(i.spec))
    .every((i) => i.spec.endsWith("lib/automation/recoveryContract")),
);
check(
  "the reused contract exposes the threshold as a constant, not an executor",
  /export const AUTOMATION_STALE_ATTEMPT_THRESHOLD_SECONDS/.test(read("lib/automation/recoveryContract.ts")),
);
check(
  "the whole Phase 70 import surface is closed to known, non-runtime modules",
  (() => {
    const specs = new Set(phase70.flatMap(([, s]) => importsOf(s)).map((i) => i.spec));
    const allowed = [
      /^next\/(link|navigation)$/,
      /^@\/app\/actions$/,
      /^@\/(components|services)\//,
      /^\.\.?\/(AdminPrimitives|AdminIcon|adminConfig|adminUtils|AttentionCenter|Pagination)$/,
      /^\.\/(Operations\w+|operationsTypes)$/,
      /^\.\.\/lib\/(supabase|errors|adminPaging)$/,
      /^\.\.\/lib\/aos\/runtime\/aosRuntimeSettings$/,
      /^\.\.\/lib\/lead-assignment\/runtimeSettings$/,
      /^\.\.\/lib\/automation\/recoveryContract$/,
      /^\.\/adminOperationsService$/,
    ];
    return [...specs].every((s) => allowed.some((re) => re.test(s)));
  })(),
);

// ===========================================================================
// 6. FOUNDER SEMANTICS
// ===========================================================================
console.log("\n── FOUNDER SEMANTICS ──");

const classKeys = [
  ...bodyOf(opsCode, "OPERATIONAL_INCIDENT_CLASSES = Object.freeze([", "] as const)").matchAll(/"([a-z_]+\.[a-z_]+)"/g),
].map((m) => m[1]);
const whyBlock = bodyOf(types, "const WHY_LISTED", "export function whyListed");
const whyEntries = [...whyBlock.matchAll(/"([a-z_]+\.[a-z_]+)":\s*\n?\s*"([^"]+)"/g)].map((m) => ({
  key: m[1],
  copy: m[2],
}));

// 30 — the why-listed copy is class-specific.
check("the class vocabulary is non-empty and closed", classKeys.length === 11);
check(
  "every incident class has its own why-listed sentence",
  classKeys.every((k) => whyEntries.some((e) => e.key === k)),
);
check("no class shares another class's sentence", new Set(whyEntries.map((e) => e.copy)).size === whyEntries.length);
check(
  "every sentence states only what its own predicate proves",
  whyEntries.length === classKeys.length && whyEntries.every((e) => /^Listed because /.test(e.copy)),
);
check(
  "no sentence leaks storage vocabulary to the founder",
  whyEntries.every((e) => !/\btable\b|\bcolumn\b|\brow id\b|select |postgres/i.test(e.copy)),
);

// 31 — no unsupported permanent-failure or external-outage claim.
const OVERCLAIM =
  /permanently failed|can never|will never|unrecoverable|cannot be recovered|is down\b|outage|is offline|unreachable|vendor (is at )?fault|client (is at )?fault|lost forever/i;
check("no why-listed sentence claims permanent failure", whyEntries.every((e) => !OVERCLAIM.test(e.copy)));
check(
  "no founder-facing surface claims an external system is down",
  [drawer, readiness, controlState, overview, incidents, attention].every((s) => !OVERCLAIM.test(stripComments(s))),
);
check(
  "the recovery note states the inference and its limit in the same breath",
  /This is inferred from job timestamps only; no external system was contacted\./.test(opsService),
);
check(
  "an unreadable job table is reported as 'cannot be assessed', not as failure",
  /Recovery cannot be assessed — the automation job table could not be read\./.test(opsService),
);

// 32 — the Core Operations readiness disclosure stays visible.
check("the readiness panel imports the shared disclosure", /READINESS_SCOPE_DISCLOSURE/.test(stripComments(readiness)));
check("the disclosure is RENDERED, not merely imported", /\{READINESS_SCOPE_DISCLOSURE\}/.test(readiness));
check("the panel is titled as Core Operations readiness", /title="Core Operations Readiness"/.test(readiness));
check(
  "the disclosure sits with the verdict rather than below the fold",
  readiness.indexOf("READINESS_SCOPE_DISCLOSURE}") < readiness.indexOf("<LaunchHealth"),
);
check(
  "an unreadable control raises a visible, role-alert warning",
  /role="alert"/.test(readiness) && /Treat it as unconfirmed, not as clear\./.test(readiness),
);

// 33 — unknown operational facts cannot render as clean zeros.
check(
  "a null launch figure renders Unavailable, never 0",
  /value === null \? \(\s*<span[^>]*>Unavailable<\/span>/.test(readiness.replace(/\s+/g, " ")) ||
    /value === null \?/.test(readiness) && /Unavailable/.test(readiness),
);
check("a null age renders Unknown, never a duration", /seconds === null \?/.test(readiness) && /Unknown/.test(readiness));
check(
  "every formatted figure is guarded by a null or fault test first",
  clientSources.every(([, s]) => {
    const code = stripComments(s);
    return [...code.matchAll(/toLocaleString\("en-IN"\)/g)].every((m) => {
      // Optional chaining, an explicit null test, or a fault branch must sit
      // before the call — a figure is never formatted blind. The window spans a
      // whole ternary: the Unavailable branch a guard protects is itself several
      // lines of JSX, so a short lookback would miss a guard that is really there.
      const before = code.slice(Math.max(0, m.index - 600), m.index);
      return /\?\.toLocaleString|=== null|!== null|\bfault\b|unknownTotal/.test(before);
    });
  }),
);
check(
  "the workspace states its own zero-versus-unknown rule to the reader",
  /never a zero standing in for an unreadable source/.test(shell),
);
check(
  "a not-provisioned source is described as a deployment state, not an empty result",
  /This is a deployment state, not an empty result/.test(types),
);

// 34 — recovery liveness stays an inference / proxy.
check(
  "the read layer states plainly that it cannot claim an external system is down",
  // The statement wraps across a JSDoc block, so leading ` * ` and `//` markers
  // are folded away before matching.
  /cannot and does not claim "n8n is down", "the worker is dead" or "the provider is offline"/.test(
    opsService.replace(/\s*\n\s*(\*|\/\/)\s*/g, " "),
  ),
);
check(
  "recovery liveness is typed as an inference, not a probe result",
  /OperationalRecoveryInference/.test(opsCode) && !/probe|heartbeat|ping/i.test(opsCode),
);
check(
  "the only liveness statement made is that overdue work exists",
  /Recovery may be delayed — overdue retry work exists\./.test(opsService),
);

// ===========================================================================
// 7. PHASE CLOSURE WIRING
// ===========================================================================
console.log("\n── PHASE CLOSURE WIRING ──");

const PHASE_70_SCRIPTS = ["test:mvp:70-01", "test:mvp:70-02", "test:mvp:70-03", "test:mvp:70-04"];
check(
  "all four Phase 70 validators are wired as package commands",
  PHASE_70_SCRIPTS.every((s) => typeof pkg.scripts[s] === "string"),
);
check(
  "every wired Phase 70 validator file exists",
  PHASE_70_SCRIPTS.every((s) => {
    const file = pkg.scripts[s].split(/\s+/).find((t) => t.endsWith(".mjs"));
    return Boolean(file) && existsSync(join(root, file));
  }),
);

const workflowDir = join(root, ".github", "workflows");
const workflowFiles = readdirSync(workflowDir).filter((f) => /\.ya?ml$/.test(f));
const workflows = workflowFiles.map((f) => readFileSync(join(workflowDir, f), "utf8"));
const gate = workflows.join("\n");

check("the repository has exactly one CI workflow", workflowFiles.length === 1);
check(
  "the CI gate runs all four Phase 70 validators",
  PHASE_70_SCRIPTS.every((s) => gate.includes(`npm run ${s}`)),
);
check(
  "the CI gate is bound to the exact PR head SHA, not a synthetic merge commit",
  /github\.event\.pull_request\.head\.sha/.test(gate) && /test "\$ACTUAL_SHA" = "\$EXPECTED_SHA"/.test(gate),
);
check("the CI gate runs on pull requests to main", /pull_request:[\s\S]{0,120}branches:[\s\S]{0,40}- main/.test(gate));
check("the CI gate declares no secret", !/secrets\./.test(gate) && !/\$\{\{\s*secrets/.test(gate));
// Judge the gate by what it EXECUTES. Step names and comments legitimately say
// "no Supabase" and "staging history governance"; only `run:` lines act.
const gateCommands = [...gate.matchAll(/^\s*run:\s*(?:\|)?\s*(.*)$/gm)].map((m) => m[1]);
check(
  "the CI gate executes no staging, provider, deployment or database command",
  gateCommands.every((c) => !/supabase|psql|ngrok|graph\.facebook|curl|n8n|deploy|vercel|ssh|seed:|canary:|repair:|create:.*-once/i.test(c)),
);
check(
  "the CI gate runs no mutation or one-shot operator command",
  gateCommands.every((c) => !/\b(seed|canary|repair|fixture|create|activate|grant)[:-]/i.test(c)),
);
check(
  "the CI gate does not run an operator-credential build",
  !/build:staging:safe/.test(gate) && /npm run build\b/.test(gate),
);
check("the CI gate pins Node 24, which the .ts resolve hook requires", /node-version: '24'/.test(gate));
check("the CI gate grants read-only repository permissions", /permissions:\s*\n\s*contents: read/.test(gate));

// Repository convention for a phase closeout is docs/QF-MVP-<n>-CLOSEOUT.md —
// the precedent is docs/QF-MVP-50-CLOSEOUT.md.
const CLOSEOUT = "docs/QF-MVP-70-CLOSEOUT.md";
check("the Phase 70 closeout document exists", existsSync(join(root, CLOSEOUT)));
if (existsSync(join(root, CLOSEOUT))) {
  const doc = read(CLOSEOUT);
  check("the closeout names all four merged slices", ["70.01", "70.02", "70.03", "70.04"].every((s) => doc.includes(s)));
  check("the closeout carries an explicit freeze statement", /CLOSED\s*\/\s*FROZEN|is CLOSED|FROZEN/.test(doc));
  check("the closeout records the migration count", /\b99\b/.test(doc));
  check(
    "the closeout claims no full launch, Meta or downstream-phase completion",
    !/pune launch (is )?certified|whatsapp is launch-ready|meta is launch-ready|qf-mvp-40 is complete|qf-mvp-75 is complete|qf-mvp-80 is complete/i.test(
      doc,
    ),
  );
  check(
    "the closeout states what Phase 70 does NOT provide",
    /does not (deliver|provide)|out of scope|deferred/i.test(doc),
  );
  check(
    "the closeout names the deferred phases explicitly",
    ["QF-MVP-40", "QF-MVP-75", "QF-MVP-80"].every((p) => doc.includes(p)),
  );
}

// ===========================================================================
console.log(`\nQF-MVP-70.04 final certification: ${passed} passed, ${failed} failed`);
console.log("offline: no database, no network, no provider, no secret, no auth bypass");
process.exit(failed === 0 ? 0 : 1);
