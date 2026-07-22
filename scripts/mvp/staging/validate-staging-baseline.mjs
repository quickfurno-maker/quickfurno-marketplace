#!/usr/bin/env node
// ============================================================================
// QF-MVP-20.2B — Offline staging-baseline validator.
// Tokenizes the generated baseline and fails non-zero on any unsafe or
// non-conforming statement. No network. No database. No SQL execution.
// ============================================================================
import fs from "node:fs";
import crypto from "node:crypto";

const REQUIRED_SOURCE_SHA256 =
  "269c9265d32a9f85488d76bfcf9dd528bd9b6b915bafb09ebb024a6bde182a2f";
const LOCKED_BASELINE_SHA256 =
  "920a4aa0143b7c91231a3c83d01452e49b8b9a829c322f15c7df4fe9f07ecc81";
const PRODUCTION_REF = "yqpgcsduqbxulrlzwzap";
const STAGING_REF = "uckafzuochmbvtiodmcl";
const EXPECT = {
  tables: 62, functions: 39, security_definer: 33, policies: 67,
  rls_enabled: 62, primary_keys: 62, foreign_keys: 69, unique_constraints: 15,
  check_constraints: 169, indexes: 180, triggers: 0, views: 0,
};
// QF-MVP-20.2C1R: expectations proven present in the verification SQL.
const VERIFY_EXPECT = {
  quickfurno_functions: 39, quickfurno_security_definer: 33,
  allowed_managed_functions: 1, total_public_functions: 40,
};
const BLOCKERS = [
  "admin_smart_assign_lead_to_vendors", "assign_client_selected_vendor_to_group",
  "assign_vendor_to_requirement_group", "assign_lead_to_preferred_vendor",
];
const SERVICE_ONLY = [
  ...BLOCKERS, "assign_lead_to_paid_vendors_phase26a", "assign_lead_to_vendors",
  "deduct_vendor_credit", "restore_vendor_credit", "increment_vendor_credits",
  "qf_apply_vendor_credit_delta",
];

function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; }
const baselinePath = arg("--baseline");
const sourcePath = arg("--source");
const grantsPath = arg("--grants");
if (!baselinePath || !sourcePath || !grantsPath) {
  console.error("usage: --baseline <sql> --source <schema.sql> --grants <manifest.json> [--verify <sql>]");
  process.exit(2);
}
// verification SQL defaults to the sibling of the baseline
const verifyPath = arg("--verify")
  || baselinePath.replace(/[^/\\]+$/, "verify_qf_mvp_staging_baseline.sql");

const failures = [];
const fail = (m) => failures.push(m);

// ---- tokenizer (same contract as the generator) ---------------------------
function tokenize(sql) {
  const out = []; let buf = ""; let i = 0; const n = sql.length;
  while (i < n) {
    const c = sql[i], c2 = sql[i + 1];
    if (c === "-" && c2 === "-") { while (i < n && sql[i] !== "\n") buf += sql[i++]; continue; }
    if (c === "/" && c2 === "*") { let d = 0; do { if (sql[i] === "/" && sql[i+1] === "*"){d++;buf+="/*";i+=2;} else if (sql[i] === "*" && sql[i+1] === "/"){d--;buf+="*/";i+=2;} else buf+=sql[i++]; } while (i<n&&d>0); continue; }
    if (c === '"') { buf+=c;i++; while(i<n){ if(sql[i]==='"'&&sql[i+1]==='"'){buf+='""';i+=2;continue;} if(sql[i]==='"'){buf+='"';i++;break;} buf+=sql[i++]; } continue; }
    if (c === "'") { buf+=c;i++; while(i<n){ if(sql[i]==="'"&&sql[i+1]==="'"){buf+="''";i+=2;continue;} if(sql[i]==="'"){buf+="'";i++;break;} buf+=sql[i++]; } continue; }
    if (c === "$") { const m=/^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i)); if(m){ const tag=m[0]; buf+=tag;i+=tag.length; const e=sql.indexOf(tag,i); if(e===-1){buf+=sql.slice(i);i=n;} else {buf+=sql.slice(i,e)+tag;i=e+tag.length;} continue; } }
    if (c === ";") { buf+=c; if(buf.trim())out.push(buf); buf=""; i++; continue; }
    buf += c; i++;
  }
  if (buf.trim()) out.push(buf);
  return out;
}
// strip leading comments/whitespace to a classifiable head
function headOf(stmt) {
  let s = stmt.replace(/^\s+/, "");
  while (true) {
    if (s.startsWith("--")) { s = s.replace(/^--[^\n]*\n?/, "").replace(/^\s+/, ""); continue; }
    if (s.startsWith("/*")) { const e = s.indexOf("*/"); s = (e >= 0 ? s.slice(e + 2) : "").replace(/^\s+/, ""); continue; }
    break;
  }
  return s;
}
// strip ALL comments (line + block) from a statement's executable text
function stripComments(stmt) {
  let s = ""; let i = 0; const n = stmt.length;
  while (i < n) {
    const c = stmt[i], c2 = stmt[i + 1];
    if (c === "-" && c2 === "-") { while (i < n && stmt[i] !== "\n") i++; continue; }
    if (c === "/" && c2 === "*") { let d = 0; do { if (stmt[i]==="/"&&stmt[i+1]==="*"){d++;i+=2;} else if (stmt[i]==="*"&&stmt[i+1]==="/"){d--;i+=2;} else i++; } while (i<n&&d>0); continue; }
    if (c === "'") { s+=c;i++; while(i<n){ s+=stmt[i]; if(stmt[i]==="'"&&stmt[i+1]==="'"){s+=stmt[i+1];i+=2;continue;} if(stmt[i]==="'"){i++;break;} i++; } continue; }
    s += stmt[i++];
  }
  return s;
}

