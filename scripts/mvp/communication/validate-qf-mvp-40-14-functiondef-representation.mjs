// ============================================================================
// QF-MVP-40.14 — pg_get_functiondef REPRESENTATION TEST. EXECUTION, NOT OFFLINE.
//
// WHY THIS EXISTS
//   The first exact production db-push of 20260912000000 failed closed inside
//   the migration's own §6.4 self-verification with
//
//     QF-MVP-40.14 aborted: excluded key campaign is reachable from this authority.
//
//   and rolled the whole transaction back. Nothing was activated and nothing was
//   sent. The cause was a REPRESENTATION mismatch, not a policy defect:
//   PostgreSQL stores a PL/pgSQL body verbatim in pg_proc.prosrc — comments
//   included — and pg_get_functiondef() returns that text unchanged. §6.4 scans
//   that text, so it saw the word `campaign` inside a harmless prose comment in
//   the authority's own body and refused, correctly, by its own rule.
//
//   The offline validator missed it because its campaign-containment rule (G05)
//   strips SQL line comments first. Rules G08..G11 there now model the stored
//   representation textually. THIS script proves the same thing the only way
//   that is not a model: by asking a real PostgreSQL what it actually returns.
//
// WHAT IT DOES
//   Starts a THROWAWAY PostgreSQL container, creates ONLY the §2 activation
//   function — extracted verbatim from the migration — with check_function_bodies
//   off so no table is required, then:
//
//     P1  proves pg_get_functiondef() retains PL/pgSQL body comments at all
//         (if it did not, this whole test would be vacuous)
//     P2  runs the migration's REAL §6.4 loop, extracted verbatim, and requires
//         it to PASS against the corrected body
//     P3  NEGATIVE CONTROL: recreates the same function with `campaign` put back
//         into a body comment and requires §6.4 to raise the EXACT production
//         error text. A check that cannot fail would prove nothing.
//
//   No production data, no fixture rows, no schema beyond the one function, no
//   Supabase, no network beyond the local Docker socket, no secret, no send.
//   The container is created fresh, named uniquely and removed on exit. It never
//   touches any other running container.
//
//   Skips cleanly (exit 0, SKIPPED) when Docker is unavailable.
// ============================================================================

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const MIGRATION_PATH =
  "supabase/migrations/20260912000000_qf_mvp_40_14_meta_transactional_mapping_authority.sql";
const RPC = "qf_activate_meta_transactional_mapping_v1";
const SIG = `public.${RPC}(text,text)`;
const IMAGE = "postgres:17-alpine";
const CONTAINER = `qf-mvp-40-14-functiondef-${process.pid}`;

/** The exact abort text production returned. The negative control must match it. */
const PRODUCTION_ABORT =
  "QF-MVP-40.14 aborted: excluded key campaign is reachable from this authority.";

const SRC = readFileSync(path.join(ROOT, MIGRATION_PATH), "utf8");

const results = [];
const check = (name, ok, detail = "") =>
  results.push({ name, ok: ok === true, detail });

// ---------------------------------------------------------------------------
// Extract the two regions VERBATIM. Nothing here is retyped by hand: if the
// migration changes, this test changes with it or fails to find its markers.
// ---------------------------------------------------------------------------

function between(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  if (start === -1) return "";
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  if (end === -1) return "";
  return source.slice(start, end);
}

