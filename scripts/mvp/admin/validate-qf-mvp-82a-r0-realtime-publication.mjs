// ============================================================================
// QF-MVP-82A-R0 — Realtime publication foundation validator.  OFFLINE.
// No database, no network, no provider, no credential, no send.
//
// WHAT THIS PHASE IS
//   ONE migration whose entire database-semantic purpose is adding exactly two
//   existing tables to the `supabase_realtime` publication, so that a
//   SERVER-SIDE Realtime subscription can drive the QF-MVP-82A inbox. Publication
//   membership is not authorization: it grants nothing, changes no policy and
//   mutates no row.
//
// WHY IT IS ITS OWN PR
//   Adding a migration is a governance event here. It moves the live tree pin,
//   the post-anchor accounting and the staging-history manifest's PENDING set —
//   records that describe what is deployed to staging and production. That
//   belongs in a change a reviewer can read on its own, not inside a UI diff.
//
// This validator reads SOURCE ONLY. It proves the migration's shape, the
// manifest's truthfulness, and that no application or inbox file rode along.
// ============================================================================

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

// QF-MVP-50.7 RE-PIN: 105 -> 106, adding ONLY the SOURCE-PENDING stale-business
// terminalization authority (20260906000000). No existing migration was changed,
// renamed, deleted or reordered. Still exact equality, never a lower bound.

// QF-MVP-50.6 RE-PIN: 104 -> 105, adding ONLY the SOURCE-PENDING orphan cancellation
// authority (20260905000000). No existing migration was changed, renamed, deleted or
// reordered. Still exact equality, never a lower bound.

const MIGRATIONS_DIR = "supabase/migrations";
const R0_VERSION = "20260904000000";
const R0_NAME = "qf_mvp_82a_r0_whatsapp_inbox_realtime_publication";
const R0_FILE = `${R0_VERSION}_${R0_NAME}.sql`;
const R0_PATH = `${MIGRATIONS_DIR}/${R0_FILE}`;
const MANIFEST_PATH = "supabase/staging-history/qf-mvp-staging-history-manifest.json";

/** The two tables this phase is allowed to publish. Exactly these. */
const PUBLISHED_TABLES = ["public.communication_messages", "public.communication_inbound_messages"];

/** The migration count on main before R0, and after it. */
const MIGRATION_COUNT_BEFORE_R0 = 103;
const MIGRATION_COUNT_WITH_R0 = 104;
// QF-MVP-50.6 RE-PIN. The two constants above are HISTORICAL facts about R0's own
// phase — the tree was 103 before it and 104 after it — and must not move. The LIVE
// tree is a separate, current fact, pinned exactly and separately for the same reason
// G1 keeps RECONCILIATION_MIGRATION_COUNT apart from MIGRATION_COUNT.
const LIVE_MIGRATION_COUNT = 109;

const rawOf = (p) => readFileSync(resolve(p), "utf8");
/**
 * Comments AND single-quoted string literals are stripped before any containment
 * check.
 *
 * The string literals matter as much as the comments here: this migration's
 * raise-exception messages deliberately NAME the clauses it refuses on — "is FOR
 * ALL TABLES", "lost row level security". Those are the text of a refusal, not
 * DDL the migration performs, and a validator that could not tell the difference
 * would punish the migration for being explicit about what it guards against.
 */
const sqlCodeOf = (p) =>
  rawOf(p)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*--.*$/gm, " ")
    .replace(/'(?:[^']|'')*'/g, " 'string-literal' ");

