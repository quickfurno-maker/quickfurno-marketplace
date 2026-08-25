// ============================================================================
// QF-MVP-40-R8A — ONE-SHOT governed REPAIR of the staging provider-account identity
// binding.  DRY RUN BY DEFAULT.
//
//   node scripts/mvp/communication/repair-meta-staging-account-identity-once.mjs
//     -> DRY RUN. Proves the environment, the owner proof, the new identity and the
//        pre-state. Zero database writes.
//
//   … --execute --owner-authorized-once-identity-repair
//     -> Performs AT MOST ONE compare-and-swap UPDATE of EXACTLY TWO columns.
//
// WHY THIS EXISTS, AND WHY IT IS NOT R7C RERUN
//   R7C rebound this row on 2026-08-13 and its authority is spent and CLOSED. It wrote
//   the digests it believed were the dedicated staging WABA and phone. Live diagnosis on
//   2026-08-25 proved those two digests are the PRODUCTION WABA and PRODUCTION phone —
//   R7C's identity pins were a MIXED triple (genuine staging app, production WABA/phone).
//
//   R7C is therefore NOT reopened. Repointing its constants would silently convert a
//   spent authority into a live one against a DIFFERENT WABA, which is precisely the
//   governance failure QF-MVP-40-R8 exists to prevent. R7C stays retired and read-only;
//   this is a NEW authority, with its OWN acknowledgement flag, its OWN writable
//   pre-state and its OWN manifest.
//
// THE OWNER PROOF MUST NOW AGREE WITH THE BOUNDARY
//   R7C consumed an external, role-labelled production deny-proof, and its
//   `validateNewIdentity` refuses any new identity that appears in it. R7C's write
//   succeeded, so the deny-proof it was given on 2026-08-13 did NOT list the digests it
//   was about to write as production. Today those digests ARE known to be production.
//   So this operator additionally requires the refreshed deny-proof to declare exactly
//   those digests as the production WABA and phone. Without that, the owner would be
//   asserting two contradictory boundaries at once, and the repair would rest on an
//   artifact that already disagrees with the evidence. See DENY_PROOF_CONTRADICTS_BOUNDARY.
//
// WHAT IT CANNOT DO — enforced below and asserted by the validator
//   * no Meta network call of any kind;   * no send, mapping, provider or canary authority;
//   * no INSERT / DELETE / upsert / rpc — not expressible through the port at all;
//   * no readiness, configuration, verification, webhook, health or billing column;
//   * no generic row selector — provider_key and channel are pinned constants;
//   * no second UPDATE, ever, including after an uncertain outcome;
//   * no production project — the environment fence runs before a client is constructed.
// ============================================================================

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// The audited R7C PURE layer. Imported, never copied. Importing a spent operator's pure
// helpers is safe and deliberate: its CLI is retired, its mutation bit is forced false,
// and none of these functions can write anything.
import {
  ACCOUNTS_TABLE,
  CHANNEL,
  DENY_PROOF_ENV,
  PROVIDER_KEY,
  REBINDABLE_COLUMNS,
  REQUIRED_READINESS,
  SEND_CAPABLE_READINESS,
  isInsideRepository,
  loadDenyProof,
  parseDenyProof,
} from "./rebind-meta-staging-provider-account-once.mjs";
import { resolveStagingTarget } from "./seed-meta-staging-inactive-mappings.mjs";
import {
  ACTUAL_STAGING_IDENTITY_DIGESTS,
  HISTORICAL_MIXED_IDENTITY_DIGESTS,
  classifyStagingIdentity,
  sha256Hex,
} from "./metaStagingIdentity.mjs";

export { ACCOUNTS_TABLE, CHANNEL, PROVIDER_KEY, REBINDABLE_COLUMNS, REQUIRED_READINESS,
         SEND_CAPABLE_READINESS, DENY_PROOF_ENV, isInsideRepository, loadDenyProof,
         parseDenyProof, sha256Hex };

/**
 * The exact acknowledgement flag. Deliberately DIFFERENT from R7C's
 * `--owner-authorized-once-rebind` and from R7B's `--owner-authorized-once`: an
 * acknowledgement that was already spent on a different WABA must not authorise this one.
 */
export const OWNER_ACK_FLAG = "--owner-authorized-once-identity-repair";