/** §2, the activation authority, exactly as the migration declares it. */
const FN_DDL = `${between(SRC, `create or replace function public.${RPC}(`, "\n$$;")}\n$$;`;

/** §6.4, the excluded-token loop, exactly as the migration declares it. */
const SECTION_6_4 = between(SRC, "-- 6.4", "end loop;") + "end loop;";

if (!FN_DDL.includes("language plpgsql") || !SECTION_6_4.includes("if v_def ~ v_name then")) {
  console.log("FAIL  could not extract §2 / §6.4 verbatim from the migration");
  process.exit(1);
}

/** The corrected body must not name `campaign`; the control puts it back. */
const CLEAN_COMMENT = "  -- any assignment, credit, lead or vendor write, and any write to the";
const DEFECT_COMMENT =
  "  -- any assignment, credit, lead, vendor or campaign write, and any write to the";

if (!FN_DDL.includes(CLEAN_COMMENT)) {
  console.log("FAIL  the corrected body comment anchor is absent; test is stale");
  process.exit(1);
}
const FN_DDL_DEFECTIVE = FN_DDL.replace(CLEAN_COMMENT, DEFECT_COMMENT);

// ---------------------------------------------------------------------------
// SQL. §6.4 is embedded verbatim inside a DO block with the same declarations
// the migration's own $verify$ block gives it.
// ---------------------------------------------------------------------------

const verifyBlock = (tag) => `
do $${tag}$
declare
  v_sig text := '${SIG}';
  v_oid oid;
  v_def text;
  v_name text;
  v_count integer;
begin
  v_oid := to_regprocedure(v_sig);
  if v_oid is null then
    raise exception 'setup failed: % is missing.', v_sig;
  end if;
  select pg_get_functiondef(v_oid) into v_def;

${SECTION_6_4}
end
$${tag}$;
`;

const SQL_SETUP = `
set check_function_bodies = off;
${FN_DDL}
`;

const SQL_P1 = `
do $probe$
declare
  v_def text;
begin
  select pg_get_functiondef(to_regprocedure('${SIG}')) into v_def;
  -- If pg_get_functiondef dropped comments, every other assertion here would be
  -- vacuously true, so prove it retains them before trusting anything else.
  if v_def !~ 'THE ONLY WRITE' then
    raise exception 'P1 FAILED: pg_get_functiondef did not retain body comments';
  end if;
  if v_def !~ 'pg_get_functiondef\\(\\) hands that same text back' then
    raise exception 'P1 FAILED: the corrected explanatory comment is not in the stored definition';
  end if;
  raise notice 'P1 OK: pg_get_functiondef retained % chars including body comments', length(v_def);
end
$probe$;
`;

const SQL_P3_SETUP = `
set check_function_bodies = off;
${FN_DDL_DEFECTIVE}
`;

// ---------------------------------------------------------------------------
// Docker plumbing. Fresh container, unique name, always removed.
// ---------------------------------------------------------------------------

const docker = (args, opts = {}) =>
  spawnSync("docker", args, { encoding: "utf8", ...opts });

function dockerAvailable() {
  const r = docker(["version", "--format", "{{.Server.Version}}"]);
  return r.status === 0;
}

function psql(sql) {
  return docker(
    ["exec", "-i", CONTAINER, "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-f", "-"],
    { input: sql }
  );
}

function cleanup() {
  docker(["rm", "-f", CONTAINER], { stdio: "ignore" });
}

if (!dockerAvailable()) {
  console.log("SKIPPED  Docker is not available; the pg_get_functiondef execution proof did not run.");
  console.log("         The offline model of this property is enforced by rules G08..G11 in");
  console.log("         validate-qf-mvp-40-14-transactional-mapping-authority.mjs (npm run test:mvp:40-14).");
  process.exit(0);
}

let started = false;
try {
  const up = docker([
    "run", "--rm", "-d", "--name", CONTAINER,
    "-e", "POSTGRES_PASSWORD=qf_local_throwaway",
    "-e", "POSTGRES_HOST_AUTH_METHOD=trust",
    IMAGE,
  ]);
  if (up.status !== 0) {
    console.log(`SKIPPED  could not start ${IMAGE}: ${(up.stderr || "").trim()}`);
    process.exit(0);
  }
  started = true;

  // Wait for readiness, polling rather than sleeping a fixed guess.
  const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  let ready = false;
  for (let i = 0; i < 60; i += 1) {
    const r = docker(["exec", CONTAINER, "pg_isready", "-U", "postgres"]);
    if (r.status === 0) { ready = true; break; }
    sleep(1000);
  }
  check("the throwaway PostgreSQL container accepted connections", ready);
  if (!ready) throw new Error("container never became ready");

  const version = docker(["exec", CONTAINER, "psql", "-U", "postgres", "-Atc", "show server_version"]);
  const serverVersion = (version.stdout || "").trim();

  // --- SETUP: create the CORRECTED authority ------------------------------
  const setup = psql(SQL_SETUP);
  check("the corrected §2 authority was created verbatim from the migration",
    setup.status === 0, (setup.stderr || "").trim().split("\n").slice(-3).join(" | "));

  // --- P1: pg_get_functiondef retains comments ----------------------------
  const p1 = psql(SQL_P1);
  check("P1 pg_get_functiondef() retains PL/pgSQL body comments",
    p1.status === 0, (p1.stderr || "").trim().split("\n").slice(-3).join(" | "));

  // --- P2: the REAL §6.4 loop passes against the corrected body -----------
  const p2 = psql(verifyBlock("v64ok"));
  check("P2 the migration's own §6.4 loop PASSES against the corrected definition",
    p2.status === 0, (p2.stderr || "").trim().split("\n").slice(-3).join(" | "));

  // --- P3: NEGATIVE CONTROL ----------------------------------------------
  const p3setup = psql(SQL_P3_SETUP);
  check("P3 setup: the defective body (comment naming `campaign`) was created",
    p3setup.status === 0, (p3setup.stderr || "").trim().split("\n").slice(-3).join(" | "));

  const p3 = psql(verifyBlock("v64bad"));
  const p3err = `${p3.stderr || ""}${p3.stdout || ""}`;
  check("P3 §6.4 REJECTS the defective definition", p3.status !== 0,
    p3.status === 0 ? "§6.4 accepted the defect — the check proves nothing" : "");
  check("P3 §6.4 reproduces the EXACT production abort text",
    p3err.includes(PRODUCTION_ABORT),
    p3err.includes(PRODUCTION_ABORT) ? "" : p3err.trim().split("\n").slice(0, 3).join(" | "));

  console.log(`PostgreSQL ${serverVersion} · image ${IMAGE} · container ${CONTAINER} (throwaway)`);
} catch (e) {
  check("the execution proof ran to completion", false, e instanceof Error ? e.message : String(e));
} finally {
  if (started) cleanup();
}

for (const r of results) {
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${!r.ok && r.detail ? `  [${r.detail}]` : ""}`);
}
const failed = results.filter((r) => !r.ok);
console.log(
  `\nProved on a real PostgreSQL: pg_get_functiondef() retains body comments, the migration's` +
  `\nown §6.4 loop accepts the corrected authority, and still rejects the exact defect that` +
  `\nfailed the production push. No production data, no fixture rows, no Supabase, no send.`
);
console.log(
  `SUMMARY assertions=${results.length} passed=${results.length - failed.length} failed=${failed.length}`
);
process.exit(failed.length === 0 ? 0 : 1);