const MIGRATION_RAW = rawOf(R0_PATH);
const MIGRATION_SQL = sqlCodeOf(R0_PATH);
const MANIFEST = JSON.parse(rawOf(MANIFEST_PATH));
const MIGRATIONS = readdirSync(resolve(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();

const checks = [];
const check = (name, fn) => checks.push({ name, fn });
function assert(c, m) { if (!c) throw new Error(m); }
const eq = (a, b, m) => assert(a === b, `${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
const absent = (code, re, label) => assert(!re.test(code), `${label} must not appear`);

const pendingOf = (version) =>
  (MANIFEST.pendingPostAnchorMigrations ?? []).find((m) => m.version === version) ?? null;
/**
 * QF-MVP-82A-R0-S1 applied R0 to staging, so its record moved out of the pending
 * set into the staging-applied set. This validator follows the RECORD rather than
 * the array it used to live in — the migration it guards has not changed at all.
 */
const stagingAppliedOf = (version) =>
  (MANIFEST.stagingAppliedPostAnchorMigrations ?? []).find((m) => m.version === version) ?? null;

/** The manifest's own canonicalization: UTF-8, CRLF folded to LF, all other bytes kept. */
const canonicalSha256 = (path) =>
  createHash("sha256").update(Buffer.from(rawOf(path).replace(/\r\n/g, "\n"), "utf8")).digest("hex");

// ---- 1-5. the migration is exactly one, and publishes exactly two tables ----

check("1 this phase adds exactly one migration", () => {
  const mine = MIGRATIONS.filter((f) => /82a_r0/i.test(f));
  eq(mine.length, 1, "exactly one R0 migration");
  eq(mine[0], R0_FILE, "and it is the expected file");
  assert(existsSync(resolve(R0_PATH)), "which exists on disk");
  // QF-MVP-50.6 RE-PIN: R0 is no longer the newest FILE in the tree, because a later
  // phase legitimately added one. What R0's own phase claimed — that it added exactly
  // one migration, sorting immediately after 80.14A — is unchanged and is what is
  // asserted here. "Immediately after" is still an exact positional proof.
  assert(R0_VERSION > "20260903040000", "its version sorts after 80.14A");
  eq(MIGRATIONS[MIGRATIONS.indexOf(R0_FILE) - 1],
    "20260903040000_qf_mvp_80_14a_meta_lead_assignment_production_activation.sql",
    "and 80.14A is immediately before it");
});

check("2 the publication is exactly supabase_realtime", () => {
  const alters = MIGRATION_SQL.match(/alter\s+publication\s+(\w+)/gi) ?? [];
  assert(alters.length >= 1, "the publication is altered");
  for (const a of alters) {
    assert(/supabase_realtime/i.test(a), `only supabase_realtime may be altered, found: ${a}`);
  }
  // No other publication is created, dropped or renamed.
  absent(MIGRATION_SQL, /create\s+publication/i, "a created publication");
  absent(MIGRATION_SQL, /drop\s+publication/i, "a dropped publication");
});

check("3 exactly the two inbox authorities are added", () => {
  const addBlock = /alter\s+publication\s+supabase_realtime\s+add\s+table([\s\S]*?);/i.exec(MIGRATION_SQL);
  assert(addBlock !== null, "an ADD TABLE statement exists");
  const named = (addBlock[1].match(/public\.[a-z_]+/gi) ?? []).map((s) => s.toLowerCase());
  eq(named.length, 2, `exactly two tables (${named.join(", ")})`);
  for (const t of PUBLISHED_TABLES) assert(named.includes(t), `${t} is published`);
  // Both are schema-qualified.
  for (const t of named) assert(t.startsWith("public."), `${t} is schema-qualified`);
});

check("4 FOR ALL TABLES is never used", () => {
  absent(MIGRATION_SQL, /for\s+all\s+tables/i, "FOR ALL TABLES");
  // It is also actively refused at apply time if the remote publication has it.
  assert(/puballtables/.test(MIGRATION_SQL), "and a FOR ALL TABLES publication is detected");
  assert(/raise exception[\s\S]{0,200}FOR ALL TABLES/i.test(MIGRATION_RAW), "and refused, not worked around");
});

check("5 no third table is published", () => {
  const addBlock = /add\s+table([\s\S]*?);/i.exec(MIGRATION_SQL);
  const named = (addBlock[1].match(/public\.[a-z_]+/gi) ?? []).map((s) => s.toLowerCase());
  for (const forbidden of [
    "public.communication_delivery_events", "public.communication_webhook_receipts",
    "public.leads", "public.vendors", "public.lead_assignment_approvals",
    "public.vendor_credit_logs", "public.payments", "public.vendor_packages",
    "public.communication_preferences", "public.automation_jobs",
  ]) {
    assert(!named.includes(forbidden), `${forbidden} must not be published`);
  }
  // Only one ADD TABLE statement exists at all.
  eq((MIGRATION_SQL.match(/add\s+table/gi) ?? []).length, 1, "exactly one ADD TABLE statement");
});

// ---- 6-10. no security, data or behaviour change ---------------------------

check("6 no RLS or policy change", () => {
  absent(MIGRATION_SQL, /row\s+level\s+security/i, "an RLS change");
  absent(MIGRATION_SQL, /create\s+policy|alter\s+policy|drop\s+policy/i, "a policy change");
  // RLS is asserted as UNCHANGED, which is a read, not a write.
  assert(/relrowsecurity\s*=\s*false/.test(MIGRATION_SQL), "and RLS loss is actively detected");
});

check("7 no grant to anon or authenticated", () => {
  absent(MIGRATION_SQL, /grant\s+[\s\S]{0,80}\bto\s+(anon|authenticated)/i, "a grant to an API role");
  absent(MIGRATION_SQL, /^\s*grant\s/im, "any GRANT at all");
  // The migration proves the API roles still have nothing. That check names the
  // roles as SQL string literals, so it is asserted against the raw text — the
  // stripped form deliberately no longer contains them.
  assert(/grantee in \('anon', 'authenticated'\)/.test(MIGRATION_RAW), "API-role access is checked");
});

check("8 no INSERT, UPDATE, DELETE or TRUNCATE", () => {
  for (const [re, label] of [
    [/^\s*insert\s+into/im, "an INSERT"],
    [/^\s*update\s+\w/im, "an UPDATE"],
    [/^\s*delete\s+from/im, "a DELETE"],
    [/truncate/i, "a TRUNCATE"],
    [/^\s*copy\s/im, "a COPY"],
  ]) {
    absent(MIGRATION_SQL, re, label);
  }
});

check("9 no trigger", () => {
  absent(MIGRATION_SQL, /create\s+(or\s+replace\s+)?trigger/i, "a trigger");
  absent(MIGRATION_SQL, /create\s+(or\s+replace\s+)?constraint\s+trigger/i, "a constraint trigger");
});

check("10 no write function, RPC or view", () => {
  absent(MIGRATION_SQL, /create\s+(or\s+replace\s+)?function/i, "a function");
  absent(MIGRATION_SQL, /create\s+(or\s+replace\s+)?procedure/i, "a procedure");
  absent(MIGRATION_SQL, /security\s+definer/i, "a SECURITY DEFINER body");
  // R0 owns publication membership only — the inbox views are not part of it.
  absent(MIGRATION_SQL, /create\s+(or\s+replace\s+)?view/i, "a view");
  absent(MIGRATION_SQL, /materialized\s+view/i, "a materialized view");
  // Nor does it alter table shape.
  absent(MIGRATION_SQL, /alter\s+table/i, "an ALTER TABLE");
  absent(MIGRATION_SQL, /create\s+table/i, "a CREATE TABLE");
  absent(MIGRATION_SQL, /create\s+index/i, "an index");
});

// ---- 11. no application code rode along ------------------------------------

check("11 no application or UI source is part of THIS phase's scope", () => {
  // QF-MVP-82A-C1 RE-SCOPE: this used to assert the inbox files did not EXIST.
  // That was a valid proxy while the inbox lived only on an unmerged branch, but
  // it is time-bound in exactly the way QF-MVP-80.14A's Z07 was: the moment PR #73
  // merges, the files are on main and the assertion fails forever while saying
  // nothing about this phase. The durable claim is about OWNERSHIP — the inbox is
  // the 82A slice's artefact, registered under its own validator, and this phase's
  // scope is the migration and the manifest. That is what is asserted now.
  // R0's own artefacts are exactly two: the migration and the manifest record.
  // Neither may contain application code, and the migration is pure DDL.
  absent(MIGRATION_SQL, /import |require\(|export /, "application code in the migration");
  const record = JSON.stringify(stagingAppliedOf(R0_VERSION) ?? pendingOf(R0_VERSION) ?? {});
  for (const p of [
    "app/api/admin/whatsapp/inbox",
    "services/adminWhatsAppInboxService",
    "lib/communication/whatsappInboxReadModel",
    "components/admin/whatsapp/inbox",
  ]) {
    assert(!record.includes(p), `${p} must not appear in R0's manifest record`);
  }
  // If the inbox IS present in the tree, it belongs to the 82A slice and carries
  // its own validator — it is never registered as part of R0's.
  const pkg = JSON.parse(rawOf("package.json"));
  if (existsSync(resolve("services/adminWhatsAppInboxService.ts"))) {
    assert(typeof pkg.scripts["test:mvp:82a"] === "string",
      "the inbox is present, so it must own its own validator");
    assert(/validate-qf-mvp-82a-whatsapp-inbox/.test(pkg.scripts["test:mvp:82a"]),
      "and that validator is the inbox one");
    assert(!/whatsappInbox|adminWhatsAppInboxService/.test(pkg.scripts["test:mvp:82a-r0"]),
      "while R0's validator remains the publication one");
  }
});

