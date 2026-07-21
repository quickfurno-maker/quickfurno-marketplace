// ============================================================================
// QF-MVP-10.1 — Deterministic SQL object extraction for the migration ledger.
//
// Regex-based extraction of database OBJECT DECLARATIONS from committed migration
// SQL. This is repository evidence only — it says what the SQL text *declares*,
// NOT what is applied in any live database (that is UNKNOWN_UNVERIFIED until a
// separate read-only reconciliation runs). Not a full SQL parser; it is stable
// and conservative, and every field cites the committed file.
// ============================================================================
import { uniqSort } from './util.mjs';

/** Strip a leading schema (public.) and surrounding double-quotes. */
function clean(name) {
  if (!name) return name;
  let n = name.trim().replace(/"/g, '');
  n = n.replace(/^public\./i, '');
  return n;
}

// SQL keywords that can be spuriously captured by the conservative regexes
// (e.g. from `CREATE TABLE IF NOT EXISTS` line breaks, `RAISE ... FAILS` text).
// Dropping them keeps the object lists to real identifiers only.
const STOPWORDS = new Set([
  'if', 'not', 'exists', 'only', 'table', 'column', 'fails', 'fail', 'begin', 'then',
  'do', 'end', 'as', 'is', 'declare', 'and', 'or', 'null', 'true', 'false', 'select',
]);
const keep = (n) => Boolean(n) && !STOPWORDS.has(n.toLowerCase());
const cllist = (arr) => uniqSort(arr.map(clean).filter(keep));

function all(re, text, pick = (m) => m[1]) {
  const out = [];
  let m;
  while ((m = re.exec(text)) !== null) out.push(pick(m));
  return out;
}

export function extractSqlObjects(sql) {
  // Normalize: keep as-is (case-insensitive regex); do not strip comments so
  // declarations inside DO blocks / functions are still counted (conservative).
  const tablesCreated = all(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:only\s+)?([a-z0-9_."]+)/gi, sql).map(clean);
  const tablesAltered = all(/alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?([a-z0-9_."]+)/gi, sql).map(clean);
  const indexes = all(/create\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?([a-z0-9_."]+)/gi, sql).map(clean);
  const functions = all(/create\s+(?:or\s+replace\s+)?function\s+([a-z0-9_."]+)\s*\(/gi, sql).map(clean);
  const triggers = all(/create\s+(?:or\s+replace\s+)?(?:constraint\s+)?trigger\s+([a-z0-9_."]+)/gi, sql).map(clean);
  const enums = all(/create\s+type\s+([a-z0-9_."]+)\s+as\s+enum/gi, sql).map(clean);
  const extensions = all(/create\s+extension\s+(?:if\s+not\s+exists\s+)?["']?([a-z0-9_]+)/gi, sql).map(clean);
  const columnsAdded = all(/add\s+column\s+(?:if\s+not\s+exists\s+)?([a-z0-9_."]+)/gi, sql).map(clean);
  const constraints = uniqSort([
    ...all(/add\s+constraint\s+([a-z0-9_."]+)/gi, sql).map(clean),
    ...all(/\bconstraint\s+([a-z0-9_."]+)\s+(?:primary\s+key|unique|foreign\s+key|check|references|exclude)/gi, sql).map(clean),
  ]);

  // RLS policies: capture name + table. Policy names are frequently double-quoted
  // identifiers containing spaces (e.g. "profiles self read"), so accept a quoted
  // form OR a bare dotted identifier.
  const policies = uniqSort(
    all(/create\s+policy\s+("[^"]*"|[a-z0-9_.]+)\s+on\s+("[^"]*"|[a-z0-9_.]+)/gi, sql, (m) => `${clean(m[1])} ON ${clean(m[2])}`),
  );
  const rlsEnabled = uniqSort(
    all(/alter\s+table\s+(?:only\s+)?([a-z0-9_."]+)\s+enable\s+row\s+level\s+security/gi, sql).map(clean),
  );

  // Grants: capture privilege + object + grantee summary (best-effort, single line).
  const grants = uniqSort(
    all(/grant\s+([a-z0-9_,\s]+?)\s+on\s+(?:table\s+|function\s+|sequence\s+)?([a-z0-9_."(),\s]+?)\s+to\s+([a-z0-9_,"\s]+)/gi, sql, (m) =>
      `${m[1].trim().replace(/\s+/g, ' ')} ON ${clean(m[2].trim())} TO ${m[3].trim().replace(/\s+/g, ' ')}`,
    ),
  );

  // RPC heuristic: SECURITY DEFINER functions are the typical Core RPC surface.
  const securityDefiner = /security\s+definer/i.test(sql);

  const createdClean = cllist(tablesCreated);
  return {
    tablesCreated: createdClean,
    tablesAltered: cllist(tablesAltered).filter((t) => !createdClean.includes(t)),
    columnsAdded: cllist(columnsAdded),
    constraints: constraints.filter(keep),
    indexes: cllist(indexes),
    functions: cllist(functions),
    securityDefinerFunctions: securityDefiner,
    triggers: cllist(triggers),
    enums: cllist(enums),
    extensions: cllist(extensions),
    rlsEnabled: rlsEnabled.filter(keep),
    policies,
    grants,
  };
}
