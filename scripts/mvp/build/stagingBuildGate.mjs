// ============================================================================
// QF-MVP-30.4D-A1 — Staging build environment gate (PURE decision layer).
//
// WHY THIS EXISTS
//   `next build` inlines NEXT_PUBLIC_* at build time. During QF-MVP-30.4D-A a
//   bare `npm run build` loaded the developer's local `.env.local` — which
//   points at PRODUCTION — and baked the prohibited production project ref into
//   4 client and 4 server chunks, with the staging ref absent entirely. The
//   contamination was only caught because the output was rescanned afterwards.
//
//   So a staging build is acceptable only when BOTH hold:
//     1. the effective environment is provably the authorised staging one
//        BEFORE Next is invoked, and
//     2. the produced output is rescanned AFTER the build and positively
//        attributed to that same staging project.
//
//   Checking (1) alone is not enough: the env can be right while a stale
//   `.next` from an earlier contaminated build survives. Checking (2) alone is
//   not enough either: by then the secret-bearing build already happened.
//
// THIS FILE IS PURE
//   No fs, no spawn, no process.exit, no clock. Everything is a function of its
//   arguments, so the self-tests can drive every branch with fixtures instead of
//   real builds. Orchestration lives in runStagingBuild.mjs.
//
// NEVER PRINTS A SECRET
//   Credentials are reduced to booleans and counts before they leave here.
// ============================================================================

export const AUTHORIZED_REF = "uckafzuochmbvtiodmcl";
export const PRODUCTION_REF = "yqpgcsduqbxulrlzwzap";
export const JARVIS_REF = "coilipywdvxklewquqvv";
export const PROHIBITED_REFS = Object.freeze([PRODUCTION_REF, JARVIS_REF]);

/** The one variable REQUIRED to contain the prohibited refs; it is the deny-list. */
export const DENY_LIST_VAR = "QF_PROHIBITED_SUPABASE_PROJECT_REFS";

export const SAFE_SESSION_VAR = "QF_STAGING_SAFE_SESSION";
export const COMMAND_WRAPPER_VAR = "QF_STAGING_COMMAND_WRAPPER";
export const AUTHORIZED_REF_VAR = "QF_AUTHORIZED_SUPABASE_PROJECT_REF";

/** Every known outbound/provider/automation switch. Any truthy value fails the gate. */
export const OUTBOUND_FLAG_VARS = Object.freeze([
  "N8N_ENABLED",
  "ENABLE_N8N",
  "NEXT_PUBLIC_N8N_ENABLED",
  "N8N_OUTBOUND_WEBHOOK_ENABLED",
  "OUTBOUND_WEBHOOK_ENABLED",
  "PROVIDER_OUTBOUND_ENABLED",
  "WHATSAPP_ENABLED",
  "META_WHATSAPP_ENABLED",
  "SMS_ENABLED",
  "EMAIL_OUTBOUND_ENABLED",
]);

const PUBLIC_CREDENTIAL_VARS = Object.freeze([
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_ANON_KEY",
  "SUPABASE_PUBLISHABLE_KEY",
]);

const SERVICE_CREDENTIAL_VARS = Object.freeze([
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_SECRET_KEY",
]);

/**
 * Falsy vocabulary. A flag is DISABLED only when it is absent or one of these;
 * anything else (including "maybe" or "0.0") counts as enabled — fail closed.
 */
const FALSY = new Set(["", "0", "false", "no", "off"]);

export function isFlagEnabled(value) {
  if (value === undefined || value === null) return false;
  return !FALSY.has(String(value).trim().toLowerCase());
}

/** Project ref from a Supabase URL, or "" when it is absent/unparseable. */
export function refFromUrl(url) {
  if (!url || typeof url !== "string") return "";
  try {
    return new URL(url).hostname.split(".")[0] || "";
  } catch {
    return "";
  }
}

/** Every distinct Supabase project ref referenced by a blob of built output. */
export function collectSupabaseRefs(text) {
  const found = new Set();
  for (const m of String(text).matchAll(/([a-z0-9]{20})\.supabase\.co/g)) found.add(m[1]);
  return found;
}

/**
 * True when a JWT's payload claims the service_role. Detects a leaked secret
 * INDEPENDENTLY of whether the gate was handed the literal key to compare.
 */
export function jwtClaimsServiceRole(token) {
  const parts = String(token).split(".");
  if (parts.length !== 3) return false;
  try {
    return Buffer.from(parts[1], "base64url").toString("utf8").includes('"service_role"');
  } catch {
    return false;
  }
}

const JWT_RE = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;