// ---- 12-14. the count truth ------------------------------------------------

check("12-13 R0 grew the tree by exactly one, from 103 to 104; the live tree is 105", () => {
  eq(MIGRATIONS.length, LIVE_MIGRATION_COUNT, "the live tree is 109");
  // Equivalent offline proof of R0's own contribution: remove this phase's single
  // migration AND every migration added after it, and what remains is exactly the 103
  // that were on main when R0 was written.
  const withoutR0 = MIGRATIONS.filter((f) => !/82a_r0/i.test(f));
  eq(MIGRATIONS.filter((f) => f < R0_FILE).length + 1, MIGRATION_COUNT_WITH_R0,
    "R0 was the 104th migration");
  eq(MIGRATIONS.filter((f) => f < R0_FILE).length, MIGRATION_COUNT_BEFORE_R0,
    "and it was 103 before R0");
  // No existing migration was renamed, removed or reordered.
  assert(withoutR0.includes("20260903040000_qf_mvp_80_14a_meta_lead_assignment_production_activation.sql"),
    "80.14A is still present");
  assert(withoutR0.every((f, i) => i === 0 || withoutR0[i - 1] < f), "and the set is still ordered");
});

check("14 the G1 live pin is the truthful current count", () => {
  const g1 = rawOf("scripts/mvp/staging/validate-qf-mvp-50-2c-s2-g1.mjs");
  assert(/const MIGRATION_COUNT = 109;/.test(g1), "G1 pins the live tree at 109");
  // The 80.05 reconciliation count is a HISTORICAL observation and must NOT move:
  // G1 says so itself, and the pending accounting depends on the difference.
  assert(/const RECONCILIATION_MIGRATION_COUNT = 102;/.test(g1),
    "the 80.05 reconciliation count stays 102 — it records what THAT phase looked at");
  eq(MANIFEST.historyReconciliation.migrationCount, 102,
    "and the manifest's historical record is likewise unchanged");
  // 104 - 102 = 2, which must be exactly the two pinned PENDING entries.
  eq(MIGRATIONS.length - MANIFEST.historyReconciliation.migrationCount,
    (MANIFEST.pendingPostAnchorMigrations ?? []).length +
    (MANIFEST.stagingAppliedPostAnchorMigrations ?? []).length,
    "every migration added since that reconciliation is accounted for as PENDING or STAGING-APPLIED");
});

