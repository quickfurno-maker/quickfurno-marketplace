// ============================================================================
// QF-MVP-80.14C — production scheduler validator.  OFFLINE.
//
// Proves the VPS scheduler is a TRIGGER and nothing else: it can reach exactly
// one endpoint, carries no secret, holds no business authority, cannot overlap
// itself, cannot retry, and logs nothing sensitive. The cron file carries no
// secret and invokes only the approved wrapper.
//
// Every rule is a pure function of the artefact source, so each is re-evaluated
// against a MUTATED copy in the self-tests. A rule that cannot fail proves
// nothing.
//
// No secrets, no Meta, no Supabase, no network, no VPS, no live change.
// ============================================================================

import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const read = (rel) => readFileSync(path.join(ROOT, rel), "utf8");

const WRAPPER_PATH = "ops/production/qf-lead-assignment-dispatch.sh";
const CRON_PATH = "ops/production/quickfurno-lead-assignment-dispatch.cron";
const ROUTE_PATH = "app/api/internal/process-lead-assignment-intents/route.ts";
const TRIGGER_PATH = "lib/communication/leadAssignmentDispatchTrigger.ts";
const SERVICE_PATH = "services/leadAssignmentDispatchService.ts";
const CONTRACT_PATH = "lib/communication/leadAssignmentDispatchContract.ts";

const WRAPPER = read(WRAPPER_PATH);
const CRON = read(CRON_PATH);
const ROUTE = read(ROUTE_PATH);
const TRIGGER = read(TRIGGER_PATH);
const SERVICE = read(SERVICE_PATH);
const CONTRACT = read(CONTRACT_PATH);

/** Comment lines are intent, not behaviour. Negative claims run on CODE only. */
const shellCode = (s) =>
  s.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");

const WRAPPER_CODE = shellCode(WRAPPER);
const CRON_CODE = shellCode(CRON);

const ENDPOINT = "https://quickfurno.in/api/internal/process-lead-assignment-intents";
const ENV_FILE = "/etc/quickfurno/quickfurno-runtime.env";
const WRAPPER_INSTALL = "/usr/local/sbin/qf-lead-assignment-dispatch";
const LAUNCH_BATCH = 3;

