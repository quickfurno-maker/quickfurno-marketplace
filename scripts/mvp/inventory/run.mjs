// ============================================================================
// QF-MVP-10.1 — Read-only repository inventory generator.
//
//   npm run inventory:mvp
//
// Emits (repo-relative, deterministic, byte-stable when the repo is unchanged):
//   docs/generated/qf-mvp-runtime-inventory.json
//   docs/generated/qf-mvp-migration-ledger.json
//
// READ-ONLY: reads repository files only. No DB / PostgreSQL / Supabase / provider
// / network / credential access; no mutation; no historical blob authority; no
// inference of database-application status from filenames. Object/ledger data is
// REPOSITORY EVIDENCE ONLY — applied-in-DB status is UNKNOWN_UNVERIFIED and is not
// asserted here. Output uses POSIX repo-relative paths and contains no absolute
// paths, no timestamps, and no secret values.
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  walk, rel, readText, exists, uniqSort, extractImports, extractEnvRefs,
  detectExternal, detectSupabase, detectRouteMethods, detectDirectives, extractExports, stableJson,
} from './lib/util.mjs';
import { extractSqlObjects } from './lib/sql.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const internalImports = (text) => extractImports(text).filter((s) => s.startsWith('@/') || s.startsWith('.'));

function deriveUrl(relPath) {
  const parts = relPath.split('/');
  parts.shift(); // drop 'app'
  parts.pop(); // drop route.ts / page.tsx
  const segs = parts.filter((p) => !/^\(.*\)$/.test(p)); // drop route groups
  return '/' + segs.join('/');
}

function audienceOf(url) {
  if (url.startsWith('/api')) return 'api';
  if (url.includes('/admin')) return 'admin';
  if (url.includes('/vendor')) return 'vendor';
  return 'public_client';
}

// --- Routes -----------------------------------------------------------------
function scanRoutes() {
  const appDir = path.join(REPO, 'app');
  const files = walk(appDir, ['.ts', '.tsx']);
  const api = [];
  const pages = [];
  for (const f of files) {
    const base = path.basename(f);
    if (base !== 'route.ts' && base !== 'page.tsx') continue;
    const r = rel(REPO, f);
    const text = readText(f);
    const url = deriveUrl(r);
    const common = {
      path: r,
      url,
      audience: audienceOf(url),
      directives: detectDirectives(text),
      external: detectExternal(text),
      supabase: detectSupabase(text).kinds,
      envRefs: extractEnvRefs(text),
      internalImports: internalImports(text),
    };
    if (base === 'route.ts') api.push({ ...common, kind: 'api_route', methods: detectRouteMethods(text) });
    else pages.push({ ...common, kind: 'page' });
  }
  const sortByPath = (a, b) => (a.path < b.path ? -1 : 1);
  return { api: api.sort(sortByPath), pages: pages.sort(sortByPath) };
}

// --- Services ---------------------------------------------------------------
function scanServices() {
  const dir = path.join(REPO, 'services');
  const files = walk(dir, ['.ts']).filter((f) => f.endsWith('.ts'));
  return files
    .map((f) => {
      const text = readText(f);
      const sb = detectSupabase(text);
      return {
        path: rel(REPO, f),
        name: path.basename(f, '.ts'),
        exports: extractExports(text),
        external: detectExternal(text),
        supabase: sb.kinds,
        envRefs: extractEnvRefs(text),
        internalImports: internalImports(text),
      };
    })
    .sort((a, b) => (a.path < b.path ? -1 : 1));
}

// --- lib modules ------------------------------------------------------------
function scanLib() {
  const dir = path.join(REPO, 'lib');
  const files = walk(dir, ['.ts']).filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'));
  const modules = files
    .map((f) => {
      const r = rel(REPO, f);
      const text = readText(f);
      const group = r.split('/')[1] || '(root)';
      return {
        path: r,
        group,
        external: detectExternal(text),
        supabase: detectSupabase(text).kinds,
        envRefs: extractEnvRefs(text),
      };
    })
    .sort((a, b) => (a.path < b.path ? -1 : 1));
  const providerAdapters = modules
    .filter((m) => m.path.startsWith('lib/communication/providers/'))
    .map((m) => ({ path: m.path, name: path.basename(m.path, '.ts'), external: m.external, supabase: m.supabase, envRefs: m.envRefs }));
  const groupCounts = {};
  for (const m of modules) groupCounts[m.group] = (groupCounts[m.group] || 0) + 1;
  const groupCountsSorted = {};
  for (const k of Object.keys(groupCounts).sort()) groupCountsSorted[k] = groupCounts[k];
  return { modules, providerAdapters, groupCounts: groupCountsSorted };
}

// --- Components (lightweight) -----------------------------------------------
function scanComponents() {
  const dir = path.join(REPO, 'components');
  const files = walk(dir, ['.tsx', '.ts']).map((f) => rel(REPO, f)).sort();
  return { count: files.length, paths: files };
}