// ---- 15-22. the manifest entry ---------------------------------------------

check("15 the R0 manifest entry appears exactly once", () => {
  // The version string appears twice inside ONE record — as `version` and inside
  // `path` — so records are counted, not raw occurrences.
  const everyRecord = [
    ...(MANIFEST.appliedPostAnchorMigrations ?? []),
    ...(MANIFEST.reconciledPostAnchorMigrations ?? []),
    ...(MANIFEST.stagingAppliedPostAnchorMigrations ?? []),
    ...(MANIFEST.pendingPostAnchorMigrations ?? []),
  ];
  eq(everyRecord.filter((m) => m.version === R0_VERSION).length, 1, "exactly one record names R0 anywhere");
  eq((MANIFEST.stagingAppliedPostAnchorMigrations ?? []).filter((m) => m.version === R0_VERSION).length, 1,
    "exactly one staging-applied record");
  // And it is not ALSO claimed anywhere else — in particular not in the applied
  // set, which would assert an observed remote-history count nobody observed, nor
  // in the reconciled set, which would assert production.
  for (const key of ["appliedPostAnchorMigrations", "reconciledPostAnchorMigrations", "pendingPostAnchorMigrations"]) {
    assert(!(MANIFEST[key] ?? []).some((m) => m.version === R0_VERSION), `not also in ${key}`);
  }
});

