// ============================================================================
// QuickFurno — scripts/mvp/communication/validate-qf-mvp-50-8-lead-destination.mjs
//
// QF-MVP-50.8 — lead destination normalization parity.
//
// WHAT IS BEING PROVED
//   `public.leads.phone` is raw capture text with NO database CHECK constraint,
//   and before this phase its writer only required a non-empty string while the
//   provider-neutral normalizer — correctly — refuses a bare national number.
//   Six queued client jobs therefore pointed at a lead nobody could dial.
//
//   The repair is NOT "make the normalizer guess". It is:
//     1. write the lead-capture contract down once, purely;
//     2. enforce it server-side BEFORE the duplicate probe and the INSERT;
//     3. adapt only that exact accepted national shape, at the LEAD boundary.
//
//   The things that must NOT have moved are pinned here as hard rules:
//     * normalizePhoneE164 still refuses a bare national number, everywhere.
//     * normalizeResolvedDestination still refuses one too.
//     * the QF-MVP-80.16B vendor adapter is untouched and still separate.
//     * no adapter reaches client, admin, OTP or integration recipients.
//     * stored representation is unchanged, so check_duplicate_lead still
//       matches the same rows by exact equality.
//
// VERIFICATION LEVELS — never conflated:
//   [pure]   executes the REAL helper with no I/O.
//   [static] reads production source text for a required contract.
//   [mutant] mutates that text and asserts the static check REJECTS it.
//
// Run: npm run test:mvp:50-8
// ============================================================================
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const outDir = resolve(".qf-50-8-build");
rmSync(outDir, { recursive: true, force: true });
const tsc = resolve("node_modules/typescript/bin/tsc");
if (!existsSync(tsc)) throw new Error("TypeScript compiler not found. Run npm install first.");

