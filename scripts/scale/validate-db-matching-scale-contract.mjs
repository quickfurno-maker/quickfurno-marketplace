#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const failures = [];
const read = (path) => readFile(join(ROOT, path), "utf8");
function check(label, ok) {
  if (ok) console.log("PASS", label);
  else {
    console.error("FAIL", label);
    failures.push(label);
  }
}

const [
  matcher,
  prefilterService,
  category,
  migration,
  assignment,
  fairMigration,
] = await Promise.all([
  read("services/leadMatchingEngine.ts"),
  read("services/vendorMatchingPrefilterService.ts"),
  read("lib/vendors/categoryMatching.ts"),
  read("supabase/migrations/20261004190001_scale_phase08_matching_prefilter.sql"),
  read("supabase/migrations/20260815000000_qf_mvp_75_01_matchcore_binding_rank_order.sql"),
  read("supabase/migrations/20261002090000_vendor_fair_opportunity_group_reconcile.sql"),
]);

check(
  "matcher no longer owns a UUID-ordered vendor table scan",
  !/MAX_VENDOR_SCAN|VENDOR_PAGE_SIZE/.test(matcher) &&
    !/\.from\(["']vendors["']\)[\s\S]{0,160}\.order\(["']id["']/.test(matcher),
);
check(
  "normal matching path enters the Phase 08 database prefilter before canonical JS re-evaluation",
  /fetchVendorMatchPrefilterRows\(lead\)/.test(matcher) &&
    /rankVendorsForLead\([\s\S]{0,120}rows/.test(matcher),
);
check(
  "compatibility scan is isolated and explicitly bounded",
  /LEGACY_FALLBACK_MAX_SCAN = 5000/.test(prefilterService) &&
    /source: "legacy_fallback"/.test(prefilterService),
);
check(
  "normal database window is bounded to 512",
  /MATCHING_PREFILTER_LIMIT = 512/.test(prefilterService) &&
    /p_limit:\s*MATCHING_PREFILTER_LIMIT/.test(prefilterService),
);
check(
  "database failure never fabricates a successful prefilter",
  /PHASE08_PREFILTER_QUERY_FAILED/.test(prefilterService) &&
    /PHASE08_PREFILTER_QUERY_THREW/.test(prefilterService),
);
check(
  "database prefilter vocabulary derives from the canonical category taxonomy",
  /buildVendorMatchPrefilterTerms/.test(category) &&
    /CANONICAL_CATEGORY_GROUPS/.test(category) &&
    /PARENT_GROUP_DEFINITIONS/.test(category),
);
check(
  "generated category vocabulary is indexed with GIN",
  /matching_terms text\[\][\s\S]*generated always/i.test(migration) &&
    /idx_vendors_matching_terms_gin[\s\S]*using gin/i.test(migration),
);
check(
  "static automatic eligibility scope has a dedicated partial index",
  /idx_vendors_auto_match_scope/.test(migration) &&
    /remaining_credits, 0\) >= 1/i.test(migration) &&
    /accepting_leads is distinct from false/i.test(migration),
);
check(
  "existing PostGIS GiST geography remains a required prerequisite",
  /idx_vendors_geo_point_gist/.test(migration) &&
    /canonical vendor geography GiST index missing/i.test(migration),
);
check(
  "fairness recent-delivery lookup gets a measured partial covering index",
  /idx_vendor_opportunity_events_delivered_scope_recent/.test(migration) &&
    /where event_type = 'delivered'/i.test(migration),
);
check(
  "prefilter has a hard upper result budget and cannot become an unbounded endpoint",
  /least\(greatest\(coalesce\(p_limit, 512\), 20\), 2048\)/i.test(migration),
);
check(
  "prefilter is read-only security-invoker and service-role only",
  /returns table \(vendor jsonb\)[\s\S]*security invoker/i.test(migration) &&
    /revoke all on function public\.qf_match_vendor_prefilter_v1[\s\S]*service_role/i.test(migration) &&
    /grant execute on function public\.qf_match_vendor_prefilter_v1[\s\S]*to service_role/i.test(migration),
);
check(
  "prefilter migration contains an explicit mutation-authority self-check",
  /SCALE-P08 aborted: matching prefilter contains mutation\/assignment authority/.test(migration),
);
check(
  "canonical assignment still caps active assignments at three",
  /c_active_cap\s+constant integer := 3/.test(assignment),
);
check(
  "canonical assignment separates global lock order from caller rank business order",
  /LOCK PASS/.test(assignment) &&
    /order by u\.vid/.test(assignment) &&
    /BUSINESS PASS/.test(assignment) &&
    /with ordinality as u\(vid, ord\) order by u\.ord/.test(assignment),
);
check(
  "canonical credit cost remains one and debit is transactional",
  /c_credit_cost\s+constant integer := 1/.test(assignment) &&
    /qf_apply_credit_mutation_v2/.test(assignment),
);
check(
  "fair opportunity remains delivery-confirmed, not assignment-created popularity scoring",
  /provider-confirmed/i.test(fairMigration) &&
    !/rating[\s\S]{0,80}fair_share_balance/i.test(fairMigration),
);

if (failures.length) {
  console.error(`QuickFurno Phase 08 database/matching contract FAILED (${failures.length})`);
  process.exit(1);
}
console.log("QuickFurno Phase 08 database/matching contract PASS");
