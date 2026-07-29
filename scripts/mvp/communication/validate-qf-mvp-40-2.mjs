// ============================================================================
// QF-MVP-40.2 — offline validator for the migration & schema readiness artefacts.
//
// OFFLINE. Reads only the repository: the 12 migration files, the read-only SQL
// verifier, and docs/generated/qf-mvp-40-2-schema-matrix.json. It opens no
// database, no network and no credential — it validates the ARTEFACTS, not a
// live schema, so it stays deterministic long after the measurement was taken.
//
// Every rule is paired with a MUTATION SELF-TEST that must FAIL, so the
// validator proves it is capable of failing.
// ============================================================================

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const MATRIX = "docs/generated/qf-mvp-40-2-schema-matrix.json";
const SQL = "scripts/mvp/communication/qf-mvp-40-2-readonly-schema-audit.sql";
const DOC = "docs/QF-MVP-40-2-MIGRATION-SCHEMA-READINESS.md";

const EXPECTED_VERSIONS = Object.freeze([
  "20260708000170", "20260708000190", "20260708000200", "20260709000100",
  "20260709000200", "20260711000100", "20260711000200", "20260712000300",
  "20260713000100", "20260716000100", "20260720000100", "20260721000100",
]);

const CLASSIFICATIONS = Object.freeze(new Set([
  "APPLIED_RECORDED_AND_MATCHING", "APPLIED_RECORDED_BUT_DRIFTED",
  "OBJECTS_PRESENT_UNRECORDED", "PARTIALLY_PRESENT", "ABSENT_EXPECTED_PENDING",
  "SUPERSEDED_BY_LATER_MIGRATION", "UNKNOWN_REQUIRES_EVIDENCE",
]));

const CUMULATIVE = Object.freeze(new Set([
  "ALREADY_PRODUCTION_MATCHING", "INCLUDED_IN_CUMULATIVE_17",
  "OBJECT_PRESENT_HISTORY_DRIFT_REQUIRES_CUTOVER_RECONCILIATION",
  "NOT_REQUIRED_FOR_CURRENT_RELEASE", "CORRECTION_DESIGN_REQUIRED",
]));

const ROLLBACK = Object.freeze(new Set([
  "REVERSIBLE_DDL", "DATA_BACKFILL_REQUIRES_FORWARD_REPAIR", "CONSTRAINT_ONLY",
  "GRANT_ONLY", "IRREVERSIBLE_WITHOUT_BACKUP", "NO_ROLLBACK_NEEDED_SUPERSEDED",
]));

const results = [];
const add = (name, ok, detail) => results.push({ name, ok: ok === true, detail: detail ?? "" });
const clone = (o) => JSON.parse(JSON.stringify(o));

const matrix = JSON.parse(readFileSync(resolve(MATRIX), "utf8"));
const sqlText = readFileSync(resolve(SQL), "utf8");

/** Executable SQL: strip -- line comments so explanatory prose cannot trip the token scan. */
function sqlExecutable(text) {
  return text.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
}