const tsconfigPath = resolve(".qf-50-8-tsconfig.json");
writeFileSync(tsconfigPath, JSON.stringify({
  compilerOptions: {
    module: "commonjs", target: "ES2020", moduleResolution: "node", skipLibCheck: true,
    esModuleInterop: true, strict: true, outDir, rootDir: ".", baseUrl: ".", paths: { "@/*": ["./*"] },
  },
  files: [
    "lib/communication/recipientResolver.ts",
    "lib/communication/phone.ts",
    "lib/leads/leadContactContract.ts",
    "lib/leads/indianMobile.ts",
  ],
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
const CONTRACT = require_(resolve(outDir, "lib/leads/leadContactContract.js"));
const NATIONAL = require_(resolve(outDir, "lib/leads/indianMobile.js"));

const {
  normalizeStoredLeadDestination,
  normalizeStoredVendorDestination,
  normalizeResolvedDestination,
} = RESOLVER;
const { normalizePhoneE164 } = PHONE;
const { normalizeLeadContactForStorage, isAcceptedLeadContact } = CONTRACT;
const { isIndianLeadMobile, INDIAN_LEAD_MOBILE_RE } = NATIONAL;

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
const readRaw = (p) => readFileSync(p, "utf8");
const readCode = (p) => stripComments(readRaw(p));

const SERVICE_SRC = readCode("services/communicationRecipientResolver.ts");
const LIB_SRC = readCode("lib/communication/recipientResolver.ts");
const PHONE_SRC = readCode("lib/communication/phone.ts");
const CONTRACT_SRC = readCode("lib/leads/leadContactContract.ts");
const NATIONAL_SRC = readCode("lib/leads/indianMobile.ts");
const LEAD_SERVICE_SRC = readCode("services/leadService.ts");
// The LIVE public surfaces. `components/LeadForm.tsx` is currently referenced by
// no route, so the funnel and the homepage modal are the ones that actually
// gate real enquiries — all three are pinned so none can drift back.
const FUNNEL_SRC = readCode("components/LeadFunnel.tsx");
const MODAL_SRC = readCode("components/ClientEnquiryModal.tsx");
const LEADFORM_SRC = readCode("components/LeadForm.tsx");

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

/** Assert the LEAD adapter produced an exact E.164 value. */
function expectLeadE164(input, expected, label) {
  const r = normalizeStoredLeadDestination(input);
  assert(r.ok === true, `${label}: expected success, got ${r.ok === false ? r.code ?? r.error : "?"}`);
  assert(r.data === expected, `${label}: expected ${expected}, got ${r.data}`);
}

/** Assert the LEAD adapter failed closed with the expected resolver vocabulary. */
function expectLeadFailure(input, expectedCode, label) {
  const r = normalizeStoredLeadDestination(input);
  assert(r.ok === false, `${label}: expected failure, got ok(${r.data})`);
  const code = r.code ?? r.error ?? "";
  assert(String(code).includes(expectedCode), `${label}: expected ${expectedCode}, got ${code}`);
}

/** Extract a named function body from source text. */
function bodyOf(source, signature) {
  const start = source.indexOf(signature);
  assert(start !== -1, `could not find ${signature}`);
  const rest = source.slice(start);
  const end = rest.indexOf("\n}");
  assert(end !== -1, `could not delimit ${signature}`);
  return rest.slice(0, end);
}

// ---------------------------------------------------------------------------
// A. [pure] the lead adapter — the exact §9 behaviour matrix
// ---------------------------------------------------------------------------
check("01 [pure] a bare Indian lead mobile resolves to +91 E.164", () => {
  expectLeadE164("9876543210", "+919876543210", "bare 10-digit");
});

check("02 [pure] every valid Indian first digit (6-9) is adapted", () => {
  expectLeadE164("6123456789", "+916123456789", "leading 6");
  expectLeadE164("7123456789", "+917123456789", "leading 7");
  expectLeadE164("8123456789", "+918123456789", "leading 8");
  expectLeadE164("9123456789", "+919123456789", "leading 9");
});

check("03 [pure] an explicit +E.164 number passes through unchanged", () => {
  expectLeadE164("+919876543210", "+919876543210", "explicit +91");
  expectLeadE164("+14155552671", "+14155552671", "US number");
});

check("04 [pure] the 00 international prefix is honoured", () => {
  expectLeadE164("00919876543210", "+919876543210", "00 prefix");
});

check("05 [pure] leading digits 0-5 are NOT Indian mobiles and are never guessed", () => {
  for (const bad of ["0123456789", "1123456789", "2234567890", "3123456789", "4123456789", "5123456789"]) {
    expectLeadFailure(bad, "RECIPIENT_DESTINATION_INVALID", `leading ${bad[0]}`);
  }
});

check("06 [pure] 9-digit and 11-digit local numbers fail closed", () => {
  expectLeadFailure("987654321", "RECIPIENT_DESTINATION_INVALID", "9 digits");
  expectLeadFailure("98765432101", "RECIPIENT_DESTINATION_INVALID", "11 digits");
  expectLeadFailure("91987654321", "RECIPIENT_DESTINATION_INVALID", "bare 91-prefixed 11 digits");
});

check("07 [pure] blank / null / undefined stay MISSING, never INVALID", () => {
  expectLeadFailure(null, "RECIPIENT_DESTINATION_MISSING", "null");
  expectLeadFailure(undefined, "RECIPIENT_DESTINATION_MISSING", "undefined");
  expectLeadFailure("", "RECIPIENT_DESTINATION_MISSING", "empty");
  expectLeadFailure("    ", "RECIPIENT_DESTINATION_MISSING", "whitespace");
});

check("08 [pure] junk fails closed", () => {
  expectLeadFailure("abcdefghij", "RECIPIENT_DESTINATION_INVALID", "letters");
  expectLeadFailure("9876543210x", "RECIPIENT_DESTINATION_INVALID", "trailing letter");
  expectLeadFailure("+91abcdefghij", "RECIPIENT_DESTINATION_INVALID", "prefixed junk");
});

check("09 [pure] the GLOBAL normalizer still refuses a bare national number", () => {
  const r = normalizePhoneE164("9876543210");
  assert(r.ok === false, "normalizePhoneE164 accepted a bare national number");
  assert(r.code === "PHONE_MISSING_COUNTRY_CODE", `expected PHONE_MISSING_COUNTRY_CODE, got ${r.code}`);
  // and the other national shapes the lead adapter accepts stay rejected too
  for (const bare of ["6123456789", "7123456789", "8123456789", "9123456789"]) {
    assert(normalizePhoneE164(bare).ok === false, `normalizePhoneE164 accepted ${bare}`);
  }
});

check("10 [pure] normalizeResolvedDestination still refuses a bare national number", () => {
  const r = normalizeResolvedDestination("9876543210");
  assert(r.ok === false, "the generic resolver path accepted a bare national number");
  const code = r.code ?? r.error ?? "";
  assert(String(code).includes("RECIPIENT_DESTINATION_INVALID"), `got ${code}`);
});

check("11 [pure] the QF-MVP-80.16B vendor adapter behaviour is unchanged", () => {
  const v = normalizeStoredVendorDestination("9876543210");
  assert(v.ok === true && v.data === "+919876543210", "vendor adapter regressed on the stored shape");
  const bad = normalizeStoredVendorDestination("12345");
  assert(bad.ok === false, "vendor adapter stopped failing closed");
  const missing = normalizeStoredVendorDestination(null);
  assert(String(missing.code ?? missing.error).includes("RECIPIENT_DESTINATION_MISSING"), "vendor MISSING vocabulary moved");
});

check("12 [pure] a FORMATTED bare national number is NOT repaired into +91", () => {
  // The canonical normalizer strips safe formatting, but the value still has no
  // country code — so it must fail, not become +919876543210.
  expectLeadFailure("98765 43210", "RECIPIENT_DESTINATION_INVALID", "spaced national");
  expectLeadFailure("98-765-43210", "RECIPIENT_DESTINATION_INVALID", "hyphenated national");
});

check("13 [pure] FORMATTED international input still passes via the canonical normalizer", () => {
  expectLeadE164("+91 98765 43210", "+919876543210", "spaced +91");
  expectLeadE164("+1 (415) 555-2671", "+14155552671", "formatted US");
});

check("14 [pure] a surrounding-whitespace national number is trimmed then adapted", () => {
  expectLeadE164("  9876543210  ", "+919876543210", "padded national");
});

// ---------------------------------------------------------------------------
// B. [pure] the lead CAPTURE contract
// ---------------------------------------------------------------------------
check("15 [pure] the capture contract accepts exactly the two documented forms", () => {
  const national = normalizeLeadContactForStorage("9876543210");
  assert(national.ok === true && national.shape === "indian_national", "national form rejected");
  const intl = normalizeLeadContactForStorage("+14155552671");
  assert(intl.ok === true && intl.shape === "international", "international form rejected");
});

check("16 [pure] the capture contract PRESERVES the stored representation", () => {
  // This is what keeps check_duplicate_lead's exact-equality match intact.
  assert(normalizeLeadContactForStorage("9876543210").storage === "9876543210", "national storage rewritten");
  assert(normalizeLeadContactForStorage("+919876543210").storage === "+919876543210", "international storage rewritten");
  assert(normalizeLeadContactForStorage("  9876543210 ").storage === "9876543210", "storage not trimmed");
  // Explicitly NOT canonicalised to E.164:
  assert(normalizeLeadContactForStorage("9876543210").storage !== "+919876543210",
    "capture contract canonicalised storage — this silently changes duplicate detection");
});

check("17 [pure] the capture contract rejects everything else", () => {
  for (const bad of ["", "   ", "0123456789", "1123456789", "5123456789", "987654321",
                     "98765432101", "91987654321", "abcdefghij", "9876543210x",
                     "98765 43210", "98-765-43210", null, undefined, 9876543210, {}]) {
    const r = normalizeLeadContactForStorage(bad);
    assert(r.ok === false, `capture contract accepted ${JSON.stringify(bad)}`);
  }
  assert(normalizeLeadContactForStorage("").code === "LEAD_CONTACT_EMPTY", "blank code moved");
  assert(normalizeLeadContactForStorage(null).code === "LEAD_CONTACT_EMPTY", "null code moved");
  assert(normalizeLeadContactForStorage("0123456789").code === "LEAD_CONTACT_NOT_ACCEPTED", "invalid code moved");
});

check("18 [pure] isAcceptedLeadContact agrees with the contract it wraps", () => {
  for (const v of ["9876543210", "+14155552671", "0123456789", "", null, "98765 43210"]) {
    assert(isAcceptedLeadContact(v) === normalizeLeadContactForStorage(v).ok, `wrapper disagreed on ${v}`);
  }
});

check("19 [pure] the browser-safe national predicate matches the shared regex", () => {
  assert(isIndianLeadMobile("9876543210") === true, "national rejected");
  assert(isIndianLeadMobile("0123456789") === false, "leading zero accepted");
  assert(isIndianLeadMobile("98765 43210") === false, "formatted accepted");
  assert(isIndianLeadMobile(9876543210) === false, "non-string accepted");
  assert(String(INDIAN_LEAD_MOBILE_RE) === String(/^[6-9]\d{9}$/), "the shared national shape moved");
});

check("20 [pure] the UI predicate and the server contract agree on the national branch", () => {
  for (const v of ["6123456789", "7123456789", "8123456789", "9123456789",
                   "0123456789", "5123456789", "987654321", "98765432101"]) {
    const uiSaysValid = isIndianLeadMobile(v);
    const serverAcceptsAsNational = normalizeLeadContactForStorage(v).shape === "indian_national";
    assert(uiSaysValid === serverAcceptsAsNational, `UI and server disagree on ${v}`);
  }
});

// ---------------------------------------------------------------------------
// C. [static] resolver branch mapping — one adapter per recipient type
// ---------------------------------------------------------------------------
/**
 * Extract ONE class method body. A method closes at `\n  }` (two-space indent);
 * `bodyOf`'s `\n}` delimiter is for top-level functions and would run past the
 * end of a method and swallow its siblings — which would silently turn every
 * per-branch assertion below into a whole-class grep that proves nothing.
 */
function methodBody(source, signature) {
  const start = source.indexOf(signature);
  assert(start !== -1, `could not find ${signature}`);
  const end = source.indexOf("\n  }", start);
  assert(end !== -1, `could not delimit ${signature}`);
  return source.slice(start, end);
}

const resolveLeadBody = (s) => methodBody(s, "private async resolveLead");
const resolveVendorBody = (s) => methodBody(s, "private async resolveVendor");
const resolveClientBody = (s) => methodBody(s, "private async resolveClient");
const resolveAdminBody = (s) => methodBody(s, "private async resolveAdmin");

check("20b [static] the method extractor really isolates ONE branch", () => {
  // Guards the harness itself: if this ever captures a sibling method again,
  // every "branch X does not use adapter Y" assertion below becomes vacuous.
  const lead = resolveLeadBody(SERVICE_SRC);
  assert(!/private async resolveClient|private async resolveVendor|private async resolveAdmin/.test(lead),
    "the lead branch extractor swallowed a sibling method");
  const client = resolveClientBody(SERVICE_SRC);
  assert(!/private async resolveVendor|private async resolveAdmin/.test(client),
    "the client branch extractor swallowed a sibling method");
});

check("21 [static] resolveLead uses the LEAD adapter", () => {
  assert(/normalizeStoredLeadDestination\(/.test(resolveLeadBody(SERVICE_SRC)), "resolveLead does not use the lead adapter");
});

check("22 [static] resolveVendor still uses the VENDOR adapter and not the lead one", () => {
  const body = resolveVendorBody(SERVICE_SRC);
  assert(/normalizeStoredVendorDestination\(/.test(body), "resolveVendor lost the vendor adapter");
  assert(!/normalizeStoredLeadDestination/.test(body), "resolveVendor uses the LEAD adapter");
});

check("23 [static] resolveClient and resolveAdmin stay on the generic normalizer", () => {
  for (const [label, body] of [["client", resolveClientBody(SERVICE_SRC)], ["admin", resolveAdminBody(SERVICE_SRC)]]) {
    assert(/normalizeResolvedDestination\(/.test(body), `resolve${label} lost the generic normalizer`);
    assert(!/normalizeStoredLeadDestination/.test(body), `resolve${label} uses the LEAD adapter`);
    assert(!/normalizeStoredVendorDestination/.test(body), `resolve${label} uses the VENDOR adapter`);
  }
});

check("24 [static] exactly ONE call site of the lead adapter exists in the service", () => {
  assert((SERVICE_SRC.match(/normalizeStoredLeadDestination\(/g) || []).length === 1,
    "the lead adapter is called more than once in the resolver service");
});

check("25 [static] no other production module calls the lead adapter", () => {
  // Only the definition, the resolver service and this lane may mention it.
  const { execFileSync: run } = require_("node:child_process");
  let hits = "";
  try {
    hits = run("git", ["grep", "-l", "normalizeStoredLeadDestination", "--", "*.ts", "*.tsx"], { encoding: "utf8" });
  } catch { hits = ""; }
  const files = hits.split("\n").map((f) => f.trim()).filter(Boolean).sort();
  assert(
    files.join(",") === "lib/communication/recipientResolver.ts,services/communicationRecipientResolver.ts",
    `the lead adapter leaked outside its boundary: ${files.join(", ") || "(none found)"}`,
  );
});

check("26 [static] the two adapters remain separate named functions", () => {
  assert(/export function normalizeStoredLeadDestination\(/.test(LIB_SRC), "lead adapter missing");
  assert(/export function normalizeStoredVendorDestination\(/.test(LIB_SRC), "vendor adapter missing");
});

// ---------------------------------------------------------------------------
// D. [static] the adapter and contract never guess or repair
// ---------------------------------------------------------------------------
check("27 [static] the lead adapter matches the exact national shape only", () => {
  const body = bodyOf(LIB_SRC, "export function normalizeStoredLeadDestination");
  assert(/INDIAN_LEAD_MOBILE_RE\.test\(/.test(body), "lead adapter does not test the shared national shape");
  assert(/`\+91\$\{trimmed\}`/.test(body), "lead adapter no longer prefixes +91 to the exact trimmed value");
});

check("28 [static] the lead adapter does not strip or repair characters", () => {
  const body = bodyOf(LIB_SRC, "export function normalizeStoredLeadDestination");
  assert(!/replace\(/.test(body), "lead adapter strips characters");
  assert(!/\\D/.test(body), "lead adapter uses a non-digit class to repair input");
});

check("29 [static] the capture contract does not strip or repair characters", () => {
  const body = bodyOf(CONTRACT_SRC, "export function normalizeLeadContactForStorage");
  assert(!/replace\(/.test(body), "capture contract strips characters");
  assert(!/\\D/.test(body), "capture contract repairs input to digits");
  assert(/normalizePhoneE164\(/.test(body), "capture contract stopped delegating the international branch");
});

check("30 [static] the shared national shape has exactly ONE definition", () => {
  assert(/export const INDIAN_LEAD_MOBILE_RE = \/\^\[6-9\]\\d\{9\}\$\/;/.test(NATIONAL_SRC),
    "the national shape definition moved or changed");
  // The contract re-exports it rather than re-declaring it.
  assert(!/const INDIAN_LEAD_MOBILE_RE\s*=\s*\//.test(CONTRACT_SRC),
    "the contract re-declares the national shape instead of importing it");
  assert(!/\/\^\[6-9\]\\d\{9\}\$\//.test(FUNNEL_SRC), "LeadFunnel re-declares the national shape");
  assert(!/\/\^\[6-9\]\\d\{9\}\$\//.test(MODAL_SRC), "ClientEnquiryModal re-declares the national shape");
  assert(!/\/\^\[6-9\]\\d\{9\}\$\//.test(LEADFORM_SRC), "LeadForm re-declares the national shape");
});

check("31 [static] the browser-safe module stays dependency-free", () => {
  assert(!/^\s*import\s/m.test(NATIONAL_SRC),
    "lib/leads/indianMobile.ts gained an import — it must stay safe for the client bundle");
});

// ---------------------------------------------------------------------------
// E. [static] the global normalizer is frozen
// ---------------------------------------------------------------------------
check("32 [static] no +91, default country or India mode leaked into phone.ts", () => {
  assert(!/\+91/.test(PHONE_SRC), "a +91 literal appeared in the canonical normalizer");
  assert(!/defaultCountry|default_country|defaultRegion|countryCode\s*=/i.test(PHONE_SRC),
    "a default-country concept appeared in the canonical normalizer");
  assert(!/INDIA|indiaMode/i.test(PHONE_SRC), "an India mode appeared in the canonical normalizer");
});

check("33 [static] normalizePhoneE164 still takes exactly one argument", () => {
  assert(/export function normalizePhoneE164\(raw: string \| null \| undefined\): PhoneNormalization/.test(PHONE_SRC),
    "normalizePhoneE164's signature changed — an optional country argument is a country guess");
});

check("34 [static] the MISSING_COUNTRY_CODE branch is still present and unconditional", () => {
  assert(/return \{ ok: false, code: "PHONE_MISSING_COUNTRY_CODE" \};/.test(PHONE_SRC),
    "the missing-country-code refusal moved");
});

check("35 [static] no recipient-wide default-country concept exists in the resolver", () => {
  assert(!/defaultCountry|default_country|DEFAULT_COUNTRY/i.test(LIB_SRC),
    "a recipient-wide default country appeared");
  assert(!/defaultCountry|default_country|DEFAULT_COUNTRY/i.test(SERVICE_SRC),
    "a recipient-wide default country appeared in the service");
});

// ---------------------------------------------------------------------------
// F. [static] the server capture authority
// ---------------------------------------------------------------------------
check("36 [static] leadService validates BEFORE the duplicate RPC and BEFORE the insert", () => {
  const validateAt = LEAD_SERVICE_SRC.indexOf("normalizeLeadContactForStorage(");
  const dupAt = LEAD_SERVICE_SRC.indexOf('rpc("check_duplicate_lead"');
  const insertAt = LEAD_SERVICE_SRC.indexOf('from("leads").insert(');
  assert(validateAt !== -1, "leadService does not validate the lead contact at all");
  assert(dupAt !== -1, "could not find the duplicate RPC call");
  assert(insertAt !== -1, "could not find the leads insert");
  assert(validateAt < dupAt, "validation happens AFTER the duplicate probe");
  assert(validateAt < insertAt, "validation happens AFTER the insert");
});

check("37 [static] leadService refuses an unaccepted contact", () => {
  assert(/if \(!contact\.ok\) throw appError\("VALIDATION"\);/.test(LEAD_SERVICE_SRC),
    "leadService does not refuse an unaccepted lead contact");
});

check("38 [static] the validated value is the one stored and de-duplicated on", () => {
  assert(/p_phone: storedPhone,/.test(LEAD_SERVICE_SRC), "the duplicate probe does not use the validated value");
  assert(/phone: storedPhone,/.test(LEAD_SERVICE_SRC), "the insert payload does not use the validated value");
});

check("39 [static] leadService never logs a raw phone value", () => {
  const logs = LEAD_SERVICE_SRC.match(/console\.(info|log|warn|error)\([\s\S]*?\);/g) || [];
  for (const block of logs) {
    assert(!/\bphone\b(?!_)/.test(block) || /has_phone|phone:\s*Boolean/.test(block),
      `a lead log block may carry a raw phone: ${block.slice(0, 80)}`);
  }
});

check("40 [static] no migration was added by QF-MVP-50.8", () => {
  const { execFileSync: run } = require_("node:child_process");
  let out = "";
  try {
    out = run("git", ["diff", "--name-only", "9f932aa5f984d7a6ddb47ec18e2917213e226043", "--", "supabase/migrations"], { encoding: "utf8" });
  } catch { out = ""; }
  assert(out.trim() === "", `QF-MVP-50.8 must add no migration, but touched: ${out.trim()}`);
});

check("41 [static] QF-MVP-50.8 adds no provider, send or Meta call", () => {
  for (const [label, src] of [["lib resolver", LIB_SRC], ["service resolver", SERVICE_SRC],
                              ["contract", CONTRACT_SRC], ["national", NATIONAL_SRC]]) {
    assert(!/graph\.facebook\.com|sendMessage\(|dispatchMessage\(|providerSend|fetch\(/i.test(src),
      `${label} gained a provider/send/network call`);
  }
});

// ---------------------------------------------------------------------------
// G. [static] the live public surfaces share the contract
// ---------------------------------------------------------------------------
check("42 [static] the LIVE enquiry surfaces import the shared national predicate", () => {
  for (const [label, src] of [["LeadFunnel", FUNNEL_SRC], ["ClientEnquiryModal", MODAL_SRC], ["LeadForm", LEADFORM_SRC]]) {
    assert(/from "@\/lib\/leads\/indianMobile"/.test(src), `${label} does not import the shared contract`);
    assert(/isIndianLeadMobile\(/.test(src), `${label} does not call the shared predicate`);
  }
});

check("43 [static] no enquiry surface keeps the old digit-count rule", () => {
  for (const [label, src] of [["LeadFunnel", FUNNEL_SRC], ["ClientEnquiryModal", MODAL_SRC], ["LeadForm", LEADFORM_SRC]]) {
    assert(!/replace\(\/\\D\/g, ""\)\.length\s*[<>=]/.test(src),
      `${label} still validates by counting digits after stripping characters`);
  }
});

check("44 [static] the client bundle never reaches phone.ts through the forms", () => {
  for (const [label, src] of [["LeadFunnel", FUNNEL_SRC], ["ClientEnquiryModal", MODAL_SRC], ["LeadForm", LEADFORM_SRC]]) {
    assert(!/leadContactContract|communication\/phone/.test(src),
      `${label} imports a module that pulls Node's crypto into the browser bundle`);
  }
});

// ---------------------------------------------------------------------------
// H. [mutant] every rule above must REJECT a broken source
// ---------------------------------------------------------------------------
mutant("M01 [mutant] reject: the lead adapter widens to any ten digits",
  LIB_SRC,
  (s) => s.replace("  if (INDIAN_LEAD_MOBILE_RE.test(trimmed)) {\n    return normalizeResolvedDestination(`+91${trimmed}`);\n  }\n  return normalizeResolvedDestination(trimmed);\n}\n",
                   "  if (/^\\d{10}$/.test(trimmed)) {\n    return normalizeResolvedDestination(`+91${trimmed}`);\n  }\n  return normalizeResolvedDestination(trimmed);\n}\n"),
  (s) => /INDIAN_LEAD_MOBILE_RE\.test\(/.test(bodyOf(s, "export function normalizeStoredLeadDestination")));

mutant("M02 [mutant] reject: the lead adapter strips non-digits before matching",
  LIB_SRC,
  (s) => {
    const body = bodyOf(s, "export function normalizeStoredLeadDestination");
    return s.replace(body, body.replace("const trimmed = raw.trim();", 'const trimmed = raw.replace(/\\D/g, "");'));
  },
  (s) => !/replace\(/.test(bodyOf(s, "export function normalizeStoredLeadDestination")));

mutant("M03 [mutant] reject: the global normalizer accepts a bare national number",
  PHONE_SRC,
  (s) => s.replace('return { ok: false, code: "PHONE_MISSING_COUNTRY_CODE" };', "digits = `91${stripped}`;"),
  (s) => /return \{ ok: false, code: "PHONE_MISSING_COUNTRY_CODE" \};/.test(s));

mutant("M04 [mutant] reject: a +91 literal appears in the canonical normalizer",
  PHONE_SRC,
  (s) => s.replace("export const E164_MIN_DIGITS = 8;", 'const DEFAULT_PREFIX = "+91";\nexport const E164_MIN_DIGITS = 8;'),
  (s) => !/\+91/.test(s));

mutant("M05 [mutant] reject: normalizePhoneE164 gains an optional country argument",
  PHONE_SRC,
  (s) => s.replace("export function normalizePhoneE164(raw: string | null | undefined): PhoneNormalization",
                   "export function normalizePhoneE164(raw: string | null | undefined, defaultCountry?: string): PhoneNormalization"),
  (s) => /export function normalizePhoneE164\(raw: string \| null \| undefined\): PhoneNormalization/.test(s));

mutant("M06 [mutant] reject: the CLIENT branch uses the lead adapter",
  SERVICE_SRC,
  (s) => {
    const body = resolveClientBody(s);
    return s.replace(body, body.replace("normalizeResolvedDestination(", "normalizeStoredLeadDestination("));
  },
  (s) => !/normalizeStoredLeadDestination/.test(resolveClientBody(s)));

mutant("M07 [mutant] reject: the ADMIN branch uses the lead adapter",
  SERVICE_SRC,
  (s) => {
    const body = resolveAdminBody(s);
    return s.replace(body, body.replace("normalizeResolvedDestination(", "normalizeStoredLeadDestination("));
  },
  (s) => !/normalizeStoredLeadDestination/.test(resolveAdminBody(s)));

mutant("M08 [mutant] reject: the VENDOR branch is switched to the lead adapter",
  SERVICE_SRC,
  (s) => {
    const body = resolveVendorBody(s);
    return s.replace(body, body.replace(/normalizeStoredVendorDestination\(/g, "normalizeStoredLeadDestination("));
  },
  (s) => {
    const body = resolveVendorBody(s);
    return /normalizeStoredVendorDestination\(/.test(body) && !/normalizeStoredLeadDestination/.test(body);
  });

mutant("M09 [mutant] reject: resolveLead reverts to the generic normalizer",
  SERVICE_SRC,
  (s) => {
    const body = resolveLeadBody(s);
    return s.replace(body, body.replace("normalizeStoredLeadDestination(", "normalizeResolvedDestination("));
  },
  (s) => /normalizeStoredLeadDestination\(/.test(resolveLeadBody(s)));

mutant("M10 [mutant] reject: server validation is removed entirely",
  LEAD_SERVICE_SRC,
  (s) => s.replace('    const contact = normalizeLeadContactForStorage(phone);\n    if (!contact.ok) throw appError("VALIDATION");\n', ""),
  (s) => s.indexOf("normalizeLeadContactForStorage(") !== -1
      && /if \(!contact\.ok\) throw appError\("VALIDATION"\);/.test(s));

mutant("M11 [mutant] reject: server validation moves AFTER the duplicate probe",
  LEAD_SERVICE_SRC,
  (s) => {
    const block = '    const contact = normalizeLeadContactForStorage(phone);\n    if (!contact.ok) throw appError("VALIDATION");\n    const storedPhone = contact.storage;\n';
    const moved = s.replace(block, "");
    return moved.replace("    const isDuplicate = Boolean(dupId);", block + "    const isDuplicate = Boolean(dupId);");
  },
  (s) => s.indexOf("normalizeLeadContactForStorage(") < s.indexOf('rpc("check_duplicate_lead"'));

mutant("M12 [mutant] reject: the capture contract accepts a leading zero",
  CONTRACT_SRC,
  (s) => s.replace("if (INDIAN_LEAD_MOBILE_RE.test(trimmed)) {", "if (/^\\d{10}$/.test(trimmed)) {"),
  (s) => /INDIAN_LEAD_MOBILE_RE\.test\(trimmed\)/.test(bodyOf(s, "export function normalizeLeadContactForStorage")));

mutant("M13 [mutant] reject: the capture contract canonicalises storage to E.164",
  CONTRACT_SRC,
  (s) => s.replace('return { ok: true, shape: "indian_national", storage: trimmed };',
                   'return { ok: true, shape: "indian_national", storage: `+91${trimmed}` };'),
  (s) => /return \{ ok: true, shape: "indian_national", storage: trimmed \};/.test(s));

mutant("M14 [mutant] reject: the capture contract repairs input to digits",
  CONTRACT_SRC,
  (s) => {
    const body = bodyOf(s, "export function normalizeLeadContactForStorage");
    return s.replace(body, body.replace("const trimmed = raw.trim();", 'const trimmed = raw.replace(/\\D/g, "");'));
  },
  (s) => !/replace\(/.test(bodyOf(s, "export function normalizeLeadContactForStorage")));

mutant("M15 [mutant] reject: the UI regex drifts away from the shared contract",
  FUNNEL_SRC,
  (s) => s.replace("  return isIndianLeadMobile(digits);", "  return /^[6-9]\\d{9}$/.test(digits);"),
  (s) => /isIndianLeadMobile\(/.test(s) && !/\/\^\[6-9\]\\d\{9\}\$\//.test(s));

mutant("M16 [mutant] reject: the modal reverts to a locally declared regex",
  MODAL_SRC,
  (s) => s.replace("  return isIndianLeadMobile(digits);", "  return /^[6-9]\\d{9}$/.test(digits);"),
  (s) => /isIndianLeadMobile\(/.test(s) && !/\/\^\[6-9\]\\d\{9\}\$\//.test(s));

mutant("M17 [mutant] reject: the browser-safe module gains an import",
  NATIONAL_SRC,
  (s) => s.replace("export const INDIAN_LEAD_MOBILE_RE",
                   'import { normalizePhoneE164 } from "../communication/phone";\nexport const INDIAN_LEAD_MOBILE_RE'),
  (s) => !/^\s*import\s/m.test(s));

mutant("M18 [mutant] reject: a default-country concept enters the resolver",
  LIB_SRC,
  (s) => s.replace("const STORED_INDIAN_MOBILE =", 'const DEFAULT_COUNTRY = "+91";\nconst STORED_INDIAN_MOBILE ='),
  (s) => !/defaultCountry|DEFAULT_COUNTRY/i.test(s));

mutant("M19 [mutant] reject: the vendor adapter's fail-closed WhatsApp rule is weakened",
  SERVICE_SRC,
  (s) => s.replace("      if (resolved.ok) return resolved;\n", "      if (resolved.ok) return resolved;\n      return normalizeStoredVendorDestination(row.phone ?? null);\n"),
  (s) => {
    const body = resolveVendorBody(s);
    const after = body.slice(body.indexOf("const preferred"));
    return (after.match(/row\.phone/g) || []).length === 1;
  });

mutant("M20 [mutant] reject: the lead adapter accepts an 11-digit 91-prefixed number",
  LIB_SRC,
  (s) => s.replace("  if (INDIAN_LEAD_MOBILE_RE.test(trimmed)) {\n    return normalizeResolvedDestination(`+91${trimmed}`);",
                   "  if (/^91[6-9]\\d{9}$/.test(trimmed)) {\n    return normalizeResolvedDestination(`+${trimmed}`);"),
  (s) => /INDIAN_LEAD_MOBILE_RE\.test\(trimmed\)/.test(bodyOf(s, "export function normalizeStoredLeadDestination")));

mutant("M21 [mutant] reject: a provider send call is added to the resolver",
  LIB_SRC,
  (s) => s.replace("export function normalizeStoredLeadDestination",
                   "export async function providerSend(to: string) { return fetch(`https://graph.facebook.com/v20.0/${to}`); }\nexport function normalizeStoredLeadDestination"),
  (s) => !/graph\.facebook\.com|providerSend|fetch\(/i.test(s));

// ============================================================================
(async () => {
  let passed = 0; const failures = [];
  for (const { name, fn } of checks) {
    try { await fn(); passed += 1; console.log(`   ok    ${name}`); }
    catch (e) { failures.push(`   FAIL  ${name} — ${e.message}`); console.log(`   FAIL  ${name} — ${e.message}`); }
  }
  rmSync(outDir, { recursive: true, force: true });
  console.log(`\n${"=".repeat(78)}`);
  console.log(`QF-MVP-50.8 lead destination normalization parity — passed ${passed}, failed ${failures.length}`);
  if (failures.length) { console.log("\nFAILURES:"); for (const l of failures) console.log(l); }
  console.log("=".repeat(78));
  process.exit(failures.length ? 1 : 0);
})();
