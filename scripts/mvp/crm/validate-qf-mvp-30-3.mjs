#!/usr/bin/env node
/**
 * QF-MVP-30.3A — offline validator for the deterministic vendor segment foundation.
 *
 * Grades the REAL artifacts (migration, contracts, validation module, verifier,
 * docs) and EXECUTES the real rule engine. One-defect fixtures mutate copies to
 * prove each rule actually trips.
 *
 * Locked owner decisions enforced here:
 *   1. definition-only — no membership/audience/campaign/provider object;
 *   4. no package-expiry / package-order predicate;
 *   5. no free-text predicate (PostgREST pattern grammar cannot enter the AST);
 *   6. no AI/provider/consent/assignment authority.
 *
 * Section 6 executes `.ts` modules, so the type-stripping loader must be registered.
 *
 * Usage:  npm run test:crm:30-3                                  (exit 0 = PASS)
 *   or:   node --import ./scripts/mvp/loader/register.mjs \
 *              scripts/mvp/crm/validate-qf-mvp-30-3.mjs
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const MIGRATION = "supabase/migrations/20260723001200_qf_mvp_vendor_segment_foundation.sql";
const FOUNDATION = "supabase/migrations/20260723001100_qf_mvp_vendor_crm_foundation.sql";
const VERIFIER_30_3 = "supabase/staging-verification/verify_qf_mvp_30_3.sql";
const VERIFIER_30_1B = "supabase/staging-verification/verify_qf_mvp_30_1b.sql";
const CONTRACTS = "lib/crm/segmentRuleContracts.ts";
const VALIDATION = "lib/crm/segmentRuleValidation.ts";
const SELF = "scripts/mvp/crm/validate-qf-mvp-30-3.mjs";

const results = [];
let failed = false;
const record = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); if (!ok) failed = true; };
const read = (rel) => readFileSync(path.join(ROOT, rel), "utf8");
const sha256 = (t) => createHash("sha256").update(t, "utf8").digest("hex");

/* ===========================================================================
 * MIGRATION evaluator — the locked schema/ACL contract
 * ========================================================================= */
