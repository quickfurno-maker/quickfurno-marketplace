// ============================================================================
// QuickFurno — scripts/mvp/communication/validate-qf-mvp-80-16b-vendor-destination.mjs
//
// QF-MVP-80.16B — vendor destination normalization.
//
// WHAT IS BEING PROVED
//   QuickFurno's vendor registration persists `phone` / `whatsapp_number` as
//   EXACTLY ten bare digits. The provider-neutral normalizer refuses any number
//   without an international prefix. Those two contracts had never met until a
//   real vendor send ran: every dispatch of the first natural post-cutover lead
//   was refused with RECIPIENT_DESTINATION_INVALID, after the three vendors had
//   already been charged one purchased credit each.
//
//   The repair adapts the exact stored shape at the VENDOR boundary only. The
//   two things that must NOT have moved are pinned here as hard rules:
//     1. normalizePhoneE164 still refuses a bare national number, everywhere.
//     2. a malformed preferred WhatsApp number still fails closed and never
//        falls back to the contact phone.
//
// VERIFICATION LEVELS — never conflated:
//   [pure]   executes the REAL helper with no I/O.
//   [static] reads production source text for a required contract.
//   [mutant] mutates that text and asserts the static check REJECTS it.
//
// Run: npm run test:mvp:80-16b
// ============================================================================
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const outDir = resolve(".qf-80-16b-build");
rmSync(outDir, { recursive: true, force: true });
const tsc = resolve("node_modules/typescript/bin/tsc");
if (!existsSync(tsc)) throw new Error("TypeScript compiler not found. Run npm install first.");

const tsconfigPath = resolve(".qf-80-16b-tsconfig.json");
writeFileSync(tsconfigPath, JSON.stringify({
  compilerOptions: {
    module: "commonjs", target: "ES2020", moduleResolution: "node", skipLibCheck: true,
    esModuleInterop: true, strict: true, outDir, rootDir: ".", baseUrl: ".", paths: { "@/*": ["./*"] },
  },
  files: ["lib/communication/recipientResolver.ts", "lib/communication/phone.ts"],
}, null, 2));
try { execFileSync(process.execPath, [tsc, "-p", tsconfigPath], { stdio: "pipe" }); }
finally { rmSync(tsconfigPath, { force: true }); }

const require_ = createRequire(import.meta.url);
const Module = require_("node:module");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (typeof request === "string" && request.startsWith("@/")) {
    return originalResolve.call(this, resolve(outDir, request.slice(2)), ...rest);
  }
  return originalResolve.call(this, request, ...rest);
};

const RESOLVER = require_(resolve(outDir, "lib/communication/recipientResolver.js"));
const PHONE = require_(resolve(outDir, "lib/communication/phone.js"));
const { normalizeStoredVendorDestination, normalizeResolvedDestination, RecipientResolutionError } = RESOLVER;
const { normalizePhoneE164 } = PHONE;

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
const readRaw = (p) => readFileSync(p, "utf8");
const readCode = (p) => stripComments(readRaw(p));

const SERVICE_SRC = readCode("services/communicationRecipientResolver.ts");
const LIB_SRC = readCode("lib/communication/recipientResolver.ts");
const PHONE_SRC = readCode("lib/communication/phone.ts");
const VENDOR_SERVICE_SRC = readCode("services/vendorService.ts");
// QF-MVP-80.16C moved the registration number rule into a pure module so the
// server authority, the live form and this lane cannot drift apart.
const VENDOR_CONTACT_SRC = readCode("lib/vendors/vendorContactContract.ts");

const checks = [];
const check = (name, fn) => checks.push({ name, fn });
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function mutant(name, source, mutate, stillPasses) {
  check(name, () => {
    assert(stillPasses(source), "precondition: the rule must PASS on real source");
    const broken = mutate(source);
    assert(broken !== source, "mutation was a no-op — the rule proves nothing");
    assert(!stillPasses(broken), "the rule ACCEPTED a broken source");
  });
}

