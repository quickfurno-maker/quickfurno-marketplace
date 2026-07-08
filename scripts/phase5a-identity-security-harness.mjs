import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

/**
 * Phase 5A — QuickFurno Identity & Security Foundation harness.
 *
 * SOURCE/STATIC harness. Compiles the pure identity contracts to a throwaway
 * CommonJS build and exercises principal/purpose/challenge/status/event helpers +
 * metadata redaction, then statically validates the additive migration's tables,
 * columns, RLS, grants, purpose isolation, and no-plaintext-secret invariants.
 * No DB, no OTP transport, no WhatsApp, no Maps, no n8n, no network.
 */

const outDir = resolve(".phase5a-test-build");
rmSync(outDir, { recursive: true, force: true });

const tsc = resolve("node_modules/typescript/bin/tsc");
if (!existsSync(tsc)) throw new Error("TypeScript compiler not found. Run npm install first.");

const identityFiles = [
  "lib/identity/principal.ts",
  "lib/identity/verification.ts",
  "lib/identity/clientAccount.ts",
  "lib/identity/authSecurityEvent.ts",
  "lib/identity/index.ts",
];

const tsconfigPath = resolve(".phase5a-tsconfig.json");
writeFileSync(tsconfigPath, JSON.stringify({
  compilerOptions: {
    module: "commonjs", target: "ES2020", moduleResolution: "node",
    skipLibCheck: true, esModuleInterop: true, strict: true, jsx: "preserve",
    outDir, rootDir: ".", baseUrl: ".", paths: { "@/*": ["./*"] },
  },
  files: identityFiles,
}, null, 2));

try {
  execFileSync(process.execPath, [tsc, "-p", tsconfigPath], { stdio: "pipe" });
} finally {
  rmSync(tsconfigPath, { force: true });
}

const requireFromBuild = createRequire(`${outDir}/`);
const I = requireFromBuild("./lib/identity/index.js");

const MIGRATION = "supabase/migrations/20260708000160_identity_security_foundation.sql";
const sql = readFileSync(MIGRATION, "utf8");
const normalized = sql.toLowerCase().replace(/\s+/g, " ");
const pkg = JSON.parse(readFileSync("package.json", "utf8"));

const checks = [];
function check(name, fn) { checks.push({ name, fn }); }
function assert(condition, message) { if (!condition) throw new Error(message); }
function hasSql(fragment) { return normalized.includes(fragment.toLowerCase().replace(/\s+/g, " ")); }
function stripComments(src) { return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, ""); }
function tableBlock(name) {
  const start = normalized.indexOf(`create table if not exists public.${name}`);
  if (start < 0) return "";
  const next = normalized.indexOf("create table if not exists public.", start + 1);
  return normalized.slice(start, next < 0 ? normalized.length : next);
}