export function evaluateMigration(src) {
  const f = [];
  const add = (rule, detail) => f.push({ rule, detail });

  // M01 exactly one table, and it is vendor_segments.
  const creates = [...src.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.(\w+)/gi)].map((m) => m[1]);
  if (creates.length !== 1 || creates[0] !== "vendor_segments") {
    add("M01_single_segment_table", `creates ${creates.join(",") || "nothing"}`);
  }
  // M02 no membership / campaign / audience / provider object (owner decision 1).
  for (const t of ["vendor_segment_memberships", "vendor_segment_members", "vendor_segment_versions",
    "vendor_campaigns", "vendor_campaign_audiences", "vendor_campaign_events", "vendor_engagement_events"]) {
    if (new RegExp(`create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?public\\.${t}\\b`, "i").test(src)) {
      add("M02_no_membership_or_campaign", `creates ${t}`);
    }
  }
  // M03 RLS enabled + untrusted roles revoked.
  if (!/alter\s+table\s+public\.vendor_segments\s+enable\s+row\s+level\s+security/i.test(src)) {
    add("M03_rls_default_deny", "RLS is not enabled on vendor_segments");
  }
  if (!/revoke\s+all\s+privileges\s+on\s+table\s+public\.vendor_segments\s+from[^;]*anon[^;]*authenticated/i.test(src)) {
    add("M03_rls_default_deny", "untrusted roles are not revoked");
  }
  // M04 service_role gets SELECT+INSERT+UPDATE and never DELETE/TRUNCATE.
  const grant = src.match(/grant\s+([^;]+?)\s+on\s+table\s+public\.vendor_segments\s+to\s+service_role/i);
  if (!grant) add("M04_no_delete_posture", "no service_role grant found");
  else {
    const privs = grant[1].toLowerCase();
    if (!/select/.test(privs) || !/insert/.test(privs) || !/update/.test(privs)) {
      add("M04_no_delete_posture", `grant is incomplete: ${privs}`);
    }
    if (/delete|truncate|references|trigger|all/.test(privs)) {
      add("M04_no_delete_posture", `grant includes a forbidden privilege: ${privs}`);
    }
  }
  // M05 no Core-truth copy / no membership column.
  for (const col of ["vendor_id", "verification_status", "is_active", "city", "service_categories",
    "areas_covered", "package_id", "remaining_credits", "total_credits", "consent", "is_suppressed",
    "member_count", "recipients", "approved_audience"]) {
    if (new RegExp(`^\\s{2}${col}\\s+\\w`, "mi").test(src)) add("M05_no_core_copy", `declares column ${col}`);
  }
  // M06 canonical rule storage + fingerprint + monotonic version.
  for (const need of ["definition", "definition_version", "definition_fingerprint", "schema_version"]) {
    if (!new RegExp(`^\\s{2}${need}\\s+\\w`, "m").test(src)) add("M06_rule_storage", `missing column ${need}`);
  }
  if (!/vsg_fingerprint_shape\s+check/i.test(src)) add("M06_rule_storage", "no fingerprint shape check");
  if (!/vsg_schema_version_check\s+check/i.test(src)) add("M06_rule_storage", "no schema_version check");
  // M07 lifecycle + archive-only.
  if (!/vsg_status_check\s+check\s*\(status\s+in\s*\('draft','active','archived'\)\)/i.test(src)) {
    add("M07_lifecycle", "status check is not the locked 3-state lifecycle");
  }
  if (!/vsg_archived_consistency/i.test(src)) add("M07_lifecycle", "no archived/archived_at consistency check");
  // M08 live-name uniqueness.
  if (!/create\s+unique\s+index[^;]*vendor_segments[^;]*lower\(btrim\(name\)\)[^;]*where\s+status\s*<>\s*'archived'/is.test(src)) {
    add("M08_name_uniqueness", "no partial unique live-name index");
  }
  // M09 actor provenance, never CASCADE.
  for (const c of ["created_by", "updated_by", "archived_by"]) {
    if (!new RegExp(`vsg_${c}_fk\\s+foreign\\s+key`, "i").test(src)) add("M09_actor_provenance", `missing ${c} FK`);
  }
  // `[^,)]*` cannot cross the `)` in `profiles (id)`, so match the paren group.
  if (/references\s+public\.profiles\s*\([^)]*\)[^;,]*?on\s+delete\s+cascade/i.test(src)) {
    add("M09_actor_provenance", "an actor FK cascades (losing an admin must not lose a segment)");
  }
  // M10 no 006 dependency, no destructive DDL, no Core alteration, no backfill.
  // Strip comments AND single-quoted literals: the self-verify block legitimately
  // passes 'TRUNCATE'/'DELETE' as privilege NAMES to has_table_privilege.
  const exec = src.replace(/--[^\n]*/g, " ").replace(/'(?:[^']|'')*'/g, "''");
  if (/\baudit_logs\b|\badmin_notifications\b/.test(exec)) {
    add("M10_no_006_dependency", "references an omitted migration-006 table in executable SQL");
  }
  if (/\bdrop\s+table\b|\btruncate\b|\bdelete\s+from\b/i.test(exec)) add("M10_no_006_dependency", "contains destructive DDL/DML");
  if (/alter\s+table\s+public\.(vendors|leads|lead_assignments|profiles|packages|vendor_credit_logs)\b/i.test(exec)) {
    add("M10_no_006_dependency", "alters a Core table");
  }
  if (/\binsert\s+into\b/i.test(exec)) add("M10_no_006_dependency", "performs a data backfill");
  return f;
}

/* ===========================================================================
 * CONTRACT evaluator — the closed registries
 * ========================================================================= */
