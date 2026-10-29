// ============================================================================
// VOX P0-1 — executable schema-contract test for the Owner overview endpoint.
//
// Verifies that the FOUR queries in app/api/vox/v1/overview/route.ts select,
// order and filter ONLY columns that exist in the verified managed Staging
// schema (fixtures/vox-overview-managed-schema.json). It pins the exact
// selected / ordered / filtered columns and limits for each of the four tables.
//
// It specifically asserts vendor_support_threads uses `priority` (which exists
// in the managed catalog) and NEVER `topic` (which does not). This is the test
// that fails if anyone applies the incorrect priority->topic change.
//
// Pure Node, no transpiler, no network, no credentials. Reads source as text.
// ============================================================================
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..", "..");
const read = (p) => readFileSync(resolve(ROOT, p), "utf8");
const schema = JSON.parse(read("scripts/mvp/vox/fixtures/vox-overview-managed-schema.json"));

const routeSrc = read("app/api/vox/v1/overview/route.ts");

let n = 0;
function test(name, fn) { fn(); n++; console.log("PASS " + name); }

// --- Parse the four db.from(...).select(...)[.eq(...)*][.order(...)].limit(N) chains
function parseQueries(src) {
  const chain = /db\.from\("([^"]+)"\)\s*\.select\("([^"]+)"\)([\s\S]*?)\.limit\((\d+)\)/g;
  const eqRe = /\.eq\("([^"]+)",\s*("[^"]*"|true|false|\d+)\)/g;
  const orderRe = /\.order\("([^"]+)",\s*\{\s*ascending:\s*(true|false)\s*\}\)/;
  const out = [];
  let m;
  while ((m = chain.exec(src)) !== null) {
    const [, table, selectCsv, middle, limit] = m;
    const filters = [];
    let e;
    while ((e = eqRe.exec(middle)) !== null) {
      let v = e[2];
      if (v === "true") v = true;
      else if (v === "false") v = false;
      else if (/^\d+$/.test(v)) v = Number(v);
      else v = v.slice(1, -1);
      filters.push({ column: e[1], value: v });
    }
    const om = orderRe.exec(middle);
    out.push({
      table,
      select: selectCsv.split(",").map((s) => s.trim()).filter(Boolean),
      order: om ? { column: om[1], ascending: om[2] === "true" } : null,
      filters,
      limit: Number(limit),
    });
  }
  return out;
}

const parsed = parseQueries(routeSrc);

test("exactly four Owner-overview queries are present", () => {
  assert.equal(parsed.length, 4, `expected 4 queries, parsed ${parsed.length}`);
});

test("every parsed query matches an expected query exactly (table/select/order/filters/limit)", () => {
  for (const expected of schema.expectedQueries) {
    const actual = parsed.find((q) => q.table === expected.table);
    assert.ok(actual, `missing query for table ${expected.table}`);
    assert.deepEqual(actual.select, expected.select, `${expected.table}: selected columns mismatch`);
    assert.deepEqual(actual.order, expected.order, `${expected.table}: order mismatch`);
    assert.deepEqual(actual.filters, expected.filters, `${expected.table}: filter mismatch`);
    assert.equal(actual.limit, expected.limit, `${expected.table}: limit mismatch`);
  }
});

test("no query selects, orders or filters a column absent from the managed schema", () => {
  for (const q of parsed) {
    const cols = schema.tables[q.table];
    assert.ok(cols, `table ${q.table} not in managed schema fixture`);
    for (const c of q.select) assert.ok(cols.includes(c), `${q.table}.${c} (select) not in managed schema`);
    if (q.order) assert.ok(cols.includes(q.order.column), `${q.table}.${q.order.column} (order) not in managed schema`);
    for (const f of q.filters) assert.ok(cols.includes(f.column), `${q.table}.${f.column} (filter) not in managed schema`);
  }
});

test("vendor_support_threads uses priority and never topic", () => {
  const support = parsed.find((q) => q.table === "vendor_support_threads");
  assert.ok(support, "vendor_support_threads query missing");
  assert.ok(support.select.includes("priority"), "support query must select priority");
  assert.ok(!support.select.includes("topic"), "support query must NOT select topic (topic does not exist in managed schema)");
  // belt-and-braces against the known-incorrect fix anywhere in the route file
  assert.doesNotMatch(routeSrc, /vendor_support_threads"\)\s*\.select\("[^"]*\btopic\b/, "route must not select topic on vendor_support_threads");
});

test("managed-schema mustExist / mustNotExist invariants hold", () => {
  for (const [table, must] of Object.entries(schema.mustExist)) {
    for (const col of must) assert.ok(schema.tables[table].includes(col), `${table}.${col} must exist in schema fixture`);
  }
  for (const [table, mustNot] of Object.entries(schema.mustNotExist)) {
    for (const col of mustNot) assert.ok(!schema.tables[table].includes(col), `${table}.${col} must NOT exist in schema fixture`);
  }
});

console.log("VOX_02B_SCHEMA_CONTRACT_PASS " + n + "/5");
