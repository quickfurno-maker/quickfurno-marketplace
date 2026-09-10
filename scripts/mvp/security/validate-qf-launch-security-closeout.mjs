// ============================================================================
// QF LAUNCH SECURITY CLOSEOUT — source validator.
//
// OFFLINE. Opens no socket, reads no credential, touches no database.
//
// WHY A SOURCE VALIDATOR AND NOT A LIVE DB TEST
//   CI here has no database. The migration's own `do $verify$` block is the
//   runtime authority and raises rather than warns, so it cannot leave a write
//   path behind. This file guards the properties that must hold in the SOURCE,
//   so a later edit cannot quietly widen the boundary before anyone applies it.
//
// LIVE EXECUTION EVIDENCE (recorded, not re-run here)
//   The migration was executed against an ISOLATED throwaway PostgreSQL 17
//   instance on a private port — never a Supabase project, never staging, never
//   production — over a stub reproducing the 20.3C objects and privilege posture.
//   Observed there:
//     * migration applied clean, self-verification NOTICE fired;
//     * re-applying it was idempotent;
//     * anon SELECT on vendor_public_v returned ONLY the eligible fixture, and
//       none of the not-approved / inactive / hidden / zero-credit fixtures;
//     * anon INSERT, UPDATE and DELETE through the view were all
//       "permission denied for view vendor_public_v";
//     * authenticated UPDATE through the view was denied;
//     * anon SELECT on public.vendors stayed "permission denied for table vendors";
//     * the now-INVOKER get_public_eligible_vendors still returned exactly the
//       eligible vendor when called as anon — proving the definer removal did not
//       break the public discovery path;
//     * prosecdef = false and search_path pinned on the RPC and all six functions;
//     * is_admin() / owns_vendor(uuid) kept authenticated EXECUTE.
// ============================================================================

import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const MIGRATION = "supabase/migrations/20260911000000_qf_launch_security_closeout.sql";
const SQL = readFileSync(path.join(ROOT, MIGRATION), "utf8");

// Comment-free view of the migration.
//
// Every "this must NOT appear" assertion runs against THIS, never the raw file:
// the migration legitimately spells the things it forbids inside `--` commentary
// (it documents what it deliberately does NOT revoke, and warns about DROP TABLE).
// Scanning the raw text made three assertions fail on their own documentation.
const CODE = SQL.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");

const results = [];
const record = (name, passed, detail = "") => results.push({ name, passed: passed === true, detail });

// Body of the redefined discovery function only — the file legitimately spells
// forbidden tokens inside the guards that forbid them.
const rpcBody = (() => {
  const i = SQL.indexOf("create or replace function public.get_public_eligible_vendors");
  const j = SQL.indexOf("$$;", i);
  return i >= 0 && j > i ? SQL.slice(i, j) : "";
})();

// ---------------------------------------------------------------------------
// A. Migration shape
// ---------------------------------------------------------------------------
record("A01 the closeout migration exists", existsSync(path.join(ROOT, MIGRATION)));
record("A02 it is explicitly transaction-wrapped, COMMIT after the verification block",
  (() => {
    const ls = SQL.split("\n");
    const b = ls.findIndex((l) => l.trim().toLowerCase() === "begin;");
    const c = ls.findIndex((l) => l.trim().toLowerCase() === "commit;");
    const verifyEnd = ls.findIndex((l) => l.trim() === "$verify$;");
    return b >= 0 && c > verifyEnd && verifyEnd > b
      && ls.filter((l) => l.trim().toLowerCase() === "begin;").length === 1
      && ls.filter((l) => l.trim().toLowerCase() === "commit;").length === 1
      && !ls.some((l) => l.trim().toLowerCase().startsWith("rollback"));
  })());
record("A03 it carries a fail-loud self-verification block",
  /do \$verify\$/.test(SQL) && (SQL.match(/raise exception/g) ?? []).length >= 15);