/**
 * QF-MVP-40 — the MODERN Supabase privileged key shapes.
 *
 * WHY THIS EXISTS. `jwtClaimsServiceRole` recognises a leaked legacy key from its own
 * decoded payload, which is what makes detection independent of whether the caller
 * supplied the literal. A modern `sb_secret_…` key is NOT a JWT, so that branch cannot
 * see it at all — a leak of the new shape would only have been caught if the literal
 * happened to be passed in `secrets`. That is a strictly weaker guarantee for the newer
 * credential, which is the wrong way round.
 *
 * `sb_secret_` is the server-only secret key and `sbp_` is a Supabase personal access
 * token; neither may ever reach a browser chunk. `sb_publishable_` is deliberately NOT
 * listed — it is public by design, exactly as an anon JWT is.
 *
 * This adds DETECTION only. Nothing here validates or reshapes a key: the loaders in
 * `lib/supabase.ts` and the staging operators check presence and never assume a shape,
 * so a modern secret key already works unchanged.
 */
export const PRIVILEGED_KEY_RE = /\b(?:sb_secret_[A-Za-z0-9_-]{16,}|sbp_[A-Za-z0-9]{16,})/g;

/** True when the text carries a non-JWT privileged Supabase credential. */
export function containsModernPrivilegedKey(text) {
  PRIVILEGED_KEY_RE.lastIndex = 0;
  return PRIVILEGED_KEY_RE.test(String(text));
}

/**
 * PRE-BUILD gates. Evaluated against the EFFECTIVE environment — i.e. after
 * @next/env has merged .env* exactly as `next build` will see it — so this
 * refuses the very contamination that produced the D-A finding.
 *
 * Returns { ok, failures: [{code, detail}], evidence } and never throws.
 */
export function evaluatePreBuildGates(env = {}) {
  const failures = [];
  const fail = (code, detail) => failures.push({ code, detail });

  if (!isFlagEnabled(env[SAFE_SESSION_VAR])) {
    fail("SAFE_SESSION_MARKER_MISSING", `${SAFE_SESSION_VAR} is not set to a truthy value`);
  }
  if (!isFlagEnabled(env[COMMAND_WRAPPER_VAR])) {
    fail("COMMAND_WRAPPER_MARKER_MISSING", `${COMMAND_WRAPPER_VAR} is not set to a truthy value`);
  }

  // The effective project ref is derived from the URL the build will bake in —
  // not from the advertised marker, which a caller could set without the URL.
  const effectiveUrl = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL || "";
  const effectiveRef = refFromUrl(effectiveUrl);
  if (!effectiveRef) {
    fail("EFFECTIVE_REF_UNRESOLVABLE", "no NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL to derive a project ref from");
  } else if (effectiveRef !== AUTHORIZED_REF) {
    const which = PROHIBITED_REFS.includes(effectiveRef) ? " (PROHIBITED ref)" : "";
    fail("EFFECTIVE_REF_NOT_AUTHORIZED", `effective project ref is "${effectiveRef}"${which}, expected "${AUTHORIZED_REF}"`);
  }
  // The marker must agree with the URL; disagreement means the environment was
  // assembled from two different sources and cannot be trusted.
  const advertised = env[AUTHORIZED_REF_VAR];
  if (advertised !== undefined && advertised !== AUTHORIZED_REF) {
    fail("AUTHORIZED_REF_MARKER_WRONG", `${AUTHORIZED_REF_VAR} is "${advertised}", expected "${AUTHORIZED_REF}"`);
  }
  if (advertised !== undefined && effectiveRef && advertised !== effectiveRef) {
    fail("AUTHORIZED_REF_MARKER_DISAGREES", `${AUTHORIZED_REF_VAR} does not match the effective URL ref`);
  }

  const denyList = String(env[DENY_LIST_VAR] ?? "");
  const missingFromDenyList = PROHIBITED_REFS.filter((r) => !denyList.includes(r));
  if (missingFromDenyList.length > 0) {
    fail("DENY_LIST_INCOMPLETE", `${DENY_LIST_VAR} is missing ${missingFromDenyList.length} prohibited ref(s)`);
  }

  // Leak scan across the whole effective environment. The deny-list variable is
  // the ONLY permitted exclusion — it exists precisely to carry those strings.
  const leaked = [];
  for (const [name, value] of Object.entries(env)) {
    if (name === DENY_LIST_VAR) continue;
    if (PROHIBITED_REFS.some((r) => String(value ?? "").includes(r))) leaked.push(name);
  }
  if (leaked.length > 0) {
    fail("PROHIBITED_REF_IN_ENVIRONMENT", `prohibited project ref present in: ${leaked.sort().join(", ")}`);
  }

  const enabledFlags = OUTBOUND_FLAG_VARS.filter((f) => isFlagEnabled(env[f]));
  if (enabledFlags.length > 0) {
    fail("OUTBOUND_FLAG_ENABLED", `outbound/provider flag(s) enabled: ${enabledFlags.join(", ")}`);
  }

  const hasPublic = PUBLIC_CREDENTIAL_VARS.some((v) => Boolean(env[v]));
  if (!hasPublic) fail("PUBLIC_CREDENTIAL_MISSING", "no staging anon/publishable credential present");

  const hasService = SERVICE_CREDENTIAL_VARS.some((v) => Boolean(env[v]));
  if (!hasService) fail("SERVICE_CREDENTIAL_MISSING", "no staging service/secret credential present");

  return {
    ok: failures.length === 0,
    failures,
    evidence: {
      effectiveRef,
      authorizedRef: AUTHORIZED_REF,
      safeSession: isFlagEnabled(env[SAFE_SESSION_VAR]),
      commandWrapper: isFlagEnabled(env[COMMAND_WRAPPER_VAR]),
      denyListComplete: missingFromDenyList.length === 0,
      leakedVariableCount: leaked.length,
      enabledOutboundFlagCount: enabledFlags.length,
      publicCredentialPresent: hasPublic,
      serviceCredentialPresent: hasService,
    },
  };
}

