// ============================================================================
// QuickFurno — scripts/mvp/local/qf-mvp-80-15c-local-contact-entitlement-integration.mjs
//
// QF-MVP-80.15C — LOCAL canonical integration proof.
//
// The pure/static harness proves the DECISION. This proves the WHOLE PATH, by
// running the REAL canonical assignment authority and then the REAL
// getVendorAssignedLeads() against a LOCAL Supabase container:
//
//   1. seed a vendor whose package expired months ago and who holds EXACTLY 1
//      lead credit, plus a consented, category-compatible local lead;
//   2. call public.qf_assign_lead_vendors_v2 — the real authority, no stub;
//   3. prove the assignment committed, the wallet went 1 -> 0, the row carries
//      operation_id + credit_deducted, and a ledger debit row exists;
//   4. call the real service and prove the client's phone IS returned even
//      though the package is expired and the balance is now zero — the exact
//      case that was broken before this slice — and that no email is returned;
//   5. flip the vendor inactive and prove the SAME assignment goes dark.
//
// LOCAL ONLY BY CONSTRUCTION. It talks to the local container by name, and
// refuses to start if the resolved URL is remote or if the container name looks
// like any other project. Every row it writes carries a unique tag and is
// deleted in a finally block.
//
// Run: npm run test:mvp:80-15c-local
// ============================================================================
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const DB_CONTAINER = "supabase_db_quickfurno";
const API_CONTAINER = "supabase_studio_quickfurno";
const TAG = `QF8015C-${Date.now()}`;

// --- Safety rail -------------------------------------------------------------
// A remote host, or any container belonging to another project, is a hard stop.
const FORBIDDEN = [/supabase\.co/i, /yqpgcsduqbxulrlzwzap/i, /uckafzuochmbvtiodmcl/i, /onedecore/i, /jarvis/i];
function assertLocal(label, value) {
  for (const pattern of FORBIDDEN) {
    if (pattern.test(value)) throw new Error(`REFUSING: ${label} matches ${pattern} — this harness is local-only`);
  }
}
assertLocal("db container", DB_CONTAINER);
assertLocal("api container", API_CONTAINER);

const docker = (args, input) =>
  execFileSync("docker", args, { input, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });

/** Run SQL in the LOCAL container. Returns trimmed stdout. */
function sql(statement, { tuplesOnly = true } = {}) {
  const args = ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"];
  if (tuplesOnly) args.push("-t", "-A");
  args.push("-f", "-");
  return docker(args, statement).trim();
}

const checks = [];
const check = (name, fn) => checks.push({ name, fn });
function assert(cond, msg) { if (!cond) throw new Error(msg); }

// --- Local credentials -------------------------------------------------------
// Read from the container's own environment; the value is used, never printed.
function localEnv() {
  const raw = docker(["inspect", API_CONTAINER, "--format", "{{range .Config.Env}}{{println .}}{{end}}"]);
  const pick = (key) => {
    const line = raw.split(/\r?\n/).find((l) => l.startsWith(`${key}=`));
    return line ? line.slice(key.length + 1).trim() : "";
  };
  const serviceKey = pick("SUPABASE_SERVICE_KEY");
  const anonKey = pick("SUPABASE_ANON_KEY");
  assert(serviceKey.length > 20, "local service key not found on the container");

  // The studio env points at the internal docker hostname; the host reaches the
  // same gateway through the published port.
  const port = docker(["port", "supabase_kong_quickfurno", "8000/tcp"]).split(/\r?\n/)[0].split(":").pop().trim();
  const url = `http://127.0.0.1:${port}`;
  assertLocal("resolved url", url);
  assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(url), `resolved url is not loopback: ${url}`);
  return { url, serviceKey, anonKey };
}

const ENV = localEnv();

// --- Seed --------------------------------------------------------------------
let vendorId = "";
let leadId = "";