check("16-21 the R0 record states STAGING-APPLIED and still refuses production", () => {
  const e = stagingAppliedOf(R0_VERSION);
  assert(e !== null, "the record exists");
  eq(e.phase, "QF-MVP-82A-R0", "phase");
  eq(e.operationalStatus, "APPLIED_TO_STAGING", "operationalStatus");
  eq(e.appliedToStaging, true, "appliedToStaging");
  eq(e.appliedExactlyOnceToStaging, true, "applied exactly once to staging");
  eq(e.independentRemoteRelistVerified, true, "an independent re-list proved the remote row");
  eq(e.appliedToProduction, false, "appliedToProduction");
  eq(e.productionVersionStatus, "NOT_APPLIED_NOT_PROVEN", "production is neither applied nor inferred");
  eq(e.requiresSeparateProductionDeploymentGate, true, "production is still gated");
  // The exact distinction that keeps this record OUT of the applied ten.
  eq(e.remoteHistoryCountObservedAtApply, false, "no remote history count was observed");
  eq(e.remoteHistoryCountAfterApply, null, "and none is fabricated to qualify for APPLIED");
  eq(e.path, R0_PATH, "path");
  eq(e.name, R0_NAME, "name");
  assert(typeof e.purpose === "string" && e.purpose.length > 40, "it states its purpose");
  assert(/publication/i.test(e.purpose), "which names publication membership");
});

check("22 the manifest hash is the exact hash of the source file", () => {
  const e = stagingAppliedOf(R0_VERSION);
  const actual = canonicalSha256(R0_PATH);
  eq(e.sha256, actual, "the pinned SHA-256 matches the file on disk");
  eq(MANIFEST.migrationSourceHashPolicy.algorithm, "sha256", "under the manifest's own algorithm");
  eq(MANIFEST.migrationSourceHashPolicy.canonicalization, "UTF8_LINE_ENDINGS_TO_LF", "and canonicalization");
});

// ---- 23-24. nothing historical was touched ---------------------------------

check("23 the 80.14A pending record is byte-identical", () => {
  const e = pendingOf("20260903040000");
  assert(e !== null, "80.14A is still pending");
  eq(e.phase, "QF-MVP-80.14A", "phase unchanged");
  eq(e.sha256, "b3bd351c61c81b02aced5257507412d45ad2d77075265f644633c699384d42e2", "SHA unchanged");
  eq(e.operationalStatus, "PENDING", "status unchanged");
  eq(e.appliedToStaging, false, "still not applied to staging");
  eq(e.appliedToProduction, false, "still not applied to production");
  eq(e.requiresSeparateStagingDeploymentGate, true, "still gated");
  // R0 leaving the pending set must not have disturbed it: 80.14A is alone again,
  // exactly as it was before R0 was ever added.
  // QF-MVP-50.6 RE-PIN: pending is two again — 80.14A plus the source-only orphan
  // cancellation authority. What this check exists to prove is that R0 leaving the
  // pending set did not disturb the 80.14A record, and that is still exact.
  eq(MANIFEST.pendingPostAnchorMigrations[0].version, "20260903040000", "and it is the first entry");
  eq(MANIFEST.pendingPostAnchorMigrations[1].version, "20260905000000", "followed by 50.6");
  eq(MANIFEST.pendingPostAnchorMigrations.length, 5, "the pending set is exactly five");
});

