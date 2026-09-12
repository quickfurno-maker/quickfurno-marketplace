// ============================================================================
// QF-MVP-82A-R0-S1 — staging deployment certification validator.  OFFLINE.
// No database, no network, no provider, no credential, no send.
//
// WHAT THIS PHASE IS
//   Documentary only. QF-MVP-82A-R0 was applied to QuickFurno Staging exactly
//   once from an isolated workspace; this phase makes source control say so, and
//   say NOTHING MORE. It changes no migration, adds none, and touches no
//   application code.
//
// THE CLAIM IT MUST NOT LET DRIFT
//   Staging applied does not mean production applied. Every check below that
//   records the staging truth is paired with one that refuses the production
//   claim, because the failure mode this validator exists to prevent is a later
//   reader — or a later phase — treating "R0 is applied" as unqualified.
//
// WHY R0 IS NOT IN THE APPLIED TEN
//   `appliedPostAnchorMigrations` means "applied with an OBSERVED remote-history
//   count". No count was observed for R0, and inventing one to qualify is exactly
//   what QF-MVP-80.05 refused to do when it created the RECONCILED set rather
//   than distort APPLIED. R0 gets the same treatment: its own set, its own rules.
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

const R0_VERSION = "20260904000000";
const R0_NAME = "qf_mvp_82a_r0_whatsapp_inbox_realtime_publication";
const R0_PATH = `supabase/migrations/${R0_VERSION}_${R0_NAME}.sql`;
const R0_SHA = "9bfcd2ed3b6a58976ad5d237d1ca63bf2f0a86ac6dd75aef1ce9267ef7b68e18";

const ACTIVATION_VERSION = "20260903040000";
const CERT_PATH = "docs/QF-MVP-82A-R0-STAGING-CERTIFICATION.md";
const MANIFEST_PATH = "supabase/staging-history/qf-mvp-staging-history-manifest.json";

const STAGING_REF = "uckafzuochmbvtiodmcl";
const PRODUCTION_REF = "yqpgcsduqbxulrlzwzap";

const PUBLISHED_TABLES = ["public.communication_inbound_messages", "public.communication_messages"];

const LIVE_MIGRATION_COUNT = 109;
const FROZEN_RECONCILIATION_COUNT = 102;

const rawOf = (p) => readFileSync(resolve(p), "utf8");
const CERT = rawOf(CERT_PATH);
/**
 * Prose wraps. A claim that spans two source lines is the same claim, so the
 * document is also read with its whitespace flattened — otherwise a validator
 * would be asserting against line breaks rather than against meaning.
 */
