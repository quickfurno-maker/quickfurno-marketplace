import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Phase 5F-D2-B — Consent evidence schema + preference/suppression state hardening.
 *
 * SCHEMA ONLY. This harness statically inspects the prepared migration DDL, the repository
 * delta, package.json, and the doc. It applies NO SQL and touches NO database. Mutation tests
 * edit the REAL migration (or webhook service), then assert the suite goes red for the intended
 * reason, restoring every file byte-identically afterwards.
 */

const MIGRATION_SRC = "supabase/migrations/20260711000200_communication_consent_evidence_and_state_hardening.sql";
const HARNESS_SRC = "scripts/phase5f-d2b-consent-evidence-schema-harness.mjs";
const DOC_SRC = "docs/QF-Consent-Evidence-Schema-Phase-5F-D2-B.md";
const WEBHOOK_SVC_SRC = "services/metaWhatsAppWebhookService.ts";
const WEBHOOK_ROUTE_SRC = "app/api/webhooks/whatsapp/meta/route.ts";
const COMM_SERVICE_SRC = "services/communicationService.ts";
const INBOUND_SVC_SRC = "services/inboundWhatsAppMessageService.ts";

/**
 * The D2-B COMMIT's historical delta — validated against LOCAL git history, NEVER the current
 * worktree. A completed-phase harness proves WHAT THAT PHASE INTRODUCED, not what the repository is
 * allowed to contain forever: a legitimate later phase (e.g. D2-C's decision service) is irrelevant
 * to D2-B's own delta and must not fail D2-B.
 */
// REACHABILITY: this fixed D2-B commit must remain reachable in local git history. Normal chained
// commits, fast-forward, and normal merges preserve it; a squash workflow that DISCARDS the D2-B
// commit would make `git diff-tree`/`git rev-parse` below fail LOUD (an error, never a silent
// fall-back to current-worktree validation) and require a documented harness adaptation.
const D2B_COMMIT = "2606739ea849daecfef0a736b572e6406db8f925";
const D2B_EXPECTED_PARENT = "44bc18c1cffdc8fee060c78920faf58cbbf1cc5f"; // Phase 5F-D1-B (one D2-B commit over the D1-B base)
const D2B_HISTORICAL_FILES = [
  "docs/QF-Consent-Evidence-Schema-Phase-5F-D2-B.md",
  "package.json",
  "scripts/phase5f-d2b-consent-evidence-schema-harness.mjs",
  "supabase/migrations/20260711000200_communication_consent_evidence_and_state_hardening.sql",
];

// ----------------------------------------------------------------------------
// Fresh reads (never cached — mutation edits must be observed)
// ----------------------------------------------------------------------------
const readF = (f) => readFileSync(f, "utf8");
/** Strip `-- ...` line comments (SQL string literals / `comment on ... is '...'` survive). */
const stripSql = (s) => s.replace(/--[^\n]*/g, "");
/** Strip TS `//` and block comments. */
const stripTs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/[^\n]*/gm, "");
const collapse = (s) => s.replace(/\s+/g, " ").trim();