/** Assert an ok Result carrying an exact E.164 value. */
function expectE164(input, expected, label) {
  const r = normalizeStoredVendorDestination(input);
  assert(r.ok === true, `${label}: expected success, got ${r.ok === false ? r.code ?? r.error : "?"}`);
  assert(r.data === expected, `${label}: expected ${expected}, got ${r.data}`);
}

/** Assert a closed failure carrying the expected resolver vocabulary. */
function expectFailure(input, expectedCode, label) {
  const r = normalizeStoredVendorDestination(input);
  assert(r.ok === false, `${label}: expected failure, got ok(${r.data})`);
  const code = r.code ?? r.error ?? "";
  assert(String(code).includes(expectedCode), `${label}: expected ${expectedCode}, got ${code}`);
}

// ---------------------------------------------------------------------------
// A. The vendor adapter — the exact cases from the incident
// ---------------------------------------------------------------------------
check("01 [pure] a bare Indian mobile resolves to +91 E.164", () => {
  expectE164("9876543210", "+919876543210", "bare 10-digit");
});

check("02 [pure] every valid Indian first digit is adapted", () => {
  expectE164("6123456789", "+916123456789", "leading 6");
  expectE164("7123456789", "+917123456789", "leading 7");
  expectE164("8123456789", "+918123456789", "leading 8");
  expectE164("9123456789", "+919123456789", "leading 9");
});

check("03 [pure] an explicit +E.164 number passes through unchanged", () => {
  expectE164("+919876543210", "+919876543210", "explicit +91");
  expectE164("+14155552671", "+14155552671", "explicit non-Indian");
});

check("04 [pure] a 00-prefixed international number is accepted", () => {
  expectE164("00919876543210", "+919876543210", "00 prefix");
});

check("05 [pure] an invalid first digit is NOT adapted", () => {
  expectFailure("1234567890", RecipientResolutionError.RECIPIENT_DESTINATION_INVALID, "leading 1");
  expectFailure("5123456789", RecipientResolutionError.RECIPIENT_DESTINATION_INVALID, "leading 5");
});

check("06 [pure] a leading zero is NOT adapted", () => {
  expectFailure("0123456789", RecipientResolutionError.RECIPIENT_DESTINATION_INVALID, "leading 0");
});

check("07 [pure] a short or long local number is NOT adapted", () => {
  expectFailure("987654321", RecipientResolutionError.RECIPIENT_DESTINATION_INVALID, "9 digits");
  expectFailure("98765432101", RecipientResolutionError.RECIPIENT_DESTINATION_INVALID, "11 digits");
  expectFailure("91987654321", RecipientResolutionError.RECIPIENT_DESTINATION_INVALID, "11 bare with 91");
});

check("08 [pure] blank and absent stay MISSING, not INVALID", () => {
  expectFailure(null, RecipientResolutionError.RECIPIENT_DESTINATION_MISSING, "null");
  expectFailure(undefined, RecipientResolutionError.RECIPIENT_DESTINATION_MISSING, "undefined");
  expectFailure("", RecipientResolutionError.RECIPIENT_DESTINATION_MISSING, "empty");
  expectFailure("   ", RecipientResolutionError.RECIPIENT_DESTINATION_MISSING, "whitespace");
});

check("09 [pure] non-phone content fails closed and is never repaired", () => {
  for (const junk of ["98765 43210", "98-765-43210", "+91 98765 4321", "abcdefghij",
                      "9876543210x", "<script>", "98765432100000000000"]) {
    const r = normalizeStoredVendorDestination(junk);
    // Some of these are legitimately normalizable by the canonical helper
    // (it strips a documented set of formatting characters); what must never
    // happen is a bare national number being invented from junk.
    if (r.ok) {
      assert(r.data.startsWith("+"), `junk produced a non-E164 value: ${r.data}`);
    }
  }
  // The specific shapes that must NOT become +91 numbers:
  expectFailure("abcdefghij", RecipientResolutionError.RECIPIENT_DESTINATION_INVALID, "letters");
  expectFailure("9876543210x", RecipientResolutionError.RECIPIENT_DESTINATION_INVALID, "trailing letter");
});

