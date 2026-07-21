// ============================================================================
// QF-MVP-10.1 — Inventory tooling shared utilities (READ-ONLY, deterministic).
//
// Reads repository files only. No DB / network / provider / credential access.
// All outputs use repo-relative POSIX paths and sorted arrays so the generated
// JSON is byte-stable when the repository has not changed. No timestamps, no
// randomness, no secret values (code contains env var *names*, never values).
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';

/** Directories never scanned (build output, deps, VCS, generated output, external kit). */
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'dist', 'build', 'coverage']);

/** POSIX, repo-relative path. */
export function rel(repoRoot, file) {
  return path.relative(repoRoot, file).split(path.sep).join('/');
}

export function readText(file) {
  return fs.readFileSync(file, 'utf8');
}

export function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

/** Recursively list files under dir matching one of `exts` (e.g. ['.ts','.tsx']). Deterministic (sorted). */
export function walk(dir, exts) {
  const out = [];
  if (!exists(dir)) return out;
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      out.push(...walk(path.join(dir, e.name), exts));
    } else if (!exts || exts.some((x) => e.name.endsWith(x))) {
      out.push(path.join(dir, e.name));
    }
  }
  return out;
}

export function uniqSort(arr) {
  return Array.from(new Set(arr)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Import specifiers (static import ... from '...' and dynamic import('...') and require('...')). */
export function extractImports(text) {
  const specs = [];
  const re = /(?:import\b[^'"]*?from\s*|import\s*|require\s*\(\s*|import\s*\(\s*)['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(text)) !== null) specs.push(m[1]);
  return uniqSort(specs);
}

/** Env var names referenced via process.env.NAME or process.env['NAME'] (names only — never values). */
export function extractEnvRefs(text) {
  const names = [];
  const re = /process\.env\.([A-Z0-9_]+)|process\.env\[\s*['"]([A-Z0-9_]+)['"]\s*\]/g;
  let m;
  while ((m = re.exec(text)) !== null) names.push(m[1] || m[2]);
  return uniqSort(names);
}

/** Detect external systems referenced (deterministic keyword map). */
export function detectExternal(text) {
  const found = [];
  const has = (re) => re.test(text);
  if (has(/graph\.facebook\.com|META_(?:WABA|PHONE|APP_SECRET|ACCESS_TOKEN|GRAPH)|whatsapp_business_account|metaCloudWhatsApp/i)) found.push('meta_whatsapp');
  if (has(/exotel|EXOTEL_/i)) found.push('exotel_sms');
  if (has(/\bn8n\b|N8N_|aosService|automation_job/i)) found.push('n8n_automation');
  if (has(/jarvis/i)) found.push('jarvis');
  if (has(/from\s+['"]@\/lib\/supabase|createServerClient|createBrowserClient|@supabase\/(?:ssr|supabase-js)/)) found.push('supabase');
  if (has(/\bfetch\s*\(|https?\.request|node-fetch|undici/)) found.push('http_fetch');
  return uniqSort(found);
}

/** Supabase usage classification (server vs browser vs service-role). */
export function detectSupabase(text) {
  const kinds = [];
  if (/service_role|SERVICE_ROLE|createServiceRoleClient|serviceRoleClient|SUPABASE_SERVICE_ROLE_KEY/.test(text)) kinds.push('service_role');
  if (/createServerClient|createServerSupabase|supabaseServer|createClient\(/.test(text)) kinds.push('server');
  if (/createBrowserClient|supabaseBrowser|createClientComponentClient/.test(text)) kinds.push('browser');
  if (/from\s+['"]@\/lib\/supabase/.test(text)) kinds.push('lib_supabase_import');
  return { uses: kinds.length > 0, kinds: uniqSort(kinds) };
}

/** Exported HTTP method handlers in an app-router route.ts. */
export function detectRouteMethods(text) {
  const methods = [];
  for (const verb of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) {
    const re = new RegExp(`export\\s+(?:async\\s+)?function\\s+${verb}\\b|export\\s+const\\s+${verb}\\s*=`);
    if (re.test(text)) methods.push(verb);
  }
  if (/export\s+const\s+dynamic\s*=/.test(text)) methods.push('(dynamic-config)');
  return uniqSort(methods).filter((m) => m !== '(dynamic-config)').concat(methods.includes('(dynamic-config)') ? [] : []);
}

/** React/runtime directive at top of file. */
export function detectDirectives(text) {
  const d = [];
  if (/^\s*['"]use client['"]/m.test(text)) d.push('use client');
  if (/^\s*['"]use server['"]/m.test(text)) d.push('use server');
  return d;
}

/** Named exports (function/const/class) — best-effort, deterministic. */
export function extractExports(text) {
  const names = [];
  const re = /export\s+(?:async\s+)?(?:function|const|class)\s+([A-Za-z0-9_]+)/g;
  let m;
  while ((m = re.exec(text)) !== null) names.push(m[1]);
  const reType = /export\s+(?:type|interface)\s+([A-Za-z0-9_]+)/g;
  while ((m = reType.exec(text)) !== null) names.push(m[1]);
  return uniqSort(names);
}

/** Stable JSON with trailing newline. Objects must already be built in the desired key order. */
export function stableJson(obj) {
  return JSON.stringify(obj, null, 2) + '\n';
}