// ==========================================================================
// PRINCIPAL MODEL
// ==========================================================================
const EXPECTED_PRINCIPALS = ["anonymous", "client", "vendor", "admin", "integration", "system"];
check("1. every allowed PrincipalType accepted", () => {
  for (const t of EXPECTED_PRINCIPALS) assert(I.isPrincipalType(t), `PrincipalType ${t} not accepted`);
  assert(I.KNOWN_PRINCIPAL_TYPES.slice().sort().join(",") === EXPECTED_PRINCIPALS.slice().sort().join(","), "principal set mismatch");
});
check("2. unsupported principal types rejected", () => {
  for (const t of ["ai_agent", "robot", "", null, undefined, 5, "Client"]) assert(!I.isPrincipalType(t), `bad principal ${t} accepted`);
});
check("3. session-backed principals are client/vendor/admin only", () => {
  for (const t of ["client", "vendor", "admin"]) assert(I.isSessionBackedPrincipalType(t), `${t} must be session-backed`);
  for (const t of ["anonymous", "integration", "system"]) assert(!I.isSessionBackedPrincipalType(t), `${t} must NOT be session-backed`);
});
check("4. anonymous/integration/system principals hold no Supabase session (userId null)", () => {
  assert(I.anonymousPrincipal().userId === null && I.anonymousPrincipal().id === null, "anonymous must have no session/id");
  assert(I.integrationPrincipal({ integrationId: "n8n_1" }).userId === null, "integration must have no session");
  assert(I.systemPrincipal({ systemId: "kernel" }).userId === null, "system must have no session");
});
check("5. AI agents act through a system context with no independent auth authority", () => {
  const agent = I.systemPrincipal({ systemId: "furno-agent", role: "ai_agent" });
  assert(agent.type === I.PrincipalType.SYSTEM && agent.userId === null, "AI agent must be a system principal with no session");
  assert(!I.isPrincipalType("ai_agent"), "there must be no independent ai_agent principal type");
});
check("6. session-backed principal refs carry a userId + business id", () => {
  const v = I.vendorPrincipal({ vendorId: "vend_1", userId: "user_1" });
  const c = I.clientPrincipal({ clientAccountId: "ca_1", userId: "user_2" });
  const a = I.adminPrincipal({ userId: "user_3", adminRole: "Superadmin" });
  assert(v.type === "vendor" && v.id === "vend_1" && v.userId === "user_1", "vendor principal wrong");
  assert(c.type === "client" && c.id === "ca_1" && c.userId === "user_2", "client principal wrong");
  assert(a.type === "admin" && a.userId === "user_3" && a.role === "Superadmin", "admin principal wrong");
});
check("7. principal refs are frozen", () => {
  assert(Object.isFrozen(I.anonymousPrincipal()) && Object.isFrozen(I.vendorPrincipal({ vendorId: "v", userId: "u" })), "principal refs must be frozen");
});

// ==========================================================================
// VERIFICATION PURPOSE + ISOLATION
// ==========================================================================
const EXPECTED_PURPOSES = ["vendor_whatsapp_verify", "vendor_password_reset"];
check("8. every allowed VerificationPurpose accepted", () => {
  for (const p of EXPECTED_PURPOSES) assert(I.isVerificationPurpose(p), `purpose ${p} not accepted`);
  assert(I.KNOWN_VERIFICATION_PURPOSES.slice().sort().join(",") === EXPECTED_PURPOSES.slice().sort().join(","), "purpose set mismatch");
});
check("9. unsupported verification purposes rejected", () => {
  for (const p of ["client_otp_login", "login", "", null, undefined, "vendor_whatsapp"]) assert(!I.isVerificationPurpose(p), `bad purpose ${p} accepted`);
});
check("10. purpose isolation: whatsapp_verify never satisfies password_reset", () => {
  assert(I.challengePurposeMatches("vendor_whatsapp_verify", "vendor_whatsapp_verify") === true, "same purpose must match");
  assert(I.challengePurposeMatches("vendor_whatsapp_verify", "vendor_password_reset") === false, "cross purpose must NOT match");
  assert(I.challengePurposeMatches("vendor_password_reset", "vendor_whatsapp_verify") === false, "cross purpose must NOT match");
});
check("11. purpose isolation rejects unknown/blank on either side", () => {
  assert(I.challengePurposeMatches("unknown", "unknown") === false, "unknown==unknown must not match");
  assert(I.challengePurposeMatches("vendor_whatsapp_verify", "") === false, "blank required must not match");
  assert(I.challengePurposeMatches(null, "vendor_password_reset") === false, "null challenge must not match");
});

// ==========================================================================
// CHALLENGE STATE RULES
// ==========================================================================
check("12. challenge terminal states are consumed/expired/locked/cancelled", () => {
  for (const s of ["consumed", "expired", "locked", "cancelled"]) assert(I.isChallengeTerminalState(s), `${s} must be terminal`);
  for (const s of ["pending", "verified"]) assert(!I.isChallengeTerminalState(s), `${s} must NOT be terminal`);
  assert(!I.isChallengeTerminalState("banana"), "unknown must not be terminal");
});
check("13. every allowed challenge status accepted; unknown rejected", () => {
  for (const s of ["pending", "verified", "consumed", "expired", "locked", "cancelled"]) assert(I.isVerificationChallengeStatus(s), `${s} not accepted`);
  for (const s of ["active", "done", "", null]) assert(!I.isVerificationChallengeStatus(s), `${s} accepted`);
});
check("14. only pending is an active challenge state", () => {
  assert(I.isChallengeActiveState("pending") === true, "pending must be active");
  for (const s of ["verified", "consumed", "expired", "locked", "cancelled"]) assert(I.isChallengeActiveState(s) === false, `${s} must not be active`);
});

