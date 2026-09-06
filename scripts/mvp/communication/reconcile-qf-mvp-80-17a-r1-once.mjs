#!/usr/bin/env node
// ============================================================================
// QF-MVP-80.17A-R1 — ONE-SHOT historical lead-assignment intent reconciliation.
//
// WHAT THIS IS
//   A disposable operator for ONE known production anomaly: the QF-MVP-80.16D-R2
//   controlled trial left a canonical communication_messages row at `failed`
//   while its derived communication_intents row stayed `dispatched`. That intent
//   predates QF-MVP-80.17A and no further Meta webhook is expected for it, so
//   deploying 80.17A cannot converge it.
//
// WHAT THIS IS NOT
//   Not a bulk reconciler, not an admin surface, not an HTTP route, not a cron
//   job, not a retry worker, not a resend or replay path, and not a generic SQL
//   repair. It can address only the exact lineage inside a hard-coded
//   thirty-minute trial window, and only one row.
//
// IT OWNS NO RECONCILIATION LOGIC
//   The repair is performed by the already-reviewed, already-deployed
//   `reconcileLeadAssignmentDeliveryResults` in services/leadAssignmentResultService.ts.
//   This operator supplies nothing but the canonical provider message identity;
//   the service re-reads canonical truth, derives the status through the shared
//   projection authority, enforces forward-only progression and applies the
//   three-fence compare-and-set. There is deliberately no
//   `UPDATE communication_intents SET status = ...` anywhere in this file and no
//   fallback that could introduce one.
//
// STRUCTURALLY INCAPABLE OF SENDING
//   No provider, no adapter, no CommunicationService, no fetch, no Graph URL, no
//   /messages endpoint, no webhook replay, no INSERT of any kind, no retry, no
//   scheduler, no n8n, and no Meta credential is read. The operator loader
//   additionally REFUSES to load any send-capable module.
//
// MODES (dry run by default)
//   (no flags)                                   offline no-op; never touches a DB
//   --preflight-readonly                         production SELECTs only; may mint one attestation
//   --execute --owner-authorized-once-...        re-proves everything, then ONE reconciliation call
//
// PRIVACY
//   Terminal output carries digests, never raw ids, and never a destination,
//   phone number, recipient reference, name, payload, token, key or URL.
// ============================================================================

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  R1,
  R1CandidateState,
  R1FailureEvidence,
  R1Mode,
  R1Refusal,
  assertCanonAgrees,
  buildR1Attestation,
  certifyR1PostState,
  certifyR1Summary,
  certifyR1WritePlan,
  classifyR1FailureEvidence,
  classifyR1Pair,
  decideR1Discovery,
  decideR1Environment,
  digestOf,
  isR1AttestationPathOutsideRepo,
  parseR1Args,
  r1FailureCodeIsSafeToPrint,
  validateR1Attestation,
} from "./qf-mvp-80-17a-r1-operator-contract.mjs";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..", "..");
const LOADER = path.join(REPO_ROOT, "scripts", "mvp", "operator", "qf-mvp-80-17a-r1-runtime-register.cjs");

/** Outside the repository, always. Never committed, never a credential store. */
const ATTESTATION_PATH = path.join(tmpdir(), "qf-mvp-80-17a-r1-attestation.json");

const INTENT_COLUMNS = "id, aggregate_type, channel, template_purpose, status, created_at, dispatched_at";
const MESSAGE_COLUMNS =
  "id, channel, template_key, entity_type, entity_id, idempotency_key, status, provider, " +
  "provider_message_id, provider_account_id, failure_code";

const line = (k, v) => console.log(`   ${String(k).padEnd(34)} ${v}`);
const rule = () => console.log("=".repeat(78));

function refuse(reason, exitCode = 2) {
  rule();
  console.log("QF-MVP-80.17A-R1 REFUSED");
  line("reason", reason);
  line("database writes performed", "0");
  rule();
  process.exit(exitCode);
}

function gitFact(args) {
  return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" }).trim();
}

// ---------------------------------------------------------------------------
// Read-only discovery. SELECTs only — the column lists above are the privacy
// fence: no destination_hash, no destination_masked, no recipient reference, no
// variables and no metadata are ever read.
// ---------------------------------------------------------------------------

async function discover(db, canon) {
  const intentQuery = await db
    .from("communication_intents")
    .select(INTENT_COLUMNS)
    .eq("aggregate_type", canon.aggregateType)
    .eq("channel", canon.intentChannel)
    .eq("template_purpose", canon.templatePurpose)
    .gte("created_at", R1.TRIAL_WINDOW_START_ISO)
    .lt("created_at", R1.TRIAL_WINDOW_END_ISO);
  if (intentQuery.error) return { ok: false, reason: "INTENT_READ_FAILED" };

  const intents = intentQuery.data ?? [];
  const classified = [];
  for (const intent of intents) {
    const messageQuery = await db
      .from("communication_messages")
      .select(MESSAGE_COLUMNS)
      .eq("entity_type", canon.intentEntityType)
      .eq("entity_id", intent.id);
    if (messageQuery.error) return { ok: false, reason: "MESSAGE_READ_FAILED" };

    const messages = messageQuery.data ?? [];
    if (messages.length === 0) {
      classified.push({ ...classifyR1Pair({ intent, message: null, canon }), failureCode: null });
      continue;
    }
    // Every message is classified on its own. Two linked messages therefore
    // surface as two candidates and the run refuses, rather than one being
    // silently preferred.
    for (const message of messages) {
      classified.push({ ...classifyR1Pair({ intent, message, canon }), failureCode: message.failure_code ?? null });
    }
  }
  return { ok: true, intents, classified };
}

