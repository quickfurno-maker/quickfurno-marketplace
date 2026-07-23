#!/usr/bin/env node
// ============================================================================
// QF-MVP-20.3R1 — repository-wide static proofs for the consumer migration.
//
// Offline and read-only: no database, no network, no Git history, no secrets,
// no mutation. It reads repository source files and proves the LOCKED runtime
// boundary that the canonical assignment authority depends on.
//
// Every source scan runs over a COMMENT-STRIPPED and (where a negative claim is
// made) STRING-STRIPPED view of the file. A prose comment or a documentation
// string that merely NAMES a legacy RPC must never be mistaken for a call to
// it — that defect class cost QF-MVP-20.3B1A a failed staging application.
//
// Usage: node scripts/qf-mvp-20-3r1-consumer-migration-harness.mjs
// ============================================================================

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

let passed = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition === true) {
    passed += 1;
    console.log(`   ok    ${name}`);
    return;
  }
  failures.push({ name, detail });
  console.log(`   FAIL  ${name}`);
  if (detail) console.log(`         ${detail}`);
}

function read(relPath) {
  return readFileSync(join(ROOT, relPath), 'utf8');
}

function sha256(relPath) {
  return createHash('sha256').update(readFileSync(join(ROOT, relPath))).digest('hex');
}

// ---------------------------------------------------------------------------
// Tokenizer — strip comments (and optionally string literals) from TS/JS source
// ---------------------------------------------------------------------------

/**
 * Remove line and block comments. When `stripStrings` is true, also blank the
 * CONTENTS of '...', "..." and `...` literals. Characters are replaced with
 * spaces so byte offsets and line counts stay usable.
 */
function stripSource(source, { stripStrings = false } = {}) {
  const out = [];
  let i = 0;
  const n = source.length;
  const blank = (text) => text.replace(/[^\n]/g, ' ');

  while (i < n) {
    const two = source.slice(i, i + 2);

    if (two === '//') {
      const end = source.indexOf('\n', i);
      const stop = end === -1 ? n : end;
      out.push(blank(source.slice(i, stop)));
      i = stop;
      continue;
    }
    if (two === '/*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      out.push(blank(source.slice(i, stop)));
      i = stop;
      continue;
    }

    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      let j = i + 1;
      while (j < n) {
        if (source[j] === '\\') { j += 2; continue; }
        if (source[j] === ch) { j += 1; break; }
        j += 1;
      }
      const literal = source.slice(i, j);
      out.push(stripStrings ? ch + blank(literal.slice(1, -1)) + (literal.length > 1 ? ch : '') : literal);
      i = j;
      continue;
    }

    out.push(ch);
    i += 1;
  }
  return out.join('');
}

// ---------------------------------------------------------------------------
// Source inventory
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'dist', 'build', 'coverage', '.vercel', 'out']);
const CODE_EXT = /\.(ts|tsx|mjs|js|jsx)$/;

function walk(dir, acc = []) {
  let entries;
  try {
    entries = readdirSync(join(ROOT, dir));
  } catch {
    return acc;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const rel = join(dir, entry);
    const full = join(ROOT, rel);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) walk(rel, acc);
    else if (CODE_EXT.test(entry)) acc.push(rel.split(sep).join('/'));
  }
  return acc;
}

/** Application runtime only — excludes scripts/ harnesses and supabase/functions. */
const RUNTIME_DIRS = ['app', 'services', 'lib', 'components'];
const RUNTIME_FILES = RUNTIME_DIRS.flatMap((dir) => walk(dir));

const CODE = new Map();       // comments stripped, strings kept
const STRUCTURE = new Map();  // comments AND string contents stripped
for (const file of RUNTIME_FILES) {
  const raw = read(file);
  CODE.set(file, stripSource(raw));
  STRUCTURE.set(file, stripSource(raw, { stripStrings: true }));
}

function filesMatching(map, regex) {
  const hits = [];
  for (const [file, text] of map) if (regex.test(text)) hits.push(file);
  return hits.sort();
}