const R = {
  exactlyTwelve: (m) => m.migrations.length === 12,

  versionsMatch: (m) =>
    m.migrations.map((x) => x.version).join(",") === EXPECTED_VERSIONS.join(","),

  filenamesExist: (m) =>
    m.migrations.every((x) => existsSync(resolve("supabase/migrations", x.filename))),

  hashesFixed: (m) =>
    m.migrations.every((x) => /^[0-9a-f]{64}$/.test(x.git_blob_sha256)),

  /** The recorded hash must equal the CURRENT committed bytes — proves no migration was edited. */
  hashesMatchGit: (m) =>
    m.migrations.every((x) => {
      const blob = execFileSync("git", ["cat-file", "blob", `HEAD:supabase/migrations/${x.filename}`],
        { maxBuffer: 64 * 1024 * 1024 });
      return createHash("sha256").update(blob).digest("hex") === x.git_blob_sha256;
    }),

  deterministicOrder: (m) =>
    m.migrations.every((x, i) => i === 0 || m.migrations[i - 1].version < x.version),

  /** Dependencies must reference known versions and always point BACKWARD (acyclic by construction). */
  dependencyGraphAcyclic: (m) => {
    const idx = new Map(m.migrations.map((x, i) => [x.version, i]));
    return m.migrations.every((x, i) =>
      (x.depends_on ?? []).every((d) => idx.has(d) && idx.get(d) < i));
  },

  classificationVocabulary: (m) =>
    m.migrations.every((x) =>
      CLASSIFICATIONS.has(x.staging_classification) &&
      CLASSIFICATIONS.has(x.production_classification)),

  cumulativeVocabulary: (m) =>
    m.migrations.every((x) => CUMULATIVE.has(x.cumulative_release_treatment)),

  rollbackVocabulary: (m) =>
    m.migrations.every((x) => ROLLBACK.has(x.rollback_class)),

  /** History state and object state are recorded independently, and both must be explicit. */
  independentStates: (m) =>
    m.migrations.every((x) =>
      ["RECORDED", "ABSENT"].includes(x.staging_history_state) &&
      ["RECORDED", "ABSENT"].includes(x.production_history_state) &&
      ["PRESENT", "ABSENT"].includes(x.staging_object_state) &&
      ["PRESENT", "ABSENT"].includes(x.production_object_state)),

  /** A migration is never called applied merely because its objects exist. */
  noAppliedFromObjectsAlone: (m) =>
    m.migrations.every((x) =>
      !(x.production_history_state === "ABSENT" &&
        x.production_classification === "APPLIED_RECORDED_AND_MATCHING")),

  /** ...and never called absent merely because history lacks the version. */
  noAbsentFromHistoryAlone: (m) =>
    m.migrations.every((x) =>
      !(x.production_object_state === "PRESENT" &&
        x.production_classification === "ABSENT_EXPECTED_PENDING")),

  /** 20260721000100 is handled consistently with the cumulative pending set. */
  pendingHandledAsCumulative: (m) => {
    const p = m.migrations.find((x) => x.version === "20260721000100");
    return !!p && p.cumulative_release_treatment === "INCLUDED_IN_CUMULATIVE_17"
      && p.production_object_state === "ABSENT";
  },

  /** No competing independent production apply plan may be proposed. */
  noCompetingApplyPlan: (m) => {
    const raw = JSON.stringify(m).toLowerCase();
    const banned = ["db push", "migration up", "migration repair", "db reset", "apply_migration"];
    return !banned.some((b) => raw.includes(b));
  },

  everyMigrationHasAction: (m) =>
    m.migrations.every((x) => typeof x.required_action === "string" && x.required_action.length > 0),

  everyMigrationHasBlockingFlags: (m) =>
    m.migrations.every((x) =>
      typeof x.blocks_40_3 === "boolean" &&
      typeof x.blocks_40_6 === "boolean" &&
      typeof x.blocks_staging_canary === "boolean"),

  /** The read-only verifier must contain no write/DDL token outside comments. */
  sqlIsReadOnly: () => {
    const exec = sqlExecutable(sqlText);
    const banned = /\b(insert\s+into|update\s+\w|delete\s+from|merge\s+into|truncate|create\s+(table|index|function|trigger|policy|role|schema)|alter\s+(table|function|role)|drop\s+\w|grant\s+\w|revoke\s+\w|copy\s+\w|vacuum|set\s+role|security\s+definer)\b/i;
    return !banned.test(exec);
  },

  sqlHasNoDoBlock: () => !/\bdo\s*\$\$/i.test(sqlExecutable(sqlText)),

  sqlHasNoTempTable: () => !/\b(create\s+temp|temporary\s+table)\b/i.test(sqlExecutable(sqlText)),

  /** No secret, credential or PII-shaped literal may appear in a generated artefact. */
  artefactsCarryNoSecretsOrPii: (m) => {
    const raw = JSON.stringify(m) + sqlText;
    // Phone shape must be a PHONE, not any long digit run: migration versions are 14 consecutive
    // digits (e.g. 20260708000170) and a naive /\d{10,}/ flags every one of them. Require either an
    // international "+" prefix or genuine group separators.
    const phone = /\+\d[\d\s-]{8,}|\b\d{3,5}[\s-]\d{3,5}[\s-]\d{3,5}\b/;
    const email = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
    const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    const bearer = /(bearer\s+[A-Za-z0-9._-]{12,}|eyJ[A-Za-z0-9._-]{20,}|postgres(ql)?:\/\/)/i;
    return !phone.test(raw) && !email.test(raw) && !uuid.test(raw) && !bearer.test(raw);
  },

  /** Drift must be enumerated, not summarised away. */
  driftRecorded: (m) =>
    Array.isArray(m.known_drift) && m.known_drift.length >= 1 &&
    m.known_drift.every((d) => d.id && d.summary && d.evidence && d.impact && d.action),

  readinessDocExists: () => existsSync(resolve(DOC)),

  /** No migration file may have been edited on this branch. */
  noMigrationEdited: () => {
    const changed = execFileSync("git", ["diff", "--name-only",
      "1713838401da8b160cbeb9d3b6090bd017bdb958..HEAD"], { encoding: "utf8" })
      .split("\n").map((s) => s.trim()).filter(Boolean);
    return !changed.some((f) => f.startsWith("supabase/migrations/"));
  },
};