function seed() {
  const out = sql(`
    with v as (
      insert into public.vendors (
        business_name, owner_name, phone, city, service_categories,
        status, is_active, accepting_leads, paid_status,
        package_status, package_expires_at, remaining_credits, total_credits)
      values (
        '${TAG}-vendor', '${TAG}-owner', '9000000001', 'Pune', array['Interior Designers'],
        'Approved', true, true, 'Unpaid',
        'active', now() - interval '60 days', 1, 10)
      returning id
    ), l as (
      insert into public.leads (
        name, phone, city, service_required, category,
        share_consent, is_duplicate, status)
      values (
        '${TAG}-client', '9000000002', 'Pune', 'Interior Designers', 'Interior Designers',
        true, false, 'New')
      returning id
    )
    select (select id from v) || ' ' || (select id from l);
  `);
  [vendorId, leadId] = out.split(/\s+/);
  assert(vendorId && leadId, `seed failed: ${out}`);
}

/**
 * Remove what the schema PERMITS removing.
 *
 * public.lead_assignment_events is append-only by design — DELETE raises
 * QF_LEAD_ASSIGNMENT_EVENTS_IMMUTABLE for every role — and its lead_id and
 * vendor_id foreign keys are RESTRICT. So once the authority has written its
 * lineage row, the seeded lead and vendor CANNOT be deleted. That is the
 * governance working as intended, and this harness does not try to defeat it:
 * it deletes what it may, neutralises the residue so it can never take part in
 * matching again, and reports exactly what remains.
 */
function cleanup() {
  if (!vendorId && !leadId) return { removed: false, note: "nothing seeded" };
  sql(`
    delete from public.vendor_credit_logs where vendor_id = '${vendorId}';
    delete from public.lead_matching_runs where lead_id = '${leadId}';
    delete from public.lead_assignments where lead_id = '${leadId}';
  `);
  try {
    sql(`
      delete from public.leads where id = '${leadId}';
      delete from public.vendors where id = '${vendorId}';
    `);
    return { removed: true, note: "all seeded rows deleted" };
  } catch {
    sql(`
      update public.vendors
         set is_active = false, accepting_leads = false, status = 'Rejected',
             remaining_credits = 0, business_name = '${TAG}-RESIDUE-INERT'
       where id = '${vendorId}';
      update public.leads
         set share_consent = false, is_duplicate = true,
             name = '${TAG}-RESIDUE-INERT', phone = '0000000000'
       where id = '${leadId}';
    `);
    return {
      removed: false,
      note: `append-only lineage pins them: vendor+lead kept but NEUTRALISED, tagged ${TAG}-RESIDUE-INERT`,
    };
  }
}