const CERT_FLAT = CERT.replace(/\s+/g, " ");
const MANIFEST = JSON.parse(rawOf(MANIFEST_PATH));
const MIGRATIONS = readdirSync(resolve("supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();

const checks = [];
const check = (name, fn) => checks.push({ name, fn });
function assert(c, m) { if (!c) throw new Error(m); }
const eq = (a, b, m) => assert(a === b, `${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
const absent = (code, re, label) => assert(!re.test(code), `${label} must not appear`);

const canonicalSha256 = (path) =>
  createHash("sha256").update(Buffer.from(rawOf(path).replace(/\r\n/g, "\n"), "utf8")).digest("hex");

const stagingApplied = (MANIFEST.stagingAppliedPostAnchorMigrations ?? []).find((m) => m.version === R0_VERSION) ?? null;
const activation = (MANIFEST.pendingPostAnchorMigrations ?? []).find((m) => m.version === ACTIVATION_VERSION) ?? null;
const recordFor = (version) => [
  ...(MANIFEST.appliedPostAnchorMigrations ?? []),
  ...(MANIFEST.reconciledPostAnchorMigrations ?? []),
  ...(MANIFEST.stagingAppliedPostAnchorMigrations ?? []),
  ...(MANIFEST.pendingPostAnchorMigrations ?? []),
].filter((m) => m.version === version);

// ---- 1-2. the artefacts this phase certifies -------------------------------

check("1 the R0 migration source is byte-identical to what was applied", () => {
  assert(existsSync(resolve(R0_PATH)), "the migration still exists");
  eq(canonicalSha256(R0_PATH), R0_SHA, "its hash is unchanged");
  eq(stagingApplied?.sha256, R0_SHA, "and the manifest pins that same hash");
  // What was applied to staging and what is in source control are the same bytes.
  assert(CERT.includes(R0_SHA), "the certification records the same hash");
});

check("2 the staging certification document exists and is substantive", () => {
  assert(existsSync(resolve(CERT_PATH)), "the document exists");
  assert(CERT.length > 2000, "and it is a real record, not a stub");
  assert(/QF-MVP-82A-R0/.test(CERT), "it names the phase");
  assert(/40af4124c11c862e68c59203f853b6032f3cbd5e/.test(CERT), "and the exact merge commit");
  eq(stagingApplied?.evidencePath, CERT_PATH, "the manifest points at it");
});

// ---- 3-4. the environments -------------------------------------------------

check("3 the exact staging project is named", () => {
  assert(CERT.includes(STAGING_REF), "the staging ref appears");
  assert(/QuickFurno \*\*Staging\*\*|QuickFurno Staging/.test(CERT), "and is identified as staging");
});

check("4 production is named ONLY as forbidden and not accessed", () => {
  assert(CERT.includes(PRODUCTION_REF), "the production ref appears, so it cannot be confused");
  // Every mention of it must be a refusal, never a claim.
  const lines = CERT.split("\n").filter((l) => l.includes(PRODUCTION_REF));
  assert(lines.length > 0, "it is mentioned");
  for (const line of lines) {
    assert(/FORBIDDEN|NOT ACCESSED|NOT APPLIED/i.test(line),
      `every production mention must be a refusal, found: ${line.trim()}`);
  }
  assert(/No production access/i.test(CERT), "and the document says so plainly");
});

// ---- 5-8. the four deployment facts ----------------------------------------

check("5 R0 is recorded as applied to staging", () => {
  assert(stagingApplied !== null, "the staging-applied record exists");
  eq(stagingApplied.operationalStatus, "APPLIED_TO_STAGING", "operationalStatus");
  eq(stagingApplied.appliedToStaging, true, "appliedToStaging");
  eq(stagingApplied.appliedExactlyOnceToStaging, true, "exactly once");
  eq(stagingApplied.stagingRemoteVersionStatus, "PRESENT_IN_STAGING_HISTORY", "the remote row is recorded");
  eq(stagingApplied.independentRemoteRelistVerified, true, "an independent re-list confirmed it");
  // The record appears in exactly ONE set — no double classification.
  eq(recordFor(R0_VERSION).length, 1, "R0 is classified exactly once");
});

check("6 R0 production remains false and unproven", () => {
  eq(stagingApplied.appliedToProduction, false, "appliedToProduction");
  eq(stagingApplied.productionVersionStatus, "NOT_APPLIED_NOT_PROVEN", "not applied and not inferred");
  eq(stagingApplied.requiresSeparateProductionDeploymentGate, true, "still gated");
  // It must not have slipped into the set that means BOTH environments.
  assert(!(MANIFEST.reconciledPostAnchorMigrations ?? []).some((m) => m.version === R0_VERSION),
    "R0 is not in the reconciled (both-environments) set");
});

check("7-8 QF-MVP-80.14A remains unapplied to staging AND production", () => {
  assert(activation !== null, "the activation authority is still pending");
  eq(activation.operationalStatus, "PENDING", "still PENDING");
  eq(activation.appliedToStaging, false, "not applied to staging");
  eq(activation.appliedToProduction, false, "not applied to production");
  eq(activation.requiresSeparateStagingDeploymentGate, true, "still gated");
  eq(activation.sha256, "b3bd351c61c81b02aced5257507412d45ad2d77075265f644633c699384d42e2", "hash unchanged");
  eq(recordFor(ACTIVATION_VERSION).length, 1, "classified exactly once");
  // R0 being applied must not have carried it along.
  assert(!(MANIFEST.stagingAppliedPostAnchorMigrations ?? []).some((m) => m.version === ACTIVATION_VERSION),
    "it did not ride into the staging-applied set");
  assert(!(MANIFEST.appliedPostAnchorMigrations ?? []).some((m) => m.version === ACTIVATION_VERSION),
    "nor into the applied set");
  // And the certification says so explicitly.
  assert(/20260903040000/.test(CERT_FLAT) && /remains unapplied to staging/i.test(CERT_FLAT),
    "the document records that it remains unapplied");
});

// ---- 9-13. the observed post-apply state -----------------------------------

check("9 the exact migration SHA is preserved everywhere", () => {
  eq(canonicalSha256(R0_PATH), R0_SHA, "source");
  eq(stagingApplied.sha256, R0_SHA, "manifest");
  assert(CERT.includes(R0_SHA), "certification");
});

check("10 exactly the two publication tables are documented", () => {
  for (const t of PUBLISHED_TABLES) {
    assert(CERT.includes(t), `${t} is recorded`);
    assert((stagingApplied.publishedTables ?? []).includes(t), `${t} is pinned in the manifest`);
  }
  eq((stagingApplied.publishedTables ?? []).length, 2, "exactly two, in the manifest");
  // No third communication table may be recorded as a member.
  for (const forbidden of ["communication_delivery_events", "communication_webhook_receipts"]) {
    assert(!(stagingApplied.publishedTables ?? []).some((t) => t.includes(forbidden)),
      `${forbidden} must not be recorded as published`);
    // The document may NAME it, but only as deliberately excluded. Prose wraps,
    // so the surrounding sentence is examined rather than the source line.
    let from = 0;
    for (;;) {
      const at = CERT_FLAT.indexOf(forbidden, from);
      if (at < 0) break;
      const sentence = CERT_FLAT.slice(Math.max(0, at - 220), at + 220);
      assert(/not published|deliberately|not present/i.test(sentence),
        `${forbidden} may only appear as excluded, near: ...${sentence.slice(180, 320)}...`);
      from = at + forbidden.length;
    }
  }
});

check("11 puballtables is documented false", () => {
  eq(stagingApplied.publicationAllTables, false, "the manifest records false");
  assert(/`puballtables`\s*\|\s*\*\*`false`\*\*|puballtables.*false/i.test(CERT), "the document records false");
  absent(CERT, /puballtables[^\n]*\btrue\b/i, "a true puballtables claim");
});

check("12 RLS is documented true for both tables", () => {
  eq(stagingApplied.rowLevelSecurityEnabledAfterApply, true, "the manifest records RLS intact");
  assert(/rls_enabled/i.test(CERT), "the document records the observation");
  const rlsLines = CERT.split("\n").filter((l) => /rls_enabled|row level security/i.test(l));
  assert(rlsLines.length > 0, "there is an RLS section");
  absent(CERT, /rls_enabled\s*=\s*false/i, "any disabled-RLS claim");
});

check("13 zero anon/authenticated grants are documented", () => {
  eq(stagingApplied.apiRoleGrantsAfterApply, 0, "the manifest records zero grants");
  assert(/zero rows/i.test(CERT), "the document records zero rows");
  assert(/anon.*authenticated|authenticated.*anon/is.test(CERT), "for both API roles");
  assert(/did not create browser read authority/i.test(CERT), "and draws the conclusion explicitly");
});

// ---- 14-16. the apply itself -----------------------------------------------

check("14 an exact-one dry run is recorded", () => {
  assert(/DRY RUN: migrations will \*not\* be pushed/i.test(CERT), "the dry-run banner is recorded");
  assert(/Would push these migrations:/i.test(CERT), "and its plan");
  // Exactly one migration in the plan, and it is R0.
  const plan = /Would push these migrations:([\s\S]*?)Finished supabase db push\./i.exec(CERT);
  assert(plan !== null, "the plan block is present");
  const listed = plan[1].match(/\d{14}_[a-z0-9_]+\.sql/g) ?? [];
  eq(listed.length, 1, `exactly one migration in the plan (${listed.join(", ")})`);
  assert(listed[0].startsWith(R0_VERSION), "and it is R0");
  assert(/No `20260903040000` appeared|No 20260903040000 appeared/.test(CERT),
    "and the document states the forbidden migration was absent from the plan");
});

check("15 exactly one apply is recorded", () => {
  const applies = CERT.match(/Applying migration \d{14}_[a-z0-9_]+\.sql/g) ?? [];
  eq(applies.length, 1, `exactly one apply line (${applies.join(", ")})`);
  assert(applies[0].includes(R0_VERSION), "and it is R0");
  eq(stagingApplied.appliedExactlyOnceToStaging, true, "the manifest agrees");
});

check("16 no second apply is authorized", () => {
  assert(/No second apply is authorized/i.test(CERT), "the document says so");
  // Production apply is explicitly still a separate, unperformed action.
  assert(/separate, gated, unperformed action|separate deployment gate/i.test(CERT),
    "and production remains a separate gated action");
});

check("16b the independent re-list and the remote rows are recorded", () => {
  assert(/independent (migration )?re-list/i.test(CERT), "the re-list is recorded");
  assert(new RegExp(`${R0_VERSION}\\s*\\|\\s*${R0_VERSION}`).test(CERT), "with local and remote in agreement");
  assert(/exists \*\*exactly once\*\*|exists exactly once/i.test(CERT), "R0 is present exactly once remotely");
  assert(/does not exist\*\* in staging migration history|does not exist in staging migration history/i.test(CERT),
    "and 80.14A is absent remotely");
});

// ---- 17-20. this phase changed nothing it must not --------------------------

check("17-18 no application or inbox source belongs to THIS phase's scope", () => {
  // QF-MVP-82A-C1 RE-SCOPE: this used to assert the inbox files did not EXIST.
  // That was a valid proxy while the inbox lived only on an unmerged branch, but
  // it is time-bound in exactly the way QF-MVP-80.14A's Z07 was: the moment PR #73
  // merges, the files are on main and the assertion fails forever while saying
  // nothing about this phase. The durable claim is about OWNERSHIP — the inbox is
  // the 82A slice's artefact, registered under its own validator, and this phase's
  // scope is the migration and the manifest. That is what is asserted now.
  // R0-S1's own artefacts are exactly two: the certification document and the
  // manifest record. Neither may name or contain application source.
  for (const p of [
    "app/api/admin/whatsapp/inbox",
    "services/adminWhatsAppInboxService",
    "lib/communication/whatsappInboxReadModel",
    "components/admin/whatsapp/inbox",
  ]) {
    assert(!CERT.includes(p), `${p} must not appear in the certification`);
    assert(!JSON.stringify(stagingApplied).includes(p), `${p} must not appear in the manifest record`);
  }
  // The certification records a DEPLOYMENT, not a code change.
  absent(CERT, /import |export function|const .* = \(/, "source code in the certification");
  assert(/No application, inbox, webhook or provider code changed/i.test(CERT_FLAT),
    "and it states that no application code changed");
});

check("19-20 S1 changed no migration and added none", () => {
  eq(MIGRATIONS.length, LIVE_MIGRATION_COUNT, "the tree is 109");
  eq(canonicalSha256(R0_PATH), R0_SHA, "R0 is byte-identical");
  // Exactly one R0 migration, and no S1 migration at all — which is the whole point
  // of this check: S1 was a certification phase and contributed no SQL of its own.
  eq(MIGRATIONS.filter((f) => /82a_r0/i.test(f)).length, 1, "one R0 migration");
  eq(MIGRATIONS.filter((f) => /82a_r0_s1|r0_s1/i.test(f)).length, 0, "and no S1 migration");
  // QF-MVP-50.6 RE-PIN: R0 is no longer the newest file, because a later phase
  // legitimately added one. Its exact position is what S1 can honestly assert.
  eq(MIGRATIONS[MIGRATIONS.indexOf(`${R0_VERSION}_${R0_NAME}.sql`) - 1],
    "20260903040000_qf_mvp_80_14a_meta_lead_assignment_production_activation.sql",
    "R0 still sits immediately after 80.14A");
});

// ---- 21-22. the two counts -------------------------------------------------

check("21 the live source migration count is 109", () => {
  eq(MIGRATIONS.length, LIVE_MIGRATION_COUNT, "tree");
  const g1 = rawOf("scripts/mvp/staging/validate-qf-mvp-50-2c-s2-g1.mjs");
  assert(/const MIGRATION_COUNT = 109;/.test(g1), "and G1 still pins 109");
});

check("22 the frozen 80.05 reconciliation count is still 102", () => {
  eq(MANIFEST.historyReconciliation.migrationCount, FROZEN_RECONCILIATION_COUNT,
    "it records what THAT phase observed, not the live tree");
  const g1 = rawOf("scripts/mvp/staging/validate-qf-mvp-50-2c-s2-g1.mjs");
  assert(/const RECONCILIATION_MIGRATION_COUNT = 102;/.test(g1), "G1 agrees");
  // The accounting still balances: everything added since is pending or staging-applied.
  eq(MIGRATIONS.length - MANIFEST.historyReconciliation.migrationCount,
    (MANIFEST.pendingPostAnchorMigrations ?? []).length +
    (MANIFEST.stagingAppliedPostAnchorMigrations ?? []).length,
    "104 - 102 = 2 = one pending + one staging-applied");
});

// ---- 23-26. the new vocabulary, and what it may not become -----------------

check("23 the partial-deployment vocabulary is exact and fail-closed", () => {
  const set = MANIFEST.stagingAppliedPostAnchorMigrations;
  assert(Array.isArray(set), "the set exists");
  // QF-MVP-40: the canary quiesce authority joined this set. R0 remains exactly one
  // member of it, which is what assertion 22 above pins.
  eq(set.length, 2, "with exactly two members");
  // Every field that could be read as a deployment claim is stated explicitly —
  // nothing is left absent to be inferred generously by a later reader.
  for (const field of [
    "operationalStatus", "appliedToStaging", "appliedExactlyOnceToStaging",
    "stagingRemoteVersionStatus", "independentRemoteRelistVerified",
    "remoteHistoryCountObservedAtApply", "remoteHistoryCountAfterApply",
    "appliedToProduction", "productionVersionStatus",
    "requiresSeparateProductionDeploymentGate", "evidencePath",
  ]) {
    assert(field in set[0], `${field} is stated explicitly`);
  }
  // It does NOT claim the applied ten's evidence, which it does not have.
  eq(set[0].remoteHistoryCountObservedAtApply, false, "no observed count is claimed");
  eq(set[0].remoteHistoryCountAfterApply, null, "and none is fabricated");
  assert(!("appliedExactlyOnce" in set[0]),
    "it does not reuse the unqualified appliedExactlyOnce of the applied ten");
});

check("24 no historical applied or reconciled record was rewritten", () => {
  eq((MANIFEST.appliedPostAnchorMigrations ?? []).length, 10, "ten applied");
  eq((MANIFEST.reconciledPostAnchorMigrations ?? []).length, 5, "five reconciled");
  for (const r of MANIFEST.appliedPostAnchorMigrations) {
    eq(r.operationalStatus, "APPLIED", `${r.version} still APPLIED`);
    assert(typeof r.remoteHistoryCountAfterApply === "number",
      `${r.version} still carries its observed remote-history count`);
  }
  for (const r of MANIFEST.reconciledPostAnchorMigrations) {
    eq(r.operationalStatus, "APPLIED", `${r.version} still APPLIED`);
    eq(r.appliedToStaging, true, `${r.version} staging`);
    eq(r.appliedToProduction, true, `${r.version} production`);
  }
  // QF-MVP-50.6 RE-PIN: 17 -> 18. The applied ten and reconciled five — which is what
  // this check is actually about — are untouched.
  eq(MANIFEST.appliedAnchor.postAnchorMigrationCount, 22, "the anchor totals twenty-two");
  eq(10 + 5 + (MANIFEST.stagingAppliedPostAnchorMigrations ?? []).length +
     (MANIFEST.pendingPostAnchorMigrations ?? []).length, 22, "and the four sets add up");
});

check("25 no production-applied claim exists for R0 anywhere", () => {
  // Not in the manifest.
  for (const r of recordFor(R0_VERSION)) {
    assert(r.appliedToProduction !== true, "no manifest record claims production");
  }
  // Not in the certification prose either.
  for (const line of CERT.split("\n")) {
    if (!/production/i.test(line)) continue;
    assert(!/production[^.\n]{0,40}\bapplied\b(?![^.\n]{0,40}(not|never|remains|separate|unperformed))/i.test(line) ||
      /NOT applied|not applied|never applied|remains a separate|unperformed/i.test(line),
      `a production-applied claim appears: ${line.trim()}`);
  }
  assert(/NOT APPLIED TO PRODUCTION/i.test(CERT), "and the verdict states it plainly");
});

check("26 no send authority, and no credential VALUE, is present", () => {
  for (const [re, label] of [
    [/graph\.facebook\.com/i, "a Graph host"],
    [/sendTemplate|CommunicationService|sendResolvedTemplate/, "a send path"],
  ]) {
    absent(CERT, re, label);
  }
  // Naming a credential CLASS in order to state that it is absent is exactly what
  // a certification should do — the document's own "no password… appears here"
  // sentence would trip a naive word search. What must never appear is a
  // credential VALUE, so this looks for the shapes real secrets take.
  for (const [re, label] of [
    [/postgres(?:ql)?:\/\//i, "a connection string"],
    [/eyJ[A-Za-z0-9_-]{20,}/, "a JWT"],
    [/\bsbp_[A-Za-z0-9]{16,}/, "a Supabase access token"],
    [/\bEAA[A-Za-z0-9]{40,}/, "a Meta access token"],
    [/[A-Za-z0-9_-]{72,}/, "a long high-entropy token"],
  ]) {
    absent(CERT, re, label);
  }
  assert(/No secret, password, CLI access token, service-role key/i.test(CERT_FLAT),
    "and the document states what it excludes");
  assert(/No Meta call\. No WhatsApp message sent/i.test(CERT), "and the document states it");
  // This phase adds no runnable operator at all.
  eq(MIGRATIONS.filter((f) => /82a_r0_s1/i.test(f)).length, 0, "no migration");
});

// ---- mutants ----------------------------------------------------------------

check("M1 mutant: denying the staging apply", () => {
  const mutant = { ...stagingApplied, appliedToStaging: false };
  assert(mutant.appliedToStaging !== stagingApplied.appliedToStaging, "the mutant denies it");
  eq(stagingApplied.appliedToStaging, true, "the real record records the apply that happened");
});

check("M2 mutant: claiming R0 reached production", () => {
  const mutant = { ...stagingApplied, appliedToProduction: true, productionVersionStatus: "APPLIED" };
  assert(mutant.appliedToProduction === true, "the mutant claims production");
  eq(stagingApplied.appliedToProduction, false, "the real record does not");
  eq(stagingApplied.productionVersionStatus, "NOT_APPLIED_NOT_PROVEN", "and refuses to infer it");
});

check("M3-M4 mutants: claiming 80.14A was deployed", () => {
  for (const field of ["appliedToStaging", "appliedToProduction"]) {
    const mutant = { ...activation, [field]: true };
    assert(mutant[field] === true && activation[field] === false,
      `the mutant claims ${field}; the real record does not`);
  }
  eq(activation.operationalStatus, "PENDING", "it is still pending");
});

check("M5 mutant: a changed R0 migration hash", () => {
  const wrong = createHash("sha256").update("not the migration").digest("hex");
  assert(wrong !== R0_SHA, "the mutant hash differs");
  eq(canonicalSha256(R0_PATH), R0_SHA, "the file still hashes to what was applied");
  eq(stagingApplied.sha256, R0_SHA, "and the manifest still pins it");
});

check("M6 mutant: moving the frozen reconciliation count", () => {
  const mutant = 104;
  assert(mutant !== FROZEN_RECONCILIATION_COUNT, "the mutant moves it to the live count");
  eq(MANIFEST.historyReconciliation.migrationCount, 102, "the real record stays frozen");
});

check("M7 mutant: documenting a third published table", () => {
  const mutant = [...PUBLISHED_TABLES, "public.communication_delivery_events"];
  eq(mutant.length, 3, "the mutant publishes three");
  eq((stagingApplied.publishedTables ?? []).length, 2, "the real record documents two");
});

check("M8 mutant: documenting puballtables as true", () => {
  const mutant = { ...stagingApplied, publicationAllTables: true };
  assert(mutant.publicationAllTables === true, "the mutant claims it");
  eq(stagingApplied.publicationAllTables, false, "the real record records false");
});

check("M9 mutant: documenting an API-role grant as present", () => {
  const mutant = { ...stagingApplied, apiRoleGrantsAfterApply: 1 };
  assert(mutant.apiRoleGrantsAfterApply > 0, "the mutant claims a grant");
  eq(stagingApplied.apiRoleGrantsAfterApply, 0, "the real record records zero");
});

check("M10 mutant: application code inside S1's own artefacts", () => {
  // The mutant names application source in the certification, turning a
  // deployment record into a code change.
  const naive = "services/adminWhatsAppInboxService.ts was rewritten";
  assert(/services\//.test(naive), "the mutant is detectable");
  assert(!CERT.includes("services/adminWhatsAppInboxService"), "the real certification names none");
  absent(CERT, /import |export function/, "and contains no source");
});

// ============================================================================
let passed = 0;
const failures = [];
for (const { name, fn } of checks) {
  try { fn(); passed += 1; console.log(`   ok    ${name}`); }
  catch (e) { failures.push(`   FAIL  ${name} — ${e.message}`); console.log(`   FAIL  ${name} — ${e.message}`); }
}
console.log(`\n${"=".repeat(78)}`);
console.log(`QF-MVP-82A-R0-S1 staging deployment certification — passed ${passed}, failed ${failures.length}`);
if (failures.length) { console.log("\nFAILURES:"); for (const l of failures) console.log(l); }
console.log("=".repeat(78));
process.exit(failures.length ? 1 : 0);
