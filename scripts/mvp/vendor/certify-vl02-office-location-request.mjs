// VL-02 office change authorization and no-direct-mutation certification.
// Uses actual transpiled service functions and fake in-memory database; no live secrets.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const source = fs.readFileSync(path.join(root, "services/vendorProfileChangeService.ts"), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const vendorId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
let rows = [];
let vendorWrites = [];
let verifiedCount = 0;
let verifyAllowed = true;
const vendor = { id: vendorId, city: "Pune", office_latitude: null, office_longitude: null, google_place_id: null, location_verification_status: "unverified" };
const candidate = {
  google_place_id: "ChIJValidSelectedGoogleOffice", google_city: "Pune",
  formatted_address: "Fixture Shop, Kharadi, Pune",
  latitude: 18.5511, longitude: 73.9422,
};
function query(table) {
  const filters = {};
  let writeRow = null;
  let inserting = false;
  return {
    select() { return this; },
    eq(key, value) { filters[key] = value; return this; },
    limit() { return this; },
    insert(value) { writeRow = value; inserting = true; return this; },
    update(value) { writeRow = value; return this; },
    order() { return this; },
    maybeSingle: async () => ({
      data: table === "vendors" ? vendor : rows.find((row) => Object.entries(filters).every(([k,v]) => row[k] === v)) ?? null,
      error: null,
    }),
    then(resolve, reject) {
      const matches = rows.filter((row) => Object.entries(filters).every(([k,v]) => row[k] === v));
      return Promise.resolve({ data: matches, error: null }).then(resolve, reject);
    },
    async single() {
      if (table === "vendor_profile_change_requests") {
        if (inserting) {
          const next = { id: "33333333-3333-4333-8333-333333333333", ...writeRow };
          rows.push(next);
          return { data: next, error: null };
        }
        const current = rows.find((row) => Object.entries(filters).every(([k,v]) => row[k] === v));
        if (!current) return { data: null, error: new Error("request not found") };
        Object.assign(current, writeRow);
        return { data: current, error: null };
      }
      throw Error("Unexpected single query");
    },
  };
}
const module = { exports: {} };
const mocks = {
  "../lib/supabase": { adminClient: () => ({
    from: (table) => { if (!["vendors", "vendor_profile_change_requests"].includes(table)) throw Error(table); return query(table); },
  }) },
  "../lib/errors": {
    appError: (code) => Object.assign(new Error(code), { code }),
    fail: (error) => ({ ok: false, code: error.code || "FAILED", error }),
    ok: (data) => ({ ok: true, data }),
  },
  "./vendorNotificationService": { createVendorNotification: async () => null },
  "./adminVendorLocationService": { backfillVendorExactLocation: async () => {
    verifiedCount++;
    if (!verifyAllowed) return { ok: false, code: "VALIDATION", error: Object.assign(new Error("VALIDATION"), { code: "VALIDATION" }) };
    vendorWrites.push("verified-office");
    return { ok: true, data: { vendorId } };
  } },
  "../lib/geo/canonicalCoordinate": {
    normalizeCoordinate: (a,b) => typeof a === "number" && typeof b === "number" && Number.isFinite(a) && Number.isFinite(b) && Math.abs(a) <= 90 && Math.abs(b) <= 180 ? { latitude:a, longitude:b } : null,
  },
};
new Function("module","exports","require",code)(module,module.exports,(key) => {
  if (!(key in mocks)) throw Error("Unexpected import "+key);
  return mocks[key];
});
const api = module.exports;
const check = (name, condition) => { assert.equal(condition,true,name); console.log("PASS",name); };
const created = await api.createVendorOfficeLocationChangeRequest(vendorId,actorId,candidate);
check("vendor Google request created pending",created.ok && created.data.request_type === "office_location_change" && created.data.status === "pending");
check("no Core business mutation during vendor request",vendorWrites.length === 0);
const replay = await api.createVendorOfficeLocationChangeRequest(vendorId,actorId,candidate);
check("same vendor pending request rejected",!replay.ok && rows.length === 1);
const malformed = await api.createVendorOfficeLocationChangeRequest(vendorId,actorId,{...candidate, google_place_id:"bad"});
check("malformed Place ID rejected",!malformed.ok && rows.length === 1);
const unapprovedRuntime = await api.approveVendorProfileChangeRequest(created.data.id,actorId);
check("office approval stays disabled before final certification", !unapprovedRuntime.ok && verifiedCount === 0 && rows[0].status === "pending");
process.env.QF_VENDOR_OFFICE_ATOMIC_APPROVAL_CERTIFIED = "1"; // disposable in-memory test only
verifyAllowed = false;
const failure = await api.approveVendorProfileChangeRequest(created.data.id,actorId);
check("Google verification failure cannot approve",!failure.ok && rows[0].status === "pending" && vendorWrites.length === 0);
verifyAllowed = true;
const success = await api.approveVendorProfileChangeRequest(created.data.id,actorId);
check("admin approval invokes Core verifier",success.ok && verifiedCount === 2 && vendorWrites.length === 1);
check("approved office request transitions once",rows[0].status === "approved" && rows[0].reviewed_by === actorId);
const double = await api.approveVendorProfileChangeRequest(created.data.id,actorId);
check("approved request cannot replay",!double.ok && vendorWrites.length === 1);
delete process.env.QF_VENDOR_OFFICE_ATOMIC_APPROVAL_CERTIFIED;
console.log("VL-02 vendor office request certification: 9/9 PASS");
