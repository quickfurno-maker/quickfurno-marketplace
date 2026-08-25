// ============================================================================
// QF-MVP-40-R7C — ONE-SHOT governed REBIND of the single staging
// public.communication_provider_accounts row from the PRODUCTION Meta asset
// references to the DEDICATED STAGING ones.  DRY RUN BY DEFAULT.
//
//   node scripts/mvp/communication/rebind-meta-staging-provider-account-once.mjs
//     -> DRY RUN. Proves environment, identity, owner proof and pre-state. No write.
//
//   … --execute --owner-authorized-once-rebind
//     -> Performs AT MOST ONE guarded UPDATE of exactly two columns.
//
// WHY THIS EXISTS, AND WHY THE 40.12 SEED CANNOT DO IT
//   The staging row (`meta_whatsapp_cloud`/`whatsapp`) carries `business_account_reference`
//   and `phone_number_reference` belonging to the PRODUCTION WABA and phone. Consequences:
//     * canaryActivationRuntime `readAccount()` filters `.eq("phone_number_reference", <staging
//       phone>)`, so it returns null -> ACCOUNT_MISSING at plan time and readiness preflight
//       refuses before minting anything;
//     * the audited seed (seed-meta-staging-inactive-mappings.mjs) cannot repair it, because
//       `classifyExistingAccount()` returns ABORT/ACCOUNT_IDENTITY_CONFLICT when both stored
//       references are non-null and differ from the intended identity. Its NORMALIZED_DISABLED
//       path is reachable ONLY when the stored references are NULL or already equal.
//   Rather than weaken that conflict rule — which is a correct, reusable safety property that
//   protects every future seed run — this file is a SEPARATE, DELIBERATELY NON-GENERAL
//   authority for exactly one row and exactly one transition.
//
// WHAT IT CANNOT DO — enforced below and asserted by the validator
//   * no INSERT, no DELETE, no RPC;      * no Meta / Graph call of any kind, no fetch;
//   * no mapping, policy or canary write; * no readiness/status column in the patch;
//   * no row selector — provider_key and channel are PINNED, not parameters;
//   * no second UPDATE, ever, including after an ambiguous result;
//   * no creation: an ABSENT row is refused and left to the audited 40.12 seed.
//
// THE TRANSITION IS PINNED AT BOTH ENDS
//   NEW identity: digest-pinned to the SAME staging triple the R7B one-shot template authority
//   pinned, imported from that module so there is exactly one pinned source of truth.
//   OLD identity: proven against the owner's EXTERNAL, role-labelled production deny-digest
//   proof. That file lives OUTSIDE the repository on purpose and is never copied into it; this
//   operator refuses a path that resolves inside the repo. So the only writable pre-state is
//   "currently bound to the known production assets", and every other pre-state is a hard stop.
//
// The patch is exactly two columns. Readiness/configuration/webhook/health columns are NOT in
// it, so this operation cannot make the account send-capable; the row stays `disabled` and the
// send path stays fail-closed. Provider activation remains a separate, ungranted authority.
// ============================================================================

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  EXPECTED_IDENTITY_DIGESTS as STAGING_IDENTITY_DIGESTS,
} from "./create-meta-staging-vendor-onboarding-reminder-once.mjs";
import { resolveStagingTarget } from "./seed-meta-staging-inactive-mappings.mjs";
import { historicalRetirementBanner, retireHistoricalMutation } from "./metaStagingIdentity.mjs";

/** The ONE row this operator may ever touch. Neither value is a parameter. */
export const PROVIDER_KEY = "meta_whatsapp_cloud";
export const CHANNEL = "whatsapp";
export const ACCOUNTS_TABLE = "communication_provider_accounts";

/** Re-exported so the validator pins the SAME triple the R7B authority pinned. */
export { STAGING_IDENTITY_DIGESTS };

/** The exact acknowledgement flag. A truthy env var is deliberately NOT accepted. */
export const OWNER_ACK_FLAG = "--owner-authorized-once-rebind";

/** The env var naming the owner's EXTERNAL production deny-digest proof. */
export const DENY_PROOF_ENV = "QF_PRODUCTION_META_DENY_DIGESTS_PATH";

/** Only these two columns may ever appear in the patch. */
export const REBINDABLE_COLUMNS = Object.freeze(["business_account_reference", "phone_number_reference"]);