const baseline = fs.readFileSync(baselinePath, "utf8");
const statements = tokenize(baseline);

// ---- 1. source metadata hash present & correct ----------------------------
const sourceSha = crypto.createHash("sha256").update(fs.readFileSync(sourcePath)).digest("hex");
if (sourceSha !== REQUIRED_SOURCE_SHA256) fail(`source SHA256 wrong: ${sourceSha}`);
if (!baseline.includes(REQUIRED_SOURCE_SHA256)) fail("baseline header missing source SHA256");
if (!baseline.includes(STAGING_REF)) fail("baseline header missing staging ref");
if (!/DO NOT APPLY TO PRODUCTION/i.test(baseline)) fail("baseline header missing production-prohibition warning");

// ---- 2. per-statement safety ----------------------------------------------
let counts = { tables:0, functions:0, security_definer:0, policies:0, rls_enabled:0, primary_keys:0, foreign_keys:0, unique_constraints:0, check_constraints:0, indexes:0, triggers:0, views:0 };
const grantExec = new Map(); // fnName -> Set(roles)
const tableGrants = new Map(); // tableName -> [{roles,privs}]
let sawPreflight = false;

for (const raw of statements) {
  const h = headOf(raw);
  const exec = stripComments(raw); // executable text, comments removed
  const H = h.slice(0, 400).toUpperCase().replace(/\s+/g, " ");

  if (/DO \$qf_preflight\$/i.test(raw) || /qf_preflight/i.test(raw)) sawPreflight = true;

  // prohibited top-level mutations / destructive / role ops
  if (/^(COPY|INSERT|UPDATE|DELETE|MERGE|TRUNCATE)\b/.test(H)) fail(`top-level data mutation present: ${H.slice(0,40)}`);
  if (/^DROP\s+(DATABASE|SCHEMA|TABLE|FUNCTION|POLICY|ROLE)\b/.test(H)) fail(`destructive DROP present: ${H.slice(0,40)}`);
  if (/^(CREATE|ALTER|DROP)\s+ROLE\b/.test(H)) fail(`role statement present: ${H.slice(0,40)}`);
  if (/^SET\s+ROLE\b/.test(H) || /SESSION AUTHORIZATION/.test(H)) fail(`SET ROLE / SESSION AUTHORIZATION present`);
  if (/^ALTER\b/.test(H) && /\sOWNER\s+TO\s/.test(H)) fail(`ALTER ... OWNER TO present: ${H.slice(0,40)}`);
  if (/^ALTER\s+DEFAULT\s+PRIVILEGES\b/.test(H)) {
    if (/\b(ANON|AUTHENTICATED)\b/.test(H)) fail(`ALTER DEFAULT PRIVILEGES grants anon/authenticated`);
    else fail(`unexpected ALTER DEFAULT PRIVILEGES present`);
  }

  // counts (semantic)
  const lead = exec.replace(/^\s+/, "");
  if (/^CREATE TABLE /i.test(lead)) { counts.tables++; counts.check_constraints += (exec.match(/CHECK \(/gi)?.length ?? 0); }
  if (/^CREATE (OR REPLACE )?FUNCTION /i.test(lead)) { counts.functions++; if (/SECURITY DEFINER/i.test(exec)) counts.security_definer++; }
  if (/^CREATE POLICY /i.test(lead)) counts.policies++;
  if (/ENABLE ROW LEVEL SECURITY/i.test(exec)) counts.rls_enabled++;
  if (/^ALTER TABLE /i.test(lead) && /ADD CONSTRAINT/i.test(exec)) {
    if (/PRIMARY KEY/i.test(exec)) counts.primary_keys++;
    if (/FOREIGN KEY/i.test(exec)) counts.foreign_keys++;
    if (/\bUNIQUE\b/i.test(exec)) counts.unique_constraints++;
    if (/\bCHECK\b/i.test(exec)) counts.check_constraints++;
  }
  if (/^CREATE (UNIQUE )?INDEX /i.test(lead)) counts.indexes++;
  if (/^CREATE (CONSTRAINT )?TRIGGER /i.test(lead)) counts.triggers++;
  if (/^CREATE (OR REPLACE )?(MATERIALIZED )?VIEW /i.test(lead)) counts.views++;

  // grant capture (executable GRANT/REVOKE only)
  let m;
  if ((m = /^GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+"public"\."([a-z_0-9]+)"\([^)]*\)\s+TO\s+(.+);$/i.exec(lead.trim()))) {
    const roles = m[2].split(",").map((r) => r.replace(/["\s]/g, ""));
    grantExec.set(m[1], new Set([...(grantExec.get(m[1]) ?? []), ...roles]));
  }
  if ((m = /^GRANT\s+([A-Z, ]+)\s+ON\s+TABLE\s+"public"\."([a-z_0-9]+)"\s+TO\s+(.+);$/i.exec(lead.trim()))) {
    const roles = m[3].split(",").map((r) => r.replace(/["\s]/g, ""));
    tableGrants.set(m[2], [...(tableGrants.get(m[2]) ?? []), { privs: m[1].trim(), roles }]);
  }
}

// ---- 3. structural counts --------------------------------------------------
for (const [k, v] of Object.entries(EXPECT))
  if (counts[k] !== v) fail(`count ${k}: expected ${v}, got ${counts[k]}`);

// ---- 4. authority: blocker + service-only RPCs not exec by anon/authenticated
for (const fn of SERVICE_ONLY) {
  const roles = grantExec.get(fn) ?? new Set();
  if (roles.has("anon")) fail(`${fn} is EXECUTE-granted to anon`);
  if (roles.has("authenticated")) fail(`${fn} is EXECUTE-granted to authenticated`);
  if (roles.has("PUBLIC")) fail(`${fn} is EXECUTE-granted to PUBLIC`);
}
// baseline must revoke each service-only fn from PUBLIC/anon/authenticated
for (const fn of SERVICE_ONLY) {
  const re = new RegExp(`REVOKE ALL ON FUNCTION "public"\\."${fn}"\\([^)]*\\) FROM [^;]*PUBLIC`, "i");
  if (!re.test(stripComments(baseline))) fail(`${fn} missing REVOKE ... FROM PUBLIC`);
}
// the one proven public helper MUST have anon execute
if (!(grantExec.get("get_public_eligible_vendors") ?? new Set()).has("anon"))
  fail("get_public_eligible_vendors missing anon EXECUTE (proven public consumer)");

// ---- 5. anon must have NO table grants (esp. vendors / sensitive) ----------
for (const [tbl, grants] of tableGrants)
  for (const g of grants)
    if (g.roles.includes("anon")) fail(`anon granted ${g.privs} on table ${tbl}`);
// explicit sanity: no anon SELECT on vendors / vendor_credit_logs / vendor_packages / payments
for (const t of ["vendors", "vendor_credit_logs", "vendor_packages", "payments"]) {
  const re = new RegExp(`GRANT [^;]* ON TABLE "public"\\."${t}" TO [^;]*"anon"`, "i");
  if (re.test(stripComments(baseline))) fail(`anon has a table grant on ${t}`);
}

// ---- 6. no copied broad GRANT ALL to anon/authenticated on tables ----------
if (/GRANT ALL ON TABLE "public"\."[a-z_0-9]+" TO [^;]*"(anon|authenticated)"/i.test(stripComments(baseline)))
  fail("broad GRANT ALL ON TABLE to anon/authenticated present");

// ---- 7. preflight guards present ------------------------------------------
if (!sawPreflight) fail("staging preflight guard block is absent");
for (const guard of ["auth.users", "gen_random_uuid", "service_role"])
  if (!baseline.includes(guard)) fail(`preflight missing guard reference: ${guard}`);

// ---- 8. production ref only in comments; no URLs/secret-like literals ------
const execAll = stripComments(baseline);
if (execAll.includes(PRODUCTION_REF)) fail("production project ref appears in an executable statement");
if (/https?:\/\//i.test(execAll)) fail("URL present in executable statement");
if (/-----BEGIN|BEARER |ACCESS_TOKEN|SERVICE_ROLE_KEY/i.test(execAll)) fail("secret-like literal present");

// ---- 9. determinism (regenerate to temp, compare) is proven by the runner;
//         here we assert the baseline embeds the fixed identity, not wall-clock.
if (!/2026-07-22T00:00:00Z/.test(baseline)) fail("fixed baseline instant missing");
if (/GENERATED (AT|ON) 20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9:]+\.[0-9]/.test(baseline)) fail("wall-clock timestamp detected");

// ---- 10. raw production schema not committed as a second file --------------
// (offline heuristic: the baseline must not contain the dump's OWNER TO / grant block)
if (/OWNER TO "postgres"/.test(execAll)) fail("raw production ownership present (dump leaked in)");

// ---- 11. baseline SQL byte-identical / locked SHA256 (unmodified) ----------
const baselineSha = crypto.createHash("sha256").update(fs.readFileSync(baselinePath)).digest("hex");
if (baselineSha !== LOCKED_BASELINE_SHA256)
  fail(`baseline SHA256 changed: got ${baselineSha}, locked ${LOCKED_BASELINE_SHA256}`);

// ---- 12. verification SQL: identity-scoped function parity (QF-MVP-20.2C1R) --
// Derive the 39 QuickFurno identities from the baseline and prove each is encoded
// as an expected_fn VALUES row in the verification SQL.
function deriveIdentities(sql) {
  function splitArgs(s) {
    const out = []; let buf = "", dP = 0, dB = 0, i = 0, inS = false, inD = false; const n = s.length;
    while (i < n) { const c = s[i];
      if (inS) { buf += c; if (c === "'" && s[i+1] === "'") buf += s[++i]; else if (c === "'") inS = false; i++; continue; }
      if (inD) { buf += c; if (c === '"' && s[i+1] === '"') buf += s[++i]; else if (c === '"') inD = false; i++; continue; }
      if (c === "'") { inS = true; buf += c; i++; continue; }
      if (c === '"') { inD = true; buf += c; i++; continue; }
      if (c === "(") { dP++; buf += c; i++; continue; }
      if (c === ")") { dP--; buf += c; i++; continue; }
      if (c === "[") { dB++; buf += c; i++; continue; }
      if (c === "]") { dB--; buf += c; i++; continue; }
      if (c === "," && dP === 0 && dB === 0) { out.push(buf.trim()); buf = ""; i++; continue; }
      buf += c; i++;
    }
    if (buf.trim()) out.push(buf.trim());
    return out;
  }
  function argType(a) {
    a = a.replace(/\s+DEFAULT\s+[\s\S]*$/i, "").trim();
    const m = /^"(?:[^"]|"")+"\s+([\s\S]+)$/.exec(a);
    if (m) a = m[1].trim();
    return a.replace(/"([a-zA-Z0-9_]+)"/g, "$1").replace(/\s+/g, "");
  }
  const re = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+"public"\."([a-z_0-9]+)"\s*\(/gi;
  const res = []; let mm;
  while ((mm = re.exec(sql))) {
    const name = mm[1]; let i = re.lastIndex - 1; let depth = 0, inS = false, inD = false; const start = i;
    for (; i < sql.length; i++) { const c = sql[i];
      if (inS) { if (c === "'" && sql[i+1] === "'") i++; else if (c === "'") inS = false; continue; }
      if (inD) { if (c === '"' && sql[i+1] === '"') i++; else if (c === '"') inD = false; continue; }
      if (c === "'") { inS = true; continue; }
      if (c === '"') { inD = true; continue; }
      if (c === "(") depth++; else if (c === ")") { depth--; if (depth === 0) break; }
    }
    const list = sql.slice(start + 1, i).trim();
    const ident = list === "" ? "" : splitArgs(list).map(argType).join(", ");
    res.push({ name, ident });
  }
  const seen = new Set();
  return res.filter(r => { const k = r.name + "(" + r.ident + ")"; if (seen.has(k)) return false; seen.add(k); return true; });
}

const verifySql = fs.readFileSync(verifyPath, "utf8");
const verifyExec = stripComments(verifySql);
const identities = deriveIdentities(baseline);
if (identities.length !== VERIFY_EXPECT.quickfurno_functions)
  fail(`derived ${identities.length} baseline function identities, expected ${VERIFY_EXPECT.quickfurno_functions}`);

// 12a. every derived identity is encoded as an expected_fn VALUES row
let encoded = 0;
for (const { name, ident } of identities) {
  const row = `('${name}','${ident}')`;
  if (verifySql.includes(row)) encoded++;
  else fail(`verify SQL missing expected_fn identity: ${name}(${ident})`);
}
if (encoded !== VERIFY_EXPECT.quickfurno_functions)
  fail(`verify SQL encodes ${encoded}/${VERIFY_EXPECT.quickfurno_functions} QuickFurno identities`);

// 12b. expected_fn VALUES contains exactly 39 rows (no extras)
const valuesRows = (verifySql.match(/^\s*\('[a-z_0-9]+','[^\n]*'\),?\s*$/gm) || []).length;
if (valuesRows !== VERIFY_EXPECT.quickfurno_functions)
  fail(`expected_fn has ${valuesRows} rows, expected ${VERIFY_EXPECT.quickfurno_functions}`);

// 12c. managed rls_auto_enable exception is explicit and singular
if (!/NOT \(f\.fname = 'rls_auto_enable' AND f\.ident = ''\)/.test(verifySql))
  fail("verify SQL missing the singular managed rls_auto_enable exclusion in qf_unexpected");
if (!/'03c_allowed_managed_public_function_count', '1'/.test(verifySql))
  fail("verify SQL missing allowed_managed_public_function_count=1 check");
if ((verifySql.match(/rls_auto_enable/g) || []).length < 3)
  fail("verify SQL does not reference the managed rls_auto_enable exception explicitly");

// 12d. identity-scoped checks with corrected expectations; no total-only=39
if (!/'03a_quickfurno_function_count', '39'/.test(verifySql)) fail("verify SQL missing identity-scoped quickfurno_function_count=39");
if (!/'03b_quickfurno_function_missing', '0'/.test(verifySql)) fail("verify SQL missing quickfurno_function_missing=0");
if (!/'03d_unexpected_public_function_count', '0'/.test(verifySql)) fail("verify SQL missing unexpected_public_function_count=0");
if (!/'03e_total_public_function_count', '40'/.test(verifySql)) fail("verify SQL missing total_public_function_count=40 (supporting)");
if (!/'04_quickfurno_security_definer_count', '33'/.test(verifySql)) fail("verify SQL missing quickfurno_security_definer_count=33");
if (/'03_public_functions', ?'39'/.test(verifySql)) fail("verify SQL still has the superseded total-only public function check (=39)");
if (/'\d+_[a-z_]*', ?'47'|'\d+_[a-z_]*', ?'178'/.test(verifySql)) fail("verify SQL reintroduced a 47/178 expected count");

// 12e. verification SQL must be SELECT-only (no DML/DDL statements)
for (const raw of tokenize(verifySql)) {
  const H = headOf(raw).slice(0, 60).toUpperCase().replace(/\s+/g, " ");
  if (/^(INSERT|UPDATE|DELETE|MERGE|COPY|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|COMMENT ON)\b/.test(H))
    fail(`verify SQL contains a non-SELECT statement: ${H.slice(0,40)}`);
}

// ---- report ----------------------------------------------------------------
if (failures.length) {
  console.error(`[validate-staging-baseline] FAIL (${failures.length}):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("[validate-staging-baseline] PASS");
console.log(`  counts        = ${JSON.stringify(counts)}`);
console.log(`  anon exec     = ${[...(grantExec.entries())].filter(([, r]) => r.has("anon")).map(([f]) => f).join(", ") || "(none)"}`);
console.log(`  service-only  = ${SERVICE_ONLY.length} mutation RPCs verified not-anon/authenticated/PUBLIC`);
console.log(`  anon tables   = none`);
console.log(`  baseline_sha  = ${baselineSha} (locked, unmodified)`);
console.log(`  verify_fn_ids = ${encoded}/${VERIFY_EXPECT.quickfurno_functions} QuickFurno identities encoded; SD expected 33; managed rls_auto_enable +1; total 40`);
console.log(`  verify_select_only = yes`);