/** Re-reads exactly the two rows the repair concerns. Read-only. */
async function readPair(db, canon, intentId, messageId) {
  const i = await db.from("communication_intents").select(INTENT_COLUMNS).eq("id", intentId).maybeSingle();
  if (i.error) return { ok: false, reason: "INTENT_READ_FAILED" };
  const m = await db.from("communication_messages").select(MESSAGE_COLUMNS).eq("id", messageId).maybeSingle();
  if (m.error) return { ok: false, reason: "MESSAGE_READ_FAILED" };
  void canon;
  return { ok: true, intent: i.data ?? null, message: m.data ?? null };
}

// ---------------------------------------------------------------------------

async function main() {
  const parsed = parseR1Args(process.argv.slice(2));

  if (parsed.mode === R1Mode.REFUSED) refuse(parsed.reason);

  if (parsed.mode === R1Mode.OFFLINE_NOOP) {
    rule();
    console.log("QF-MVP-80.17A-R1 — one-shot historical intent reconciliation (OFFLINE NO-OP)");
    line("mode", R1Mode.OFFLINE_NOOP);
    line("database reads performed", "0");
    line("database writes performed", "0");
    console.log("");
    console.log(`   read-only preflight:  ${R1.PREFLIGHT_FLAG}`);
    console.log(`   guarded execution:    ${R1.EXECUTE_FLAG} ${R1.OWNER_ACK_FLAG}`);
    rule();
    process.exit(0);
  }

  // --- 1. Repository facts ------------------------------------------------
  const gitSha = gitFact(["rev-parse", "HEAD"]);
  if (gitFact(["status", "--porcelain"]) !== "") refuse(R1Refusal.WORKING_TREE_DIRTY);

  // --- 2. Production identity, proved BEFORE any client construction ------
  const env = decideR1Environment({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    serviceRoleKeyPresent:
      typeof process.env.SUPABASE_SERVICE_ROLE_KEY === "string" && process.env.SUPABASE_SERVICE_ROLE_KEY !== "",
  });
  if (!env.allowed) refuse(env.reason);

  // --- 3. The deployed authority ------------------------------------------
  const runtime = require(LOADER).loadR1Runtime();
  const canon = runtime.canon;
  const canonOk = assertCanonAgrees(canon);
  if (!canonOk.ok) refuse(canonOk.reason);
  if (!isR1AttestationPathOutsideRepo(ATTESTATION_PATH, REPO_ROOT)) {
    refuse(R1Refusal.ATTESTATION_INSIDE_REPOSITORY);
  }

  const db = runtime.adminClient();

  rule();
  console.log("QF-MVP-80.17A-R1 — one-shot historical intent reconciliation");
  line("mode", parsed.mode);
  line("project ref", env.projectRef);
  line("git sha", gitSha);
  line("trial window start (frozen)", R1.TRIAL_WINDOW_START_ISO);
  line("trial window end (frozen)", R1.TRIAL_WINDOW_END_ISO);
  rule();

  // --- 4. Read-only discovery ---------------------------------------------
  const found = await discover(db, canon);
  if (!found.ok) refuse(found.reason);

  const decision = decideR1Discovery(found.classified);
  line("intents inside window", String(found.intents.length));
  line("pairs classified", String(found.classified.length));
  line("discovery verdict", decision.state === R1Mode.REFUSED ? decision.reason : decision.state);

  if (decision.state === R1CandidateState.ALREADY_RECONCILED) {
    rule();
    console.log("QF-MVP-80.17A-R1 ALREADY_RECONCILED — exact historical lineage located and proved.");
    line("database writes performed", "0");
    rule();
    process.exit(0);
  }
  if (decision.state !== R1CandidateState.CANDIDATE) refuse(decision.reason);

  const candidate = decision.candidate;
  const candidateRow = found.classified.find((r) => r.state === R1CandidateState.CANDIDATE);
  const evidence = classifyR1FailureEvidence(candidateRow?.failureCode);
  if (evidence === R1FailureEvidence.CONTRADICTS_KNOWN_TRIAL) {
    line(
      "failure code",
      r1FailureCodeIsSafeToPrint(String(candidateRow.failureCode)) ? String(candidateRow.failureCode).trim() : "opaque"
    );
    refuse("FAILURE_EVIDENCE_CONTRADICTS_KNOWN_TRIAL");
  }

  line("candidate intent", digestOf(candidate.intentId));
  line("candidate message", digestOf(candidate.messageId));
  line("provider message id", digestOf(candidate.providerMessageId));
  line("provider account id", digestOf(candidate.providerAccountId));
  line("idempotency key", digestOf(candidate.idempotencyKey));
  line("observed intent status", candidate.observedIntentStatus);
  line("canonical message status", candidate.canonicalMessageStatus);
  line("131026 evidence", evidence);

  // --- 5. Prove the write the deployed contract WOULD plan ----------------
  const pairRows = await readPair(db, canon, candidate.intentId, candidate.messageId);
  if (!pairRows.ok) refuse(pairRows.reason);
  const planned = runtime.evaluate({ intent: pairRows.intent, message: pairRows.message });
  const planCertified = certifyR1WritePlan({
    decision: planned,
    canon,
    appliedOutcome: runtime.appliedOutcome,
  });
  line("planned write", planCertified.certified ? "CERTIFIED single-column CAS" : planCertified.reason);
  if (!planCertified.certified) refuse(planCertified.reason);
  line("plan table", planned.plan.table);
  line("plan patch column", Object.keys(planned.plan.patch).join(","));
  line("plan patch value", planned.plan.patch[canon.reconcileColumn]);
  line("plan fences", planned.plan.filters.map(([c]) => c).join(","));

  // --- 6A. Preflight: mint the single-use attestation and stop ------------
  if (parsed.mode === R1Mode.PREFLIGHT_READONLY) {
    const attestation = buildR1Attestation({
      candidate,
      projectRef: env.projectRef,
      gitSha,
      nowMs: Date.now(),
    });
    writeFileSync(ATTESTATION_PATH, `${JSON.stringify(attestation, null, 2)}\n`, { mode: 0o600 });
    rule();
    console.log("QF-MVP-80.17A-R1 PREFLIGHT PASS — read-only. No database write was performed.");
    line("database writes performed", "0");
    line("attestation", ATTESTATION_PATH);
    line("attestation ttl", `${R1.ATTESTATION_TTL_MS / 60000} minutes`);
    line("next step", `${R1.EXECUTE_FLAG} ${R1.OWNER_ACK_FLAG}`);
    rule();
    process.exit(0);
  }

  // --- 6B. Execute: re-validate the attestation, then ONE service call ----
  let attestation = null;
  if (existsSync(ATTESTATION_PATH)) {
    try {
      attestation = JSON.parse(readFileSync(ATTESTATION_PATH, "utf8"));
    } catch {
      attestation = { schema: "unparsable" };
    }
  }
  const attestationCheck = validateR1Attestation({
    attestation,
    nowMs: Date.now(),
    projectRef: env.projectRef,
    gitSha,
    candidate,
  });
  line("attestation", attestationCheck.ok ? "VALID (single use)" : attestationCheck.reason);
  if (!attestationCheck.ok) refuse(attestationCheck.reason);

  // The attestation is consumed BEFORE the call, so a crash mid-write can never
  // leave a reusable authorization behind.
  rmSync(ATTESTATION_PATH, { force: true });

  let calls = 0;
  let summary = null;
  try {
    calls += 1;
    summary = await runtime.reconcile({
      provider: candidate.provider,
      providerMessageIds: [candidate.providerMessageId],
      providerAccountId: candidate.providerAccountId,
    });
  } catch {
    // Never retried, never repaired by hand: the canonical row is already
    // correct and a later explicit action starts from a fresh preflight.
    refuse("RECONCILIATION_CALL_THREW", 3);
  }

  const certified = certifyR1Summary(summary);
  line("service calls", String(calls));
  line("summary.examined", String(summary?.examined));
  line("summary.applied", String(summary?.applied));
  line("summary.unchanged", String(summary?.unchanged));
  line("summary.notApplicable", String(summary?.notApplicable));
  line("summary.concurrent", String(summary?.concurrent));
  line("summary.refused", String(summary?.refused));
  line("summary.outcomes", JSON.stringify(summary?.outcomes ?? {}));
  if (!certified.certified) {
    rule();
    console.log("QF-MVP-80.17A-R1 NOT CERTIFIED");
    line("reason", certified.reason);
    line("automatic retry", "none — a later explicit action must re-run the preflight");
    rule();
    process.exit(3);
  }

  // --- 7. Read-back proof --------------------------------------------------
  const after = await readPair(db, canon, candidate.intentId, candidate.messageId);
  if (!after.ok) refuse(after.reason, 3);
  const post = certifyR1PostState({
    message: after.message,
    intent: after.intent,
    canon,
    before: candidate,
  });
  line("post canonical message", after.message?.status);
  line("post derived intent", after.intent?.status);
  line("post dispatched_at", post.certified ? "unchanged" : "CHECK FAILED");
  if (!post.certified) {
    rule();
    console.log("QF-MVP-80.17A-R1 NOT CERTIFIED");
    line("reason", post.reason);
    rule();
    process.exit(3);
  }

  rule();
  console.log("QF-MVP-80.17A-R1 EXECUTION CERTIFIED — one guarded projection write, one row.");
  line("service calls", String(calls));
  line("attestation", "consumed");
  rule();
  process.exit(0);
}

main().catch(() => {
  // A closed vocabulary even here: no stack, no driver text, no identifiers.
  refuse("UNEXPECTED_OPERATOR_ERROR", 3);
});