console.log('== QF-MVP-20.3R1 consumer-migration static proofs ==');
console.log(`runtime files scanned: ${RUNTIME_FILES.length} (app, services, lib, components)\n`);

// ---------------------------------------------------------------------------
// 1. Applied migrations and locked verification artifacts are UNCHANGED
// ---------------------------------------------------------------------------

const LOCKED = {
  'supabase/migrations/20260723000100_qf_mvp_marketplace_authority_foundation.sql':
    'b6307094715a102fa0cfccc1533cb8089e5b26fbe1e80a294c127b81e29f2b83',
  'supabase/migrations/20260723000200_qf_mvp_assignment_lineage_backfill.sql':
    '9d77f4460701caa1caf172b50886b681f4b7e86849172ca2a7af1ece70eb3d60',
  'supabase/migrations/20260723000300_qf_mvp_canonical_assignment_authority.sql':
    '46ce7377a217a13620305572f1be9038a56c911ce76a556b4d52f91fe107177e',
  'supabase/migrations/20260723000400_qf_mvp_lineage_append_only_grants.sql':
    '91544524c27ca26020b648f13f462d2613ca407366c8de0f258ea4f04d8c553b',
  'supabase/staging-verification/verify_qf_mvp_20_3b1.sql':
    'e1d9edb85008c8f157016cb04f09ec127aba850d1980ca86ebb8e6721aab7483',
  'scripts/mvp/staging/validate-qf-mvp-20-3b1.mjs':
    'e27d62d09f38e599c34b1084019777b0147df68bba1c91389b52d1df6577a6c8',
};

for (const [file, expected] of Object.entries(LOCKED)) {
  const actual = sha256(file);
  check(`01 locked artifact unchanged: ${file}`, actual === expected, `expected ${expected}, got ${actual}`);
}

// R1 is a repository/code phase: it must not add, remove or edit a migration.
//
// QF-MVP-20.3B2 correction: this was an ABSOLUTE file count (72), which is a
// phase-blind guard — the very next authorized migration phase makes it fail
// even though R1 is still innocent. The claim R1 actually needs is "no
// migration exists at or before R1's boundary that R1 did not inherit, and
// every LATER migration belongs to an explicitly declared later phase". That
// keeps the guard's full force against an accidental R1 migration while
// letting authorized phases land.
const R1_BOUNDARY_VERSION = '20260723000400'; // Migration G, the last one R1 inherited.
const DECLARED_LATER_MIGRATIONS = new Set([
  '20260723000500_qf_mvp_assignment_universal_enforcement.sql', // QF-MVP-20.3B2
]);

const migrationFiles = readdirSync(join(ROOT, 'supabase/migrations')).filter((f) => f.endsWith('.sql'));
const afterBoundary = migrationFiles.filter((f) => (f.match(/^(\d+)_/) || [])[1] > R1_BOUNDARY_VERSION);
const undeclared = afterBoundary.filter((f) => !DECLARED_LATER_MIGRATIONS.has(f));

check('02a R1 added no SQL migration of its own', undeclared.length === 0,
  `undeclared migrations after the R1 boundary: ${JSON.stringify(undeclared)}`);
check('02b every migration after the R1 boundary belongs to a declared later phase',
  afterBoundary.length === DECLARED_LATER_MIGRATIONS.size,
  `found ${afterBoundary.length}, declared ${DECLARED_LATER_MIGRATIONS.size}: ${JSON.stringify(afterBoundary)}`);

// ---------------------------------------------------------------------------
// 2. Exactly ONE call site for the canonical authority
// ---------------------------------------------------------------------------

const AUTHORITY = 'qf_assign_lead_vendors_v2';

// The authority's NAME is declared exactly once, as a constant, in the pure
// contract module. No consumer may hard-code it.
const nameHolders = filesMatching(CODE, new RegExp(AUTHORITY));
check(
  '03a the authority name is declared in exactly one runtime module',
  nameHolders.length === 1 && nameHolders[0] === 'lib/marketplace/canonicalAssignmentContract.ts',
  `declared in: ${JSON.stringify(nameHolders)}`,
);