// --- Package scripts + runtime config ---------------------------------------
function scanPackageAndConfig() {
  const pkg = JSON.parse(readText(path.join(REPO, 'package.json')));
  const scripts = {};
  for (const k of Object.keys(pkg.scripts || {}).sort()) scripts[k] = pkg.scripts[k];
  const config = [];
  for (const f of ['middleware.ts', 'next.config.mjs', 'next.config.js', 'tsconfig.json', '.eslintrc.json', 'tailwind.config.ts', 'tailwind.config.js', 'postcss.config.js', 'postcss.config.mjs']) {
    if (exists(path.join(REPO, f))) config.push(f);
  }
  return { scripts, config: config.sort(), dependencies: pkg.dependencies || {}, devDependencies: pkg.devDependencies || {} };
}

// --- Migrations -------------------------------------------------------------
function scanMigrations() {
  const dir = path.join(REPO, 'supabase/migrations');
  const files = walk(dir, ['.sql']).sort();
  const migrations = files.map((f, i) => {
    const r = rel(REPO, f);
    const base = path.basename(f);
    const tsMatch = base.match(/^(\d+)/);
    const sql = readText(f);
    return {
      file: r,
      name: base,
      order: i + 1,
      timestampPrefix: tsMatch ? tsMatch[1] : null,
      bytes: Buffer.byteLength(sql, 'utf8'),
      objects: extractSqlObjects(sql),
      appliedStatus: { staging: 'UNKNOWN_UNVERIFIED', production: 'UNKNOWN_UNVERIFIED', note: 'No DB access in this task; verify via QF-MVP-10.7 reconciliation.' },
    };
  });
  // Aggregate unique objects across all migrations (repository declarations).
  const agg = { tablesCreated: [], functions: [], triggers: [], enums: [], extensions: [], policies: [], rlsEnabled: [] };
  for (const m of migrations) {
    agg.tablesCreated.push(...m.objects.tablesCreated);
    agg.functions.push(...m.objects.functions);
    agg.triggers.push(...m.objects.triggers);
    agg.enums.push(...m.objects.enums);
    agg.extensions.push(...m.objects.extensions);
    agg.policies.push(...m.objects.policies);
    agg.rlsEnabled.push(...m.objects.rlsEnabled);
  }
  for (const k of Object.keys(agg)) agg[k] = uniqSort(agg[k]);
  return { migrations, aggregate: agg };
}

function main() {
  const routes = scanRoutes();
  const services = scanServices();
  const lib = scanLib();
  const components = scanComponents();
  const pkg = scanPackageAndConfig();
  const mig = scanMigrations();

  const runtime = {
    schemaVersion: 1,
    generator: 'scripts/mvp/inventory/run.mjs',
    note: 'Repository-derived, read-only. Presence of code proves EXISTENCE, not that it is wired/configured/deployed/active. No DB/provider/network access.',
    counts: {
      apiRoutes: routes.api.length,
      pages: routes.pages.length,
      services: services.length,
      libModules: lib.modules.length,
      providerAdapters: lib.providerAdapters.length,
      components: components.count,
      packageScripts: Object.keys(pkg.scripts).length,
    },
    routes,
    services,
    providerAdapters: lib.providerAdapters,
    libGroupCounts: lib.groupCounts,
    lib: lib.modules,
    components,
    packageScripts: pkg.scripts,
    runtimeConfig: pkg.config,
    dependencies: pkg.dependencies,
    devDependencies: pkg.devDependencies,
  };

  const ledger = {
    schemaVersion: 1,
    generator: 'scripts/mvp/inventory/run.mjs',
    note: 'Regex-extracted OBJECT DECLARATIONS from committed migration SQL — repository evidence only. Applied-in-DB status is UNKNOWN_UNVERIFIED (see docs/QF-MVP-10-DATABASE-RECONCILIATION.md). Not a full SQL parser.',
    counts: {
      migrations: mig.migrations.length,
      uniqueTablesCreated: mig.aggregate.tablesCreated.length,
      uniqueFunctions: mig.aggregate.functions.length,
      uniqueTriggers: mig.aggregate.triggers.length,
      uniqueEnums: mig.aggregate.enums.length,
      uniqueExtensions: mig.aggregate.extensions.length,
      uniquePolicies: mig.aggregate.policies.length,
      tablesWithRlsEnabled: mig.aggregate.rlsEnabled.length,
    },
    aggregate: mig.aggregate,
    migrations: mig.migrations,
  };

  const outDir = path.join(REPO, 'docs/generated');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'qf-mvp-runtime-inventory.json'), stableJson(runtime));
  fs.writeFileSync(path.join(outDir, 'qf-mvp-migration-ledger.json'), stableJson(ledger));

  // Console summary (non-authoritative; deterministic given a fixed repo).
  console.log('== QF-MVP inventory (read-only) ==');
  console.log(`routes(api)=${runtime.counts.apiRoutes} pages=${runtime.counts.pages} services=${runtime.counts.services} lib=${runtime.counts.libModules} providers=${runtime.counts.providerAdapters} components=${runtime.counts.components}`);
  console.log(`migrations=${ledger.counts.migrations} tablesCreated=${ledger.counts.uniqueTablesCreated} functions=${ledger.counts.uniqueFunctions} triggers=${ledger.counts.uniqueTriggers} enums=${ledger.counts.uniqueEnums} policies=${ledger.counts.uniquePolicies} rlsTables=${ledger.counts.tablesWithRlsEnabled}`);
  console.log('wrote docs/generated/qf-mvp-runtime-inventory.json');
  console.log('wrote docs/generated/qf-mvp-migration-ledger.json');
}

main();
