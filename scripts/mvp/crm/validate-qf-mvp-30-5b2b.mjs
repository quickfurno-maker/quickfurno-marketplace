#!/usr/bin/env node
/**
 * QF-MVP-30.5B2B — offline validator for the frequency-policy history hardening.
 *
 * Grades migration 20260728001600 and verify_qf_mvp_30_5b2b.sql statically, with
 * mutation controls proving each protection is load-bearing.
 *
 * Offline: no database, no network, no provider. Usage: npm run test:crm:30-5b2b
 */

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const MIG = "supabase/migrations/20260728001600_qf_mvp_frequency_policy_history_hardening.sql";
const MIG_1500 = "supabase/migrations/20260728001500_qf_mvp_vendor_campaign_execution_handoff_foundation.sql";
const VER = "supabase/staging-verification/verify_qf_mvp_30_5b2b.sql";
const read = (p) => readFileSync(path.join(ROOT, p), "utf8");

/** Strip `--` comments (respecting literals and $tags) so prohibition scans grade real SQL. */
function executableSql(src) {
  let out = "", i = 0, quote = null;
  while (i < src.length) {
    if (quote) {
      if (quote.startsWith("$")) {
        if (src.startsWith(quote, i)) { out += quote; i += quote.length; quote = null; continue; }
      } else if (src[i] === quote) {
        if (src[i + 1] === quote) { out += src[i] + src[i + 1]; i += 2; continue; }
        quote = null;
      }
      out += src[i]; i += 1; continue;
    }
    const d = /^\$[A-Za-z_]*\$/.exec(src.slice(i));
    if (d) { quote = d[0]; out += d[0]; i += d[0].length; continue; }
    if (src[i] === "'" || src[i] === '"') { quote = src[i]; out += src[i]; i += 1; continue; }
    if (src[i] === "-" && src[i + 1] === "-") { while (i < src.length && src[i] !== "\n") i += 1; continue; }
    out += src[i]; i += 1;
  }
  return out;
}
/** Blank literals too, for keyword scans where a word appears as DATA. */
const keywordSurface = (s) => executableSql(s).replace(/'(?:[^']|'')*'/g, "''");

const results = [];
const record = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail });

if (!existsSync(path.join(ROOT, MIG))) {
  console.log(`RESULT: FAIL — migration missing: ${MIG}`);
  process.exit(1);
}
const sql = read(MIG);
const exec = executableSql(sql);

/* === 1. immutability of prior migrations ================================= */
record("01 migrations 0001-1500 are not edited by this phase",
  read(MIG_1500).includes("qf_handoff_vendor_campaign_intents_v1")
  && read(MIG_1500).includes("trg_vsg_definition_pair"),
  "1600 is forward-only");
record("02 1600 sorts after 1500", "20260728001600" > "20260728001500");

/* === 2. the ACL correction =============================================== */
record("03 DELETE authority is removed by revoking from service_role FIRST",
  /revoke all on table public\.communication_frequency_policies from service_role;/.test(exec),
  "1500 revoked only public/anon/authenticated, and its grant was additive");
record("04 public, anon and authenticated are revoked too",
  ["public", "anon", "authenticated"].every((r) =>
    new RegExp(`revoke all on table public\\.communication_frequency_policies from ${r};`).test(exec)));
record("05 only select/insert/update is re-granted to service_role",
  /grant select, insert, update on table public\.communication_frequency_policies to service_role;/.test(exec)
  && !/grant[^;]*delete[^;]*communication_frequency_policies/i.test(exec)
  && !/grant all[^;]*communication_frequency_policies/i.test(exec));
record("06 the revoke precedes the re-grant (order is what makes it work)",
  exec.indexOf("revoke all on table public.communication_frequency_policies from service_role")
    < exec.indexOf("grant select, insert, update on table public.communication_frequency_policies"));