export const RepairFailure = Object.freeze({
  UNKNOWN_FLAG: "UNKNOWN_FLAG",
  ENV_FENCE_REFUSED: "ENV_FENCE_REFUSED",
  DENY_PROOF_PATH_MISSING: "DENY_PROOF_PATH_MISSING",
  DENY_PROOF_INSIDE_REPO: "DENY_PROOF_INSIDE_REPO",
  DENY_PROOF_UNREADABLE: "DENY_PROOF_UNREADABLE",
  DENY_PROOF_CONTRADICTS_BOUNDARY: "DENY_PROOF_CONTRADICTS_BOUNDARY",
  IDENTITY_MISSING: "IDENTITY_MISSING",
  IDENTITY_NOT_ACTUAL_STAGING: "IDENTITY_NOT_ACTUAL_STAGING",
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
  BOUND_TO_HISTORICAL_MIXED: "BOUND_TO_HISTORICAL_MIXED",
  ALREADY_REPAIRED: "ALREADY_REPAIRED",
  UNRECOGNIZED_BINDING: "UNRECOGNIZED_BINDING",
});

export const Outcome = Object.freeze({
  DRY_RUN_WOULD_REPAIR: "DRY_RUN_WOULD_REPAIR",
  ALREADY_REPAIRED: "ALREADY_REPAIRED",
  REPAIRED: "REPAIRED",
  REPAIR_AMBIGUOUS: "REPAIR_AMBIGUOUS",
  REFUSED: "REFUSED",
});

// ---------------------------------------------------------------------------
// PURE: flags. Dry run unless BOTH flags are present, exactly. An unknown flag is
// REFUSED rather than ignored, so a typo cannot degrade into a dry run that the
// operator then reports as a success.
// ---------------------------------------------------------------------------
export function parseFlags(argv = []) {
  const known = new Set(["--execute", OWNER_ACK_FLAG]);
  const unknown = argv.filter((a) => !known.has(a));
  if (unknown.length > 0) {
    return { ok: false, reason: RepairFailure.UNKNOWN_FLAG, flag: unknown[0], mayWrite: false };
  }
  const execute = argv.includes("--execute");
  const ownerAck = argv.includes(OWNER_ACK_FLAG);
  return { ok: true, execute, ownerAck, mayWrite: execute && ownerAck };
}

// ---------------------------------------------------------------------------
// PURE: the owner deny-proof must AGREE with the corrected boundary.
//
// The proof's production WABA/phone digests must be exactly the digests this repair
// is moving the row AWAY from. If they are not, the owner's external artifact and the
// committed boundary disagree about which assets are production, and no write may rest
// on that disagreement.
// ---------------------------------------------------------------------------
export function verifyDenyProofAgreesWithBoundary(denyDigests) {
  if (!denyDigests) return { ok: false, reason: RepairFailure.DENY_PROOF_UNREADABLE };
  const agrees = denyDigests.wabaId === HISTORICAL_MIXED_IDENTITY_DIGESTS.wabaId
    && denyDigests.phoneNumberId === HISTORICAL_MIXED_IDENTITY_DIGESTS.phoneNumberId;
  if (!agrees) return { ok: false, reason: RepairFailure.DENY_PROOF_CONTRADICTS_BOUNDARY };
  return { ok: true, reason: null };
}

// ---------------------------------------------------------------------------
// PURE: the NEW identity. All three roles are proven even though only two columns are
// written — an operator that repairs staging must not run in a half-configured
// environment. The production deny-list inside classifyStagingIdentity is an
// independent second layer behind the actual-staging allow-list.
// ---------------------------------------------------------------------------
export function validateRepairIdentity(env = {}) {
  const supplied = {
    appId: env.QF_META_APP_ID,
    wabaId: env.QF_META_WABA_ID,
    phoneNumberId: env.QF_META_PHONE_NUMBER_ID,
  };
  const classified = classifyStagingIdentity(supplied);
  return { ok: classified.ok, faults: classified.faults, digests: classified.digests };
}

// ---------------------------------------------------------------------------
// PURE: pre-state of the single account row.
//
// BOUND_TO_HISTORICAL_MIXED is the ONLY writable state, and it requires BOTH stored
// references to match the historical pins. A row carrying one historical reference and
// one of something else is UNRECOGNIZED_BINDING — half-migrated is never "close enough".
// ---------------------------------------------------------------------------
export function classifyPreState(rows, {
  historicalDigests = HISTORICAL_MIXED_IDENTITY_DIGESTS,
  stagingDigests = ACTUAL_STAGING_IDENTITY_DIGESTS,
} = {}) {
  if (!Array.isArray(rows) || rows.length === 0) return { state: PreState.ABSENT, row: null };
  if (rows.length > 1) return { state: PreState.AMBIGUOUS, row: null };
  const row = rows[0];

  // Checked before the binding: a send-capable row is never touched, whatever it holds.
  if (row.readiness_status === SEND_CAPABLE_READINESS) return { state: PreState.SEND_CAPABLE, row };

  const waba = row.business_account_reference;
  const phone = row.phone_number_reference;
  if (waba == null || String(waba) === "" || phone == null || String(phone) === "") {
    return { state: PreState.REFERENCES_NULL, row };
  }

  const wabaDigest = sha256Hex(waba);
  const phoneDigest = sha256Hex(phone);

  if (wabaDigest === stagingDigests.wabaId && phoneDigest === stagingDigests.phoneNumberId) {
    return { state: PreState.ALREADY_REPAIRED, row };
  }
  if (wabaDigest === historicalDigests.wabaId && phoneDigest === historicalDigests.phoneNumberId) {
    return { state: PreState.BOUND_TO_HISTORICAL_MIXED, row };
  }
  return { state: PreState.UNRECOGNIZED_BINDING, row };
}