/**
 * POST-BUILD scan of the produced output.
 *
 * `clientFiles` / `serverFiles` are [{ path, text }]. `secrets` may carry literal
 * credential values to search for; detection does NOT depend on them, because a
 * service_role JWT is recognised from its own decoded payload and a modern
 * `sb_secret_`/`sbp_` key is recognised from its own shape.
 */
export function scanBuildOutput({ clientFiles = [], serverFiles = [], secrets = [] } = {}) {
  const failures = [];
  const fail = (code, detail) => failures.push({ code, detail });

  // 1. no prohibited project ref anywhere in the output.
  const prohibitedHits = [];
  for (const f of [...clientFiles, ...serverFiles]) {
    if (PROHIBITED_REFS.some((r) => String(f.text).includes(r))) prohibitedHits.push(f.path);
  }
  if (prohibitedHits.length > 0) {
    fail("PROHIBITED_REF_IN_OUTPUT", `${prohibitedHits.length} file(s): ${prohibitedHits.slice(0, 5).join(", ")}`);
  }

  // 2. no service-role/secret material in CLIENT chunks.
  const secretHits = [];
  for (const f of clientFiles) {
    const text = String(f.text);
    let hit = false;
    for (const m of text.matchAll(JWT_RE)) {
      if (jwtClaimsServiceRole(m[0])) { hit = true; break; }
    }
    // A modern secret key carries no decodable payload, so it is recognised by shape.
    if (!hit && containsModernPrivilegedKey(text)) hit = true;
    if (!hit) {
      for (const s of secrets) {
        if (s && String(s).length > 20 && text.includes(s)) { hit = true; break; }
      }
    }
    if (hit) secretHits.push(f.path);
  }
  if (secretHits.length > 0) {
    fail("SERVICE_CREDENTIAL_IN_CLIENT_BUNDLE", `${secretHits.length} file(s): ${secretHits.slice(0, 5).join(", ")}`);
  }

  // 3. positive attribution: the output must name exactly ONE Supabase project,
  //    and it must be the authorised staging one. Zero means the build cannot be
  //    attributed at all; more than one means the evidence is ambiguous.
  const refs = new Set();
  for (const f of [...clientFiles, ...serverFiles]) {
    for (const r of collectSupabaseRefs(f.text)) refs.add(r);
  }
  const refList = [...refs].sort();
  if (refList.length === 0) {
    fail("BUILD_TARGET_UNATTRIBUTABLE", "no Supabase project ref found in the output; cannot attribute the build");
  } else if (refList.length > 1) {
    fail("BUILD_TARGET_AMBIGUOUS", `output names ${refList.length} distinct project refs: ${refList.join(", ")}`);
  } else if (refList[0] !== AUTHORIZED_REF) {
    fail("BUILD_TARGET_NOT_AUTHORIZED", `output is attributed to "${refList[0]}", expected "${AUTHORIZED_REF}"`);
  }

  return {
    ok: failures.length === 0,
    failures,
    evidence: {
      clientFileCount: clientFiles.length,
      serverFileCount: serverFiles.length,
      distinctProjectRefs: refList,
      prohibitedRefFileCount: prohibitedHits.length,
      clientSecretFileCount: secretHits.length,
    },
  };
}