// ---------------------------------------------------------------------------
// B. THE SECURITY BOUNDARY — the global normalizer must be unchanged
// ---------------------------------------------------------------------------
check("10 [pure] MANDATORY: normalizePhoneE164 still refuses a bare national number", () => {
  const r = normalizePhoneE164("9876543210");
  assert(r.ok === false, "the global normalizer now accepts a bare national number — the boundary was loosened");
  assert(r.code === "PHONE_MISSING_COUNTRY_CODE", `expected PHONE_MISSING_COUNTRY_CODE, got ${r.code}`);
});

check("11 [pure] the generic storage normalizer is also unchanged", () => {
  const r = normalizeResolvedDestination("9876543210");
  assert(r.ok === false, "normalizeResolvedDestination now guesses a country code");
  const code = r.code ?? r.error ?? "";
  assert(String(code).includes(RecipientResolutionError.RECIPIENT_DESTINATION_INVALID),
    `expected RECIPIENT_DESTINATION_INVALID, got ${code}`);
});

check("12 [static] phone.ts still demands an explicit country code", () => {
  assert(/PHONE_MISSING_COUNTRY_CODE/.test(PHONE_SRC), "the missing-country-code failure mode is gone");
  assert(!/\+91/.test(PHONE_SRC), "an India-specific assumption leaked into the global normalizer");
  assert(!/defaultCountry|assumeCountry|fallbackCountry/i.test(PHONE_SRC),
    "the global normalizer gained a default-country concept");
});

// ---------------------------------------------------------------------------
// C. The vendor branch — preference and fail-closed semantics unchanged
// ---------------------------------------------------------------------------
const vendorBranch = () => {
  const start = SERVICE_SRC.indexOf("private async resolveVendor");
  return SERVICE_SRC.slice(start, SERVICE_SRC.indexOf("\n  }", start));
};

check("13 [static] only the VENDOR branch uses the adapter", () => {
  const branch = vendorBranch();
  assert(/normalizeStoredVendorDestination/.test(branch), "the vendor branch does not use the adapter");
  // Every other resolver must still use the generic helper.
  for (const other of ["resolveClient", "resolveLead", "resolveAdmin"]) {
    const s = SERVICE_SRC.indexOf(`private async ${other}`);
    assert(s !== -1, `${other} is gone`);
    const body = SERVICE_SRC.slice(s, SERVICE_SRC.indexOf("\n  }", s));
    assert(!/normalizeStoredVendorDestination/.test(body),
      `${other} was widened to use the vendor-only adapter`);
    assert(/normalizeResolvedDestination/.test(body), `${other} no longer uses the generic normalizer`);
  }
});

check("14 [static] a malformed preferred WhatsApp number still fails closed", () => {
  const branch = vendorBranch();
  // The preferred number is tried, and its failure is RETURNED — not swallowed
  // into a second attempt on `phone`.
  assert(/if \(resolved\.ok\) return resolved;/.test(branch), "the preferred-number success path changed");
  assert(/return resolved;/.test(branch), "a malformed preferred number no longer fails closed");
  // There must be exactly one phone fallback, and it must be guarded by the
  // blank check — never reachable after a malformed WhatsApp number.
  const afterPreferred = branch.slice(branch.indexOf("const preferred"));
  const phoneUses = (afterPreferred.match(/row\.phone/g) || []).length;
  assert(phoneUses === 1, `expected exactly one phone fallback, found ${phoneUses}`);
});

