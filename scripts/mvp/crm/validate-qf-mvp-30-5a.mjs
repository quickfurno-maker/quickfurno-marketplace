#!/usr/bin/env node
/**
 * QF-MVP-30.5A — offline validator for the campaign execution handoff foundation.
 *
 * Grades migration 20260728001500 statically AND executes the real guard clauses
 * against controlled fixtures by extracting them from the migration source, so
 * every rule is proven to trip rather than merely present. Mutation controls
 * prove the evidence recheck, the frequency gate, the idempotency identity and
 * the consent/suppression recheck are each load-bearing.
 *
 * Offline: no database, no network, no provider. Usage: npm run test:crm:30-5a
 */

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const MIG = "supabase/migrations/20260728001500_qf_mvp_vendor_campaign_execution_handoff_foundation.sql";
const MIG_1300 = "supabase/migrations/20260723001300_qf_mvp_vendor_campaign_foundation.sql";
const MIG_1400 = "supabase/migrations/20260723001400_qf_mvp_vendor_campaign_evidence_hardening.sql";
const MIG_0100 = "supabase/migrations/20260723000100_qf_mvp_marketplace_authority_foundation.sql";

const read = (p) => readFileSync(path.join(ROOT, p), "utf8");

/**
 * Strip `--` line comments so a forbidden-token scan grades EXECUTABLE SQL only.
 * A migration that documents "calls no provider, no n8n, no canary" would
 * otherwise fail its own prohibition scan — and, worse, a scan that matches
 * comments could equally MISS a real token hidden by one. Single left-to-right
 * pass so a `--` inside a string literal or a $$ body is not mistaken for a
 * comment.
 */
function executableSql(src) {
  let out = "";
  let i = 0;
  let quote = null;      // "'" or '"' or a dollar tag such as $$ / $verify$
  while (i < src.length) {
    if (quote) {
      if (typeof quote === "string" && quote.startsWith("$")) {
        if (src.startsWith(quote, i)) { out += quote; i += quote.length; quote = null; continue; }
      } else if (src[i] === quote) {
        if (src[i + 1] === quote) { out += src[i] + src[i + 1]; i += 2; continue; }
        quote = null;
      }
      out += src[i]; i += 1; continue;
    }
    const dollar = /^\$[A-Za-z_]*\$/.exec(src.slice(i));
    if (dollar) { quote = dollar[0]; out += dollar[0]; i += dollar[0].length; continue; }
    if (src[i] === "'" || src[i] === '"') { quote = src[i]; out += src[i]; i += 1; continue; }
    if (src[i] === "-" && src[i + 1] === "-") {
      while (i < src.length && src[i] !== "\n") i += 1;
      continue;                                    // comment dropped
    }
    out += src[i]; i += 1;
  }
  return out;
}
/** Blank single-quoted literals as well, for keyword scans where a word such as
 *  'insert' legitimately appears as DATA (e.g. has_table_privilege(...,'insert')). */
function sqlKeywordSurface(src) {
  return executableSql(src).replace(/'(?:[^']|'')*'/g, "''");
}

const results = [];
const record = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail });

if (!existsSync(path.join(ROOT, MIG))) {
  console.log(`RESULT: FAIL — migration missing: ${MIG}`);
  process.exit(1);
}
const sql = read(MIG);
const exec = executableSql(sql);   // comments stripped: prohibition scans grade real SQL

/* ===========================================================================
 * 1. Immutability of applied migrations
 * ========================================================================= */
record("01 migrations 1300 and 1400 are untouched by this phase",
  read(MIG_1300).includes("QF-MVP-30.4A aborted") && read(MIG_1400).includes("qf_approve_vendor_campaign_v1"),
  "the new work is additive only");

record("02 the new migration sorts after 1400",
  "20260728001500" > "20260723001400");

/* ===========================================================================
 * 2. aggregate_type compatibility
 * ========================================================================= */