function region(name) {
  const s = readF(MIGRATION_SRC);
  const b = s.indexOf(`-- @@ ${name}_BEGIN`);
  const e = s.indexOf(`-- @@ ${name}_END`);
  if (b < 0 || e < b) throw new Error(`migration region ${name} missing`);
  return s.slice(b, e);
}
const ev = () => collapse(stripSql(region("EVIDENCE_TABLE")));
const evRaw = () => region("EVIDENCE_TABLE");
const pf = () => collapse(stripSql(region("PREFERENCE_HARDENING")));
const pfRaw = () => region("PREFERENCE_HARDENING");
const sp = () => collapse(stripSql(region("SUPPRESSION_HARDENING")));
const spRaw = () => region("SUPPRESSION_HARDENING");
const gd = () => collapse(stripSql(region("GUARD")));
const gr = () => collapse(stripSql(region("EVIDENCE_GRANTS")));
const migCode = () => collapse(stripSql(readF(MIGRATION_SRC)));
// EXECUTABLE DDL only — also strips `comment on ... is '...';` string literals so a NEGATIVE
// forbidden-token scan (DML, plaintext columns) never matches descriptive comment prose.
const execCode = () => collapse(stripSql(readF(MIGRATION_SRC)).replace(/comment on [\s\S]*?;/gi, ""));
const execRegion = (name) => collapse(stripSql(region(name)).replace(/comment on [\s\S]*?;/gi, ""));
// For a DESTRUCTIVE-DML keyword scan: strip `--` comments and neutralize ALL single-quoted string
// literals (comment-on bodies, exception hints/messages, CHECK patterns). This removes descriptive
// words like "truncate"/"delete" that live inside literals; real DML keywords live OUTSIDE literals
// and survive. (Literals here contain no internal single-quote, so pairing is exact.)
const dmlScanText = () => collapse(stripSql(readF(MIGRATION_SRC)).replace(/'[^']*'/g, "''"));

/**
 * PURE historical-scope validator (testable in isolation). Given the file list + parent SHA of the
 * D2-B commit, returns an array of violation strings (empty = valid). It rejects an unexpected fifth
 * file, a missing approved file, a service/route/webhook/env/lockfile, and an incorrect parent.
 */
function validateD2BHistoricalDelta(files, parent) {
  const problems = [];
  const set = new Set(files);
  if (files.length !== D2B_HISTORICAL_FILES.length) problems.push(`expected ${D2B_HISTORICAL_FILES.length} files, got ${files.length} [${files.join(", ")}]`);
  for (const f of D2B_HISTORICAL_FILES) if (!set.has(f)) problems.push(`missing approved D2-B file: ${f}`);
  for (const f of files) if (!D2B_HISTORICAL_FILES.includes(f)) problems.push(`unexpected file in the D2-B delta: ${f}`);
  if (parent !== D2B_EXPECTED_PARENT) problems.push(`expected parent ${D2B_EXPECTED_PARENT}, got ${parent}`);
  for (const f of files) {
    if (/^services\//.test(f)) problems.push(`D2-B must introduce no service: ${f}`);
    if (/(^|\/)(app|pages)\/api\//.test(f)) problems.push(`D2-B must introduce no API route: ${f}`);
    if (/webhook/i.test(f)) problems.push(`D2-B must introduce no webhook file: ${f}`);
    if (/(^|\/)\.env(\.|$)/.test(f)) problems.push(`D2-B must change no env file: ${f}`);
    if (/(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/.test(f)) problems.push(`D2-B must change no lockfile: ${f}`);
    if (/communicationConsent(Decision|Writer|Authority)/.test(f)) problems.push(`D2-B must introduce no consent decision/writer/authority service: ${f}`);
  }
  const migrations = files.filter((f) => f.startsWith("supabase/migrations/"));
  if (migrations.length !== 1 || migrations[0] !== MIGRATION_SRC) problems.push(`D2-B must ADD exactly its own migration (no earlier migration modified): [${migrations.join(", ")}]`);
  return problems;
}

/** The REAL local git history for the fixed audited D2-B commit (no network access). */
function d2bHistoricalDelta() {
  const files = execFileSync("git", ["diff-tree", "--no-commit-id", "--name-only", "-r", D2B_COMMIT], { encoding: "utf8" })
    .split("\n").map((s) => s.trim()).filter(Boolean).map((p) => p.replace(/\\/g, "/"));
  const parent = execFileSync("git", ["rev-parse", `${D2B_COMMIT}^`], { encoding: "utf8" }).trim();
  return { files, parent };
}

const checks = [];
function check(name, fn) { checks.push({ name, fn }); }
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function has(re, s, msg) { assert(re.test(s), msg); }
function hasNot(re, s, msg) { assert(!re.test(s), msg); }

// ============================================================================
// MIGRATION SCOPE (1-8)
// ============================================================================
check("1-8. D2-B historical delta: exactly its four approved files, correct parent, no service/route/webhook/env/lockfile", () => {
  assert(existsSync(MIGRATION_SRC), "1. the D2-B migration exists in the worktree");
  // 1-6: validate the D2-B COMMIT's historical delta (local git history) — NOT the current worktree,
  // so legitimate later-phase files (e.g. D2-C's decision service/doc/harness) never fail D2-B.
  const { files, parent } = d2bHistoricalDelta();
  const problems = validateD2BHistoricalDelta(files, parent);
  assert(problems.length === 0, `1-6. D2-B historical-delta violation: ${problems.join(" | ")}`);
  const code = migCode();
  // 6-8: schema-only — no trigger/function/RPC, no policy, no DML, no Meta activation, no send.
  hasNot(/create trigger/i, code, "no trigger");
  hasNot(/create (or replace )?function/i, code, "6-7. no function/RPC");
  hasNot(/security definer/i, code, "no SECURITY DEFINER");
  hasNot(/create policy/i, code, "no browser RLS policy");
  hasNot(/insert\s+into\b|truncate\b|delete\s+from\b/i, dmlScanText(), "no DML");
  hasNot(/is_operationally_enabled|webhook_processing_enabled|outbound_enabled|activation_status/i, code, "6. no Meta/runtime activation");
  // 7-8: no STOP/START/HELP handling and no consent decision/writer wired into the webhook service.
  const svc = stripTs(readF(WEBHOOK_SVC_SRC));
  hasNot(/["'`]STOP["'`]|["'`]START["'`]|["'`]HELP["'`]/, svc, "7. no STOP/START/HELP command handling in the webhook service");
  hasNot(/communicationConsent(Decision|Writer|Authority)/i, svc, "8. no consent decision/writer wired into the webhook service");
});

// ============================================================================
// DORMANT-DATA GUARD (9-11)
// ============================================================================
check("9-11. the migration aborts on any pre-existing consent row; no destructive DML", () => {
  const g = gd();
  has(/select count\(\*\) into v_pref_rows from public\.communication_preferences/, g, "9. counts preference rows");
  has(/select count\(\*\) into v_supp_rows from public\.communication_suppressions/, g, "10. counts suppression rows");
  has(/if v_pref_rows > 0 or v_supp_rows > 0 then/, g, "9-10. aborts when either table has rows");
  has(/raise exception 'Phase 5F-D2-B: refusing to harden non-empty consent tables/, g, "9-10. sanitized abort exception");
  // 11. never truncate/delete/backfill consent truth.
  hasNot(/truncate|delete\s+from|update\s+public\.communication_(preferences|suppressions)|insert\s+into/i, dmlScanText(), "11. no destructive/backfill DML");
});

// ============================================================================
// EVIDENCE TABLE — shape (12-14, 29-31, 35)
// ============================================================================
check("12-14,29-31,35. evidence table: pk, no updated_at, source-event, policy, timestamps, idempotency", () => {
  const e = ev();
  has(/create table if not exists public\.communication_consent_events/, e, "12. evidence table created");
  has(/id uuid primary key default gen_random_uuid\(\)/, e, "13. uuid primary key");
  hasNot(/updated_at/i, e, "14. no updated_at (append-only)");
  has(/source_event_type text not null check \(source_event_type ~ '\^\[A-Za-z0-9\._:-\]\{1,64\}\$'\)/, e, "29. source_event_type required + bounded");
  has(/source_event_id text not null check \(char_length\(source_event_id\) between 1 and 200\)/, e, "29. source_event_id required + bounded");
  has(/policy_version text not null check \(policy_version ~ '\^\[A-Za-z0-9\._:-\]\{1,64\}\$'\)/, e, "30. policy_version required + bounded");
  has(/occurred_at timestamptz not null/, e, "35. occurred_at present");
  has(/created_at timestamptz not null default now\(\)/, e, "35. created_at present");
  has(/idempotency_key text not null check \(idempotency_key ~ '\^\[0-9a-f\]\{64\}\$'\)/, e, "31. idempotency_key hex64");
  has(/create unique index if not exists uq_comm_consent_event_idempotency on public\.communication_consent_events \(idempotency_key\)/, e, "31. idempotency_key UNIQUE");
});

// ============================================================================
// EVIDENCE TABLE — subject/target invariants (15-18, 22)
// ============================================================================
check("15-18,22. evidence subject/target invariants", () => {
  const e = ev();
  has(/chk_consent_evt_principal_pair check \( \(principal_type is null and principal_id is null\) or \(principal_type is not null and principal_id is not null\) \)/, e,
    "15. complete principal-pair invariant");
  has(/chk_consent_evt_subject_present check \( \(principal_type is not null and principal_id is not null\) or destination_hash is not null \)/, e,
    "16. subject-presence invariant");
  has(/target_type = 'preference' and principal_type is not null and principal_id is not null and destination_hash is null and scope in \('authentication', 'transactional', 'marketing'\)/, e,
    "17,22. preference target: complete principal pair + NO destination_hash + preference scope");
  has(/target_type = 'suppression' and destination_hash is not null and scope in \('transactional', 'marketing', 'global'\)/, e,
    "18,22. suppression target requires destination_hash + suppression scope set");
});

// ============================================================================
// EVIDENCE TABLE — fences/vocab (19-28, 32-34, 36)
// ============================================================================
check("19-28,32-34,36. evidence fences, vocabularies, FK, defense-in-depth, metadata, no plaintext", () => {
  const e = ev();
  has(/destination_hash text check \(destination_hash is null or destination_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/, e, "19. destination hash hex64");
  has(/channel text not null check \(channel in \('whatsapp', 'sms', 'rcs'\)\)/, e, "20. bounded channels");
  has(/scope text not null check \(scope in \('authentication', 'transactional', 'marketing', 'global'\)\)/, e, "21. bounded scopes");
  // 23. bounded actions — all nine.
  has(/action text not null check \(action in \(/, e, "23. bounded action vocabulary");
  for (const a of ["grant", "withdraw", "reaffirm", "admin_block", "admin_unblock", "suppress", "unsuppress", "provider_block", "provider_unblock"]) {
    has(new RegExp(`'${a}'`), e, `23. action ${a} present`);
  }
  // 24. target-specific action/state.
  has(/chk_consent_evt_action_state check \(/, e, "24. action/state fence present");
  has(/action in \('grant', 'reaffirm'\) and target_type = 'preference' and state_after = 'allowed'/, e, "24. grant/reaffirm → preference/allowed");
  has(/action in \('suppress', 'provider_block'\) and target_type = 'suppression' and state_after = 'active'/, e, "24. suppress/provider_block → suppression/active");
  has(/state_after text not null check \(state_after in \('allowed', 'blocked', 'active', 'inactive'\)\)/, e, "24. bounded resulting state");
  has(/chk_consent_evt_state_before check \(/, e, "24. per-target prior-state fence");
  // 25. bounded reason / source / evidence_type.
  for (const r of ["user_grant", "user_withdrawal", "user_stop", "user_start", "provider_block", "provider_restored", "hard_bounce", "complaint", "admin", "legal", "abuse", "import", "system", "unspecified"]) {
    has(new RegExp(`'${r}'`), e, `25. reason ${r} present`);
  }
  has(/source text not null check \(source in \('system', 'user', 'admin', 'provider', 'import'\)\)/, e, "25. bounded source");
  has(/evidence_type text not null check \(evidence_type in \('inbound_command', 'admin_action', 'provider_signal', 'import', 'system_action'\)\)/, e, "25. bounded evidence_type");
  // 26. actor_id is admin-only (one complete invariant; see the dedicated actor check below).
  has(/chk_consent_evt_actor check \( \(actor_type = 'admin' and actor_id is not null\) or \(actor_type <> 'admin' and actor_id is null\) \)/, e, "26. actor_id admin-only complete invariant");
  // 27. provider pair all-or-none + inbound-command requires the pair (not the FK link).
  has(/chk_consent_evt_provider_pair check \( \(provider is null and provider_message_id is null\) or \(provider is not null and provider_message_id is not null\) \)/, e, "27. provider pair all-or-none");
  has(/chk_consent_evt_inbound_command check \( evidence_type <> 'inbound_command' or \(provider is not null and provider_message_id is not null\) \)/, e, "27. inbound_command requires the provider pair (not the optional FK)");
  // 28. inbound FK ON DELETE SET NULL.
  has(/inbound_message_id uuid references public\.communication_inbound_messages\(id\) on delete set null/, e, "28. inbound FK ON DELETE SET NULL");
  // 32. defense-in-depth provider-message partial unique.
  has(/create unique index if not exists uq_comm_consent_event_provider_action on public\.communication_consent_events \(provider, provider_message_id, target_type, action, channel, scope\) where provider is not null and provider_message_id is not null/, e,
    "32. provider-message defense-in-depth unique index");
  // 33-34. metadata is a bounded JSON object.
  has(/jsonb_typeof\(metadata_sanitized\) = 'object'/, e, "33. metadata is a JSON object");
  has(/octet_length\(metadata_sanitized::text\) <= 4096/, e, "34. metadata encoded size bounded");
  // 36. no plaintext destination/content COLUMNS (column-shape scan on executable DDL only, so a
  // descriptive comment mentioning "OTP"/"password" never trips it).
  const cols = execRegion("EVIDENCE_TABLE");
  hasNot(/\b(phone_e164|wa_id|msisdn|phone_number|sender_phone|raw_payload|message_text|message_body|access_token|app_secret|otp|password)\s+(text|jsonb|uuid|varchar)/i, cols, "36. no plaintext/secret column");
  hasNot(/\bphone\s+text/i, cols, "36. no plaintext phone column");
});

// ============================================================================
// APPEND-ONLY SECURITY (37-43)
// ============================================================================
check("37-43. evidence ledger is append-only: RLS, no policy, service_role SELECT/INSERT only", () => {
  const g = gr();
  has(/alter table public\.communication_consent_events enable row level security/, g, "37. RLS enabled");
  hasNot(/create policy/i, migCode(), "38-39. no anon/authenticated (browser) policy anywhere");
  has(/revoke all on table public\.communication_consent_events from public/i, g, "PUBLIC explicitly revoked (defense in depth vs altered default privileges)");
  has(/revoke all on public\.communication_consent_events from anon/, g, "38. anon revoked");
  has(/revoke all on public\.communication_consent_events from authenticated/, g, "39. authenticated revoked");
  has(/grant select, insert on public\.communication_consent_events to service_role/, g, "40. service_role SELECT/INSERT only");
  hasNot(/grant[^;]*\b(update|delete|truncate)\b[^;]*communication_consent_events/i, g, "41-43. no UPDATE/DELETE/TRUNCATE grant on the ledger");
  hasNot(/grant[^;]*communication_consent_events[^;]*\b(update|delete|truncate)\b/i, g, "41-43. no UPDATE/DELETE/TRUNCATE grant on the ledger");
  hasNot(/grant[^;]*to (anon|authenticated)/i, migCode(), "38-39. no anon/authenticated grant");
});

// ============================================================================
// PREFERENCE HARDENING (44-53)
// ============================================================================
check("44-53. preference hardening", () => {
  const p = pf();
  has(/alter table public\.communication_preferences alter column principal_id set not null/, p, "44. principal_id NOT NULL");
  has(/chk_comm_preference_principal_type check \(principal_type in \('client', 'vendor', 'admin'\)\)/, p, "45. principal_type client/vendor/admin only");
  has(/chk_comm_preference_state check \(state in \('allowed', 'blocked'\)\)/, p, "46. state allowed/blocked only");
  has(/alter column state drop default/, p, "46. durable 'unknown' default removed");
  has(/absence of a row means unknown/i, pfRaw(), "47. absence documented as unknown");
  has(/state = 'allowed' and consented_at is not null and withdrawn_at is null/, p, "48. exact allowed timestamp invariant");
  has(/state = 'blocked' and consented_at is null and withdrawn_at is not null/, p, "49. exact blocked timestamp invariant");
  has(/alter column policy_version set not null/, p, "50. policy_version required");
  has(/chk_comm_preference_policy_version check \(policy_version ~ '\^\[A-Za-z0-9\._:-\]\{1,64\}\$'\)/, p, "50. policy_version bounded");
  has(/fk_comm_preference_last_event foreign key \(last_event_id\) references public\.communication_consent_events\(id\) on delete restrict/, p, "51. last_event_id evidence FK");
  hasNot(/drop (index|constraint)[^;]*uq_comm_preference/i, p, "52. the unique (principal_type, principal_id, channel, scope) is NOT dropped");
  has(/grant select, insert, update on public\.communication_preferences to service_role/, p, "53. service_role SELECT/INSERT/UPDATE preserved");
  hasNot(/grant[^;]*\b(delete|truncate)\b[^;]*communication_preferences/i, p, "53. no DELETE/TRUNCATE grant on preferences");
});

// ============================================================================
// SUPPRESSION HARDENING (54-64)
// ============================================================================
check("54-64. suppression hardening", () => {
  const s = sp();
  has(/add column if not exists deactivated_at timestamptz/, s, "54. deactivated_at added");
  has(/alter column policy_version set not null/, s, "55. policy_version required");
  has(/chk_comm_suppression_policy_version check \(policy_version ~ '\^\[A-Za-z0-9\._:-\]\{1,64\}\$'\)/, s, "55. policy_version bounded");
  has(/fk_comm_suppression_last_event foreign key \(last_event_id\) references public\.communication_consent_events\(id\) on delete restrict/, s, "56. last_event_id evidence FK");
  has(/chk_comm_suppression_destination_hash check \(destination_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/, s, "57. destination hash hex64");
  has(/chk_comm_suppression_reason check \(reason in \(/, s, "58. reason vocabulary present");
  has(/'legal'/, s, "58. legal reason added");
  has(/'abuse'/, s, "58. abuse reason added");
  has(/\(is_active = true and deactivated_at is null\) or \(is_active = false and deactivated_at is not null\)/, s, "59. active/deactivated exact invariant");
  has(/chk_comm_suppression_deactivated_order check \(deactivated_at is null or deactivated_at >= suppressed_at\)/, s, "60. deactivation ordering check");
  has(/chk_comm_suppression_expiry_order check \(expires_at is null or expires_at > suppressed_at\)/, s, "61. expiry ordering check");
  hasNot(/drop (index|constraint)[^;]*uq_comm_suppression_active/i, s, "62. active partial unique index NOT dropped");
  has(/is_active and \(expires_at is null or expires_at > evaluatedat\)/i, spRaw(), "63. effective-expiry read rule documented in the migration");
  has(/grant select, insert, update on public\.communication_suppressions to service_role/, s, "64. service_role SELECT/INSERT/UPDATE preserved");
  hasNot(/grant[^;]*\b(delete|truncate)\b[^;]*communication_suppressions/i, s, "64. no DELETE/TRUNCATE grant on suppressions");
  // no now() in any CHECK — the only now() in executable SQL is a column default.
  const code = stripSql(readF(MIGRATION_SRC));
  const nows = (code.match(/now\(\)/g) || []).length;
  const defs = (code.match(/default now\(\)/g) || []).length;
  assert(nows === defs, `no now() outside a column default (now()=${nows}, default now()=${defs})`);
});

// ============================================================================
// BOUNDARIES (65-74) + package wiring
// ============================================================================
check("65-74. boundaries: no decision/writer/RPC/webhook mutation/send/AI/conversation; not applied", () => {
  const pkg = JSON.parse(readF("package.json"));
  assert(pkg.scripts["test:phase5f:d2b"] === "node scripts/phase5f-d2b-consent-evidence-schema-harness.mjs", "package script wired");
  // 65-72: the D2-B COMMIT introduced no decision/writer/authority service, RPC, API route, or
  // webhook file. HISTORICAL (the commit's delta), NOT a forever repo assertion — a legitimate later
  // phase (D2-C) may create the decision service, which is irrelevant to D2-B's own delta.
  const { files } = d2bHistoricalDelta();
  for (const f of files) {
    assert(!/^services\//.test(f), `65-72. D2-B introduced no service (got ${f})`);
    assert(!/communicationConsent(Decision|Writer|Authority)/.test(f), `65-66. D2-B introduced no consent decision/writer/authority service (got ${f})`);
    assert(!/(^|\/)(app|pages)\/api\//.test(f), `67. D2-B introduced no API route (got ${f})`);
    assert(!/webhook/i.test(f), `67-72. D2-B introduced no webhook file (got ${f})`);
  }
  const code = migCode();
  hasNot(/create (or replace )?function|security definer/i, code, "66. no RPC/writer function in the migration");
  // 73-74: nothing in this delta applies SQL or deploys. The migration is inert DDL (no auto-apply
  // directive), and the d2b script is a plain node invocation (asserted above) — never a db-push/deploy.
  hasNot(/\\copy\b|\\i\b|pg_dump|supabase (db )?push|supabase migration up/i, execCode(), "73. the migration carries no apply/deploy directive");
  hasNot(/supabase|push|deploy|db:reset/i, pkg.scripts["test:phase5f:d2b"], "74. the d2b script only runs node (no apply/deploy)");
});

// ============================================================================
// DOCUMENTATION
// ============================================================================
check("doc: covers the required D2-B topics", () => {
  assert(existsSync(DOC_SRC), "doc exists");
  const doc = readF(DOC_SRC);
  for (const topic of [
    /D2-A findings/i, /dormant/i, /aborts?.*(non-empty|rows)|refuses/i, /evidence.*current-state|current-state.*evidence/i,
    /append-only/i, /subject invariant|principal-pair/i, /privacy/i, /idempotency/i, /policy version/i,
    /absence of a\s+row means unknown/i, /allowed.*consented_at|timestamp/i, /effective activity|expires_at > evaluatedat/i,
    /active partial unique|one active suppression/i, /controlled writer/i, /decision service/i,
    /no-objection|no consent objection/i, /no STOP\/START\/HELP|no STOP/i, /no reply|no.*send/i,
    /no domain_events|no.*outbox|no n8n/i, /no AI|no Jarvis/i, /Meta remains disabled|no Meta activation/i,
    /not applied|manual/i,
    // Correction topics:
    /access exclusive|fixed-order lock|race-safe lock/i, /TOCTOU|time-of-check|concurrent insert/i,
    /one transaction|single transaction|held until.*commit/i, /strictly principal-scoped|destination-level truth belongs to suppression/i,
    /actor_id is admin-only|actor.*admin-only|admin-only actor/i, /PUBLIC.*revok|revoke.*public/i,
    /owner|superuser/i,
  ]) has(topic, doc, `doc covers ${topic}`);
});

// ============================================================================
// RACE-SAFE LOCKING (correction) — L1-L11
// ============================================================================
check("L1-L11. fixed-order ACCESS EXCLUSIVE locks precede every count / CREATE / ALTER", () => {
  const raw = readF(MIGRATION_SRC);
  const g = gd();
  // L1-L3: both current-state tables locked in ACCESS EXCLUSIVE, inside the SECTION 0 guard block.
  has(/lock table public\.communication_preferences in access exclusive mode/i, g, "L1. preferences ACCESS EXCLUSIVE lock (in the guard)");
  has(/lock table public\.communication_suppressions in access exclusive mode/i, g, "L2-L3. suppressions ACCESS EXCLUSIVE lock (in the guard)");
  const iPrefLock = raw.search(/lock table public\.communication_preferences in access exclusive mode/i);
  const iSuppLock = raw.search(/lock table public\.communication_suppressions in access exclusive mode/i);
  const iInboundPrereq = raw.search(/communication_inbound_messages'\)\s*is null/i);
  const iPrefCount = raw.search(/select count\(\*\) into v_pref_rows from public\.communication_preferences/i);
  const iSuppCount = raw.search(/select count\(\*\) into v_supp_rows from public\.communication_suppressions/i);
  const iCreate = raw.search(/create table if not exists public\.communication_consent_events/i);
  const iAlterPref = raw.search(/alter table public\.communication_preferences/i);
  const iAlterSupp = raw.search(/alter table public\.communication_suppressions/i);
  assert(iPrefLock >= 0 && iSuppLock >= 0, "both locks present");
  // L4: fixed order — preferences lock strictly before suppressions lock (never reversed).
  assert(iPrefLock < iSuppLock, "L4. preferences lock precedes suppressions lock (fixed order)");
  // locks come AFTER the prerequisite existence checks.
  assert(iInboundPrereq >= 0 && iPrefLock > iInboundPrereq, "locks follow the prerequisite existence checks");
  // L5-L6: both locks BEFORE both row-count checks.
  assert(iSuppLock < iPrefCount && iSuppLock < iSuppCount, "L5-L6. both locks precede both row-count checks");
  // L7: both locks BEFORE CREATE TABLE communication_consent_events.
  assert(iSuppLock < iCreate, "L7. both locks precede CREATE TABLE communication_consent_events");
  // L8-L9: both locks BEFORE any ALTER of either current-state table.
  assert(iSuppLock < iAlterPref, "L8. both locks precede ALTER communication_preferences");
  assert(iSuppLock < iAlterSupp, "L9. both locks precede ALTER communication_suppressions");
  // L10: no non-transactional statement (would break the single-transaction lock hold).
  hasNot(/create\s+(unique\s+)?index\s+concurrently|\bvacuum\b|reindex\s+concurrently/i, migCode(), "L10. no CREATE INDEX CONCURRENTLY / non-transactional statement");
  // L11: transaction-compatible + one-execution instruction; no statement-by-statement directive.
  has(/one (atomic )?transaction|as one transaction|entire file as one/i, raw, "L11. instructs single-transaction application");
  hasNot(/(apply|run|execute)[^.\n]{0,40}(block|section|statement)s?[^.\n]{0,25}(separately|individually|one at a time)/i, raw, "L11. no statement-by-statement application directive");
});

// ============================================================================
// ACTOR ADMIN-ONLY (correction) — all four actor cases via one complete CHECK
// ============================================================================
check("actor: actor_id admin-only (system/user/provider → null; admin → required)", () => {
  const e = ev();
  // One complete CHECK proves all four cases: admin ⟹ actor_id present; system/user/provider
  // (<> admin) ⟹ actor_id null. The affected principal stays the typed (principal_type, principal_id).
  has(/chk_consent_evt_actor check \( \(actor_type = 'admin' and actor_id is not null\) or \(actor_type <> 'admin' and actor_id is null\) \)/, e,
    "one complete CHECK covers all four actor cases");
  hasNot(/chk_consent_evt_admin_actor/, e, "the old admin-only-half CHECK is fully replaced");
});

// ============================================================================
// PREFERENCE TARGET FORBIDS destination_hash (correction)
// ============================================================================
check("preference evidence cannot carry a destination_hash (suppression may optionally carry a principal)", () => {
  const e = ev();
  has(/target_type = 'preference'[^)]*and destination_hash is null/, e, "preference branch forbids destination_hash");
  has(/target_type = 'suppression' and destination_hash is not null and scope in \('transactional', 'marketing', 'global'\)/, e,
    "suppression branch requires destination_hash; principal pair remains optional linkage");
});

// ============================================================================
// MUTATIONS
// ============================================================================
const mutationChecks = [];
function mut(name, file, from, to) { mutationChecks.push({ name, file, edits: [[from, to]] }); }
function mutM(name, file, edits) { mutationChecks.push({ name, file, edits }); }
/** A pure-scenario mutation (no file edit, no git-dirty): scenario() returns true when the vulnerability is caught. */
function mutFn(name, scenario) { mutationChecks.push({ name, kind: "fn", scenario }); }

mut("MUT A: remove the dormant-data guard", MIGRATION_SRC,
  "  if v_pref_rows > 0 or v_supp_rows > 0 then", "  if false then");
mut("MUT B: allow a partial principal pair", MIGRATION_SRC,
  "    or (principal_type is not null and principal_id is not null)", "    or (false)");
mut("MUT C: allow a subjectless evidence event", MIGRATION_SRC,
  "    or destination_hash is not null", "    or (false)");
mut("MUT D: permit a preference target without a principal", MIGRATION_SRC,
  "       and principal_type is not null and principal_id is not null", "       and (true)");
mut("MUT E: permit a suppression target without a destination hash", MIGRATION_SRC,
  "       and destination_hash is not null", "       and (true)");
mut("MUT F: remove the evidence destination-hash format check", MIGRATION_SRC,
  "  destination_hash     text check (destination_hash is null or destination_hash ~ '^[0-9a-f]{64}$'),",
  "  destination_hash     text,");
mut("MUT G: make the idempotency key non-unique", MIGRATION_SRC,
  "create unique index if not exists uq_comm_consent_event_idempotency",
  "create index if not exists uq_comm_consent_event_idempotency");
mut("MUT H: allow non-object / unbounded metadata", MIGRATION_SRC,
  "jsonb_typeof(metadata_sanitized) = 'object'", "jsonb_typeof(metadata_sanitized) in ('object', 'array')");
mut("MUT I: grant evidence UPDATE to service_role", MIGRATION_SRC,
  "grant select, insert on public.communication_consent_events to service_role;",
  "grant select, insert, update on public.communication_consent_events to service_role;");
mut("MUT J: allow a nullable preference principal_id", MIGRATION_SRC,
  "  alter table public.communication_preferences alter column principal_id set not null;",
  "  -- (mutation) principal_id left nullable");
mut("MUT K: allow a durable preference 'unknown' state", MIGRATION_SRC,
  "      add constraint chk_comm_preference_state check (state in ('allowed', 'blocked'));",
  "      add constraint chk_comm_preference_state check (state in ('allowed', 'blocked', 'unknown'));");
mut("MUT L: weaken preference timestamp consistency", MIGRATION_SRC,
  "        (state = 'allowed' and consented_at is not null and withdrawn_at is null)", "        (true)");
mut("MUT M: remove the suppression active/deactivated invariant", MIGRATION_SRC,
  "        (is_active = true and deactivated_at is null)", "        (true)");
mut("MUT N: remove the expired-suppression read rule from the migration", MIGRATION_SRC,
  "is_active AND (expires_at IS NULL OR expires_at > evaluatedAt)", "is_active only");
mut("MUT O: add STOP/START/HELP handling to the webhook service", WEBHOOK_SVC_SRC,
  'const CHANNEL = "whatsapp";',
  'const CHANNEL = "whatsapp";\nfunction __d2bStopStart(t: string) { return t === "STOP" || t === "START" || t === "HELP"; }');
mut("MUT P: wire a consent decision/writer into the webhook service", WEBHOOK_SVC_SRC,
  'const CHANNEL = "whatsapp";',
  'const CHANNEL = "whatsapp";\nimport { writeConsentDecision } from "./communicationConsentWriterService";');

// ---- Correction mutations (race-safe locks, actor, target-shape, PUBLIC revoke) --------------
mut("MUT Q: remove both LOCK TABLE statements", MIGRATION_SRC,
  "  lock table public.communication_preferences in access exclusive mode;\n  lock table public.communication_suppressions in access exclusive mode;",
  "  -- (MUT Q) locks removed");
mut("MUT R: downgrade ACCESS EXCLUSIVE to ACCESS SHARE", MIGRATION_SRC,
  "  lock table public.communication_preferences in access exclusive mode;",
  "  lock table public.communication_preferences in access share mode;");
mutM("MUT S: move the locks after the row-count checks", MIGRATION_SRC, [
  ["  lock table public.communication_preferences in access exclusive mode;\n  lock table public.communication_suppressions in access exclusive mode;",
   "  -- (MUT S) locks relocated below the counts"],
  ["  select count(*) into v_supp_rows from public.communication_suppressions;",
   "  select count(*) into v_supp_rows from public.communication_suppressions;\n  lock table public.communication_preferences in access exclusive mode;\n  lock table public.communication_suppressions in access exclusive mode;"],
]);
mut("MUT T: reverse the deterministic lock order", MIGRATION_SRC,
  "  lock table public.communication_preferences in access exclusive mode;\n  lock table public.communication_suppressions in access exclusive mode;",
  "  lock table public.communication_suppressions in access exclusive mode;\n  lock table public.communication_preferences in access exclusive mode;");
mutM("MUT U: move a lock after CREATE TABLE / ALTER TABLE", MIGRATION_SRC, [
  ["  lock table public.communication_suppressions in access exclusive mode;\n", ""],
  ["alter table public.communication_preferences\n  add column if not exists policy_version text,",
   "lock table public.communication_suppressions in access exclusive mode;\nalter table public.communication_preferences\n  add column if not exists policy_version text,"],
]);
mut("MUT V: permit a non-admin actor_id", MIGRATION_SRC,
  "    or (actor_type <> 'admin' and actor_id is null)",
  "    or (actor_type <> 'admin')");
mut("MUT W: permit destination_hash on preference evidence", MIGRATION_SRC,
  "       and destination_hash is null\n       and scope in ('authentication', 'transactional', 'marketing'))",
  "       and scope in ('authentication', 'transactional', 'marketing'))");
mut("MUT X: remove the PUBLIC revoke on the evidence ledger", MIGRATION_SRC,
  "revoke all on table public.communication_consent_events from public;\n",
  "");

// ---- Cross-phase compatibility mutations (D2-C): the HISTORICAL boundary stays strict ----------
// These exercise the PURE validator with a simulated delta — no git-dirty dependency.
mutFn("MUT Y: a service file inside the simulated D2-B delta is rejected",
  () => validateD2BHistoricalDelta([...D2B_HISTORICAL_FILES, "services/communicationConsentDecisionService.ts"], D2B_EXPECTED_PARENT).length > 0);
mutFn("MUT Z: removing an approved file from the simulated D2-B delta is rejected",
  () => validateD2BHistoricalDelta(D2B_HISTORICAL_FILES.filter((f) => f !== "package.json"), D2B_EXPECTED_PARENT).length > 0);
mutFn("MUT AA: an incorrect expected D2-B parent is rejected",
  () => validateD2BHistoricalDelta(D2B_HISTORICAL_FILES, "0000000000000000000000000000000000000000").length > 0);

// ============================================================================
// RUNNER
// ============================================================================
async function runFunctional() {
  let passed = 0, failed = 0;
  console.log("Running Phase 5F-D2-B consent evidence schema checks...\n");
  for (const c of checks) {
    try { await c.fn(); console.log(`PASS ${c.name}`); passed++; }
    catch (e) { console.log(`FAIL ${c.name}`); console.error(e); failed++; }
  }
  return { passed, failed };
}
async function suiteGoesRed() { for (const c of checks) { try { await c.fn(); } catch { return true; } } return false; }
async function runMutations() {
  let passed = 0, failed = 0;
  console.log("\nRunning Phase 5F-D2-B mutation tests...\n");
  for (const m of mutationChecks) {
    if (m.kind === "fn") {
      try {
        const caught = await m.scenario();
        if (caught) { console.log(`PASS ${m.name}`); passed++; }
        else { console.log(`FAIL ${m.name} (historical guard did not prove load-bearing)`); failed++; }
      } catch (e) { console.log(`FAIL ${m.name}`); console.error(e); failed++; }
      continue;
    }
    const p = resolve(m.file);
    const original = readFileSync(p, "utf8");
    try {
      let cur = original;
      for (const [from, to] of m.edits) {
        if (!cur.includes(from)) throw new Error(`anchor not found in ${m.file}: ${JSON.stringify(from.slice(0, 48))}`);
        cur = cur.replace(from, to);
      }
      writeFileSync(p, cur);
      const violation = await suiteGoesRed();
      if (violation) { console.log(`PASS ${m.name}`); passed++; }
      else { console.log(`FAIL ${m.name} (guard did not prove load-bearing)`); failed++; }
    } catch (e) { console.log(`FAIL ${m.name}`); console.error(e); failed++; }
    finally { writeFileSync(p, original); }
  }
  return { passed, failed };
}

const functional = await runFunctional();
const mutations = await runMutations();
const passed = functional.passed + mutations.passed;
const failed = functional.failed + mutations.failed;
console.log(`\nSummary: ${passed} passed, ${failed} failed (functional: ${functional.passed}/${functional.passed + functional.failed}, mutation: ${mutations.passed}/${mutations.passed + mutations.failed}).`);
process.exit(failed > 0 ? 1 : 0);