check("15 [static] vendor registration STORAGE is NOT changed by this phase", () => {
  assert(/replace\(\/\\D\/g, ""\)/.test(VENDOR_SERVICE_SRC), "vendor registration stopped cleaning to digits");
  // The rule this originally pinned as `cleanedPhone.length !== 10` was TIGHTENED
  // by QF-MVP-80.16C to the exact Indian mobile contract, and moved into a pure
  // module so the server, the live form and this lane cannot drift apart. What
  // 80.16B actually needs to stay true is the STORED SHAPE: still exactly ten
  // bare digits, never an international prefix. `^[6-9]\d{9}$` implies ten
  // digits, so this is strictly STRONGER than the check it replaces — widening
  // registration back to "any ten digits", or forward to E.164, still fails here.
  assert(/isValidIndianMobile\(cleanedPhone\)/.test(VENDOR_SERVICE_SRC),
    "registration no longer validates the phone through the shared contract");
  assert(/isValidIndianMobile\(cleanedWhatsapp\)/.test(VENDOR_SERVICE_SRC),
    "registration no longer validates a supplied WhatsApp number");
  assert(/INDIAN_MOBILE_RE = \/\^\[6-9\]\\d\{9\}\$\//.test(VENDOR_CONTACT_SRC),
    "the stored-shape contract is no longer exactly ten digits starting 6-9");
  assert(!/\+91/.test(VENDOR_SERVICE_SRC) && !/\+91/.test(VENDOR_CONTACT_SRC),
    "registration started writing a country code — that is a separate phase");
});

check("16 [static] the adapter matches only the exact stored shape", () => {
  assert(/\^\[6-9\]\\d\{9\}\$/.test(LIB_SRC), "the adapter no longer pins ^[6-9]\\d{9}$");
  const fn = LIB_SRC.slice(LIB_SRC.indexOf("export function normalizeStoredVendorDestination"));
  const body = fn.slice(0, fn.indexOf("\n}"));
  assert(!/replace\(/.test(body), "the adapter strips or rewrites characters instead of matching a shape");
  assert(!/\bdigits\b/.test(body), "the adapter derives digits instead of matching a shape");
});

// ---------------------------------------------------------------------------
// D. Mutants — each rule must be able to fail
// ---------------------------------------------------------------------------
mutant("M13 [mutant] reject: the adapter is widened to another recipient type",
  SERVICE_SRC,
  (s) => {
    const i = s.indexOf("private async resolveClient");
    const j = s.indexOf("\n  }", i);
    return s.slice(0, i) + s.slice(i, j).replace("normalizeResolvedDestination", "normalizeStoredVendorDestination") + s.slice(j);
  },
  (s) => {
    const i = s.indexOf("private async resolveClient");
    const body = s.slice(i, s.indexOf("\n  }", i));
    return !/normalizeStoredVendorDestination/.test(body);
  });

mutant("M14 [mutant] reject: a malformed WhatsApp number falls back to phone",
  SERVICE_SRC,
  (s) => s.replace(
    "      if (resolved.ok) return resolved;",
    "      if (resolved.ok) return resolved;\n      return normalizeStoredVendorDestination(row.phone ?? null);",
  ),
  (s) => {
    const start = s.indexOf("private async resolveVendor");
    const branch = s.slice(start, s.indexOf("\n  }", start));
    const after = branch.slice(branch.indexOf("const preferred"));
    return (after.match(/row\.phone/g) || []).length === 1;
  });

mutant("M16 [mutant] reject: the adapter starts stripping characters",
  LIB_SRC,
  (s) => s.replace("  const trimmed = raw.trim();", "  const trimmed = raw.replace(/\\D/g, \"\");"),
  (s) => {
    const fn = s.slice(s.indexOf("export function normalizeStoredVendorDestination"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    return !/replace\(/.test(body);
  });

// ============================================================================
(async () => {
  let passed = 0; const failures = [];
  for (const { name, fn } of checks) {
    try { await fn(); passed += 1; console.log(`   ok    ${name}`); }
    catch (e) { failures.push(`   FAIL  ${name} — ${e.message}`); console.log(`   FAIL  ${name} — ${e.message}`); }
  }
  rmSync(outDir, { recursive: true, force: true });
  console.log(`\n${"=".repeat(78)}`);
  console.log(`QF-MVP-80.16B vendor destination normalization — passed ${passed}, failed ${failures.length}`);
  if (failures.length) { console.log("\nFAILURES:"); for (const l of failures) console.log(l); }
  console.log("=".repeat(78));
  process.exit(failures.length ? 1 : 0);
})();