// ...and exactly one module actually invokes it, through that constant.
const authorityCallers = filesMatching(CODE, /\.rpc\(\s*CANONICAL_ASSIGNMENT_RPC\b/);
check(
  '03b exactly one runtime module calls the canonical authority',
  authorityCallers.length === 1 && authorityCallers[0] === 'services/canonicalAssignmentAuthority.ts',
  `callers: ${JSON.stringify(authorityCallers)}`,
);

// No other module may reach ANY assignment RPC by any name.
const allRpcCallers = filesMatching(CODE, /\.rpc\(\s*["'`][a-z_]*assign[a-z_]*["'`]/i);
check(
  '03c no runtime module calls an assignment RPC by literal name',
  allRpcCallers.length === 1 && allRpcCallers[0] === 'services/packageService.ts',
  `literal assignment-RPC callers (only the package-assignment RPC is expected): ${JSON.stringify(allRpcCallers)}`,
);

const seam = CODE.get('services/canonicalAssignmentAuthority.ts');
check(
  '04 the seam calls the authority through the service-role client only',
  /adminClient\(\)\.rpc\(\s*CANONICAL_ASSIGNMENT_RPC/.test(seam),
  'expected adminClient().rpc(CANONICAL_ASSIGNMENT_RPC, ...)',
);
check(
  '05 the seam never uses the anon or session client',
  !/publicClient\s*\(|serverClient\s*\(|browserClient\s*\(/.test(seam),
  'an untrusted client appears in the assignment seam',
);

// ---------------------------------------------------------------------------
// 3. No legacy assignment RPC is CALLED anywhere in the runtime
// ---------------------------------------------------------------------------

const LEGACY_ASSIGNMENT_RPCS = [
  'assign_lead_to_paid_vendors_phase26a',
  'assign_lead_to_paid_vendors',
  'assign_lead_to_vendors',
  'admin_smart_assign_lead_to_vendors',
  'assign_lead_to_preferred_vendor',
  'assign_client_selected_vendor_to_group',
  'assign_vendor_to_requirement_group',
];

for (const rpc of LEGACY_ASSIGNMENT_RPCS) {
  const callers = filesMatching(CODE, new RegExp(`\\.rpc\\(\\s*["'\`]${rpc}["'\`]`));
  check(`06 legacy assignment RPC is never called: ${rpc}`, callers.length === 0, `called in: ${JSON.stringify(callers)}`);
}

// ---------------------------------------------------------------------------
// 4. No direct credit mutation on an assignment path
// ---------------------------------------------------------------------------

const CREDIT_MUTATION_RPCS = ['deduct_vendor_credit', 'restore_vendor_credit', 'increment_vendor_credits'];
for (const rpc of CREDIT_MUTATION_RPCS) {
  const callers = filesMatching(CODE, new RegExp(`\\.rpc\\(\\s*["'\`]${rpc}["'\`]`));
  check(`07 direct credit RPC is never called: ${rpc}`, callers.length === 0, `called in: ${JSON.stringify(callers)}`);
}

// The wallet primitive stays reachable ONLY from the admin wallet service, and
// never from an assignment consumer.
const walletCallers = filesMatching(CODE, /\.rpc\(\s*["'`]qf_apply_vendor_credit_delta["'`]/);
check(
  '08 the wallet delta primitive is confined to the credit wallet service',
  walletCallers.length === 1 && walletCallers[0] === 'services/vendorCreditWalletService.ts',
  `callers: ${JSON.stringify(walletCallers)}`,
);

const ASSIGNMENT_CONSUMERS = [
  'services/leadDeliveryService.ts',
  'services/leadService.ts',
  'services/manualLeadAssignmentService.ts',
  'services/delayedLeadFillService.ts',
  'services/preferredVendorLeadService.ts',
  'services/clientRequirementGroupService.ts',
];
// A consumer may READ or PROJECT a vendor's credit balance (previews, audit
// snapshots); what it must never do is WRITE one. Only ledger-backed writes
// inside the authority may move credits.
for (const file of ASSIGNMENT_CONSUMERS) {
  const text = CODE.get(file);
  const ledgerWrite = /from\(\s*["'`]vendor_credit_logs["'`]\s*\)\s*\.\s*(insert|update|upsert|delete)/.test(text);
  const balanceWrite = /\.update\(\s*\{[^}]*\bremaining_credits\b/s.test(text);
  check(
    `09 assignment consumer performs no direct credit write: ${file}`,
    !ledgerWrite && !balanceWrite,
    ledgerWrite ? 'a direct vendor_credit_logs write was found' : 'a direct remaining_credits update was found',
  );
}

// ---------------------------------------------------------------------------
// 5. No caller-controlled ceiling, cost or duplicate override survives
// ---------------------------------------------------------------------------

for (const forbidden of ['p_total_limit', 'p_allow_duplicate', 'p_selected_type', 'p_vendor_ids', 'p_selected_vendor_ids']) {
  const hits = filesMatching(STRUCTURE, new RegExp(`\\b${forbidden}\\b`));
  check(`10 no legacy assignment argument in runtime code: ${forbidden}`, hits.length === 0, `found in: ${JSON.stringify(hits)}`);
}

const contract = STRUCTURE.get('lib/marketplace/canonicalAssignmentContract.ts');
check(
  '11 the canonical request type exposes no ceiling or cost field',
  !/\b(totalLimit|maxVendors|creditCost|allowDuplicate)\s*[?:]/.test(contract),
  'a caller-controlled ceiling or cost field is declared on the request',
);

// ---------------------------------------------------------------------------
// 6. Every migrated consumer goes through the seam
// ---------------------------------------------------------------------------

const SEAM_IMPORT = /from\s+["'`][^"'`]*canonicalAssignmentAuthority["'`]/;
for (const file of ASSIGNMENT_CONSUMERS) {
  check(`12 consumer imports the canonical seam: ${file}`, SEAM_IMPORT.test(CODE.get(file)), 'no import of canonicalAssignmentAuthority');
}

const MIGRATED_MODES = {
  'services/leadDeliveryService.ts': 'automatic',
  'services/leadService.ts': 'admin_manual',
  'services/manualLeadAssignmentService.ts': 'admin_manual',
  'services/delayedLeadFillService.ts': 'delayed_fill',
  'services/clientRequirementGroupService.ts': 'delayed_fill',
};
for (const [file, mode] of Object.entries(MIGRATED_MODES)) {
  check(
    `13 consumer declares its canonical mode: ${file} -> ${mode}`,
    new RegExp(`mode:\\s*["'\`]${mode}["'\`]`).test(CODE.get(file)),
    `expected mode: "${mode}"`,
  );
}

// ---------------------------------------------------------------------------
// 7. client_selected is fail-closed everywhere, with no fallback
// ---------------------------------------------------------------------------

const BLOCKED_PATHS = [
  'services/leadService.ts',
  'services/preferredVendorLeadService.ts',
  'services/delayedLeadFillService.ts',
  'services/clientRequirementGroupService.ts',
];
for (const file of BLOCKED_PATHS) {
  const text = CODE.get(file);
  check(
    `14 blocked path surfaces R1_BLOCKED_PENDING_OWNER_BINDING: ${file}`,
    /R1_BLOCKED_PENDING_OWNER_BINDING/.test(text) || /blockedClientSelectedAssignment\s*[<(]/.test(text),
    'the blocked path neither names the code nor returns the blocked result',
  );
}

check(
  '15 no runtime module requests client_selected mode from the authority',
  filesMatching(CODE, /mode:\s*["'`]client_selected["'`]/).length === 0,
  'a consumer still asks the authority for client_selected mode',
);

check(
  '16 the contract rejects client_selected before building an operation key',
  /if \(mode === "client_selected"\)[\s\S]{0,200}R1_BLOCKED_PENDING_OWNER_BINDING/.test(CODE.get('lib/marketplace/canonicalAssignmentContract.ts')),
  'client_selected is not rejected ahead of key construction',
);

check(
  '17 the documented unblocking prerequisite is recorded in the contract',
  /ownership binding column/.test(read('lib/marketplace/canonicalAssignmentContract.ts'))
    && /client-selection request row/.test(read('lib/marketplace/canonicalAssignmentContract.ts')),
  'the exact missing prerequisite is not documented',
);

// ---------------------------------------------------------------------------
// 8. Trust-tier boundary: no service-role credential is browser-reachable
// ---------------------------------------------------------------------------

const clientComponents = RUNTIME_FILES.filter((file) => /^\s*["'`]use client["'`]/m.test(read(file)));
const leakingClients = clientComponents.filter((file) =>
  SEAM_IMPORT.test(CODE.get(file)) || /\badminClient\b/.test(CODE.get(file)));
check(
  '18 no "use client" module imports the assignment seam or the service-role client',
  leakingClients.length === 0,
  `leaking: ${JSON.stringify(leakingClients)}`,
);

// Only one module may turn the service-role key into a CLIENT. (A module may
// still test the variable's presence — services/vendorService.ts logs
// `Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)` in a diagnostic and never
// exposes its value — so the claim under test is construction, not mention.)
const serviceRoleClients = filesMatching(STRUCTURE, /createClient\s*\([\s\S]{0,160}?serviceRoleKey/);
check(
  '19a the service-role client is constructed in exactly one runtime module',
  serviceRoleClients.length === 1 && serviceRoleClients[0] === 'lib/supabase.ts',
  `constructors: ${JSON.stringify(serviceRoleClients)}`,
);

const clientSideKeyRefs = clientComponents.filter((file) => /SUPABASE_SERVICE_ROLE_KEY|serviceRoleKey/.test(CODE.get(file)));
check(
  '19b no browser-reachable module references the service-role key at all',
  clientSideKeyRefs.length === 0,
  `referencing: ${JSON.stringify(clientSideKeyRefs)}`,
);

const keyValueEscapes = filesMatching(STRUCTURE, /(return|=|:|\+)\s*process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
check(
  '19c the service-role key value never escapes lib/supabase.ts',
  keyValueEscapes.every((file) => file === 'lib/supabase.ts'),
  `value read in: ${JSON.stringify(keyValueEscapes)}`,
);

check(
  '20 the pure contract module pulls in no client, network or clock dependency',
  !/from\s+["'`][^"'`]*supabase|fetch\(|Date\.now\(|Math\.random\(|new Date\(/.test(CODE.get('lib/marketplace/canonicalAssignmentContract.ts')),
  'the contract module is no longer dependency-free',
);

// ---------------------------------------------------------------------------
// 9. The public unauthenticated action cannot assign
// ---------------------------------------------------------------------------

const actions = CODE.get('app/actions.ts');
check(
  '21 the public assignLead action requests only client_selected (therefore blocked)',
  /export async function assignLead\([\s\S]{0,400}assignmentType:\s*["'`]client_selected["'`]/.test(actions),
  'the public action does not pin itself to the blocked client-selected path',
);
check(
  '22 the admin assign action attributes a real superadmin actor',
  /adminAssignLead[\s\S]{0,400}requireSuperadmin\(\)[\s\S]{0,300}adminId:\s*user\.id/.test(actions),
  'adminAssignLead does not bind the acting superadmin as the actor',
);
check(
  '23 the admin assign action no longer offers a duplicate override',
  !/adminAssignLead\s*=\s*async\s*\([^)]*allowDuplicate/.test(actions),
  'allowDuplicate is still reachable from the admin action',
);

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

const total = passed + failures.length;
console.log(`\n== Summary ==`);
console.log(`checks: ${passed} passed, ${failures.length} failed (of ${total})`);
if (failures.length > 0) {
  for (const f of failures) console.log(`  - ${f.name}${f.detail ? ` :: ${f.detail}` : ''}`);
}
console.log(`RESULT: ${failures.length === 0 ? 'PASS' : 'FAIL'}`);
process.exit(failures.length === 0 ? 0 : 1);