// ---------------------------------------------------------------------------
// PURE: the patch. EXACTLY the two reference columns. There is no branch in this
// function that could add a third, so the operation is structurally incapable of
// touching readiness, configuration, verification, webhook, health or billing state.
// ---------------------------------------------------------------------------
export function buildRepairPatch(env = {}) {
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
// PURE: the whole decision. Only BOUND_TO_HISTORICAL_MIXED + both flags may ever write.
// ---------------------------------------------------------------------------
export function decide({ flags, identity, denyProof, boundaryAgreement, preState }) {
  const refuse = (reason) => ({ write: false, outcome: Outcome.REFUSED, reason });
  if (!flags.ok) return refuse(`${flags.reason}:${flags.flag ?? ""}`);
  if (!denyProof.ok) return refuse(denyProof.reason);
  if (!boundaryAgreement.ok) return refuse(boundaryAgreement.reason);
  if (!identity.ok) return refuse(identity.faults.join(","));

  if (preState === PreState.ALREADY_REPAIRED) {
    return { write: false, outcome: Outcome.ALREADY_REPAIRED,
             reason: "row already carries the actual staging identity" };
  }
  if (preState === PreState.ABSENT) return refuse(RepairFailure.ACCOUNT_ABSENT);
  if (preState === PreState.AMBIGUOUS) return refuse(RepairFailure.ACCOUNT_AMBIGUOUS);
  if (preState === PreState.SEND_CAPABLE) return refuse(RepairFailure.ACCOUNT_SEND_CAPABLE);
  if (preState === PreState.REFERENCES_NULL) return refuse(RepairFailure.ACCOUNT_REFERENCES_NULL);
  if (preState !== PreState.BOUND_TO_HISTORICAL_MIXED) return refuse(RepairFailure.UNRECOGNIZED_BINDING);

  if (!flags.mayWrite) return { write: false, outcome: Outcome.DRY_RUN_WOULD_REPAIR, reason: null };
  return { write: true, outcome: null, reason: null };
}

// ---------------------------------------------------------------------------
// PURE: post-state proof. The write is only "done" if the row now carries the ACTUAL
// staging identity AND has not escalated out of `disabled`.
// ---------------------------------------------------------------------------
export function verifyPostState(rows, { stagingDigests = ACTUAL_STAGING_IDENTITY_DIGESTS } = {}) {
  if (!Array.isArray(rows) || rows.length !== 1) {
    return { ok: false, reason: RepairFailure.READBACK_MISMATCH };
  }
  const row = rows[0];
  if (sha256Hex(row.business_account_reference) !== stagingDigests.wabaId
      || sha256Hex(row.phone_number_reference) !== stagingDigests.phoneNumberId) {
    return { ok: false, reason: RepairFailure.READBACK_MISMATCH };
  }
  if (row.readiness_status !== REQUIRED_READINESS) {
    return { ok: false, reason: RepairFailure.READINESS_ESCALATED };
  }
  return { ok: true, reason: null, row };
}

// ---------------------------------------------------------------------------
// Database port. There is deliberately NO insert, delete, upsert or rpc method: those
// operations are not expressible through this adapter, which is stronger than choosing
// not to call them. UPDATE is hard-limited to ONE per process and refuses any patch
// whose shape is not exactly the two rebindable columns.
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
    async repairOnce(patch, cas) {
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
  const flags = parseFlags(process.argv.slice(2));

  console.log("== QF-MVP-40-R8A one-shot staging provider-account IDENTITY REPAIR ==");
  if (!flags.ok) {
    console.log(`RESULT: REFUSED (${flags.reason}: ${flags.flag}) — no client constructed, no write`);
    process.exit(1);
  }
  console.log(`   mode                    : ${flags.mayWrite ? "EXECUTE" : "DRY RUN"}`);
  console.log(`   target row              : ${PROVIDER_KEY} / ${CHANNEL}`);

  // -- The environment identity fence, BEFORE any client exists --------------
  const target = resolveStagingTarget(env);
  if (!target.ok) {
    console.log(`RESULT: REFUSED (${RepairFailure.ENV_FENCE_REFUSED}: ${target.reason}`
      + `${target.missing ? ` ${target.missing}` : ""}) — no client constructed, no write`);
    process.exit(2);
  }
  console.log(`   target ref              : ${target.projectRef} (${target.environment}) — identity proven`);

  const denyProof = loadDenyProof(env);
  console.log(`   owner deny proof        : ${denyProof.ok ? "LOADED (external)" : "REFUSED -> " + denyProof.reason}`);

  const boundaryAgreement = verifyDenyProofAgreesWithBoundary(denyProof.ok ? denyProof.digests : null);
  console.log(`   proof agrees w/ boundary: ${boundaryAgreement.ok}`
    + `${boundaryAgreement.ok ? "" : " -> " + boundaryAgreement.reason}`);

  const identity = validateRepairIdentity(env);
  console.log(`   new identity authorised : ${identity.ok}${identity.ok ? "" : " -> " + identity.faults.join(", ")}`);

  if (!denyProof.ok || !boundaryAgreement.ok || !identity.ok) {
    console.log("UPDATE_ATTEMPT_COUNT=0");
    console.log("RESULT: REFUSED (preflight) — zero database writes");
    process.exit(1);
  }

  const run = async () => {
    const { createClient } = await import("@supabase/supabase-js");
    const client = createClient(env.QF_STAGING_SUPABASE_URL, env.QF_STAGING_SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const db = makeDb(client);

    const selected = await db.selectAccount();
    if (!selected.ok) {
      console.log(`UPDATE_ATTEMPT_COUNT=${db.updateCount()}`);
      console.log("RESULT: REFUSED (account read failed) — zero database writes");
      return 1;
    }
    const pre = classifyPreState(selected.rows);
    console.log(`   row pre-state           : ${pre.state}`);
    if (pre.row) console.log(`   readiness_status        : ${pre.row.readiness_status}`);

    const decision = decide({ flags, identity, denyProof, boundaryAgreement, preState: pre.state });

    if (decision.outcome === Outcome.ALREADY_REPAIRED) {
      console.log(`UPDATE_ATTEMPT_COUNT=${db.updateCount()}`);
      console.log("RESULT: ALREADY_REPAIRED — no write. Repair authority is spent.");
      return 0;
    }
    if (!decision.write) {
      console.log(`UPDATE_ATTEMPT_COUNT=${db.updateCount()}`);
      if (decision.outcome === Outcome.DRY_RUN_WOULD_REPAIR) {
        console.log(`   would UPDATE columns    : ${REBINDABLE_COLUMNS.join(", ")}`);
        console.log(`   would set WABA digest   : ${identity.digests.wabaId}`);
        console.log(`   would set phone digest  : ${identity.digests.phoneNumberId}`);
        console.log("WOULD_WRITE=YES");
        console.log(`RESULT: DRY RUN — zero database writes. Re-run with --execute ${OWNER_ACK_FLAG} to repair.`);
        return 0;
      }
      console.log(`RESULT: REFUSED (${decision.outcome}: ${decision.reason}) — zero database writes`);
      return 1;
    }

    // -- THE single compare-and-swap UPDATE -----------------------------------
    const res = await db.repairOnce(buildRepairPatch(env), buildCasPredicate(pre.row));
    console.log(`UPDATE_ATTEMPT_COUNT=${db.updateCount()}`);
    if (res.threw || !res.ok) {
      // The outcome is UNCERTAIN, not failed. It is never retried: a second UPDATE is
      // structurally refused, and a blind re-run is how a one-shot becomes a two-shot.
      console.log(`RESULT: ${Outcome.REPAIR_AMBIGUOUS} (${RepairFailure.WRITE_OUTCOME_UNCERTAIN})`
        + " — no retry. Verify the row out of band before any further action.");
      return 2;
    }
    if (!Array.isArray(res.rows) || res.rows.length !== 1) {
      console.log(`RESULT: REFUSED (${RepairFailure.CAS_LOST}) — the row changed under the compare-and-swap`);
      return 1;
    }

    // ONE read-only readback.
    const back = await db.selectAccount();
    const post = verifyPostState(back.ok ? back.rows : null);
    console.log(`   post-state proven       : ${post.ok}${post.ok ? "" : " -> " + post.reason}`);
    if (!post.ok) {
      console.log(`RESULT: ${Outcome.REPAIR_AMBIGUOUS} (${post.reason}) — no retry`);
      return 2;
    }
    console.log(`   readiness_status        : ${post.row.readiness_status} (unchanged, fail-closed)`);
    console.log(`RESULT: ${Outcome.REPAIRED} — exactly ${db.updateCount()} UPDATE, two columns, no retry`);
    return 0;
  };

  run().then((code) => process.exit(code)).catch(() => {
    console.log("RESULT: REFUSED (unexpected failure) — no retry");
    process.exit(1);
  });
}