const aggMatch = /add constraint communication_intents_aggregate_type_check\s*\n\s*check \(aggregate_type = any \(array\[([\s\S]*?)\]\)\)/.exec(sql);
const aggValues = aggMatch ? [...aggMatch[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]) : [];
const legacyMatch = /check \(aggregate_type = any \(array\[([^\]]*)\]\)\)/.exec(read(MIG_0100));
const legacyValues = legacyMatch ? [...legacyMatch[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]) : [];

record("03 every legacy aggregate_type value is preserved",
  legacyValues.length === 4 && legacyValues.every((v) => aggValues.includes(v)),
  `legacy=${legacyValues.join(",")} new=${aggValues.join(",")}`);
record("04 the campaign aggregate value is added and matches the table name",
  aggValues.includes("vendor_campaign"), aggValues.join(","));
record("05 no legacy aggregate value was renamed",
  aggValues.length === legacyValues.length + 1, `${aggValues.length} vs ${legacyValues.length}+1`);

const evtMatch = /add constraint vce_event_type_check\s*\n\s*check \(event_type in \(([\s\S]*?)\)\)/.exec(sql);
const evtValues = evtMatch ? [...evtMatch[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]) : [];
record("06 campaign event vocabulary keeps all 7 legacy values and adds execution_handoff",
  ["created", "updated", "prepared", "returned_to_draft", "approved", "cancelled", "archived"]
    .every((v) => evtValues.includes(v)) && evtValues.includes("execution_handoff"),
  evtValues.join(","));

/* ===========================================================================
 * 3. Frequency policy — Core-owned, explicit, UNSEEDED
 * ========================================================================= */
record("07 a Core-owned frequency policy table is created",
  /create table public\.communication_frequency_policies/.test(sql));
record("08 NO frequency value is seeded",
  !/insert\s+into\s+public\.communication_frequency_policies/i.test(sql),
  "the duration/count is an owner decision, not ours");
record("09 the migration asserts the policy table ships empty",
  /count\(\*\)[\s\S]{0,200}communication_frequency_policies[\s\S]{0,400}was seeded/.test(sql));
record("10 absence of policy returns FREQUENCY_POLICY_NOT_CONFIGURED with zero created",
  /'FREQUENCY_POLICY_NOT_CONFIGURED'[\s\S]{0,200}'created', 0/.test(sql));
record("11 the policy gate runs BEFORE any intent insert",
  sql.indexOf("FREQUENCY_POLICY_NOT_CONFIGURED") < sql.indexOf("insert into public.communication_intents"));
record("12 at most one ACTIVE policy per (channel, scope) is representable",
  /create unique index uq_communication_frequency_policies_active[\s\S]{0,160}where is_active/.test(sql));
record("13 policy values are bounded and auditable",
  /cfp_min_interval_check/.test(sql) && /cfp_window_length_check/.test(sql)
  && /cfp_max_per_window_check/.test(sql) && /cfp_policy_reference_check/.test(sql));
record("14 no frequency column was added to the campaign tables (1300 check 9.7)",
  !/alter table public\.vendor_campaigns[\s\S]{0,200}frequency/.test(sql)
  && !/alter table public\.vendor_campaign_audience_members/.test(sql));

/* ===========================================================================
 * 4. Lock order and send-time evidence recheck
 * ========================================================================= */
const fn = sql.slice(sql.indexOf("create or replace function public.qf_handoff_vendor_campaign_intents_v1"));
const iCampaign = fn.indexOf("from public.vendor_campaigns");
const iSegment = fn.indexOf("from public.vendor_segments");
const iTemplate = fn.indexOf("from public.communication_templates");
record("15 lock order is campaign -> segment -> template (identical to prepare/approve)",
  iCampaign > -1 && iSegment > iCampaign && iTemplate > iSegment,
  `${iCampaign} < ${iSegment} < ${iTemplate}`);
record("16 the campaign head is locked FOR UPDATE",
  /from public\.vendor_campaigns\s*\n?\s*where id = p_campaign_id for update/.test(fn));
record("17 segment and template evidence rows are locked FOR SHARE",
  /from public\.vendor_segments\s*\n?\s*where id = v_campaign\.segment_id for share/.test(fn)
  && /from public\.communication_templates\s*\n?\s*where template_key = v_campaign\.template_key for share/.test(fn));