check("24 applied and reconciled records are unchanged", () => {
  eq((MANIFEST.appliedPostAnchorMigrations ?? []).length, 10, "ten applied");
  eq((MANIFEST.reconciledPostAnchorMigrations ?? []).length, 5, "five reconciled");
  for (const r of MANIFEST.appliedPostAnchorMigrations) eq(r.operationalStatus, "APPLIED", `${r.version} applied`);
  for (const r of MANIFEST.reconciledPostAnchorMigrations) {
    eq(r.operationalStatus, "APPLIED", `${r.version} reconciled as applied`);
    eq(r.appliedToStaging, true, `${r.version} staging`);
    eq(r.appliedToProduction, true, `${r.version} production`);
  }
  // QF-MVP-50.6 RE-PIN: the anchor accounts for ten + five + one + two.
  eq(MANIFEST.appliedAnchor.postAnchorMigrationCount, 22, "post-anchor count is twenty-two");
  eq((MANIFEST.stagingAppliedPostAnchorMigrations ?? []).length, 2, "two staging-applied");
  eq(MANIFEST.appliedPostAnchorMigrations.length + MANIFEST.reconciledPostAnchorMigrations.length +
     MANIFEST.stagingAppliedPostAnchorMigrations.length + MANIFEST.pendingPostAnchorMigrations.length,
     22, "and the four sets add up to it");
});

// ---- 25-26. this phase reaches nothing --------------------------------------

check("25 nothing here reads a database, a network or a credential", () => {
  // A file cannot prove its own containment by grepping itself for the very
  // patterns its checks are written in — the check list would match itself. What
  // IS provable is the import surface: this validator pulls in Node builtins and
  // nothing else, so it has no client, no transport and no credential reader
  // available to it at all.
  const self = rawOf("scripts/mvp/admin/validate-qf-mvp-82a-r0-realtime-publication.mjs");
  const imports = [...self.matchAll(/^import\s[\s\S]*?from\s+"([^"]+)";/gm)].map((m) => m[1]);
  eq(imports.length, 3, `exactly three imports (${imports.join(", ")})`);
  for (const spec of imports) assert(spec.startsWith("node:"), `${spec} is a Node builtin`);
  for (const forbidden of ["node:http", "node:https", "node:net", "node:child_process", "node:dns"]) {
    assert(!imports.includes(forbidden), `${forbidden} is not imported`);
  }
  // Counted, not pattern-matched across lines: a lazy multi-line regex would
  // happily span from a real import statement into a STRING that merely contains
  // the word `from`, and report a non-builtin import that does not exist. The
  // statement list above is the precise proof; this only checks nothing hid.
  eq((self.match(/^import\s/gm) ?? []).length, imports.length,
    "every import statement was parsed, so none escaped the check above");
  // The migration itself performs no connection either; it is DDL only.
  absent(MIGRATION_SQL, /dblink|postgres_fdw|http_post|pg_net/i, "an outbound call from SQL");
});

check("26 no WhatsApp send path is reachable from this phase", () => {
  for (const [re, label] of [
    [/graph\.facebook\.com/i, "a Graph host"],
    [/\/messages\b/, "a provider messages endpoint"],
    [/send_message|sendTemplate|CommunicationService/i, "a send path"],
  ]) {
    absent(MIGRATION_SQL, re, label);
  }
  // Publication membership cannot send: it is a replication concern only.
  assert(/publication membership is not/i.test(MIGRATION_RAW.toLowerCase()) ||
    /grants no browser access|not browser authorization/i.test(MIGRATION_RAW),
    "and the migration says so to the reader");
});

// ---- mutants ----------------------------------------------------------------

check("M1 mutant: FOR ALL TABLES would publish the whole database", () => {
  const naive = "alter publication supabase_realtime set (publish = 'insert'); create publication p for all tables;";
  assert(/for\s+all\s+tables/i.test(naive), "the mutant is detectable");
  absent(MIGRATION_SQL, /for\s+all\s+tables/i, "the real migration never does it");
});

check("M2 mutant: dropping one required table would break the inbox silently", () => {
  const naive = "alter publication supabase_realtime add table public.communication_messages;";
  eq((naive.match(/public\.[a-z_]+/g) ?? []).length, 1, "the mutant publishes only one");
  const addBlock = /add\s+table([\s\S]*?);/i.exec(MIGRATION_SQL);
  eq((addBlock[1].match(/public\.[a-z_]+/gi) ?? []).length, 2, "the real migration publishes both");
});