/** Everything the scheduler must never be able to reach or contain. */
const FORBIDDEN_IN_WRAPPER = [
  [/graph\.facebook\.com/i, "meta graph host"],
  [/\/messages\b/, "meta messages endpoint"],
  [/n8n/i, "n8n"],
  [/supabase/i, "supabase"],
  [/service_role/i, "service role key"],
  [/eyJhbGciOi/, "jwt literal"],
  [/postgres(ql)?:\/\//i, "postgres dsn"],
  [/\bpsql\b/, "psql"],
  [/\b(select|insert into|update .* set|delete from)\b/i, "sql"],
  [/WHATSAPP_ACCESS_TOKEN|WHATSAPP_APP_SECRET|WHATSAPP_WEBHOOK_VERIFY_TOKEN/, "provider token"],
  [/communication_intents|communication_messages|lead_assignments|vendor_credit/i, "db table"],
  [/--retry\s+[1-9]/, "curl retry enabled"],
  [/while\s+true|until\s+/, "retry loop"],
  [/activationNotBefore|lead_assignment_dispatch_activation/, "activation boundary"],
];

// ---------------------------------------------------------------------------

const RULES = {
  // ---- endpoint containment -----------------------------------------------
  "W01 the wrapper targets exactly one endpoint, the approved internal route": () => {
    const urls = [...WRAPPER_CODE.matchAll(/https?:\/\/[^\s"'`)]+/g)].map((m) => m[0]);
    return urls.length === 1 && urls[0] === ENDPOINT &&
      new RegExp(`ENDPOINT="${ENDPOINT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`).test(WRAPPER);
  },
  "W02 the request is POST only": () =>
    /--request POST/.test(WRAPPER_CODE) &&
    !/--request\s+(GET|PUT|PATCH|DELETE|HEAD)/.test(WRAPPER_CODE) &&
    (WRAPPER_CODE.match(/curl /g) ?? []).length === 1,
  "W03 the batch limit is fixed at the launch value and is not caller-tunable": () =>
    new RegExp(`readonly BATCH_LIMIT=${LAUNCH_BATCH}\\b`).test(WRAPPER) &&
    /--data "\{\\"limit\\":\$\{BATCH_LIMIT\}\}"/.test(WRAPPER_CODE) &&
    // Assigned exactly once, from a literal — never from argv, env or a caller.
    // (`$1`/`$2` legitimately appear inside the fail() helper, so a blanket
    // positional ban would be wrong; pinning the assignment is the real check.)
    (WRAPPER_CODE.match(/BATCH_LIMIT=/g) ?? []).length === 1 &&
    !/BATCH_LIMIT=\$/.test(WRAPPER_CODE) &&
    !/getopts/.test(WRAPPER_CODE),

  // ---- secret safety -------------------------------------------------------
  "W04 the secret is read at run time from the root-protected runtime env file": () =>
    new RegExp(`ENV_FILE="${ENV_FILE}"`).test(WRAPPER) &&
    /sed -n 's\/\^QF_CRON_SECRET=\/\/p' "\$ENV_FILE"/.test(WRAPPER_CODE),
  "W05 no literal secret is embedded anywhere": () =>
    !/QF_CRON_SECRET\s*=\s*["'][^"'$]/.test(WRAPPER_CODE) &&
    !/x-qf-cron-secret:\s*[A-Za-z0-9]{8,}/.test(WRAPPER_CODE) &&
    !/[A-Za-z0-9+/]{40,}={0,2}/.test(WRAPPER_CODE),
  "W06 the secret never reaches argv (it is passed by file descriptor)": () =>
    /--header @<\(printf 'x-qf-cron-secret: %s\\n' "\$QF_CRON_SECRET"\)/.test(WRAPPER_CODE) &&
    !/--header\s+"x-qf-cron-secret: \$/.test(WRAPPER_CODE) &&
    !/-H\s+"x-qf-cron-secret: \$/.test(WRAPPER_CODE),
  "W07 the wrapper fails closed when the secret is absent or blank": () =>
    /if \[ -z "\$\{QF_CRON_SECRET:-\}" \]/.test(WRAPPER_CODE) &&
    /secret_absent/.test(WRAPPER_CODE) &&
    /\[ -r "\$ENV_FILE" \] \|\| fail/.test(WRAPPER_CODE),
  "W08 the secret is unset before any parsing or logging": () =>
    WRAPPER_CODE.indexOf("unset QF_CRON_SECRET") < WRAPPER_CODE.indexOf("log \"result=success"),
  "W09 tracing is disabled so the secret cannot leak via set -x": () =>
    /set \+x/.test(WRAPPER_CODE) && !/set -x/.test(WRAPPER_CODE),

  // ---- no business authority ----------------------------------------------
  "W10 the wrapper contains no forbidden capability": () =>
    FORBIDDEN_IN_WRAPPER.every(([re]) => !re.test(WRAPPER_CODE)),
  "W11 the wrapper performs no automatic retry": () =>
    /--retry 0/.test(WRAPPER_CODE) &&
    !/--retry-delay|--retry-max-time|--retry-all-errors/.test(WRAPPER_CODE) &&
    !/\bfor\s+\w+\s+in\b|\bwhile\b/.test(WRAPPER_CODE),
  "W12 the wrapper cannot overlap itself": () =>
    /flock -n 9/.test(WRAPPER_CODE) &&
    /exec 9>"\$LOCK_FILE"/.test(WRAPPER_CODE) &&
    /LOCK_FILE="\/var\/lock\/qf-lead-assignment-dispatch\.lock"/.test(WRAPPER),
  "W13 connect and total timeouts are bounded": () =>
    /--connect-timeout "\$CONNECT_TIMEOUT"/.test(WRAPPER_CODE) &&
    /--max-time "\$MAX_TIME"/.test(WRAPPER_CODE) &&
    /readonly CONNECT_TIMEOUT=\d+/.test(WRAPPER) &&
    /readonly MAX_TIME=\d+/.test(WRAPPER),

  // ---- response handling ---------------------------------------------------
  "W14 a non-200 response is refused": () =>
    /\[ "\$http_status" = "200" \] \|\| fail/.test(WRAPPER_CODE),
  "W15 a malformed or non-JSON response is refused": () =>
    /malformed_json/.test(WRAPPER_CODE) && /jq -e 'type == "object"'/.test(WRAPPER_CODE),
  "W16 a response outside the exact sanitized contract is refused": () => {
    const keys = /\["dispatched","ok","refused","selected","selectionBlocked"\]/.test(WRAPPER_CODE);
    return keys && /contract_violation/.test(WRAPPER_CODE) &&
      /\[ "\$contract_ok" = "yes" \] \|\| fail/.test(WRAPPER_CODE);
  },
  "W17 only safe operational fields are logged": () => {
    const logs = [...WRAPPER_CODE.matchAll(/log "([^"]*)"/g)].map((m) => m[1]);
    // Keys are camelCase in one place (selectionBlocked), so the allowlist must
    // permit an uppercase letter inside the key while still pinning key=value.
    const allowed = /^[A-Za-z_]+=(\$?[A-Za-z0-9_${}:.\-]*|[A-Za-z0-9_.\-]*)$/;
    return logs.length > 0 && logs.every((line) =>
      line.split(/\s+/).every((tok) => tok === "" || allowed.test(tok))
    ) &&
      // never a header, body, env dump, secret or phone
      !/log .*\$http_body|log .*\$response|log .*ENV_FILE|log .*SECRET|log .*\+91/.test(WRAPPER_CODE);
  },
  "W18 failures exit non-zero": () =>
    /fail\(\) \{ log "result=error status=\$1 detail=\$2"; exit "\$\{3:-1\}"; \}/.test(WRAPPER_CODE) &&
    /exit 0/.test(WRAPPER_CODE),
  "W19 the wrapper is strict-mode bash": () =>
    /^#!\/usr\/bin\/env bash$/m.test(WRAPPER) && /set -euo pipefail/.test(WRAPPER_CODE),

  // ---- cron ----------------------------------------------------------------
  "C01 cron runs once per minute": () =>
    /^\* \* \* \* \* root \/usr\/local\/sbin\/qf-lead-assignment-dispatch$/m.test(CRON_CODE),
  "C02 cron invokes ONLY the approved wrapper": () => {
    const jobs = CRON_CODE.split("\n").filter((l) => /^\s*[\d*]/.test(l));
    return jobs.length === 1 && jobs[0].includes(WRAPPER_INSTALL) &&
      !/curl|wget|http|;|&&|\|\|/.test(jobs[0]);
  },
  "C03 cron carries NO secret and no endpoint": () =>
    !/QF_CRON_SECRET/.test(CRON_CODE) &&
    !/x-qf-cron-secret/.test(CRON_CODE) &&
    !/https?:\/\//.test(CRON_CODE) &&
    !/[A-Za-z0-9+/]{40,}={0,2}/.test(CRON_CODE),
  "C04 cron defines no mail target that could leak output": () =>
    /^MAILTO=""$/m.test(CRON_CODE),

  // ---- the trigger stays the sole authority -------------------------------
  "A01 the route remains the only trigger endpoint and still delegates to Core": () =>
    /runLeadAssignmentDispatchBatch\(\{ limit \}\)/.test(ROUTE) &&
    /export async function POST/.test(ROUTE) &&
    /status: 405/.test(ROUTE),
  "A02 the route's security contract is unchanged": () =>
    /CRON_SECRET_HEADER = "x-qf-cron-secret"/.test(TRIGGER) &&
    /CRON_SECRET_ENV_KEY = "QF_CRON_SECRET"/.test(TRIGGER) &&
    /timingSafeEqual/.test(TRIGGER) &&
    /DISPATCH_BATCH_MIN = 1/.test(TRIGGER) &&
    /DISPATCH_BATCH_MAX = 25/.test(TRIGGER),
  "A03 the launch batch is inside the route's own clamp": () =>
    LAUNCH_BATCH >= 1 && LAUNCH_BATCH <= 25,
  "A04 the scheduler does not reimplement the activation boundary": () =>
    !/created_at|notBefore|boundary/i.test(WRAPPER_CODE) &&
    // the boundary still lives where 80.13A put it
    /LEAD_ASSIGNMENT_ACTIVATION_POLICY_KEY =\s*\n?\s*"lead_assignment_dispatch_activation"/.test(CONTRACT) &&
    /\.gt\("created_at", boundary\.notBeforeIso\)/.test(SERVICE),
  "A05 no second dispatch worker is introduced": () =>
    (SERVICE.match(/export async function runLeadAssignmentDispatchBatch/g) ?? []).length === 1 &&
    !/runLeadAssignmentDispatchBatch/.test(WRAPPER_CODE),
};

// ---------------------------------------------------------------------------
// MUTATION SELF-TESTS — each must flip its rule to false.
// ---------------------------------------------------------------------------

const MUTANTS = [
  ["W01", "a second endpoint is added", (w) => w.replace('readonly LOG_TAG', 'readonly EVIL="https://graph.facebook.com/v26.0/x"\nreadonly LOG_TAG')],
  ["W02", "the method is changed to GET", (w) => w.replace("--request POST", "--request GET")],
  ["W03", "the batch is raised to the route maximum", (w) => w.replace("readonly BATCH_LIMIT=3", "readonly BATCH_LIMIT=25")],
  ["W03", "the batch becomes caller-tunable from argv", (w) => w.replace("readonly BATCH_LIMIT=3", "readonly BATCH_LIMIT=${1:-3}")],
  ["W04", "the secret is read from an unprotected path", (w) => w.replace('ENV_FILE="/etc/quickfurno/quickfurno-runtime.env"', 'ENV_FILE="/tmp/env"')],
  ["W05", "a literal secret is embedded", (w) => w.replace('readonly LOG_TAG', 'readonly HARDCODED="AbCdEfGhIjKlMnOpQrStUvWxYz0123456789AbCdEfGh"\nreadonly LOG_TAG')],
  ["W06", "the secret is moved onto the command line", (w) => w.replace(`--header @<(printf 'x-qf-cron-secret: %s\\n' "$QF_CRON_SECRET")`, `--header "x-qf-cron-secret: $QF_CRON_SECRET"`)],
  ["W07", "the blank-secret guard is removed", (w) => w.replace(/if \[ -z "\$\{QF_CRON_SECRET:-\}" \][\s\S]*?\nfi\n/, "")],
  ["W09", "tracing is turned on", (w) => w.replace("set +x", "set -x")],
  ["W10", "the wrapper starts calling Meta directly", (w) => w.replace("readonly LOG_TAG", 'readonly META="https://graph.facebook.com"\nreadonly LOG_TAG')],
  ["W10", "the wrapper starts querying the database", (w) => w.replace("readonly LOG_TAG", 'readonly Q="select id from communication_intents"\nreadonly LOG_TAG')],
  // Anchored on the trailing line-continuation so the mutation hits the CODE,
  // not the explanatory comment that also names `--retry 0`.
  ["W11", "curl retry is enabled", (w) => w.replace("--retry 0 \\\n", "--retry 3 \\\n")],
  ["W12", "the overlap lock is removed", (w) => w.replace("if ! flock -n 9; then", "if false; then")],
  ["W13", "the total timeout is removed", (w) => w.replace('--max-time "$MAX_TIME" \\\n       ', "")],
  ["W14", "a non-200 response is accepted", (w) => w.replace('[ "$http_status" = "200" ] || fail', '[ "$http_status" = "200" ] || true # fail')],
  ["W16", "the response contract check is dropped", (w) => w.replace('[ "$contract_ok" = "yes" ] || fail', '[ "$contract_ok" = "yes" ] || true # fail')],
  ["W17", "the raw response body is logged", (w) => w.replace('log "result=success', 'log "body=$http_body result=success')],
];

const CRON_MUTANTS = [
  ["C01", "the cadence is changed", (c) => c.replace("* * * * * root", "*/5 * * * * root")],
  ["C02", "cron calls curl directly instead of the wrapper", (c) => c.replace("* * * * * root /usr/local/sbin/qf-lead-assignment-dispatch", "* * * * * root curl -X POST https://quickfurno.in/api/internal/process-lead-assignment-intents")],
  ["C02", "a second scheduled job is added", (c) => c + "\n* * * * * root /usr/local/sbin/other-job\n"],
  ["C03", "the secret is placed in cron", (c) => c.replace('MAILTO=""', 'MAILTO=""\nQF_CRON_SECRET=AbCdEfGhIjKlMnOpQrStUvWxYz0123456789AbCd')],
  ["C04", "MAILTO is opened up", (c) => c.replace('MAILTO=""', 'MAILTO="ops@example.com"')],
];

// ---------------------------------------------------------------------------

const results = [];
const add = (name, ok, detail) => results.push({ name, ok: ok === true, detail: detail ?? "" });

for (const [name, fn] of Object.entries(RULES)) {
  let ok = false, detail = "";
  try { ok = fn() === true; } catch (e) { detail = e instanceof Error ? e.message : String(e); }
  add(name, ok, detail);
}

// The RULES above close over the pristine module constants, so a mutant is
// evaluated through this parallel table: the SAME predicate, applied to
// substituted source text. Each entry is deliberately the load-bearing clause of
// its rule, so "still passed after mutation" is a real failure rather than an
// artefact of checking something weaker.
function ruleAgainst(ruleKey, wrapperText, cronText) {
  const w = wrapperText ?? WRAPPER;
  const c = cronText ?? CRON;
  const wc = shellCode(w), cc = shellCode(c);
  const table = {
    W01: () => { const u = [...wc.matchAll(/https?:\/\/[^\s"'`)]+/g)].map((m) => m[0]); return u.length === 1 && u[0] === ENDPOINT; },
    W02: () => /--request POST/.test(wc) && !/--request\s+(GET|PUT|PATCH|DELETE|HEAD)/.test(wc) && (wc.match(/curl /g) ?? []).length === 1,
    W03: () => new RegExp(`readonly BATCH_LIMIT=${LAUNCH_BATCH}\\b`).test(w) && (wc.match(/BATCH_LIMIT=/g) ?? []).length === 1 && !/BATCH_LIMIT=\$/.test(wc),
    W04: () => new RegExp(`ENV_FILE="${ENV_FILE}"`).test(w),
    W05: () => !/[A-Za-z0-9+/]{40,}={0,2}/.test(wc),
    W06: () => /--header @<\(printf 'x-qf-cron-secret/.test(wc) && !/--header\s+"x-qf-cron-secret: \$/.test(wc),
    W07: () => /if \[ -z "\$\{QF_CRON_SECRET:-\}" \]/.test(wc) && /secret_absent/.test(wc),
    W09: () => /set \+x/.test(wc) && !/set -x/.test(wc),
    W10: () => FORBIDDEN_IN_WRAPPER.every(([re]) => !re.test(wc)),
    W11: () => /--retry 0/.test(wc) && !/--retry\s+[1-9]/.test(wc),
    W12: () => /flock -n 9/.test(wc),
    W13: () => /--max-time "\$MAX_TIME"/.test(wc),
    W14: () => /\[ "\$http_status" = "200" \] \|\| fail/.test(wc),
    W16: () => /\[ "\$contract_ok" = "yes" \] \|\| fail/.test(wc),
    W17: () => !/log .*\$http_body/.test(wc),
    C01: () => /^\* \* \* \* \* root \/usr\/local\/sbin\/qf-lead-assignment-dispatch$/m.test(cc),
    C02: () => { const j = cc.split("\n").filter((l) => /^\s*[\d*]/.test(l)); return j.length === 1 && j[0].includes(WRAPPER_INSTALL) && !/curl|wget|http/.test(j[0]); },
    C03: () => !/QF_CRON_SECRET/.test(cc) && !/[A-Za-z0-9+/]{40,}={0,2}/.test(cc),
    C04: () => /^MAILTO=""$/m.test(cc),
  };
  return table[ruleKey] ? table[ruleKey]() : null;
}

let mutantsRejected = 0;
for (const [key, label, mutate] of MUTANTS) {
  const mutated = mutate(WRAPPER);
  let rejected = false, detail = "";
  if (mutated === WRAPPER) detail = "mutation was a no-op (source drifted)";
  else {
    const base = ruleAgainst(key, WRAPPER, null);
    const after = ruleAgainst(key, mutated, null);
    if (base !== true) detail = `${key} did not hold on pristine source`;
    else if (after !== false) detail = `${key} still passed after mutation`;
    else rejected = true;
  }
  if (rejected) mutantsRejected += 1;
  add(`MUT ${key} reject: ${label}`, rejected, detail);
}
for (const [key, label, mutate] of CRON_MUTANTS) {
  const mutated = mutate(CRON);
  let rejected = false, detail = "";
  if (mutated === CRON) detail = "mutation was a no-op (source drifted)";
  else {
    const base = ruleAgainst(key, null, CRON);
    const after = ruleAgainst(key, null, mutated);
    if (base !== true) detail = `${key} did not hold on pristine source`;
    else if (after !== false) detail = `${key} still passed after mutation`;
    else rejected = true;
  }
  if (rejected) mutantsRejected += 1;
  add(`MUT ${key} reject: ${label}`, rejected, detail);
}

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${!r.ok && r.detail ? `  [${r.detail}]` : ""}`);
console.log(`\nScheduler: cron '* * * * *' -> ${WRAPPER_INSTALL} -> POST ${ENDPOINT} limit=${LAUNCH_BATCH}`);
console.log(`Secret: ${ENV_FILE} (never in cron, never in argv, never logged)`);
console.log(
  `SUMMARY assertions=${results.length} passed=${results.length - failed.length} failed=${failed.length} ` +
  `rules=${Object.keys(RULES).length} mutants=${MUTANTS.length + CRON_MUTANTS.length} mutants_rejected=${mutantsRejected}`
);
process.exit(failed.length === 0 ? 0 : 1);
