// ============================================================================
// QF-MVP-00 — Focused MVP validation runner.
//
// Runs the safe, non-mutating MVP suites SEQUENTIALLY with deterministic
// pass/fail output. Guarantees (by construction — see scripts/mvp/README.md):
//   - never modifies source files, never mutates, never reads Git history / blob
//     SHAs, never touches Supabase / a provider / the network, needs no secrets.
//   - stops on the FIRST failed mandatory suite and exits non-zero.
//   - shows the command + elapsed time per suite and a passed/failed/skipped
//     summary. Never silently ignores a failure.
//
// Usage:  node --import ./scripts/mvp/loader/register.mjs ./scripts/mvp/run.mjs [suiteId...]
//   suiteId ∈ { marketplace, communication }. No args => run all, in order.
// ============================================================================

const REGISTER = './scripts/mvp/loader/register.mjs';
const ENTRY = './scripts/mvp/run.mjs';

// Canonical order. Every MVP suite is mandatory (no soft/optional suites).
const SUITE_ORDER = ['marketplace', 'assignment-authority', 'communication'];
const SUITE_FILES = {
  marketplace: './suites/marketplace.mjs',
  'assignment-authority': './suites/assignmentAuthority.mjs',
  communication: './suites/communication.mjs',
};

function fmtMs(ms) {
  return `${ms.toFixed(1)} ms`;
}

function parseSelection(argv) {
  const requested = argv.slice(2).filter((a) => !a.startsWith('-'));
  if (requested.length === 0) return SUITE_ORDER.slice();
  const unknown = requested.filter((id) => !SUITE_FILES[id]);
  if (unknown.length > 0) {
    console.error(`[qf-mvp] unknown suite(s): ${unknown.join(', ')}. Known: ${SUITE_ORDER.join(', ')}`);
    process.exit(2);
  }
  // Preserve canonical order regardless of arg order; de-duplicate.
  return SUITE_ORDER.filter((id) => requested.includes(id));
}

async function runSuite(id) {
  const mod = await import(new URL(SUITE_FILES[id], import.meta.url));
  const suite = mod.suite ?? mod.default;
  const cases = suite?.cases ?? [];
  console.log(`\n>> ${id} -- ${suite?.title ?? id}`);
  console.log(`   $ node --import ${REGISTER} ${ENTRY} ${id}`);

  let passed = 0;
  const failures = [];
  const start = performance.now();
  for (const testCase of cases) {
    try {
      await testCase.run();
      passed += 1;
      console.log(`   ok    ${testCase.name}`);
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      failures.push({ name: testCase.name, message });
      console.log(`   FAIL  ${testCase.name}`);
      console.log(`         ${message}`);
    }
  }
  const elapsed = performance.now() - start;
  const status = failures.length === 0 ? 'PASS' : 'FAIL';
  console.log(`   => ${id}: ${passed} passed, ${failures.length} failed  [${status}]  (${fmtMs(elapsed)})`);
  return { id, total: cases.length, passed, failed: failures.length, elapsed };
}

async function main() {
  const selection = parseSelection(process.argv);
  console.log('== QF-MVP focused validation runner ==');
  console.log(`Node ${process.version} | suites: ${selection.join(', ')}`);

  const results = [];
  const skipped = [];
  let stopped = false;

  for (let i = 0; i < selection.length; i += 1) {
    const id = selection[i];
    if (stopped) {
      skipped.push(id);
      continue;
    }
    const result = await runSuite(id);
    results.push(result);
    if (result.failed > 0) {
      // Stop on the first failed mandatory suite.
      stopped = true;
      for (let j = i + 1; j < selection.length; j += 1) skipped.push(selection[j]);
    }
  }

  const suitesPassed = results.filter((r) => r.failed === 0).length;
  const suitesFailed = results.filter((r) => r.failed > 0).length;
  const casesPassed = results.reduce((n, r) => n + r.passed, 0);
  const casesFailed = results.reduce((n, r) => n + r.failed, 0);

  console.log('\n== Summary ==');
  console.log(`suites: ${suitesPassed} passed, ${suitesFailed} failed, ${skipped.length} skipped`);
  console.log(`cases:  ${casesPassed} passed, ${casesFailed} failed`);
  if (skipped.length > 0) console.log(`skipped after first failure: ${skipped.join(', ')}`);

  const ok = suitesFailed === 0 && casesFailed === 0;
  console.log(`RESULT: ${ok ? 'PASS' : 'FAIL'}`);
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error('[qf-mvp] runner crashed:', err && err.stack ? err.stack : err);
  process.exit(1);
});