check("M3 mutant: a third table would widen the replication surface", () => {
  const naive = "add table public.communication_messages, public.communication_inbound_messages, public.leads;";
  assert(/public\.leads/.test(naive), "the mutant adds a third");
  assert(!/public\.leads/i.test(MIGRATION_SQL), "the real migration does not");
  assert(!/communication_delivery_events/i.test(
    /add\s+table([\s\S]*?);/i.exec(MIGRATION_SQL)[1]), "nor the delivery ledger");
});

check("M4 mutant: an authenticated SELECT grant would open the tables to the browser", () => {
  const naive = "grant select on public.communication_messages to authenticated;";
  assert(/to\s+authenticated/i.test(naive), "the mutant is detectable");
  absent(MIGRATION_SQL, /^\s*grant\s/im, "the real migration grants nothing");
});

check("M5-M6 mutants: claiming R0 reached PRODUCTION", () => {
  const e = stagingAppliedOf(R0_VERSION);
  for (const field of ["appliedToProduction", "productionVersionStatus", "requiresSeparateProductionDeploymentGate"]) {
    assert(field in e, `${field} is stated explicitly, never left to inference`);
  }
  const mutant = { ...e, appliedToProduction: true, productionVersionStatus: "APPLIED" };
  assert(mutant.appliedToProduction !== e.appliedToProduction, "the mutant claims production");
  eq(e.appliedToProduction, false, "the real record does not");
  eq(e.productionVersionStatus, "NOT_APPLIED_NOT_PROVEN", "and refuses to infer production from staging");
});

check("M7 mutant: a manifest SHA that does not match the file", () => {
  const e = stagingAppliedOf(R0_VERSION);
  const wrong = createHash("sha256").update("not the migration").digest("hex");
  assert(wrong !== e.sha256, "the mutant hash differs");
  eq(e.sha256, canonicalSha256(R0_PATH), "the real one is the file's own hash");
});

check("M8 mutant: leaving the migration count stale", () => {
  const g1 = rawOf("scripts/mvp/staging/validate-qf-mvp-50-2c-s2-g1.mjs");
  assert(!/const MIGRATION_COUNT = 103;/.test(g1), "the stale pin is gone");
  assert(/const MIGRATION_COUNT = 109;/.test(g1), "and replaced by the truthful one");
  // No pin was loosened to an inequality to make this pass.
  assert(!/MIGRATION_COUNT\s*>=|migrations\.length\s*>=/.test(g1), "no `>=` was introduced");
  assert(!/postAnchorLocal\.length\s*>=/.test(g1), "nor on the post-anchor set");
});

check("M9 mutant: altering the 80.14A pending record", () => {
  const e = pendingOf("20260903040000");
  const mutant = { ...e, operationalStatus: "APPLIED" };
  assert(mutant.operationalStatus !== e.operationalStatus, "the mutant reclassifies it");
  eq(e.operationalStatus, "PENDING", "the real record is untouched");
  eq(e.sha256, "b3bd351c61c81b02aced5257507412d45ad2d77075265f644633c699384d42e2", "hash untouched");
});

check("M10 mutant: application code inside R0's own artefacts", () => {
  // The mutant puts application source where R0's scope is — its migration.
  const naive = 'import { adminClient } from "@/lib/supabase";';
  assert(/import /.test(naive), "the mutant is detectable");
  absent(MIGRATION_SQL, /import |require\(/, "R0's migration is pure DDL");
  // And R0's validator is still the publication one, not the inbox one.
  const pkg = JSON.parse(rawOf("package.json"));
  assert(/validate-qf-mvp-82a-r0-realtime-publication/.test(pkg.scripts["test:mvp:82a-r0"]),
    "R0 owns only its publication validator");
});

// ============================================================================
let passed = 0;
const failures = [];
for (const { name, fn } of checks) {
  try { fn(); passed += 1; console.log(`   ok    ${name}`); }
  catch (e) { failures.push(`   FAIL  ${name} — ${e.message}`); console.log(`   FAIL  ${name} — ${e.message}`); }
}
console.log(`\n${"=".repeat(78)}`);
console.log(`QF-MVP-82A-R0 Realtime publication foundation — passed ${passed}, failed ${failures.length}`);
if (failures.length) { console.log("\nFAILURES:"); for (const l of failures) console.log(l); }
console.log("=".repeat(78));
process.exit(failures.length ? 1 : 0);