/** A row in this readiness state is send-capable and is never touched. */
export const SEND_CAPABLE_READINESS = "provider_ready";
/** The readiness state the row must be in before, and must remain in after. */
export const REQUIRED_READINESS = "disabled";

export const RebindFailure = Object.freeze({
  UNKNOWN_FLAG: "UNKNOWN_FLAG",
  ENV_FENCE_REFUSED: "ENV_FENCE_REFUSED",
  DENY_PROOF_PATH_MISSING: "DENY_PROOF_PATH_MISSING",
  DENY_PROOF_INSIDE_REPO: "DENY_PROOF_INSIDE_REPO",
  DENY_PROOF_UNREADABLE: "DENY_PROOF_UNREADABLE",
  DENY_PROOF_SCHEMA_UNSUPPORTED: "DENY_PROOF_SCHEMA_UNSUPPORTED",
  DENY_PROOF_INCOMPLETE: "DENY_PROOF_INCOMPLETE",
  DENY_PROOF_MALFORMED_DIGEST: "DENY_PROOF_MALFORMED_DIGEST",
  IDENTITY_MISSING: "IDENTITY_MISSING",
  IDENTITY_UNAUTHORIZED: "IDENTITY_UNAUTHORIZED",
  IDENTITY_IS_PRODUCTION: "IDENTITY_IS_PRODUCTION",
  ACCOUNT_ABSENT: "ACCOUNT_ABSENT",
  ACCOUNT_AMBIGUOUS: "ACCOUNT_AMBIGUOUS",
  ACCOUNT_SEND_CAPABLE: "ACCOUNT_SEND_CAPABLE",
  ACCOUNT_REFERENCES_NULL: "ACCOUNT_REFERENCES_NULL",
  UNRECOGNIZED_BINDING: "UNRECOGNIZED_BINDING",
  CAS_LOST: "CAS_LOST",
  WRITE_OUTCOME_UNCERTAIN: "WRITE_OUTCOME_UNCERTAIN",
  READBACK_MISMATCH: "READBACK_MISMATCH",
  READINESS_ESCALATED: "READINESS_ESCALATED",
});

export const PreState = Object.freeze({
  ABSENT: "ABSENT",
  AMBIGUOUS: "AMBIGUOUS",
  SEND_CAPABLE: "SEND_CAPABLE",
  REFERENCES_NULL: "REFERENCES_NULL",
  BOUND_TO_PRODUCTION: "BOUND_TO_PRODUCTION",
  ALREADY_REBOUND: "ALREADY_REBOUND",
  UNRECOGNIZED_BINDING: "UNRECOGNIZED_BINDING",
});

export const Outcome = Object.freeze({
  DRY_RUN_WOULD_REBIND: "DRY_RUN_WOULD_REBIND",
  ALREADY_REBOUND: "ALREADY_REBOUND",
  REBOUND: "REBOUND",
  REBIND_AMBIGUOUS: "REBIND_AMBIGUOUS",
  REFUSED: "REFUSED",
});

