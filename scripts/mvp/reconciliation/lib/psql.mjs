// ============================================================================
// QF-MVP-10.7 — Safe psql invocation for read-only metadata collection.
//
// Credentials are parsed from the connection URI into PG* environment variables
// for the psql child process ONLY — the password never appears in argv, is never
// logged, and is never written to disk. A single `BEGIN READ ONLY` session runs
// all sections; `SHOW transaction_read_only` must report `on` or collection stops.
// ============================================================================
import { spawnSync } from 'node:child_process';
import { assertReadOnly } from './sql.mjs';

export function hasPsql() {
  try {
    const r = spawnSync('psql', ['--version'], { encoding: 'utf8' });
    return r.status === 0;
  } catch {
    return false;
  }
}

/** Parse a postgres URI into a PG* env map (never logged). Throws on malformed. */
function pgEnvFromUri(uri) {
  const u = new URL(uri);
  if (!/^postgres(ql)?:$/.test(u.protocol)) throw new Error('connection string is not a postgres URI');
  const env = {
    PGHOST: u.hostname,
    PGPORT: u.port || '5432',
    PGUSER: decodeURIComponent(u.username || ''),
    PGPASSWORD: decodeURIComponent(u.password || ''),
    PGDATABASE: (u.pathname || '').replace(/^\//, '') || 'postgres',
    PGSSLMODE: u.searchParams.get('sslmode') || 'require',
    PGCONNECT_TIMEOUT: '10',
  };
  return env;
}

/** Remove any occurrence of secret substrings from a string (defence-in-depth). */
function redact(text, secrets) {
  let out = String(text == null ? '' : text);
  for (const s of secrets) {
    if (s) out = out.split(s).join('[REDACTED]');
  }
  return out.replace(/postgres(ql)?:\/\/[^\s"']+/gi, 'postgresql://[REDACTED]');
}

/**
 * Run all sections in ONE read-only psql session. Returns { readonly, sections }.
 * Never prints the URI, password, host, or argv.
 */
export function runReadOnlySession(uri, sections) {
  const pgEnv = pgEnvFromUri(uri);
  const secrets = [uri, pgEnv.PGPASSWORD, pgEnv.PGHOST, pgEnv.PGUSER].filter(Boolean);

  const lines = ['\\set ON_ERROR_STOP on', 'begin read only;'];
  for (const s of sections) {
    assertReadOnly(s.sql); // hard guard: refuse to send write/DDL keywords
    lines.push(`\\echo @@SEC:${s.name}@@`);
    lines.push(s.sql);
  }
  lines.push('commit;');
  const script = lines.join('\n') + '\n';
  assertReadOnly(script.replace(/\\echo @@SEC:[a-z_]+@@/g, '')); // guard the whole script too

  const res = spawnSync('psql', ['-X', '-q', '-A', '-t', '-P', 'pager=off', '-v', 'ON_ERROR_STOP=1', '-f', '-'], {
    input: script,
    encoding: 'utf8',
    env: { ...process.env, ...pgEnv },
    maxBuffer: 64 * 1024 * 1024,
  });

  if (res.error) throw new Error(`[reconcile] psql failed: ${redact(res.error.message, secrets)}`);
  if (res.status !== 0) throw new Error(`[reconcile] psql exit ${res.status}: ${redact(res.stderr, secrets)}`);

  // Parse @@SEC:name@@ markers; each section payload is the text until the next marker.
  const out = redact(res.stdout, secrets);
  const parts = out.split(/@@SEC:([a-z_]+)@@/g); // [pre, name1, body1, name2, body2, ...]
  const parsed = {};
  for (let i = 1; i < parts.length; i += 2) {
    const name = parts[i];
    const body = (parts[i + 1] || '').trim();
    const def = sections.find((s) => s.name === name);
    if (!def) continue;
    if (def.kind === 'scalar') parsed[name] = body;
    else {
      try {
        parsed[name] = JSON.parse(body || 'null');
      } catch {
        parsed[name] = { __parse_error: true };
      }
    }
  }
  const readonly = parsed.readonly_check === 'on';
  return { readonly, sections: parsed };
}