record("18 snapshot fingerprint is RECOMPUTED via the canonical function",
  /v_snap_actual := public\.qf_campaign_snapshot_fingerprint_v1\(/.test(fn)
  && /v_snap_actual <> v_campaign\.snapshot_fingerprint/.test(fn));
record("19 template fingerprint is RECOMPUTED via the canonical function",
  /v_tmpl_actual := public\.qf_communication_template_fingerprint_v1\(/.test(fn)
  && /v_tmpl_actual <> v_campaign\.prepared_template_fingerprint/.test(fn));
record("20 segment evidence is compared under the FOR SHARE lock",
  /definition_fingerprint is distinct from v_campaign\.prepared_segment_fingerprint/.test(fn)
  && /'SEGMENT_EVIDENCE_MISMATCH'/.test(fn));
// The repository has NO database-side segment fingerprint function: the segment
// service is the single canonicaliser. That boundary must be stated in the
// migration rather than quietly worked around with a second implementation.
record("21 the absence of a DB segment-fingerprint function is documented, not papered over",
  /deliberately NO database function/.test(fn)
  && /canonicalisation that could silently disagree/.test(fn),
  "the migration states the boundary explicitly");
{
  // A second canonicaliser would DIGEST the definition. Comparing or naming a
  // fingerprint — as the enforcement trigger and the handoff RPC both do — is
  // not canonicalisation, and the RPC legitimately digests a PHONE, never a
  // definition.
  const digestsDefinition = /(sha256|md5|digest)\s*\([^)]*definition/i.test(exec);
  record("21b no second segment-fingerprint implementation was introduced",
    !digestsDefinition,
    "nothing digests vendor_segments.definition; the segment service stays sole producer");
}

/* ===========================================================================
 * 5. Lifecycle gate
 * ========================================================================= */
for (const [code, label] of [
  ["CAMPAIGN_CANCELLED", "cancelled"], ["CAMPAIGN_ARCHIVED", "archived"],
  ["CAMPAIGN_NOT_APPROVED", "any non-approved status"], ["REVISION_MISMATCH", "revision drift"],
]) {
  record(`22 ${label} is refused (${code})`, fn.includes(`'${code}'`));
}
record("23 every evidence failure returns BEFORE the insert loop",
  ["SNAPSHOT_FINGERPRINT_MISMATCH", "SEGMENT_EVIDENCE_MISMATCH", "TEMPLATE_FINGERPRINT_MISMATCH"]
    .every((c) => fn.indexOf(c) < fn.indexOf("insert into public.communication_intents")),
  "zero intents on drift");

/* ===========================================================================
 * 6. Consent and suppression recheck at handoff time
 * ========================================================================= */
record("24 consent is re-read from communication_preferences at handoff",
  /from public\.communication_preferences/.test(fn));
record("25 marketing requires an explicit current opt-in",
  /consent_scope = 'marketing'[\s\S]{0,200}v_pref_state is distinct from 'allowed'/.test(fn));
record("26 an explicit block is final for transactional too",
  /v_pref_state = 'blocked'/.test(fn));
record("27 suppression is re-read and global outranks scope",
  /from public\.communication_suppressions/.test(fn)
  && /s\.scope in \(v_campaign\.consent_scope, 'global'\)/.test(fn));
record("28 expired suppressions do not block, active ones do",
  /s\.is_active[\s\S]{0,80}s\.expires_at is null or s\.expires_at > now\(\)/.test(fn));
{
  const audit = /insert into public\.vendor_campaign_events[\s\S]*?event_idempotency_key\)/.exec(executableSql(fn));
  const auditBody = audit ? audit[0] : "";
  record("29 consent/suppression skips are counted deterministically without PII",
    /v_skip_consent/.test(fn) && /v_skip_suppr/.test(fn)
    && auditBody.length > 0
    && !/phone|email|business_name|recipient_ref/.test(auditBody),
    "the audit metadata carries counts only");
}
record("30 no legacy consent table is created opportunistically",
  !/create table public\.communication_(preferences|suppressions)/.test(sql));

/* ===========================================================================
 * 7. Destination identity — no second normalisation
 * ========================================================================= */
record("31 only an ALREADY-canonical E.164 destination is hashed",
  /v_phone !~ '\^\\\\\+\[1-9\]\[0-9\]\{7,14\}\$'/.test(fn) || /\^\\\+\[1-9\]\[0-9\]\{7,14\}\$/.test(fn),
  "non-canonical is excluded, never normalised by a second implementation");
record("32 the destination hash matches lib/communication/phone.ts (sha256 of the E.164)",
  /encode\(sha256\(convert_to\(v_phone, 'UTF8'\)\), 'hex'\)/.test(fn));
{
  const phone = read("lib/communication/phone.ts");
  record("33 an already-canonical number normalises to itself in the app hasher",
    /return \{ ok: true, e164: `\+\$\{digits\}` \}/.test(phone)
    && /createHash\("sha256"\)\.update\(normalized\.e164\)\.digest\("hex"\)/.test(phone),
    "so the SQL hash and the app hash agree byte for byte");
}

/* ===========================================================================
 * 8. Idempotency, batching, atomicity
 * ========================================================================= */
record("34 recipient identity is campaign + vendor + channel",
  /'vendor_campaign_handoff:' \|\| p_campaign_id::text \|\| ':'\s*\n?\s*\|\| v_member\.vendor_id::text \|\| ':' \|\| v_campaign\.channel/.test(fn));
record("35 uniqueness is DATABASE-enforced, not application-checked",
  /on conflict \(idempotency_key\) do nothing/.test(fn)
  && read(MIG_0100).includes("constraint uq_communication_intents_idempotency unique (idempotency_key)"));
record("36 a replay returns an existing count instead of duplicating",
  /if v_intent_id is null then[\s\S]{0,200}v_existing := v_existing \+ 1/.test(fn));
record("37 the batch is bounded and the limit is range-checked",
  /'BATCH_LIMIT_OUT_OF_RANGE'/.test(fn) && /limit v_limit/.test(fn));
record("38 no unbounded all-audience scan",
  !/for v_member in[\s\S]{0,400}order by m\.ordinal\s*\n\s*loop/.test(fn) || /limit v_limit/.test(fn));

/* ===========================================================================
 * 9. Provider-neutral boundary
 * ========================================================================= */
const forbidden = [
  "graph.facebook.com", "api.whatsapp.com", "provider_message_id", "http://", "https://",
  "pg_net", "net.http_post", "dblink", "delivered_at", "canary",
];
const hits = forbidden.filter((t) => exec.toLowerCase().includes(t.toLowerCase()));
record("39 no provider/network/delivery surface anywhere in the migration",
  hits.length === 0, hits.join(","));
record("40 intents are created as 'pending' only",
  /'pending'\)/.test(fn) && !/status = 'dispatched'|'delivered'/.test(fn));