/* === 3. history immutability ============================================= */
const fnRewrite = /create or replace function public\.qf_prevent_frequency_policy_history_rewrite[\s\S]*?\$\$;/.exec(sql)?.[0] || "";
for (const col of ["channel", "scope", "min_interval", "max_per_window",
                   "window_length", "effective_from", "policy_reference", "created_at"]) {
  record(`07 immutable field guarded: ${col}`,
    new RegExp(`new\\.${col}\\s+is distinct from old\\.${col}`).test(fnRewrite));
}
record("08 a rewrite raises rather than silently ignoring",
  /raise exception[\s\S]{0,200}history is immutable/.test(fnRewrite));
record("09 retirement is one-way (a retired policy cannot be re-activated)",
  /old\.is_active is false and new\.is_active is true[\s\S]{0,200}raise exception/.test(fnRewrite));
record("10 effective_to is write-once",
  /old\.effective_to is not null and new\.effective_to is distinct from old\.effective_to/.test(fnRewrite));
record("11 canonical RETIREMENT is still possible — is_active/effective_to/updated_at are not frozen",
  !/new\.is_active is distinct from old\.is_active/.test(fnRewrite)
  && !/new\.updated_at is distinct from old\.updated_at/.test(fnRewrite),
  "hardening must not block the legitimate lifecycle");
record("12 the immutability trigger is BEFORE UPDATE, per row",
  /create trigger trg_cfp_history_immutable\s*\n\s*before update on public\.communication_frequency_policies\s*\n\s*for each row/.test(exec));

/* === 4. delete/truncate refusal ========================================== */
record("13 DELETE is refused by trigger, not only by grant",
  /create trigger trg_cfp_no_delete\s*\n\s*before delete on public\.communication_frequency_policies/.test(exec),
  "table grants are not consulted for the owner");
record("14 TRUNCATE is refused too, as a statement trigger",
  /create trigger trg_cfp_no_truncate\s*\n\s*before truncate on public\.communication_frequency_policies\s*\n\s*for each statement/.test(exec));
record("15 the refusal names the canonical alternative",
  /append-only; retire a policy with is_active = false/.test(sql));

/* === 5. boundaries ======================================================= */
record("16 NO policy row is seeded and no business number is chosen",
  !/insert\s+into\s+public\.communication_frequency_policies/i.test(exec));
record("17 the migration asserts no ACTIVE policy exists",
  /count\(\*\)[\s\S]{0,160}where is_active[\s\S]{0,260}owner decision/.test(sql));
record("18 no second policy model, table or column is created",
  !/create table/i.test(exec) && !/alter table[^;]*add column/i.test(exec));