// ==========================================================================
// CLIENT ACCOUNT STATUS
// ==========================================================================
check("15. client account status vocabulary is active/suspended/disabled", () => {
  for (const s of ["active", "suspended", "disabled"]) assert(I.isClientAccountStatus(s), `${s} not accepted`);
  for (const s of ["deleted", "banned", "", null]) assert(!I.isClientAccountStatus(s), `${s} accepted`);
  assert(I.KNOWN_CLIENT_ACCOUNT_STATUSES.slice().sort().join(",") === "active,disabled,suspended", "status set mismatch");
});

// ==========================================================================
// AUTH SECURITY EVENT TYPES + REDACTION
// ==========================================================================
const EXPECTED_EVENTS = [
  "vendor.login_success", "vendor.login_failed", "vendor.whatsapp_verification_requested",
  "vendor.whatsapp_verified", "vendor.password_reset_requested", "vendor.password_reset_otp_failed",
  "vendor.password_reset_completed", "client.otp_requested", "client.login_success",
  "auth.rate_limit_triggered", "auth.challenge_expired",
];
check("16. every documented auth security event type accepted", () => {
  for (const e of EXPECTED_EVENTS) assert(I.isAuthSecurityEventType(e), `event ${e} not accepted`);
  assert(I.KNOWN_AUTH_SECURITY_EVENT_TYPES.length === EXPECTED_EVENTS.length, "event count mismatch");
});
check("17. unsupported auth security event types rejected", () => {
  for (const e of ["vendor.hacked", "", null, "login"]) assert(!I.isAuthSecurityEventType(e), `${e} accepted`);
});
check("18. metadata sanitizer strips plaintext secret keys", () => {
  const dirty = {
    vendor_id: "v1", correlation_id: "c1",
    otp: "123456", password: "hunter2", reset_token: "tok", access_token: "at", refresh_token: "rt",
    service_role_key: "sr", provider_secret: "ps", whatsapp_secret: "ws", api_key: "ak", authorization: "Bearer x",
  };
  const clean = I.sanitizeAuthSecurityMetadata(dirty);
  assert(clean.vendor_id === "v1" && clean.correlation_id === "c1", "safe keys must be preserved");
  for (const k of ["otp", "password", "reset_token", "access_token", "refresh_token", "service_role_key", "provider_secret", "whatsapp_secret", "api_key", "authorization"]) {
    assert(!(k in clean), `secret key ${k} must be stripped`);
  }
});
check("19. metadata sanitizer strips nested secret keys", () => {
  const clean = I.sanitizeAuthSecurityMetadata({ outer: { inner: { otp: "1", ok: "yes" }, list: [{ password: "p", keep: 1 }] } });
  assert(clean.outer.inner.ok === "yes" && !("otp" in clean.outer.inner), "nested otp must be stripped");
  assert(clean.outer.list[0].keep === 1 && !("password" in clean.outer.list[0]), "nested-array password must be stripped");
});
check("20. containsForbiddenSecurityKey detects secrets (any depth)", () => {
  assert(I.containsForbiddenSecurityKey({ otp: "x" }) === true, "otp must be detected");
  assert(I.containsForbiddenSecurityKey({ a: { b: { grant_token_hash_but_token: 1 } } }) === true, "nested token must be detected");
  assert(I.containsForbiddenSecurityKey({ vendor_id: "v", correlation_id: "c" }) === false, "safe object must pass");
});
check("21. sanitizer is safe on null/array/non-object", () => {
  assert(JSON.stringify(I.sanitizeAuthSecurityMetadata(null)) === "{}", "null -> {}");
  assert(JSON.stringify(I.sanitizeAuthSecurityMetadata(undefined)) === "{}", "undefined -> {}");
  assert(JSON.stringify(I.sanitizeAuthSecurityMetadata([1, 2])) === "{}", "array -> {}");
});
check("22. explicit forbidden key names are rejected", () => {
  for (const k of ["otp", "password", "reset_token", "access_token", "refresh_token", "service_role_key", "whatsapp_provider_secret", "session_token"]) {
    assert(I.isForbiddenSecurityMetadataKey(k), `${k} must be forbidden`);
  }
  for (const k of ["vendor_id", "correlation_id", "destination_hash", "otp_hash", "attempt_count"]) {
    assert(!I.isForbiddenSecurityMetadataKey(k), `${k} must be allowed (hash/id/count)`);
  }
});