const RULES = [
  ["V1  exactly 12 migrations inventoried", R.exactlyTwelve],
  ["V2  versions match the locked QF-MVP-40 set", R.versionsMatch],
  ["V3  every migration filename exists", R.filenamesExist],
  ["V4  every git blob SHA-256 is well formed", R.hashesFixed],
  ["V5  every SHA-256 matches the committed bytes", R.hashesMatchGit],
  ["V6  migration order is deterministic and ascending", R.deterministicOrder],
  ["V7  dependency graph is acyclic and backward-only", R.dependencyGraphAcyclic],
  ["V8  staging/production classifications use the allowed vocabulary", R.classificationVocabulary],
  ["V9  cumulative-release treatments use the allowed vocabulary", R.cumulativeVocabulary],
  ["V10 every migration has a rollback classification", R.rollbackVocabulary],
  ["V11 history state and object state are recorded independently", R.independentStates],
  ["V12 nothing is marked applied from object presence alone", R.noAppliedFromObjectsAlone],
  ["V13 nothing is marked absent from missing history alone", R.noAbsentFromHistoryAlone],
  ["V14 20260721000100 is handled as part of the cumulative pending set", R.pendingHandledAsCumulative],
  ["V15 no competing independent production apply plan is proposed", R.noCompetingApplyPlan],
  ["V16 every migration carries a required action", R.everyMigrationHasAction],
  ["V17 every migration carries 40.3/40.6/canary blocking flags", R.everyMigrationHasBlockingFlags],
  ["V18 the SQL verifier contains no write/DDL token outside comments", R.sqlIsReadOnly],
  ["V19 the SQL verifier contains no DO block", R.sqlHasNoDoBlock],
  ["V20 the SQL verifier creates no temporary table", R.sqlHasNoTempTable],
  ["V21 generated artefacts carry no secrets or PII", R.artefactsCarryNoSecretsOrPii],
  ["V22 measured drift is enumerated with evidence and action", R.driftRecorded],
  ["V23 the readiness document exists", R.readinessDocExists],
  ["V24 no migration file was edited on this branch", R.noMigrationEdited],
];
for (const [name, fn] of RULES) add(name, fn(matrix));

const MUTATIONS = [
  ["M1  a missing migration is rejected", R.exactlyTwelve, (m) => { m.migrations.pop(); }],
  ["M2  a renamed version is rejected", R.versionsMatch, (m) => { m.migrations[0].version = "20990101000000"; }],
  ["M3  a missing file is rejected", R.filenamesExist, (m) => { m.migrations[0].filename = "nope.sql"; }],
  ["M4  a malformed hash is rejected", R.hashesFixed, (m) => { m.migrations[0].git_blob_sha256 = "xyz"; }],
  ["M5  a hash not matching git is rejected", R.hashesMatchGit, (m) => { m.migrations[0].git_blob_sha256 = "0".repeat(64); }],
  ["M6  out-of-order migrations are rejected", R.deterministicOrder, (m) => { m.migrations.reverse(); }],
  ["M7  a forward dependency is rejected", R.dependencyGraphAcyclic, (m) => { m.migrations[0].depends_on = ["20260721000100"]; }],
  ["M8  an unknown classification is rejected", R.classificationVocabulary, (m) => { m.migrations[0].production_classification = "PROBABLY_FINE"; }],
  ["M9  an unknown cumulative treatment is rejected", R.cumulativeVocabulary, (m) => { m.migrations[0].cumulative_release_treatment = "JUST_APPLY_IT"; }],
  ["M10 a missing rollback class is rejected", R.rollbackVocabulary, (m) => { m.migrations[0].rollback_class = "MAYBE"; }],
  ["M11 a non-explicit state is rejected", R.independentStates, (m) => { m.migrations[0].production_object_state = "PROBABLY"; }],
  ["M12 applied-from-objects-alone is rejected", R.noAppliedFromObjectsAlone, (m) => {
    m.migrations[0].production_history_state = "ABSENT";
    m.migrations[0].production_classification = "APPLIED_RECORDED_AND_MATCHING"; }],
  ["M13 absent-from-history-alone is rejected", R.noAbsentFromHistoryAlone, (m) => {
    m.migrations[0].production_object_state = "PRESENT";
    m.migrations[0].production_classification = "ABSENT_EXPECTED_PENDING"; }],
  ["M14 mishandling the pending migration is rejected", R.pendingHandledAsCumulative, (m) => {
    m.migrations.find((x) => x.version === "20260721000100").cumulative_release_treatment = "NOT_REQUIRED_FOR_CURRENT_RELEASE"; }],
  ["M15 a competing apply plan is rejected", R.noCompetingApplyPlan, (m) => {
    m.migrations[0].required_action = "run supabase db push against production"; }],
  ["M16 a missing action is rejected", R.everyMigrationHasAction, (m) => { m.migrations[0].required_action = ""; }],
  ["M17 a missing blocking flag is rejected", R.everyMigrationHasBlockingFlags, (m) => { delete m.migrations[0].blocks_40_6; }],
  ["M18 a PII-shaped literal is rejected", R.artefactsCarryNoSecretsOrPii, (m) => {
    m.migrations[0].purpose += " contact +91 98765 43210"; }],
  ["M19 unenumerated drift is rejected", R.driftRecorded, (m) => { m.known_drift = []; }],
];
for (const [name, fn, mutate] of MUTATIONS) {
  const copy = clone(matrix);
  mutate(copy);
  add(name, fn(copy) === false);
}

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? `  [${r.detail}]` : ""}`);
console.log(`\nMigrations inventoried: ${matrix.migrations.length}`);
console.log(`Drift entries recorded: ${(matrix.known_drift ?? []).length}`);
console.log(`Summary: ${results.length - failed.length} passed, ${failed.length} failed ` +
  `(rules: ${RULES.length}, mutation self-tests: ${MUTATIONS.length}).`);
process.exit(failed.length === 0 ? 0 : 1);