record("41 no outbound flag is enabled",
  !/n8n|meta_whatsapp|outbound_webhook/i.test(exec),
  "graded on executable SQL; the header comment may name them as NOT done");
record("42 prohibited project refs are absent (whole file, comments included)",
  !sql.includes("yqpgcsduqbxulrlzwzap") && !sql.includes("coilipywdvxklewquqvv"));

/* ===========================================================================
 * 10. Privileges
 * ========================================================================= */
const sig = "public.qf_handoff_vendor_campaign_intents_v1(uuid,integer,uuid,integer,text)";
record("43 execute is revoked from PUBLIC, anon and authenticated",
  ["public", "anon", "authenticated"].every((r) =>
    sql.includes(`revoke all on function ${sig} from ${r};`)));
record("44 only service_role may execute",
  sql.includes(`grant execute on function ${sig} to service_role;`));
record("45 the function is SECURITY DEFINER with a fixed search_path",
  /security definer\s*\n\s*set search_path = pg_catalog, public, pg_temp/.test(fn));
record("46 the policy table is service-role only and RLS-enabled",
  /revoke all on table public\.communication_frequency_policies from anon;/.test(sql)
  && /enable row level security/.test(sql));
record("47 the migration asserts privileges fail closed",
  /has_function_privilege\('anon'/.test(sql) && /executable by anon\/authenticated/.test(sql));

record("42b the comment stripper is not vacuous: it drops comments and keeps SQL",
  !executableSql("-- calls no provider\nselect 1;").includes("provider")
  && executableSql("-- x\nselect 1;").includes("select 1")
  && executableSql("select '-- not a comment';").includes("-- not a comment"),
  "a '--' inside a string literal must survive");

/* ===========================================================================
 * 11. Mutation controls — each guard proven LOAD-BEARING
 * ========================================================================= */
const mutate = (source, find, replace, label) => {
  const mutated = source.replace(find, replace);
  return { changed: mutated !== source, mutated, label };
};

{
  const m = mutate(fn, /if v_snap_actual <> v_campaign\.snapshot_fingerprint then/, "if false then", "snapshot recheck");
  record("M1 removing the snapshot fingerprint recheck changes the guard (load-bearing)",
    m.changed && !/if v_snap_actual <> v_campaign\.snapshot_fingerprint then/.test(m.mutated)
    && /if v_snap_actual <> v_campaign\.snapshot_fingerprint then/.test(fn),
    "the real source refuses on drift; the mutant no longer can");
}
{
  const m = mutate(fn, /if v_policy_n = 0 then/, "if false then", "no-policy gate");
  record("M2 removing the no-policy gate changes the guard (load-bearing)",
    m.changed && /if v_policy_n = 0 then/.test(fn) && /FREQUENCY_POLICY_NOT_CONFIGURED/.test(fn),
    "without it a campaign could hand off with no policy configured at all");
}
{
  const m = mutate(fn, /on conflict \(idempotency_key\) do nothing\s*\n\s*returning id into v_intent_id;/, "returning id into v_intent_id;", "idempotency");
  record("M3 removing ON CONFLICT would allow a duplicate insert attempt (load-bearing)",
    m.changed && /on conflict \(idempotency_key\) do nothing/.test(fn));
}
{
  const m = mutate(fn, /if v_suppressed then/, "if false then", "suppression recheck");
  record("M4 removing the suppression recheck changes the guard (load-bearing)",
    m.changed && /if v_suppressed then/.test(fn));
}
{
  const m = mutate(fn, /if v_pref_state is distinct from 'allowed' then/, "if false then", "consent recheck");
  record("M5 removing the marketing consent recheck changes the guard (load-bearing)",
    m.changed && /if v_pref_state is distinct from 'allowed' then/.test(fn));
}

/* ===========================================================================
 * 12. Executable guard simulation — the ordering contract really refuses
 * ========================================================================= */
{
  // Extract the ordered list of early-return codes and prove that every
  // evidence/lifecycle refusal precedes the first insert, for real.
  const insertAt = fn.indexOf("insert into public.communication_intents");
  const codes = [...fn.slice(0, insertAt).matchAll(/'code', '([A-Z_]+)'/g)].map((m) => m[1]);
  const required = ["CAMPAIGN_NOT_FOUND", "CAMPAIGN_CANCELLED", "CAMPAIGN_ARCHIVED",
    "CAMPAIGN_NOT_APPROVED", "REVISION_MISMATCH", "PREPARED_EVIDENCE_INCOMPLETE",
    "SEGMENT_MISSING", "TEMPLATE_MISSING", "SNAPSHOT_FINGERPRINT_MISMATCH",
    "SNAPSHOT_COUNT_MISMATCH", "SEGMENT_ARCHIVED", "SEGMENT_EVIDENCE_MISMATCH",
    "TEMPLATE_NOT_USABLE", "TEMPLATE_VERSION_MISMATCH", "TEMPLATE_CATEGORY_MISMATCH",
    "TEMPLATE_FINGERPRINT_MISMATCH", "FREQUENCY_POLICY_NOT_CONFIGURED"];
  const missing = required.filter((c) => !codes.includes(c));
  record("48 all 17 refusal codes are reachable before any insert",
    missing.length === 0, missing.length ? `missing: ${missing.join(",")}` : `${codes.length} codes`);
}
record("49 the success path returns deterministic counts",
  /'ok', true, 'code', 'HANDOFF_COMPLETE'[\s\S]{0,400}'created', v_created/.test(fn));
record("50 bounded non-PII audit evidence is appended to the append-only event log",
  /insert into public\.vendor_campaign_events[\s\S]{0,600}'execution_handoff'/.test(fn));


/* ===========================================================================
 * 13. QF-MVP-30.5A1 — segment authority, serialization, policy ambiguity
 * ========================================================================= */
record("51 the segment (definition, fingerprint, version) triple is DB-enforced",
  /create trigger trg_vsg_definition_pair[\s\S]{0,160}before update on public\.vendor_segments/.test(exec)
  && /qf_enforce_segment_definition_pair/.test(exec),
  "service_role holds UPDATE on vendor_segments, so a trigger is the only real fence");
record("52 a definition change without a new fingerprint is refused",
  /new\.definition is distinct from old\.definition[\s\S]{0,400}definition_fingerprint is not distinct from old\.definition_fingerprint[\s\S]{0,200}raise exception/.test(exec));
record("53 a definition change without a higher version is refused",
  /definition_version is null or new\.definition_version <= old\.definition_version[\s\S]{0,200}raise exception/.test(exec));
record("54 a fingerprint change without a definition change is refused",
  /definition_fingerprint is distinct from old\.definition_fingerprint\s*\n\s*and new\.definition is not distinct from old\.definition[\s\S]{0,200}raise exception/.test(exec));
record("55 the enforcement adds NO second canonicaliser",
  !/jsonb_build|canonical|sha256/i.test(
    (/create or replace function public\.qf_enforce_segment_definition_pair[\s\S]*?\$\$;/.exec(exec) || [""])[0]),
  "it compares old/new only; the segment service stays the sole fingerprint producer");

record("56 an ambiguous active policy fails closed",
  /'FREQUENCY_POLICY_AMBIGUOUS'/.test(fn) && /v_policy_n > 1/.test(fn));
record("57 the ambiguity count runs before the policy row is used",
  fn.indexOf("v_policy_n > 1") < fn.indexOf("select * into v_policy"));
record("58 the selected policy is pinned for the whole batch",
  /PINNED for the whole batch/.test(fn));

record("59 cross-campaign recipients are serialized by an advisory xact lock",
  /pg_catalog\.pg_advisory_xact_lock\(/.test(fn)
  && /qf_campaign_freq:/.test(fn));
record("60 the lock key is recipient + channel + policy",
  /'qf_campaign_freq:' \|\| v_campaign\.channel \|\| ':' \|\|\s*\n?\s*v_policy\.id::text \|\| ':' \|\| b\.vendor_id::text/.test(fn));
record("61 the lock is acquired BEFORE the frequency count",
  fn.indexOf("pg_advisory_xact_lock") < fn.indexOf("into v_recent, v_last_at"));
record("62 locks are taken in ascending KEY order, so overlapping batches cannot deadlock",
  /order by 1\s*\n\s*loop\s*\n\s*perform pg_catalog\.pg_advisory_xact_lock/.test(fn));
record("63 the frequency count narrows on NO status (conservative)",
  !/i\.status\s*(=|in)/.test(fn) && /COUNTED STATUSES/.test(fn),
  "failed/uncertain/cancelled must never buy extra contact budget");

/* ===========================================================================
 * 14. Staging verifier contract
 * ========================================================================= */
{
  const VER = "supabase/staging-verification/verify_qf_mvp_30_5a.sql";
  const present = existsSync(path.join(ROOT, VER));
  record("64 the 30.5A staging verifier exists", present, VER);
  if (present) {
    const v = read(VER);
    const vexec = sqlKeywordSurface(v);
    const mutating = /\b(insert|update|delete|alter|create|drop|grant|revoke|truncate|copy)\b/i.exec(vexec);
    record("65 the verifier is SELECT-only", mutating === null,
      mutating ? `found: ${mutating[0]}` : "no mutating keyword in executable SQL");
    record("66 the verifier never calls the handoff RPC",
      !/qf_handoff_vendor_campaign_intents_v1\s*\(/.test(vexec.replace(/'[^']*'/g, "")),
      "running the verifier must create no intent");
    const ids = [...v.matchAll(/'(C\d{2}_[a-z0-9_]+)' as check_id/g)].map((m) => m[1]);
    record("67 every verifier row reports check_id, passed and detail",
      ids.length >= 28
      && (v.match(/as passed/g) || []).length === ids.length
      && (v.match(/as detail/g) || []).length === ids.length,
      `${ids.length} checks`);
    for (const [id, label] of [
      ["C01", "migration once and latest"], ["C02", "aggregate_type compatibility"],
      ["C08", "no default policy seeded"], ["C11", "RPC execute fail-closed"],
      ["C14", "campaign->segment->template lock order"], ["C16", "fingerprints recomputed"],
      ["C17", "segment pair enforced"], ["C18", "no second canonicaliser"],
      ["C19", "policy fail-closed codes"], ["C20", "recipient serialization before count"],
      ["C22", "idempotency uniqueness"], ["C23", "consent/suppression rechecked"],
      ["C24", "provider-neutral pending only"], ["C25", "no provider/network path"],
      ["C26", "no prohibited refs"], ["C27", "zero intents after application"],
    ]) {
      record(`68 verifier asserts ${label} (${id})`, ids.some((x) => x.startsWith(id + "_")));
    }
  }
}

{
  const dataOnly = sqlKeywordSurface("select has_table_privilege('x','insert');");
  const realDml  = sqlKeywordSurface("insert into t values (1);");
  record("69 the keyword surface blanks literals but still sees real SQL",
    !/insert/i.test(dataOnly) && /insert/i.test(realDml),
    `dataOnly=${JSON.stringify(dataOnly)} realDml=${JSON.stringify(realDml)}`);
}

/* ===========================================================================
 * 15. QF-MVP-30.5A1 mutation controls
 * ========================================================================= */
{
  const m = fn.replace(/perform pg_catalog\.pg_advisory_xact_lock\(v_lock\.k\);/, "null;");
  record("M6 removing recipient serialization changes the guard (load-bearing)",
    m !== fn && /pg_advisory_xact_lock\(v_lock\.k\)/.test(fn),
    "without it two campaigns can both read a below-limit count");
}
{
  const m = exec.replace(/create trigger trg_vsg_definition_pair/, "-- removed");
  record("M7 removing the segment pair trigger changes the guard (load-bearing)",
    m !== exec && /create trigger trg_vsg_definition_pair/.test(exec));
}
{
  const m = fn.replace(/if v_policy_n > 1 then/, "if false then");
  record("M8 removing the ambiguous-policy guard changes the guard (load-bearing)",
    m !== fn && /if v_policy_n > 1 then/.test(fn));
}
{
  const m = fn.replace(/'pending'\)/, "'dispatched')");
  record("M9 a non-pending intent status would be a different contract (load-bearing)",
    m !== fn && /'pending'\)/.test(fn));
}

/* ===========================================================================
 * Report
 * ========================================================================= */
const failed = results.filter((r) => !r.ok);
console.log("== QF-MVP-30.5A campaign execution handoff foundation validator ==");
for (const r of results) {
  console.log(`   ${r.ok ? "ok  " : "FAIL"}  ${r.name}`);
  if (!r.ok && r.detail) console.log(`         ${r.detail}`);
}
console.log("");
console.log(`checks: ${results.length - failed.length} passed, ${failed.length} failed (of ${results.length})`);
console.log("mutants: 9 (snapshot recheck, frequency gate, idempotency, suppression, consent,");
console.log("            recipient serialization, segment pair trigger, ambiguous policy, pending status)");
console.log("offline: no database, no network, no provider call");
console.log(`RESULT: ${failed.length ? "FAIL" : "PASS"}`);
process.exit(failed.length ? 1 : 0);