export function evaluateContracts(src) {
  const f = [];
  const add = (rule, detail) => f.push({ rule, detail });
  if (/import\s+["']server-only["']/.test(src)) add("C01_pure", "contracts import server-only");
  if (/adminClient|createClient|@supabase/.test(src)) add("C01_pure", "contracts touch a database client");
  // no free-text operator anywhere (owner decision 5).
  if (/\b(like|ilike|contains_text|text_contains|search|matches|regex)\b\s*:/i.test(src)) {
    add("C02_no_free_text", "a free-text/pattern operator is registered");
  }
  // no package-expiry field registered (owner decision 4).
  if (/["'](core|crm)\.(package_expires_at|package_expiry_days|days_to_expiry|active_package|package_order_status)["']\s*:\s*\{/.test(src)) {
    add("C03_no_package_expiry", "a package-expiry field is registered as permitted");
  }
  // consent/suppression/eligibility must NOT be permitted fields.
  if (/["'](core|crm)\.(consent_status|is_suppressed|suppression|communication_authorization|campaign_eligibility|is_eligible)["']\s*:\s*\{\s*\n?\s*source:/.test(src)) {
    add("C04_no_authorization_input", "a consent/suppression/eligibility field is registered as permitted");
  }
  return f;
}

/* ===========================================================================
 * 1. Files exist + locked foundation untouched
 * ========================================================================= */
for (const file of [MIGRATION, CONTRACTS, VALIDATION, VERIFIER_30_3]) {
  record(`01 present :: ${file}`, existsSync(path.join(ROOT, file)), file);
}
record("02 locked 30.1B foundation migration unchanged",
  sha256(read(FOUNDATION)) === "9212f746f0eb90a0be281b9b31c34e3c4ea19466d5d09c9e29f11bafb969ed34",
  "the applied foundation is byte-identical");
record("03 locked 30.1B verifier unchanged (historical, pre-segments)",
  sha256(read(VERIFIER_30_1B)) === "e10caa5699ff67346a700c6bd8a69c0a7ff0e0e5d48eeb76dcf2a24e7e633799",
  "verify_qf_mvp_30_1b.sql is NOT edited by this phase");
record("04 migration version is monotonic and collision-free", (() => {
  const files = readdirSync(path.join(ROOT, "supabase/migrations")).filter((x) => x.endsWith(".sql")).sort();
  const mine = "20260723001200_qf_mvp_vendor_segment_foundation.sql";
  return files[files.length - 1] === mine
    && files.filter((x) => x.startsWith("20260723001200")).length === 1;
})(), "20260723001200 is the highest and appears once");

/* ===========================================================================
 * 2. Migration — zero findings + one-defect fixtures
 * ========================================================================= */
const migrationSrc = read(MIGRATION);
const migFindings = evaluateMigration(migrationSrc);
record("05 migration has zero findings", migFindings.length === 0,
  migFindings.map((x) => `${x.rule}: ${x.detail}`).join(" | ") || "one table, RLS default-deny, no DELETE, no Core copy, no 006 dependency");

const MIG_FIX = [
  { id: "A", rule: "M02_no_membership_or_campaign", why: "a membership table is added",
    mutate: (s) => `${s}\ncreate table public.vendor_segment_memberships (id uuid primary key);\n` },
  { id: "B", rule: "M02_no_membership_or_campaign", why: "a campaign audience table is added",
    mutate: (s) => `${s}\ncreate table public.vendor_campaign_audiences (id uuid primary key);\n` },
  { id: "C", rule: "M04_no_delete_posture", why: "service_role is granted DELETE",
    mutate: (s) => s.replace(/grant select, insert, update on table public\.vendor_segments to service_role;/,
      "grant select, insert, update, delete on table public.vendor_segments to service_role;") },
  { id: "D", rule: "M03_rls_default_deny", why: "RLS is not enabled",
    mutate: (s) => s.replace(/alter table public\.vendor_segments enable row level security;/, "-- removed") },
  { id: "E", rule: "M05_no_core_copy", why: "a Core truth column is copied onto the segment",
    mutate: (s) => s.replace(/^  description            text,$/m, "  description            text,\n  remaining_credits      integer,") },
  { id: "F", rule: "M07_lifecycle", why: "the archived/archived_at consistency check is dropped",
    mutate: (s) => s.replace(/constraint vsg_archived_consistency[^,]*,/, "") },
  { id: "G", rule: "M08_name_uniqueness", why: "the live-name unique index is removed",
    mutate: (s) => s.replace(/create unique index if not exists uq_vendor_segments_live_name[\s\S]*?;/, "") },
  { id: "H", rule: "M06_rule_storage", why: "the fingerprint column is removed",
    mutate: (s) => s.replace(/^  definition_fingerprint text        not null,$/m, "") },
  { id: "I", rule: "M10_no_006_dependency", why: "an audit_logs dependency is added",
    mutate: (s) => `${s}\ninsert into public.audit_logs (action) values ('x');\n` },
  { id: "J", rule: "M09_actor_provenance", why: "an actor FK cascades",
    mutate: (s) => s.replace(/references public\.profiles \(id\) on update restrict on delete set null/, "references public.profiles (id) on delete cascade") },
];
for (const fx of MIG_FIX) {
  const mutated = fx.mutate(migrationSrc); const changed = mutated !== migrationSrc;
  const ff = changed ? evaluateMigration(mutated) : [];
  const tripped = ff.some((x) => x.rule === fx.rule);
  record(`06 migration fixture ${fx.id} trips ${fx.rule} :: ${fx.why}`, changed && tripped,
    !changed ? "NO-OP" : tripped ? "tripped" : ff.map((x) => x.rule).join(",") || "none");
}
record("07 every enforced migration rule has a fixture", (() => {
  const covered = new Set(MIG_FIX.map((x) => x.rule));
  const declared = [...new Set([...read(SELF).matchAll(/add\("(M\d\d_[a-z0-9_]+)"/g)].map((m) => m[1]))]
    .filter((r) => !["M01_single_segment_table"].includes(r)); // structural, cannot be mutated meaningfully
  return declared.every((r) => covered.has(r));
})(), "every migration rule is exercised (M01 is a structural guard)");

/* ===========================================================================
 * 3. Contracts module
 * ========================================================================= */
const contractSrc = read(CONTRACTS);
const conFindings = evaluateContracts(contractSrc);
record("08 contracts have zero findings", conFindings.length === 0,
  conFindings.map((x) => `${x.rule}: ${x.detail}`).join(" | ") || "pure, no free text, no package expiry, no authorization input");
const CON_FIX = [
  { id: "K", rule: "C01_pure", why: "contracts import a database client",
    mutate: (s) => `import { createClient } from "@supabase/supabase-js";\n${s}` },
  { id: "L", rule: "C03_no_package_expiry", why: "a package-expiry field is registered",
    mutate: (s) => s.replace(/"core\.status": \{/, '"core.days_to_expiry": {\n    source: "core", relation: "vendors", column: "x", operators: ["eq"],\n    description: "bad",\n  },\n  "core.status": {') },
];
for (const fx of CON_FIX) {
  const mutated = fx.mutate(contractSrc); const changed = mutated !== contractSrc;
  const ff = changed ? evaluateContracts(mutated) : [];
  record(`09 contract fixture ${fx.id} trips ${fx.rule} :: ${fx.why}`,
    changed && ff.some((x) => x.rule === fx.rule),
    !changed ? "NO-OP" : ff.some((x) => x.rule === fx.rule) ? "tripped" : "none");
}

/* ===========================================================================
 * 4. Validation module is pure and server-safe
 * ========================================================================= */
const validationSrc = read(VALIDATION);
record("10 validation module is pure (no server-only, no DB client)",
  !/import\s+["']server-only["']/.test(validationSrc) && !/adminClient|@supabase\/supabase-js/.test(validationSrc),
  "safely importable by tests and by later client vocabulary use");
record("11 no raw PostgREST filter grammar is constructed anywhere",
  !/\.or\(|ilike\.|\.filter\(/.test(validationSrc) && !/\.or\(|ilike\./.test(contractSrc),
  "the rule engine builds no filter string");

/* ===========================================================================
 * 5. No runtime/UI implementation has leaked into this phase
 * ========================================================================= */
/* QF-MVP-30.3C RE-BASE.
 * These three slots previously asserted that NO segment runtime existed. That was
 * correct for 30.3A alone and became false the moment 30.3C legitimately shipped
 * routes, a service and UI — the same phase-scoped "not yet" trap as the old 30.2
 * migration ceiling. They are re-based onto the invariant that still matters: the
 * FOUNDATION layer stays pure and the runtime, wherever it exists, stays admin-only.
 * The 30.3C runtime itself is graded by validate-qf-mvp-30-3c.mjs. */
record("12 segment runtime, if present, is admin-only", (() => {
  const publicRoute = existsSync(path.join(ROOT, "app/segments"))
    || existsSync(path.join(ROOT, "app/vendor/segments"))
    || existsSync(path.join(ROOT, "app/admin/../segments"));
  return !publicRoute;
})(), "no public or vendor-self segment route may exist in any phase");
record("13 foundation modules stay free of runtime/DB code", (() => {
  const c = read(CONTRACTS), v = read(VALIDATION);
  const dirty = (s) => /import\s+["']server-only["']|@supabase\/supabase-js|adminClient|next\/headers|next\/cache|vendorSegmentService/.test(s);
  return !dirty(c) && !dirty(v);
})(), "contracts + validation remain pure and independently testable");
record("14 the 30.3A contract survives the 30.3C runtime landing", (() => {
  // regression: shipping runtime must not alter the locked migration this phase
  // owns. Pinned to the SHA-256 recorded in the accepted QF-MVP-30.3A report.
  const migrationLocked =
    sha256(read(MIGRATION)) === "e5f05be8d1ae856056158772f9cc492643d550af85751ac987451e4ca6729f77";
  const foundationStillPure = !/import\s+["']server-only["']/.test(read(VALIDATION));
  return migrationLocked && foundationStillPure;
})(), "migration byte-identical to the accepted 30.3A hash; foundation still pure");

/* ===========================================================================
 * 6. BEHAVIOURAL — the real rule engine, executed
 * ========================================================================= */
const rules = await import("../../../lib/crm/segmentRuleValidation.ts");
const contracts = await import("../../../lib/crm/segmentRuleContracts.ts");
const { normalizeSegmentDefinition, validateSegmentDefinition, fingerprintSegmentDefinition,
  canonicalizeSegmentDefinition, validateSegmentMeta, normalizeSegmentNameKey, resolveWindowBoundary } = rules;

const def = (groups, combinator = "AND") => ({ schema_version: 1, combinator, groups });
const grp = (predicates, combinator = "AND") => ({ combinator, predicates });
const ok = (fn) => { try { return { ok: true, value: fn() }; } catch (e) { return { ok: false, err: e }; } };
const rejects = (input, label) => {
  const r = ok(() => validateSegmentDefinition(input));
  record(`15 rejects :: ${label}`, !r.ok && r.err?.name === "SegmentValidationError",
    r.ok ? "ACCEPTED (should have been rejected)" : `${r.err.message}`.slice(0, 90));
};
const accepts = (input, label) => {
  const r = ok(() => normalizeSegmentDefinition(input));
  record(`16 accepts :: ${label}`, r.ok, r.ok ? `fp ${r.value.fingerprint.slice(0, 12)}…` : `${r.err?.message}`.slice(0, 90));
  return r.ok ? r.value : null;
};

// -- valid Core predicates (preflight allow-list) -----------------------------
accepts(def([grp([{ field: "core.status", op: "in", value: ["Approved"] }])]), "core.status in [Approved]");
accepts(def([grp([{ field: "core.is_active", op: "is_true" }])]), "core.is_active is_true");
accepts(def([grp([{ field: "core.city", op: "eq", value: "Pune" }])]), "core.city eq Pune");
accepts(def([grp([{ field: "core.service_categories", op: "array_contains_any", value: ["Modular Kitchen"] }])]), "core.service_categories contains_any");
accepts(def([grp([{ field: "core.areas_covered", op: "array_contains_all", value: ["Kharadi"] }])]), "core.areas_covered contains_all");
accepts(def([grp([{ field: "core.covers_full_city", op: "is_false" }])]), "core.covers_full_city is_false");
accepts(def([grp([{ field: "core.remaining_credits", op: "lt", value: 5 }])]), "core.remaining_credits lt 5");
accepts(def([grp([{ field: "core.total_credits", op: "between", value: [0, 100] }])]), "core.total_credits between");
accepts(def([grp([{ field: "core.last_assigned_at", op: "older_than_days", value: 30 }])]), "core.last_assigned_at older_than_days 30");
accepts(def([grp([{ field: "core.last_assigned_at", op: "is_null" }])]), "core.last_assigned_at is_null");
accepts(def([grp([{ field: "core.created_at", op: "within_last_days", value: 90 }])]), "core.created_at within_last_days 90");

// -- valid CRM predicates -----------------------------------------------------
accepts(def([grp([{ field: "crm.onboarding_stage", op: "eq", value: "active" }])]), "crm.onboarding_stage eq active");
accepts(def([grp([{ field: "crm.relationship_status", op: "not_in", value: ["blacklisted"] }])]), "crm.relationship_status not_in");
accepts(def([grp([{ field: "crm.residential_commercial_scope", op: "eq", value: "both" }])]), "crm.residential_commercial_scope eq both");
accepts(def([grp([{ field: "crm.travel_radius_km", op: "gte", value: 10 }])]), "crm.travel_radius_km gte 10");
accepts(def([grp([{ field: "crm.years_in_business", op: "between", value: [2, 20] }])]), "crm.years_in_business between");
accepts(def([grp([{ field: "crm.next_follow_up_at", op: "is_not_null" }])]), "crm.next_follow_up_at is_not_null");
accepts(def([grp([{ field: "crm.last_interaction_at", op: "older_than_days", value: 30 }])]), "crm.last_interaction_at older_than_days");
accepts(def([grp([{ field: "crm.tag_id", op: "eq", value: "11111111-1111-4111-8111-111111111111" }])]), "crm.tag_id eq <uuid>");
accepts(def([grp([{ field: "crm.tag_id", op: "in", value: ["11111111-1111-4111-8111-111111111111"] }])]), "crm.tag_id in [<uuid>]");
accepts(def([grp([{ field: "crm.has_open_task", op: "is_true" }])]), "crm.has_open_task is_true");
accepts(def([grp([{ field: "crm.has_overdue_task", op: "is_true" }])]), "crm.has_overdue_task is_true");
accepts(def([grp([{ field: "crm.has_active_primary_contact", op: "is_false" }])]), "crm.has_active_primary_contact is_false");

// -- fingerprint determinism --------------------------------------------------
const baseA = normalizeSegmentDefinition(def([grp([
  { field: "core.status", op: "in", value: ["Approved", "Pending"] },
  { field: "crm.onboarding_stage", op: "eq", value: "active" },
])]));
const baseB = normalizeSegmentDefinition(def([grp([
  // same rule, predicates reversed and array values reordered + duplicated
  { field: "crm.onboarding_stage", op: "eq", value: "active" },
  { field: "core.status", op: "in", value: ["Pending", "Approved", "Approved"] },
])]));
record("17 canonical equivalence => identical fingerprint", baseA.fingerprint === baseB.fingerprint,
  `${baseA.fingerprint.slice(0, 12)}… == ${baseB.fingerprint.slice(0, 12)}…`);
record("18 predicate ordering does not affect the fingerprint", baseA.canonical === baseB.canonical, "canonical forms identical");
record("19 input key ordering does not affect the fingerprint", (() => {
  const reordered = { groups: [{ predicates: [{ op: "eq", field: "crm.onboarding_stage", value: "active" },
    { value: ["Approved", "Pending"], op: "in", field: "core.status" }], combinator: "AND" }],
    combinator: "AND", schema_version: 1 };
  return normalizeSegmentDefinition(reordered).fingerprint === baseA.fingerprint;
})(), "object key order is irrelevant");
const changed = normalizeSegmentDefinition(def([grp([
  { field: "core.status", op: "in", value: ["Approved"] },
  { field: "crm.onboarding_stage", op: "eq", value: "active" },
])]));
record("20 a semantic change produces a DIFFERENT fingerprint", changed.fingerprint !== baseA.fingerprint,
  "dropping a value changes the fingerprint");
record("21 operator change produces a DIFFERENT fingerprint",
  normalizeSegmentDefinition(def([grp([{ field: "core.remaining_credits", op: "lt", value: 5 }])])).fingerprint
  !== normalizeSegmentDefinition(def([grp([{ field: "core.remaining_credits", op: "lte", value: 5 }])])).fingerprint,
  "lt != lte");
record("22 combinator change produces a DIFFERENT fingerprint",
  normalizeSegmentDefinition(def([grp([{ field: "core.is_active", op: "is_true" }])], "AND")).fingerprint
  !== normalizeSegmentDefinition(def([grp([{ field: "core.is_active", op: "is_true" }])], "OR")).fingerprint,
  "AND != OR");
record("23 fingerprint is sha256 hex of the canonical JSON", (() => {
  const expect = createHash("sha256").update(baseA.canonical, "utf8").digest("hex");
  return baseA.fingerprint === expect && /^[0-9a-f]{64}$/.test(baseA.fingerprint)
    && fingerprintSegmentDefinition(baseA.definition) === expect;
})(), "matches the DB vsg_fingerprint_shape check");
record("24 canonical JSON has fixed key order", (() => {
  const c = canonicalizeSegmentDefinition(baseA.definition);
  return c.startsWith('{"schema_version":1,"combinator":') && /"groups":\[\{"combinator":/.test(c)
    && /"predicates":\[\{"field":/.test(c);
})(), "schema_version, combinator, groups / combinator, predicates / field, op, value");
record("25 normalization is idempotent",
  normalizeSegmentDefinition(baseA.definition).fingerprint === baseA.fingerprint, "re-normalizing is stable");
record("26 exact duplicate predicates collapse (no fingerprint drift)", (() => {
  const dup = normalizeSegmentDefinition(def([grp([
    { field: "core.is_active", op: "is_true" }, { field: "core.is_active", op: "is_true" }])]));
  const one = normalizeSegmentDefinition(def([grp([{ field: "core.is_active", op: "is_true" }])]));
  return dup.fingerprint === one.fingerprint && dup.predicateCount === 1;
})(), "a repeated predicate is a no-op");

// -- rejections ---------------------------------------------------------------
rejects(def([grp([{ field: "core.status", op: "eq", value: "Approved" }])], "XOR"), "unknown top-level combinator");
rejects(def([grp([{ field: "core.status", op: "eq", value: "Approved" }], "XOR")]), "unknown group combinator");
rejects({ ...def([grp([{ field: "core.is_active", op: "is_true" }])]), schema_version: 2 }, "wrong schema_version");
rejects({ combinator: "AND", groups: [grp([{ field: "core.is_active", op: "is_true" }])] }, "missing schema_version");
rejects(def([grp([{ field: "core.not_a_field", op: "eq", value: "x" }])]), "unknown field");
rejects(def([grp([{ field: "core.status", op: "not_an_operator", value: "x" }])]), "unknown operator");
rejects(def([grp([{ field: "core.status", op: "lt", value: 3 }])]), "operator not allowed on field");
rejects(def([grp([{ field: "core.status", op: "eq", value: "NotAStatus" }])]), "value outside the closed vocabulary");
rejects(def([grp([{ field: "core.remaining_credits", op: "eq", value: "five" }])]), "wrong value type (string for integer)");
rejects(def([grp([{ field: "core.remaining_credits", op: "eq", value: 1.5 }])]), "non-integer numeric");
rejects(def([grp([{ field: "core.total_credits", op: "between", value: [10, 1] }])]), "between with lo > hi");
rejects(def([grp([{ field: "core.total_credits", op: "between", value: [1] }])]), "between with one element");
rejects(def([grp([{ field: "crm.tag_id", op: "eq", value: "not-a-uuid" }])]), "non-uuid for a uuid field");
rejects(def([grp([{ field: "core.is_active", op: "is_true", value: true }])]), "value supplied to a no-value operator");
rejects(def([grp([{ field: "core.created_at", op: "within_last_days", value: 0 }])]), "day window below the bound");
rejects(def([grp([{ field: "core.created_at", op: "within_last_days", value: 99999 }])]), "day window above the bound");
rejects(def([grp([])]), "empty predicate list");
rejects(def([]), "empty group list");
rejects(def(Array.from({ length: contracts.SEGMENT_MAX_GROUPS + 1 }, () => grp([{ field: "core.is_active", op: "is_true" }]))), "too many groups");
rejects(def([grp(Array.from({ length: contracts.SEGMENT_MAX_PREDICATES_PER_GROUP + 1 },
  (_, i) => ({ field: "core.remaining_credits", op: "eq", value: i })))]), "too many predicates in a group");
rejects(def([grp([{ field: "core.service_categories", op: "array_contains_any",
  value: Array.from({ length: contracts.SEGMENT_MAX_ARRAY_VALUES + 1 }, (_, i) => `c${i}`) }])]), "array value list too long");
rejects(def([grp([{ field: "core.service_categories", op: "array_contains_any", value: [] }])]), "empty array value");
rejects(def([grp([{ field: "core.is_active", op: "is_true", extra: 1 }])]), "unknown key on a predicate");
rejects({ ...def([grp([{ field: "core.is_active", op: "is_true" }])]), extra: 1 }, "unknown key on the definition");
rejects("not an object", "non-object definition");

// -- owner-decision rejections ------------------------------------------------
for (const [field, label] of [
  ["core.days_to_expiry", "package expiry (days_to_expiry)"],
  ["core.package_expires_at", "package expiry (expires_at)"],
  ["core.active_package", "invented 'active package'"],
  ["core.package_order_status", "package-order status"],
]) rejects(def([grp([{ field, op: "eq", value: 1 }])]), `owner decision 4 — ${label}`);
for (const [field, label] of [
  ["core.consent_status", "consent"],
  ["core.is_suppressed", "suppression"],
  ["core.communication_authorization", "communication authorization"],
  ["core.campaign_eligibility", "campaign eligibility"],
  ["core.lead_id", "lead content"],
  ["core.assignment_id", "assignment content"],
  ["crm.contact_phone", "contact PII"],
  ["crm.note_body", "note body"],
  ["crm.ai_score", "AI score"],
]) rejects(def([grp([{ field, op: "eq", value: "x" }])]), `boundary — ${label}`);

// -- free text / raw grammar cannot enter -------------------------------------
record("27 no free-text operator is registered (owner decision 5)",
  !contracts.SEGMENT_OPERATOR_KEYS.some((o) => /like|search|match|contains_text|regex/i.test(o)),
  contracts.SEGMENT_OPERATOR_KEYS.join(","));
for (const payload of ['Approved,is_active.eq.true', 'Approved") or ("1"="1', "Approved%", "Approved*"]) {
  rejects(def([grp([{ field: "core.status", op: "eq", value: payload }])]), `raw grammar payload ${JSON.stringify(payload).slice(0, 34)}`);
}
record("28 an accepted rule's canonical JSON contains no filter grammar", (() => {
  const c = baseA.canonical;
  return !/ilike|\.eq\.|\.or\(|%|\*/.test(c);
})(), "canonical form carries only registry keys and enum values");

// -- meta + name uniqueness ---------------------------------------------------
record("29 segment meta validates and normalizes", (() => {
  const m = validateSegmentMeta({ name: "  Pune   Verified  ", description: "x", status: "active" });
  return m.name === "Pune Verified" && m.status === "active" && m.description === "x";
})(), "name whitespace collapsed");
record("30 meta rejects unknown keys and bad status", (() => {
  const a = ok(() => validateSegmentMeta({ name: "x", created_by: "spoofed" }));
  const b = ok(() => validateSegmentMeta({ name: "x", status: "deleted" }));
  const c = ok(() => validateSegmentMeta({ name: "   " }));
  return !a.ok && !b.ok && !c.ok;
})(), "actor cannot be mass-assigned; status is closed; empty name refused");
record("31 live-name key mirrors uq_vendor_segments_live_name", (() => {
  return normalizeSegmentNameKey("  Pune   Verified ") === normalizeSegmentNameKey("pune verified")
    && normalizeSegmentNameKey("PUNE VERIFIED") === "pune verified";
})(), "lower(btrim(name)) with collapsed whitespace");
record("32 duplicate definition is detectable by fingerprint", (() => {
  const one = normalizeSegmentDefinition(def([grp([{ field: "core.is_active", op: "is_true" }])]));
  const two = normalizeSegmentDefinition(def([grp([{ field: "core.is_active", op: "is_true" }])]));
  return one.fingerprint === two.fingerprint;
})(), "two names, same population => same fingerprint (surfaced, not blocked)");

// -- date/time semantics ------------------------------------------------------
record("33 window boundary resolves against a single evaluatedAt", (() => {
  const at = new Date("2026-07-25T00:00:00.000Z");
  return resolveWindowBoundary(at, 30) === "2026-06-25T00:00:00.000Z";
})(), "deterministic, no per-predicate now()");
record("34 window boundary is stable and bounded", (() => {
  const at = new Date("2026-07-25T00:00:00.000Z");
  const a = resolveWindowBoundary(at, 1), b = resolveWindowBoundary(at, 1);
  const badLow = ok(() => resolveWindowBoundary(at, 0));
  const badDate = ok(() => resolveWindowBoundary(new Date("nope"), 5));
  return a === b && !badLow.ok && !badDate.ok;
})(), "same input => same instant; bounds + invalid date refused");
record("35 timezone is locked to Asia/Kolkata", contracts.SEGMENT_TIMEZONE === "Asia/Kolkata", contracts.SEGMENT_TIMEZONE);
record("36 null/missing semantics are documented and only is_null matches NULL", (() => {
  const hasDoc = /predicate over a NULL value evaluates FALSE/i.test(validationSrc);
  const nullOps = contracts.SEGMENT_FIELDS["core.last_assigned_at"].operators;
  return hasDoc && nullOps.includes("is_null") && nullOps.includes("is_not_null");
})(), "unknown excludes; is_null is the only NULL match");

/* ===========================================================================
 * 7. Staging verifier contract (not executed here)
 * ========================================================================= */
const verifierSrc = read(VERIFIER_30_3);
record("37 new 30.3 verifier is SELECT-only", (() => {
  // Strip comments AND single-quoted literals first: the verifier legitimately
  // passes 'DELETE'/'TRUNCATE'/'INSERT' as privilege NAMES to has_table_privilege,
  // and names them in its details text. Only executable keywords may be judged.
  const exec = verifierSrc.replace(/--[^\n]*/g, " ").replace(/'(?:[^']|'')*'/g, "''");
  return !/\b(insert|update|delete|truncate|create|alter|drop|grant|revoke|call|merge|do)\b/i.test(exec)
    && /^\s*select\b/im.test(exec);
})(), "no mutating statement outside string literals; begins with SELECT");
record("38 new 30.3 verifier covers the locked posture", (() => {
  const need = ["vendor_segments", "supabase_migrations", "20260723001200", "has_table_privilege",
    "relrowsecurity", "vendor_campaign", "vendor_segment_membership", "vendor_public_v"];
  return need.every((n) => verifierSrc.includes(n));
})(), "migration once, objects, RLS, grants, no membership/campaign, projection");
record("39 new 30.3 verifier does not assume audit_logs/admin_notifications", (() => {
  const exec = verifierSrc.replace(/--[^\n]*/g, "");
  return !/\baudit_logs\b|\badmin_notifications\b/.test(exec)
    || /to_regclass\('public\.audit_logs'\)/.test(exec);
})(), "006-divergence safe");
record("40 the historical 30.1B verifier is untouched by this phase",
  read(VERIFIER_30_1B).includes("W18_no_segment_or_campaign_tables"),
  "its pre-segments assertion is preserved as historical evidence");

/* ===========================================================================
 * 8. Docs
 * ========================================================================= */
const bp = read("docs/QF-MVP-30-VENDOR-CRM-BLUEPRINT.md").toLowerCase();
const board = read("docs/QF-MVP-EXECUTION-BOARD.md").toLowerCase();
record("41 blueprint records the 30.3 segment contract", (() => {
  return bp.includes("30.3") && bp.includes("vendor_segments") && bp.includes("fingerprint")
    && bp.includes("no membership") && bp.includes("20260723001200");
})(), "contract, fingerprint, no-membership, migration filename");
record("42 blueprint records the owner decisions", (() => {
  return bp.includes("package-expiry") && bp.includes("free-text") && bp.includes("verify_qf_mvp_30_1b");
})(), "package expiry, free text, historical verifier");
record("43 board records 30.3A generated-not-applied", (() => {
  return board.includes("30.3a") && board.includes("20260723001200")
    && (board.includes("not applied") || board.includes("generated"));
})(), "execution board updated");

/* ===========================================================================
 * Report
 * ========================================================================= */
const passed = results.filter((r) => r.ok).length;
console.log("== QF-MVP-30.3A deterministic vendor segment foundation validator ==");
for (const r of results) { console.log(`   ${r.ok ? "ok  " : "FAIL"}  ${r.name}`); if (!r.ok) console.log(`         ${r.detail}`); }
console.log("");
console.log(`checks: ${passed} passed, ${results.length - passed} failed (of ${results.length})`);
console.log(`fixtures: ${MIG_FIX.length} migration + ${CON_FIX.length} contract one-defect mutations`);
console.log(`RESULT: ${failed ? "FAIL" : "PASS"}`);
process.exit(failed ? 1 : 0);