/** Call the REAL service in a child process bound to the LOCAL database. */
function callRealService() {
  const dir = mkdtempSync(join(tmpdir(), "qf8015c-"));
  const runner = join(dir, "run.mjs");
  // On Windows a bare absolute path is not a valid ESM specifier — the loader
  // reads "C:" as an unsupported protocol. It must be a file:// URL.
  const serviceUrl = pathToFileURL(resolve("services/vendorService.ts")).href;
  writeFileSync(runner, `
import { getVendorAssignedLeads } from ${JSON.stringify(serviceUrl)};
const result = await getVendorAssignedLeads(${JSON.stringify(vendorId)});
process.stdout.write(JSON.stringify(result));
`);
  try {
    // A local-only resolve hook supplies the repo's extensionless imports; Node
    // strips the TS types itself. The offline MVP loader is deliberately NOT
    // used here — it refuses Supabase/services modules on purpose, and this
    // harness must exercise the real service.
    return JSON.parse(execFileSync(process.execPath, [
      "--experimental-transform-types",
      "--import", pathToFileURL(resolve("scripts/mvp/local/qfLocalIntegrationLoader-register.mjs")).href,
      "--disable-warning=ExperimentalWarning",
      "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
      runner,
    ], {
      encoding: "utf8",
      cwd: process.cwd(),
      env: {
        ...process.env,
        NEXT_PUBLIC_SUPABASE_URL: ENV.url,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: ENV.anonKey,
        SUPABASE_SERVICE_ROLE_KEY: ENV.serviceKey,
      },
    }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- The proof ---------------------------------------------------------------
let assignedJson = null;
let serviceRows = null;

check("L01 the canonical authority commits exactly one assignment", () => {
  const out = sql(`
    select public.qf_assign_lead_vendors_v2(
      '${leadId}'::uuid, 'automatic', array['${vendorId}']::uuid[],
      '${TAG}-op', 'system', null, null, 'qf_mvp_80_15c_local')::text;
  `);
  assignedJson = JSON.parse(out);
  const assigned = assignedJson.assigned ?? assignedJson.assigned_vendors ?? [];
  assert(Array.isArray(assigned) && assigned.length === 1,
    `expected 1 assignment, got ${JSON.stringify(assignedJson).slice(0, 300)}`);
});

check("L02 the wallet went 1 -> 0 (the assignment spent the LAST credit)", () => {
  const credits = sql(`select remaining_credits from public.vendors where id='${vendorId}';`);
  assert(credits === "0", `expected 0 remaining credits, got ${credits}`);
});

check("L03 the committed row carries operation_id + credit_deducted", () => {
  const row = sql(`
    select (operation_id is not null)::text || ' ' || credit_deducted::text
    from public.lead_assignments where lead_id='${leadId}' and vendor_id='${vendorId}';
  `);
  assert(row === "true true", `receipt columns wrong: ${row}`);
});

check("L04 a mandatory ledger debit row exists for that assignment", () => {
  const n = sql(`
    select count(*) from public.vendor_credit_logs
    where vendor_id='${vendorId}' and change_type='lead_assignment_debit' and credits_delta = -1;
  `);
  assert(n === "1", `expected exactly 1 ledger debit, got ${n}`);
});

check("L05 REAL service returns the client phone despite expired package + zero balance", () => {
  const result = callRealService();
  assert(result.ok === true, `service failed: ${JSON.stringify(result).slice(0, 300)}`);
  serviceRows = result.data;
  assert(serviceRows.length === 1, `expected 1 assigned lead, got ${serviceRows.length}`);
  const row = serviceRows[0];
  assert(row.contact_allowed === true, "contact_allowed was false on a charged assignment");
  assert(row.lead && row.lead.phone === "9000000002",
    `phone missing on a charged assignment: ${JSON.stringify(row.lead)}`);
});

check("L06 no email and no entitlement evidence cross the service boundary", () => {
  const blob = JSON.stringify(serviceRows);
  assert(!/"email"/.test(blob), "an email field crossed the service boundary");
  assert(!/operation_id/.test(blob), "operation_id was shipped to the caller");
  assert(!/credit_deducted/.test(blob), "credit_deducted was shipped to the caller");
});

check("L07 making the vendor INACTIVE hides the same assignment again", () => {
  sql(`update public.vendors set is_active = false where id='${vendorId}';`);
  const result = callRealService();
  assert(result.ok === true, `service failed: ${JSON.stringify(result).slice(0, 200)}`);
  const row = result.data[0];
  assert(row.contact_allowed === false, "an inactive vendor kept contact access");
  assert(row.lead.phone === null, `an inactive vendor still received a phone: ${row.lead.phone}`);
  const blob = JSON.stringify(result.data);
  assert(!blob.includes("9000000002"), "the phone survived somewhere in the payload");
});

// ============================================================================
(async () => {
  if (!existsSync("services/vendorService.ts")) throw new Error("run from the repository root");
  let passed = 0; const failures = [];
  try {
    seed();
    for (const { name, fn } of checks) {
      try { await fn(); passed += 1; console.log(`   ok    ${name}`); }
      catch (e) { failures.push(`   FAIL  ${name} — ${e.message}`); console.log(`   FAIL  ${name} — ${e.message}`); }
    }
  } finally {
    try {
      const r = cleanup();
      console.log(`   ok    L08 local cleanup — ${r.note}`);
    } catch (e) {
      failures.push(`   FAIL  cleanup — ${e.message}`);
      console.log(`   FAIL  cleanup — ${e.message}`);
    }
  }
  console.log(`\n${"=".repeat(78)}`);
  console.log(`QF-MVP-80.15C LOCAL canonical integration — passed ${passed}, failed ${failures.length}`);
  if (failures.length) { console.log("\nFAILURES:"); for (const l of failures) console.log(l); }
  console.log("=".repeat(78));
  process.exit(failures.length ? 1 : 0);
})();