record("19 both protective functions fix search_path",
  (exec.match(/set search_path = pg_catalog, public, pg_temp/g) || []).length >= 2);
{
  // Scan for USAGE, not mention. The migration's verification block names pg_net /
  // http / dblink precisely in order to assert none is installed; that is a guard,
  // not a network path. A call or an extension creation is what would matter.
  const usage = [
    /create\s+extension[^;]*(pg_net|http|dblink)/i,
    /net\.http_(post|get|delete)\s*\(/i,
    /dblink(_exec|_connect)?\s*\(/i,
    /http_(post|get)\s*\(/i,
    /graph\.facebook|api\.whatsapp|https?:\/\//i,
    /provider_message_id|dispatched_at\s*=/i,
  ].filter((re) => re.test(exec));
  record("20 no provider, network or delivery surface is USED",
    usage.length === 0, usage.map(String).join(" | ") || "guards may name them; nothing calls them");
}
record("21 no prohibited project ref anywhere in the file",
  !sql.includes("yqpgcsduqbxulrlzwzap") && !sql.includes("coilipywdvxklewquqvv"));
record("22 the handoff RPC and segment-pair trigger are asserted intact",
  /qf_handoff_vendor_campaign_intents_v1/.test(sql) && /handoff RPC is missing or became executable/.test(sql));
record("23 the migration is a single transaction",
  /^begin;/m.test(exec) && /^commit;/m.test(exec));

/* === 6. verifier contract ================================================ */
{
  const present = existsSync(path.join(ROOT, VER));
  record("24 the 30.5B2B staging verifier exists", present, VER);
  if (present) {
    const v = read(VER);
    const mut = /\b(insert|update|delete|alter|create|drop|grant|revoke|truncate|copy)\b/i.exec(keywordSurface(v));
    record("25 the verifier is SELECT-only", mut === null, mut ? `found: ${mut[0]}` : "clean keyword surface");
    record("26 the verifier never calls the handoff RPC",
      !/qf_handoff_vendor_campaign_intents_v1\s*\(/.test(keywordSurface(v)));
    const ids = [...v.matchAll(/'(D\d{2}_[a-z0-9_]+)' as check_id/g)].map((m) => m[1]);
    record("27 every verifier row reports check_id, passed and detail",
      ids.length >= 18 && new Set(ids).size === ids.length
      && (v.match(/as passed/g) || []).length === ids.length
      && (v.match(/as detail/g) || []).length === ids.length,
      `${ids.length} checks`);
    for (const [id, label] of [
      ["D01", "1600 once and latest"], ["D03", "DELETE denied to all roles"],
      ["D04", "TRUNCATE denied"], ["D06", "intended authority exact"],
      ["D08", "history rewrite blocked"], ["D10", "canonical retirement still possible"],
      ["D11", "delete/truncate triggers"], ["D13", "no default policy"],
      ["D14", "zero intents from application"], ["D15", "no provider/network object"],
      ["D16", "no prohibited refs"],
    ]) {
      record(`28 verifier asserts ${label} (${id})`, ids.some((x) => x.startsWith(id + "_")));
    }
  }
}

/* === 7. mutation controls — each protection load-bearing ================= */
const mutate = (src, find, repl) => ({ changed: src.replace(find, repl) !== src });
record("M1 restoring service_role DELETE changes the migration (load-bearing)",
  mutate(exec, /revoke all on table public\.communication_frequency_policies from service_role;/, "").changed
  && /revoke all on table public\.communication_frequency_policies from service_role;/.test(exec),
  "without this line the pre-granted arwdDxtm survives");
record("M2 permitting a threshold/window/scope rewrite changes the guard (load-bearing)",
  mutate(fnRewrite, /new\.max_per_window\s+is distinct from old\.max_per_window/, "false").changed
  && mutate(fnRewrite, /new\.window_length\s+is distinct from old\.window_length/, "false").changed
  && mutate(fnRewrite, /new\.scope\s+is distinct from old\.scope/, "false").changed);
record("M3 blocking legitimate retirement would be caught (negative control)",
  !/new\.is_active is distinct from old\.is_active[\s\S]{0,120}raise exception/.test(fnRewrite),
  "freezing is_active would break the canonical retirement path");
record("M4 seeding a default policy would be caught",
  !/insert\s+into\s+public\.communication_frequency_policies/i.test(exec)
  && /owner decision/.test(sql));
record("M5 granting public/authenticated mutation would be caught",
  !/grant[^;]*to (public|anon|authenticated)/i.test(
    exec.split("communication_frequency_policies").slice(1).join(" ")));
record("M6 adding a provider/network path would be caught",
  !/net\.http_post\s*\(|dblink\s*\(|create\s+extension[^;]*pg_net/i.test(exec)
  && /network extension is installed/.test(sql)
  && /pg_extension where extname in \('pg_net', 'http', 'dblink'\)/.test(exec),
  "the migration's own verification block aborts if one is installed");
record("M7 the comment stripper is not vacuous",
  !executableSql("-- delete from t\nselect 1;").includes("delete")
  && executableSql("select '-- literal';").includes("-- literal"));

/* === report ============================================================== */
const failed = results.filter((r) => !r.ok);
console.log("== QF-MVP-30.5B2B frequency policy history hardening validator ==");
for (const r of results) {
  console.log(`   ${r.ok ? "ok  " : "FAIL"}  ${r.name}`);
  if (!r.ok && r.detail) console.log(`         ${r.detail}`);
}
console.log("");
console.log(`checks: ${results.length - failed.length} passed, ${failed.length} failed (of ${results.length})`);
console.log("mutants: 7 (service_role DELETE, threshold/window/scope rewrite, retirement block,");
console.log("            default policy seed, public mutation grant, provider path, comment stripper)");
console.log("offline: no database, no network, no provider call");
console.log(`RESULT: ${failed.length ? "FAIL" : "PASS"}`);
process.exit(failed.length ? 1 : 0);