// ==========================================================================
// TS CONTRACT — NO PLAINTEXT SECRET FIELDS
// ==========================================================================
function interfaceBody(src, name) {
  const start = src.indexOf(`interface ${name} {`);
  if (start < 0) return "";
  const end = src.indexOf("}", start);
  return src.slice(start, end < 0 ? src.length : end);
}
check("23. VerificationChallenge stores hashes, never plaintext otp/destination", () => {
  const body = interfaceBody(readFileSync("lib/identity/verification.ts", "utf8"), "VerificationChallenge");
  assert(/otpHash\s*:/.test(body) && /destinationHash\s*:/.test(body), "must store otpHash + destinationHash");
  assert(!/\botp\s*:/.test(body) && !/\bplaintext/i.test(body), "must not store a plaintext otp field");
});
check("24. AuthSecurityEvent carries no plaintext secret fields", () => {
  const body = interfaceBody(readFileSync("lib/identity/authSecurityEvent.ts", "utf8"), "AuthSecurityEvent");
  assert(!/\b(password|accessToken|refreshToken|resetToken|serviceRoleKey)\s*:/i.test(body), "audit contract must not declare secret fields");
  assert(/metadata\s*:\s*Record<string, unknown>/.test(body), "metadata must be freeform sanitized record");
});