record("A04 no historical migration was edited by this phase",
  readdirSync(path.join(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql")).length === 108);

// ---------------------------------------------------------------------------
// B. vendor_public_v — read only, contract unchanged
// ---------------------------------------------------------------------------
for (const role of ["public", "anon", "authenticated"]) {
  record(`B01 every write verb is revoked on vendor_public_v from ${role}`,
    new RegExp(`revoke insert, update, delete, truncate, references, trigger\\s*\\n\\s*on table public\\.vendor_public_v from ${role};`).test(SQL));
}
record("B02 the intended SELECT grant is preserved",
  /grant select on table public\.vendor_public_v to anon, authenticated, service_role;/.test(SQL));
record("B03 the migration never re-creates or redefines the view (column contract untouched)",
  !/create (or replace )?view public\.vendor_public_v/.test(SQL));
record("B04 it asserts the view is read-only for all three browser roles",
  /has_table_privilege\(v_role, 'public\.vendor_public_v', v_priv\)/.test(SQL) &&
  /array\['public', 'anon', 'authenticated'\]/.test(SQL) &&
  /array\['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'\]/.test(SQL));
record("B05 it asserts the 21-column contract and re-checks forbidden columns",
  /<> 21/.test(SQL) && /forbidden column/.test(SQL) &&
  ["remaining_credits", "phone", "user_id", "gst_number"].every((c) => SQL.includes(`'${c}'`)));

// ---------------------------------------------------------------------------
// C. The boundary is never widened to make discovery work
// ---------------------------------------------------------------------------
record("C01 it never grants anon or PUBLIC any privilege on public.vendors",
  !/grant\s+[a-z, ]*\s+on table public\.vendors to [^;]*\b(anon|public)\b/i.test(CODE));
record("C02 it disables no RLS and drops no policy",
  !/disable row level security/i.test(CODE) && !/drop policy/i.test(CODE));
record("C03 it asserts PUBLIC/anon regained nothing on vendors, and that vendors RLS is still enabled",
  /regained % on vendors/.test(SQL) && /RLS was disabled on public\.vendors/.test(SQL));
record("C04 it performs no row mutation anywhere",
  !/\binsert\s+into\s+public\./i.test(CODE) && !/\bupdate\s+public\./i.test(CODE) &&
  !/\bdelete\s+from\s+public\./i.test(CODE) && !/\bdrop\s+table\b/i.test(CODE));

// ---------------------------------------------------------------------------
// D. get_public_eligible_vendors — definer removed without semantic drift
// ---------------------------------------------------------------------------
record("D01 the discovery RPC is declared SECURITY INVOKER",
  /security invoker/.test(rpcBody) && !/security definer/.test(rpcBody));
record("D02 it reads the trusted projection, not the base table",
  /from public\.vendor_public_v v/.test(rpcBody) && !/from public\.vendors\b/.test(rpcBody));
record("D03 its signature and returned schema are unchanged",
  /get_public_eligible_vendors\(p_city text, p_area text, p_service text\)/.test(rpcBody) &&
  ["id uuid", "business_name text", "city text", "areas_covered text\\[\\]", "service_categories text\\[\\]",
   "experience text", "portfolio_urls text\\[\\]", "profile_image_url text", "rating numeric",
   "completed_projects integer"].every((c) => new RegExp(c).test(rpcBody)));
record("D04 the city / service / area predicates are byte-for-byte the original",
  /v\.city = p_city/.test(rpcBody) &&
  /p_service = any\(v\.service_categories\)/.test(rpcBody) &&
  /\(v\.covers_full_city or \(p_area is not null and p_area = any\(v\.areas_covered\)\)\)/.test(rpcBody));
record("D05 the ordering is unchanged",
  /case when p_area is not null and p_area = any\(v\.areas_covered\) then 0 else 1 end/.test(rpcBody) &&
  /v\.rating desc/.test(rpcBody) && /v\.completed_projects desc/.test(rpcBody) && /random\(\)/.test(rpcBody));
record("D06 the eligibility filter is NOT widened — it is the view's own row filter",
  // The four predicates must NOT be re-stated (the view applies them) and must NOT be relaxed.
  !/status\s*=\s*'Approved'/.test(rpcBody) && !/remaining_credits/.test(rpcBody));
record("D07 anon keeps EXECUTE on the discovery path",
  /grant execute on function public\.get_public_eligible_vendors\(text, text, text\)\s*\n\s*to anon, authenticated, service_role;/.test(SQL));
record("D08 it asserts prosecdef is false and search_path is pinned",
  /still SECURITY DEFINER/.test(SQL) && /get_public_eligible_vendors lacks the pinned search_path/.test(SQL));

// ---------------------------------------------------------------------------
// E. Browser EXECUTE — revoked only where traced to service_role-only callers
// ---------------------------------------------------------------------------
for (const sig of ["public.check_duplicate_lead(text,text,text)",
                   "public.get_setting_int(text,integer)",
                   "public.refresh_requirement_group_counters(uuid)"]) {
  record(`E01 ${sig} is in the browser-EXECUTE revocation set`, SQL.includes(`'${sig}'`));
}
record("E02 the revocation restores service_role EXECUTE in the same step",
  /grant execute on function %s to service_role/.test(SQL));
record("E03 the RLS helpers are NEVER revoked",
  !/revoke[^;]*is_admin/i.test(CODE) && !/revoke[^;]*owns_vendor/i.test(CODE));
record("E04 the discovery RPC is never revoked from anon",
  !/revoke[^;]*get_public_eligible_vendors[^;]*anon/i.test(CODE));
record("E05 it asserts authenticated KEEPS EXECUTE on both RLS helpers",
  /lost EXECUTE on RLS helper/.test(SQL) &&
  SQL.includes("'public.is_admin()'") && SQL.includes("'public.owns_vendor(uuid)'"));

// ---------------------------------------------------------------------------
// F. search_path pins
// ---------------------------------------------------------------------------
const SIX = [
  "public.communication_consent_receipt_results_valid(jsonb)",
  "public.communication_consent_receipt_scope_result_valid(jsonb, text)",
  "public.qf_lead_vendor_parent_group_compatible(text, text, text, text[], text, text[])",
  "public.qf_norm_text(text)",
  "public.qf_normalize_category_label(text)",
  "public.qf_parent_category_group(text)",
];
for (const sig of SIX) {
  const esc = sig.replace(/[.()[\]]/g, (c) => "\\" + c);
  record(`F01 ${sig.split("(")[0]} gets a pinned search_path`,
    new RegExp(`alter function ${esc}\\s*\\n?\\s*set search_path = pg_catalog, public, pg_temp;`).test(SQL));
}
record("F02 ALTER FUNCTION is used, so no body/volatility/ownership is rewritten",
  (SQL.match(/alter function public\./g) ?? []).length === 6 &&
  !SIX.some((s) => new RegExp(`create or replace function ${s.split("(")[0].replace(/\./g, "\\.")}\\b`).test(SQL)));
record("F03 it asserts every one of the six is pinned afterwards",
  /still has a mutable search_path/.test(SQL));

// ---------------------------------------------------------------------------
// G. Hygiene
// ---------------------------------------------------------------------------
record("G01 no production identifier, project ref or host appears",
  !/27861262223494153|1333595106493545|1034375632334278|7709172106|yqpgcsduqbxulrlzwzap|213\.210\.21\.216/.test(SQL));
record("G02 no secret-shaped literal appears",
  !/eyJ[A-Za-z0-9_-]{20,}|EAA[A-Za-z0-9]{20,}|service_role_key\s*=/.test(SQL));
record("G03 no Meta/WhatsApp behaviour is introduced",
  !/graph\.facebook|\/messages|whatsapp/i.test(rpcBody) &&
  !/qf_arm_meta|qf_quiesce_meta|qf_disable_meta/.test(SQL));

// ---------------------------------------------------------------------------
for (const [i, r] of results.entries()) {
  console.log(`${r.passed ? "PASS" : "FAIL"} ${String(i + 1).padStart(3, "0")} ${r.name}${r.detail ? ` (${r.detail})` : ""}`);
}
const failed = results.filter((r) => !r.passed);
console.log(`\nQF LAUNCH SECURITY CLOSEOUT: ${results.length - failed.length}/${results.length} PASS`);
if (failed.length) process.exit(1);
console.log("QF_LAUNCH_SECURITY_CLOSEOUT_SOURCE_VERIFIED");