export function sha256Hex(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** The owner proof must live OUTSIDE the repository, and must never be copied into it. */
export function isInsideRepository(path, root = REPO_ROOT) {
  const abs = resolve(path);
  const base = resolve(root);
  return abs === base || abs.startsWith(base + "\\") || abs.startsWith(base + "/");
}

// ---------------------------------------------------------------------------
// PURE: flags. Dry run unless BOTH flags are present, exactly. Unknown flags are
// refused rather than ignored, so a typo can never silently degrade to a dry run
// that the operator then reports as success.
// ---------------------------------------------------------------------------
export function parseFlags(argv = []) {
  const known = new Set(["--execute", OWNER_ACK_FLAG]);
  const unknown = argv.filter((a) => a.startsWith("--") && !known.has(a));
  if (unknown.length > 0) {
    return { ok: false, reason: RebindFailure.UNKNOWN_FLAG, flag: unknown[0], mayWrite: false };
  }
  const execute = argv.includes("--execute");
  const ownerAck = argv.includes(OWNER_ACK_FLAG);
  return { ok: true, execute, ownerAck, mayWrite: execute && ownerAck };
}

// ---------------------------------------------------------------------------
// PURE: the owner's external production deny-digest proof.
//
// Role-labelled by design: the three digests are consumed by NAME, never by position,
// so a reordered or partially-populated proof cannot silently rebind the wrong asset.
// The file is written with a UTF-8 BOM, which makes a bare JSON.parse throw — strip it.
// ---------------------------------------------------------------------------
const HEX64 = /^[0-9a-f]{64}$/;

export function parseDenyProof(text) {
  const bad = (reason) => ({ ok: false, reason, digests: null });
  if (typeof text !== "string") return bad(RebindFailure.DENY_PROOF_UNREADABLE);
  let parsed;
  try { parsed = JSON.parse(text.replace(/^﻿/, "")); }
  catch { return bad(RebindFailure.DENY_PROOF_UNREADABLE); }
  if (!parsed || typeof parsed !== "object") return bad(RebindFailure.DENY_PROOF_UNREADABLE);
  if (parsed.schema_version !== 1) return bad(RebindFailure.DENY_PROOF_SCHEMA_UNSUPPORTED);

  const roles = {
    appId: parsed.production_app_id_sha256,
    wabaId: parsed.production_waba_id_sha256,
    phoneNumberId: parsed.production_phone_number_id_sha256,
  };
  for (const value of Object.values(roles)) {
    if (typeof value !== "string" || value === "") return bad(RebindFailure.DENY_PROOF_INCOMPLETE);
  }
  for (const value of Object.values(roles)) {
    if (!HEX64.test(value.toLowerCase())) return bad(RebindFailure.DENY_PROOF_MALFORMED_DIGEST);
  }
  const digests = Object.freeze({
    appId: roles.appId.toLowerCase(),
    wabaId: roles.wabaId.toLowerCase(),
    phoneNumberId: roles.phoneNumberId.toLowerCase(),
  });
  // Three DISTINCT assets. A proof that collapses two roles onto one digest cannot
  // distinguish "bound to production WABA" from "bound to production phone".
  if (new Set(Object.values(digests)).size !== 3) return bad(RebindFailure.DENY_PROOF_INCOMPLETE);
  return { ok: true, reason: null, digests, proofHash: sha256Hex(JSON.stringify(digests)) };
}

export function loadDenyProof(env = {}, readFile = (p) => readFileSync(p, "utf8")) {
  const path = env[DENY_PROOF_ENV];
  if (!path) return { ok: false, reason: RebindFailure.DENY_PROOF_PATH_MISSING, digests: null };
  if (isInsideRepository(path)) {
    return { ok: false, reason: RebindFailure.DENY_PROOF_INSIDE_REPO, digests: null };
  }
  let text;
  try { text = readFile(resolve(path)); }
  catch { return { ok: false, reason: RebindFailure.DENY_PROOF_UNREADABLE, digests: null }; }
  return parseDenyProof(text);
}

// ---------------------------------------------------------------------------
// PURE: the NEW identity. Exact digest equality against the pinned staging triple,
// plus an independent cross-check that no supplied id is a known production asset.
// The second check is redundant while the pins hold — and that is the point: it is
// the layer that still refuses if a pinned constant is ever edited carelessly.
// ---------------------------------------------------------------------------
export function validateNewIdentity(env = {}, denyDigests = null) {
  const faults = [];
  const values = {
    wabaId: env.QF_META_WABA_ID,
    phoneNumberId: env.QF_META_PHONE_NUMBER_ID,
  };
  for (const [role, value] of Object.entries(values)) {
    if (value === undefined || value === null || String(value) === "") {
      faults.push(`${RebindFailure.IDENTITY_MISSING}:${role}`);
    }
  }
  if (faults.length > 0) return { ok: false, faults, digests: null };

  const digests = {
    wabaId: sha256Hex(values.wabaId),
    phoneNumberId: sha256Hex(values.phoneNumberId),
  };
  for (const role of ["wabaId", "phoneNumberId"]) {
    if (digests[role] !== STAGING_IDENTITY_DIGESTS[role]) {
      faults.push(`${RebindFailure.IDENTITY_UNAUTHORIZED}:${role}`);
    }
  }
  if (denyDigests) {
    const denied = new Set(Object.values(denyDigests));
    for (const role of ["wabaId", "phoneNumberId"]) {
      if (denied.has(digests[role])) faults.push(`${RebindFailure.IDENTITY_IS_PRODUCTION}:${role}`);
    }
  }
  return { ok: faults.length === 0, faults, digests };
}

// ---------------------------------------------------------------------------
// PURE: pre-state of the single account row.
//
// BOUND_TO_PRODUCTION is the ONLY writable state, and it requires BOTH stored
// references to match the production proof — a half-migrated row is unrecognized,
// not "close enough".
// ---------------------------------------------------------------------------
export function classifyPreState(rows, { denyDigests, stagingDigests = STAGING_IDENTITY_DIGESTS } = {}) {
  if (!Array.isArray(rows) || rows.length === 0) return { state: PreState.ABSENT, row: null };
  if (rows.length > 1) return { state: PreState.AMBIGUOUS, row: null };
  const row = rows[0];

  // Checked before anything else: a send-capable row is never touched, whatever it is bound to.
  if (row.readiness_status === SEND_CAPABLE_READINESS) return { state: PreState.SEND_CAPABLE, row };

  const waba = row.business_account_reference;
  const phone = row.phone_number_reference;
  if (waba == null || String(waba) === "" || phone == null || String(phone) === "") {
    // NULL references are exactly the case the audited 40.12 seed already handles
    // (NORMALIZED_DISABLED). This authority declines rather than duplicating it.
    return { state: PreState.REFERENCES_NULL, row };
  }

  const wabaDigest = sha256Hex(waba);
  const phoneDigest = sha256Hex(phone);

  if (wabaDigest === stagingDigests.wabaId && phoneDigest === stagingDigests.phoneNumberId) {
    return { state: PreState.ALREADY_REBOUND, row };
  }
  if (denyDigests
      && wabaDigest === denyDigests.wabaId
      && phoneDigest === denyDigests.phoneNumberId) {
    return { state: PreState.BOUND_TO_PRODUCTION, row };
  }
  return { state: PreState.UNRECOGNIZED_BINDING, row };
}

// ---------------------------------------------------------------------------
// PURE: the patch. EXACTLY the two reference columns — never a readiness, configuration,
// webhook, health, billing or verification column, so this operation is structurally
// incapable of making the account send-capable.
// ---------------------------------------------------------------------------
export function buildRebindPatch(env = {}) {
  return {
    business_account_reference: String(env.QF_META_WABA_ID),
    phone_number_reference: String(env.QF_META_PHONE_NUMBER_ID),
  };
}

/** The compare-and-swap predicate: the exact row, in the exact pre-state we proved. */
export function buildCasPredicate(row) {
  return {
    provider_key: PROVIDER_KEY,
    channel: CHANNEL,
    business_account_reference: row.business_account_reference,
    phone_number_reference: row.phone_number_reference,
  };
}

// ---------------------------------------------------------------------------
// PURE: the whole decision. Only BOUND_TO_PRODUCTION + both flags may ever write.
// ---------------------------------------------------------------------------
export function decide({ flags, identity, denyProof, preState }) {
  const refuse = (reason) => ({ write: false, outcome: Outcome.REFUSED, reason });
  if (!flags.ok) return refuse(`${flags.reason}:${flags.flag ?? ""}`);
  if (!denyProof.ok) return refuse(denyProof.reason);
  if (!identity.ok) return refuse(identity.faults.join(","));

  if (preState === PreState.ALREADY_REBOUND) {
    return { write: false, outcome: Outcome.ALREADY_REBOUND, reason: "row already carries the staging identity" };
  }
  if (preState === PreState.ABSENT) return refuse(RebindFailure.ACCOUNT_ABSENT);
  if (preState === PreState.AMBIGUOUS) return refuse(RebindFailure.ACCOUNT_AMBIGUOUS);
  if (preState === PreState.SEND_CAPABLE) return refuse(RebindFailure.ACCOUNT_SEND_CAPABLE);
  if (preState === PreState.REFERENCES_NULL) return refuse(RebindFailure.ACCOUNT_REFERENCES_NULL);
  if (preState !== PreState.BOUND_TO_PRODUCTION) return refuse(RebindFailure.UNRECOGNIZED_BINDING);

  if (!flags.mayWrite) return { write: false, outcome: Outcome.DRY_RUN_WOULD_REBIND, reason: null };
  return { write: true, outcome: null, reason: null };
}

// ---------------------------------------------------------------------------
// PURE: post-state proof. The write is only "done" if the row now carries the staging
// identity AND has not escalated out of `disabled`.
// ---------------------------------------------------------------------------
export function verifyPostState(rows, { stagingDigests = STAGING_IDENTITY_DIGESTS } = {}) {
  if (!Array.isArray(rows) || rows.length !== 1) {
    return { ok: false, reason: RebindFailure.READBACK_MISMATCH };
  }
  const row = rows[0];
  if (sha256Hex(row.business_account_reference) !== stagingDigests.wabaId
      || sha256Hex(row.phone_number_reference) !== stagingDigests.phoneNumberId) {
    return { ok: false, reason: RebindFailure.READBACK_MISMATCH };
  }
  if (row.readiness_status !== REQUIRED_READINESS) {
    return { ok: false, reason: RebindFailure.READINESS_ESCALATED };
  }
  return { ok: true, reason: null, row };
}

// ---------------------------------------------------------------------------
// Database port. There is deliberately NO insert, delete, upsert or rpc method:
// those operations are not expressible through this adapter, which is stronger
// than choosing not to call them. UPDATE is hard-limited to ONE per process.
// ---------------------------------------------------------------------------
export function makeDb(client) {
  let updateCount = 0;
  return {
    updateCount: () => updateCount,
    async selectAccount() {
      const { data, error } = await client.from(ACCOUNTS_TABLE)
        .select("id,provider_key,channel,readiness_status,configuration_status,webhook_status,"
          + "health_status,billing_status,business_account_reference,phone_number_reference")
        .eq("provider_key", PROVIDER_KEY).eq("channel", CHANNEL);
      if (error) return { ok: false, rows: null };
      return { ok: true, rows: data ?? [] };
    },
    /** The ONLY mutating call in this file. A second attempt throws rather than writes. */
    async rebindOnce(patch, cas) {
      if (updateCount > 0) throw new Error("SECOND_UPDATE_REFUSED");
      const keys = Object.keys(patch).sort();
      if (keys.join(",") !== [...REBINDABLE_COLUMNS].sort().join(",")) {
        throw new Error("PATCH_SHAPE_REFUSED");
      }
      updateCount += 1;
      try {
        const { data, error } = await client.from(ACCOUNTS_TABLE)
          .update(patch)
          .eq("provider_key", cas.provider_key)
          .eq("channel", cas.channel)
          .eq("business_account_reference", cas.business_account_reference)
          .eq("phone_number_reference", cas.phone_number_reference)
          .neq("readiness_status", SEND_CAPABLE_READINESS)
          .select();
        if (error) return { threw: false, ok: false, rows: null };
        return { threw: false, ok: true, rows: data ?? [] };
      } catch {
        return { threw: true, ok: false, rows: null };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// CLI. Only runs as entry point, so the validator imports the pure layer freely.
// ---------------------------------------------------------------------------
const isEntry = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isEntry) {
  const env = process.env;
  const parsedFlags = parseFlags(process.argv.slice(2));
  // QF-MVP-40-R8 — spent historical authority: the write bit is forced false here,
  // before the Supabase client is constructed. Dry-run reading still works.
  const flags = retireHistoricalMutation(parsedFlags, { operatorId: "QF-MVP-40-R7C", mutationKey: "mayWrite" });

  console.log("== QF-MVP-40-R7C one-shot staging provider-account rebind ==");
  if (!flags.ok) {
    console.log(`RESULT: REFUSED (${flags.reason}: ${flags.flag}) — no client constructed, no write`);
    process.exit(1);
  }
  console.log(`   mode                    : ${flags.mayWrite ? "EXECUTE" : "DRY RUN"}`);
  console.log(historicalRetirementBanner(flags.retiredOperatorId));
  console.log(`   target row              : ${PROVIDER_KEY} / ${CHANNEL}`);

  // -- The environment identity fence, BEFORE any client exists --------------
  const target = resolveStagingTarget(env);
  if (!target.ok) {
    console.log(`RESULT: REFUSED (${RebindFailure.ENV_FENCE_REFUSED}: ${target.reason}`
      + `${target.missing ? ` ${target.missing}` : ""}) — no client constructed, no write`);
    process.exit(2);
  }
  console.log(`   target ref              : ${target.projectRef} (${target.environment}) — identity proven`);

  const denyProof = loadDenyProof(env);
  console.log(`   owner deny proof        : ${denyProof.ok ? "LOADED (external)" : "REFUSED -> " + denyProof.reason}`);

  const identity = validateNewIdentity(env, denyProof.ok ? denyProof.digests : null);
  console.log(`   new identity authorised : ${identity.ok}${identity.ok ? "" : " -> " + identity.faults.join(", ")}`);

  if (!denyProof.ok || !identity.ok) {
    console.log("RESULT: REFUSED (preflight) — zero database writes");
    process.exit(1);
  }

  const run = async () => {
    const { createClient } = await import("@supabase/supabase-js");
    const client = createClient(env.QF_STAGING_SUPABASE_URL, env.QF_STAGING_SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } });
    const db = makeDb(client);

    const read = await db.selectAccount();
    if (!read.ok) {
      console.log("RESULT: REFUSED (account table unreadable) — zero writes");
      return 1;
    }
    const pre = classifyPreState(read.rows, { denyDigests: denyProof.digests });
    console.log(`   rows matched            : ${read.rows.length}`);
    console.log(`   pre-state               : ${pre.state}`);
    if (pre.row) console.log(`   readiness_status        : ${pre.row.readiness_status}`);

    const decision = decide({ flags, identity, denyProof, preState: pre.state });

    if (decision.outcome === Outcome.ALREADY_REBOUND) {
      console.log(`UPDATE_ATTEMPT_COUNT=${db.updateCount()}`);
      console.log("RESULT: ALREADY_REBOUND — no write. Rebind authority is spent.");
      return 0;
    }
    if (!decision.write) {
      console.log(`UPDATE_ATTEMPT_COUNT=${db.updateCount()}`);
      if (decision.outcome === Outcome.DRY_RUN_WOULD_REBIND) {
        console.log(`   would UPDATE columns    : ${REBINDABLE_COLUMNS.join(", ")}`);
        console.log(`   would set (digests)     : waba=${identity.digests.wabaId.slice(0, 12)}… `
          + `phone=${identity.digests.phoneNumberId.slice(0, 12)}…`);
        console.log("WOULD_REBIND=YES");
        console.log(`RESULT: DRY RUN — zero database writes. Re-run with --execute ${OWNER_ACK_FLAG} to rebind.`);
        return 0;
      }
      console.log(`RESULT: REFUSED (${decision.reason}) — zero writes`);
      return 1;
    }

    // -- THE single guarded UPDATE --------------------------------------------
    const patch = buildRebindPatch(env);
    const cas = buildCasPredicate(pre.row);
    const res = await db.rebindOnce(patch, cas);
    console.log(`UPDATE_ATTEMPT_COUNT=${db.updateCount()}`);

    if (res.threw || !res.ok) {
      console.log(`RESULT: ${Outcome.REBIND_AMBIGUOUS} (${RebindFailure.WRITE_OUTCOME_UNCERTAIN}) — `
        + "no retry, no second UPDATE. Re-run in DRY RUN to observe the settled state.");
      return 1;
    }
    if (res.rows.length === 0) {
      console.log(`RESULT: REFUSED (${RebindFailure.CAS_LOST}) — the row changed under us; zero rows updated`);
      return 1;
    }

    // ONE read-only readback, independent of the UPDATE's own returned representation.
    const back = await db.selectAccount();
    const post = verifyPostState(back.ok ? back.rows : null);
    console.log(`   post-state proof        : ${post.ok}${post.ok ? "" : " -> " + post.reason}`);
    if (post.ok) {
      console.log(`   readiness_status        : ${post.row.readiness_status} (unchanged, not send-capable)`);
      console.log(`   bound to (digests)      : waba=${sha256Hex(post.row.business_account_reference).slice(0, 12)}… `
        + `phone=${sha256Hex(post.row.phone_number_reference).slice(0, 12)}…`);
    }
    if (!post.ok) {
      console.log(`RESULT: ${Outcome.REBIND_AMBIGUOUS} — exactly ${db.updateCount()} UPDATE, no retry`);
      return 1;
    }
    console.log(`RESULT: ${Outcome.REBOUND} — exactly ${db.updateCount()} UPDATE, no retry. `
      + "Rebind authority is now spent; provider activation remains NOT GRANTED.");
    return 0;
  };

  /**
   * Set `exitCode` and let the loop drain rather than calling process.exit().
   *
   * supabase-js keeps undici sockets open; on Windows an abrupt process.exit() while those
   * handles are mid-close aborts the runtime with
   *   Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), src\win\async.c
   * and the shell then observes 127 — AFTER the RESULT line has already printed. For an
   * authority whose whole job is an auditable outcome, an exit code that contradicts the
   * printed result is a correctness bug, not cosmetics. The early refusal paths above still
   * use process.exit() safely: they run before any client, and so hold no open handle.
   */
  run().then((code) => { process.exitCode = code; }).catch(() => {
    console.log("RESULT: REFUSED (unexpected failure) — no retry");
    process.exitCode = 1;
  });
}