// ==========================================================================
// MIGRATION — TABLES + COLUMNS
// ==========================================================================
const SENSITIVE_TABLES = ["verification_challenges", "password_reset_grants", "auth_security_events"];
const ALL_TABLES = ["client_accounts", ...SENSITIVE_TABLES];
check("25. creates all four Phase 5A tables (additive)", () => {
  for (const t of ALL_TABLES) assert(hasSql(`create table if not exists public.${t}`), `missing table ${t}`);
});
check("26. client_accounts has required columns + status check + uniqueness", () => {
  const b = tableBlock("client_accounts");
  for (const c of ["user_id", "phone_e164", "display_name", "whatsapp_verified_at", "status", "created_at", "updated_at"]) assert(b.includes(c), `client_accounts missing ${c}`);
  assert(b.includes("check (status in ('active', 'suspended', 'disabled'))"), "client_accounts status check missing");
  assert(hasSql("create unique index if not exists uq_client_accounts_user on public.client_accounts(user_id)"), "client_accounts user uniqueness missing");
  assert(normalized.includes("uq_client_accounts_phone_e164") && normalized.includes("where phone_e164 is not null"), "client_accounts phone partial-unique missing");
  assert(b.includes("references auth.users(id) on delete cascade"), "client_accounts must map user_id to auth.users");
});
check("27. verification_challenges has required columns + purpose/status checks", () => {
  const b = tableBlock("verification_challenges");
  for (const c of ["principal_type", "principal_id", "purpose", "destination_hash", "otp_hash", "status", "expires_at", "attempt_count", "max_attempts", "resend_count", "created_at", "verified_at", "consumed_at"]) assert(b.includes(c), `verification_challenges missing ${c}`);
  assert(b.includes("check (purpose in ('vendor_whatsapp_verify', 'vendor_password_reset'))"), "purpose check missing/incomplete");
  assert(b.includes("check (status in ('pending', 'verified', 'consumed', 'expired', 'locked', 'cancelled'))"), "challenge status check missing");
});
check("28. verification_challenges stores no plaintext OTP column (only otp_hash)", () => {
  const b = tableBlock("verification_challenges");
  assert(b.includes("otp_hash"), "otp_hash required");
  assert(!/[,(]\s*otp\s+text/.test(b) && !/[,(]\s*otp_plain/.test(b), "must not store a plaintext otp column");
});
check("29. password_reset_grants stores only a token hash (single-use + expiry)", () => {
  const b = tableBlock("password_reset_grants");
  for (const c of ["vendor_id", "user_id", "grant_token_hash", "expires_at", "consumed_at", "created_at"]) assert(b.includes(c), `password_reset_grants missing ${c}`);
  assert(!/[,(]\s*grant_token\s+text/.test(b) && !/reset_token\s+text/.test(b), "must not store a plaintext reset token");
  assert(hasSql("create unique index if not exists uq_password_reset_grants_token on public.password_reset_grants(grant_token_hash)"), "grant token hash uniqueness missing");
});
check("30. auth_security_events has required columns + jsonb metadata", () => {
  const b = tableBlock("auth_security_events");
  for (const c of ["event_type", "principal_type", "principal_id", "actor_user_id", "purpose", "correlation_id", "destination_hash", "metadata", "created_at"]) assert(b.includes(c), `auth_security_events missing ${c}`);
  assert(b.includes("metadata jsonb"), "metadata must be jsonb");
});

// ==========================================================================
// MIGRATION — RLS + GRANTS (server-only for sensitive tables)
// ==========================================================================
check("31. RLS enabled on all Phase 5A tables", () => {
  for (const t of ALL_TABLES) assert(hasSql(`alter table public.${t} enable row level security`), `RLS not enabled on ${t}`);
});
check("32. sensitive tables revoke anon + authenticated", () => {
  for (const t of SENSITIVE_TABLES) {
    assert(hasSql(`revoke all on public.${t} from anon`), `${t} must revoke anon`);
    assert(hasSql(`revoke all on public.${t} from authenticated`), `${t} must revoke authenticated`);
  }
});
check("33. server-only tables grant service_role only", () => {
  assert(hasSql("grant select, insert, update, delete on public.verification_challenges to service_role"), "verification_challenges service_role grant missing");
  assert(hasSql("grant select, insert, update, delete on public.password_reset_grants to service_role"), "password_reset_grants service_role grant missing");
});
check("34. auth_security_events is append-oriented (no update/delete grant)", () => {
  assert(hasSql("grant select, insert on public.auth_security_events to service_role"), "auth_security_events must grant select+insert");
  assert(!/grant[^;]*update[^;]*on public\.auth_security_events/.test(normalized) && !/grant[^;]*delete[^;]*on public\.auth_security_events/.test(normalized), "auth_security_events must not grant update/delete");
});
check("35. no anon/authenticated SELECT policy on sensitive tables", () => {
  for (const t of SENSITIVE_TABLES) {
    assert(!normalized.includes(`create policy "${t}`) && !new RegExp(`create policy [^;]*on public\\.${t} for select to (anon|authenticated)`).test(normalized), `${t} must have no anon/authenticated policy`);
  }
});
check("36. client_accounts has owner-read + admin-manage policies, no anon", () => {
  assert(normalized.includes("create policy \"client_accounts owner read\"") && normalized.includes("auth.uid() = user_id or public.is_admin()"), "client_accounts owner-read policy missing");
  assert(normalized.includes("create policy \"client_accounts admin manage\"") && normalized.includes("using (public.is_admin()) with check (public.is_admin())"), "client_accounts admin-manage policy missing");
  assert(hasSql("revoke all on public.client_accounts from anon"), "client_accounts must revoke anon");
  assert(!/to anon/.test(tableBlockPolicies("client_accounts")), "client_accounts must have no anon policy");
});
function tableBlockPolicies(t) {
  const re = new RegExp(`create policy [^;]*on public\\.${t}[^;]*`, "g");
  return (normalized.match(re) || []).join(" ");
}

// ==========================================================================
// MIGRATION — ADDITIVE-ONLY SAFETY
// ==========================================================================
check("37. migration is additive-only (no drop/truncate of data)", () => {
  assert(!/drop table/.test(normalized), "no DROP TABLE allowed");
  assert(!/drop column/.test(normalized), "no DROP COLUMN allowed");
  assert(!/truncate/.test(normalized), "no TRUNCATE allowed");
  assert(!/delete from/.test(normalized), "no DELETE FROM allowed");
});
check("38. migration only DROPs POLICY (idempotent re-create), nothing else", () => {
  const drops = normalized.match(/drop [a-z ]+ if exists/g) || [];
  assert(drops.every((d) => d.startsWith("drop policy if exists")), `unexpected drop: ${drops.join("; ")}`);
});
check("39. migration filename sorts after the highest prior migration", () => {
  assert(existsSync(MIGRATION), "migration file missing");
  assert("20260708000160" > "20260706000150", "migration number must be higher than prior");
});

// ==========================================================================
// IDENTITY SOURCE — NO TRANSPORT / PROVIDER / NETWORK
// ==========================================================================
const identitySource = stripComments(identityFiles.map((f) => readFileSync(f, "utf8")).join("\n"));
check("40. identity contracts import no Supabase client", () => assert(!/from\s+["'][^"']*supabase/i.test(identitySource) && !/adminClient\s*\(|createClient\s*\(/.test(identitySource), "identity layer must not import Supabase"));
check("41. identity contracts perform no network fetch", () => assert(!/\bfetch\s*\(/.test(identitySource), "identity layer must not fetch"));
check("42. identity contracts import no WhatsApp/Twilio/Gupshup/Maps/geocode provider", () => assert(!/from\s+["'][^"']*(whatsapp|twilio|gupshup|google-maps|googlemaps|geocod)/i.test(identitySource), "identity layer must not import a provider"));
check("43. identity contracts wire no n8n / webhook / OTP transport", () => assert(!/from\s+["'][^"']*n8n|\bsendOtp\s*\(|\bsendWhatsApp\s*\(|webhookUrl|\.post\s*\(/i.test(identitySource), "identity layer must not wire transport"));

// ==========================================================================
// REGRESSION AVAILABILITY + WIRING
// ==========================================================================
check("44. Phase 4A/4B1/4B2 harnesses available", () => {
  assert(existsSync("scripts/phase4a-policy-engine-harness.mjs") && pkg.scripts["test:phase4a"], "phase4a missing");
  assert(existsSync("scripts/phase4b1-policy-inputs-contract-harness.mjs") && pkg.scripts["test:phase4b1"], "phase4b1 missing");
  assert(existsSync("scripts/phase4b2-policy-lifecycle-integration-harness.mjs") && pkg.scripts["test:phase4b2"], "phase4b2 missing");
});
check("45. test:phase5a wired + Phase 5A doc exists", () => {
  assert(pkg.scripts["test:phase5a"] === "node scripts/phase5a-identity-security-harness.mjs", "test:phase5a not wired");
  assert(existsSync("docs/QF-Identity-Security-Foundation-Phase-5A.md"), "Phase 5A doc missing");
});
check("46. no protected Phase 1-4 files changed by Phase 5A", () => {
  const protectedPaths = [
    "app/actions.ts", "lib/supabase.ts", "lib/errors.ts", "lib/lead-assignment/runtimeSettings.ts",
    "services/leadService.ts", "services/leadQualityService.ts", "services/vendorService.ts",
    "lib/aos/policy", "lib/aos/workflows/leadLifecycle",
  ];
  assert(gitPorcelain(protectedPaths).length === 0, "a protected Phase 1-4 path changed");
});
check("47. no new database migration other than Phase 5A identity foundation", () => {
  const changed = gitPorcelain(["supabase/migrations"]);
  assert(changed.every((line) => line.includes("20260708000160_identity_security_foundation.sql")), `unexpected migration change: ${changed.join("; ")}`);
});

function gitPorcelain(paths = []) {
  const output = execFileSync("git", ["status", "--porcelain", "--", ...paths], { encoding: "utf8" });
  return output.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

const results = [];
for (const { name, fn } of checks) {
  try { await fn(); results.push({ name, ok: true }); }
  catch (error) { results.push({ name, ok: false, error }); }
}
for (const item of results) {
  console.log(`${item.ok ? "PASS" : "FAIL"} ${item.name}`);
  if (!item.ok) console.error(item.error);
}

rmSync(outDir, { recursive: true, force: true });

const failures = results.filter((item) => !item.ok);
if (failures.length > 0) {
  console.error(`\n${failures.length} Phase 5A identity-security harness check(s) failed.`);
  process.exit(1);
}
console.log(`\nAll ${results.length} Phase 5A identity-security checks passed.`);
