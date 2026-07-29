import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

/**
 * Phase 5F-D3-B — OUTBOUND CONSENT ENFORCEMENT.
 *
 * The pure scope registry, the coordinator, CommunicationService's single authoritative gate, and the
 * SMS authentication fallback gate are all driven through INJECTED fakes:
 *   • D2-C is a fake `decide` — the real decision authority is never loaded, never called;
 *   • Supabase is a STUB that throws if touched, plus a small compare-and-set fake table for the
 *     ledger tests (it models the REAL `.eq(id).eq(status)` semantics, so a lost race is a lost race);
 *   • the WhatsApp/SMS providers are fakes that COUNT calls — so "zero provider calls" is proven, not
 *     asserted by inspection.
 *
 * It never connects to Supabase, never reaches Meta/Exotel/any network, and never reads a real
 * credential. Every mutation is restored byte-identically in a `finally` block.
 */

const tsc = resolve("node_modules/typescript/bin/tsc");
if (!existsSync(tsc)) throw new Error("TypeScript compiler not found. Run npm install first.");

// The full transitive graph CommunicationService needs, compiled once.
const TS_FILES = [
  "lib/errors.ts",
  "lib/supabase.ts",
  "lib/identity/principal.ts",
  "lib/identity/verification.ts",
  "lib/identity/clientAccount.ts",
  "lib/identity/authSecurityEvent.ts",
  "lib/communication/types.ts",
  "lib/communication/phone.ts",
  "lib/communication/dbErrors.ts",
  "lib/communication/recipientResolver.ts",
  "lib/communication/channelDispatchGuard.ts",
  "lib/communication/whatsappTemplate.ts",
  "lib/communication/approvedTemplateOutbound.ts",
  "lib/communication/providerMappingFingerprint.ts",
  "lib/communication/canonicalJson.ts",
  "lib/communication/providers/whatsappProvider.ts",
  "lib/communication/providers/providerError.ts",
  "lib/communication/providers/mockWhatsAppProvider.ts",
  "lib/communication/outboundConsentScope.ts",
  "services/communicationRecipientResolver.ts",
  "services/communicationService.ts",
  "services/outboundConsentEnforcementService.ts",
];

const SCOPE_SRC = "lib/communication/outboundConsentScope.ts";
const COORD_SRC = "services/outboundConsentEnforcementService.ts";
const COMM_SRC = "services/communicationService.ts";
const RUNTIME_SRC = "services/runtimeCommunicationService.ts";
const ORCH_SRC = "services/clientLoginOtpDeliveryOrchestrator.ts";
const HARNESS_SRC = "scripts/phase5f-d3b-outbound-consent-enforcement-harness.mjs";
const DOC_SRC = "docs/QF-Outbound-Consent-Enforcement-Phase-5F-D3-B.md";

// The frozen consent authorities D3-B may call but must NEVER modify.
const D2C_SRC = "services/communicationConsentDecisionService.ts";
const D2D_WRITER_SRC = "services/communicationConsentWriterService.ts";
const D2D_COMMAND_SRC = "lib/communication/consentCommand.ts";
const POLICY_SRC = "lib/communication/consentPolicy.ts";
const D2E_ORCH_SRC = "services/inboundConsentCommandService.ts";
const D2E_INPUT_SRC = "lib/communication/inboundConsentCommandInput.ts";

/**
 * The 5F-B harness — PINNED TO A FIXED AUTHORITY BASELINE (Phase 8B-0).
 *
 * During Phase 5F-D3-B this file was frozen to a single approved `.in()` line. Phase 8B-0 — reviewed and
 * passed — legitimately re-baselined it (Phase 8A made the consent enforcer a REQUIRED, fail-closed
 * constructor argument, so 5F-B's Meta send-chain constructions had to state a test consent posture).
 *
 * The AUTHORITY BOUNDARY is now a BYTE-FREEZE against a fixed commit, NOT a count heuristic. The on-disk
 * 5F-B must be byte-identical to the blob committed at `PHASE_8B0_HARNESS_HEAD`. That runs even on a clean
 * tree, so BOTH a dirty edit AND a later committed edit fail D3-B until an EXPLICIT authority transfer
 * re-pins `PHASE_8B0_HARNESS_HEAD`. The check/assert count logic survives only as SUPPLEMENTAL defence in
 * depth — it can never be the boundary, because an equal-count edit (swap one real assertion for a harmless
 * one) still changes the bytes and still fails.
 *
 * The pinned range is CLOSED at both ends and never references the moving HEAD, so later phases cannot
 * expand or reopen it.
 */
const PHASE5FB_SRC = "scripts/phase5f-b-whatsapp-cloud-api-harness.mjs";

/** The FIXED Phase 8B-0 authority range for the 5F-B harness. Both endpoints are immutable SHAs. */
const PHASE_8B0_AUTHORITY_BASE = "832bacc29b3955f19ad80d09af06f317fa5b9f98";
const PHASE_8B0_HARNESS_HEAD = "b6c288b232dc0ee0c19fa4f5d92a654ef0bc807c";
/** The committed 5F-B baseline's EXECUTABLE-registration counts (supplemental; a re-pin updates them too). */
const PHASE5FB_EXPECTED_CHECKS = 60;
const PHASE5FB_EXPECTED_MUTATIONS = 63;

/**
 * The two legacy SMS-fallback harnesses. FOUNDER-APPROVED to receive an INJECTED TEST CONSENT ENFORCER,
 * because the orchestrator no longer has any implicit allow: absent an injected enforcer it loads the REAL
 * coordinator, which these isolated builds do not contain. The `allow` therefore lives ONLY in their
 * dependency objects — never in production code. `B4` proves they REMOVE nothing (no assertion weakened).
 */
const LEGACY_SMS_HARNESSES = [
  "scripts/phase5f-c3b-client-otp-fallback-harness.mjs",
  "scripts/phase5f-c3c1-client-otp-resolved-sms-harness.mjs",
];

/** PHASE 8A — the webhook now states its consent posture, and 5B states its test posture. */
const WEBHOOK_SRC = "services/metaWhatsAppWebhookService.ts";
const PHASE5B_SRC = "scripts/phase5b-communication-core-harness.mjs";
/**
 * The historical harnesses whose freeze/scope guards Phase 8A legitimately updates. They are NOT being
 * declared mutable: each one TRANSFERS the authority for the two released shared files to THIS harness,
 * which now owns and proves the fail-closed consent properties (P8A-1..17). Each keeps every other guard.
 */
const PHASE_8A_UPDATED_HARNESSES = [
  "scripts/phase5f-d4c-consent-ack-async-harness.mjs",
  "scripts/phase5f-d4b-consent-command-response-harness.mjs",
  "scripts/phase5f-d2e-inbound-consent-integration-harness.mjs",
  "scripts/phase5f-d1b-whatsapp-inbound-persistence-harness.mjs",
];

const D3B_EXPECTED_FILES = [
  DOC_SRC,
  "lib/communication/outboundConsentScope.ts",
  "package.json",
  HARNESS_SRC,
  // NOTE: PHASE5FB_SRC is DELIBERATELY NOT here. 5F-B is not a generally-allowed dirty file; it is pinned
  // by the Phase 8B-0 BYTE-FREEZE (see provePhase8B0MetaHarnessAuthority), which fails any on-disk change
  // with a clear authority-transfer error before the dirty-scope loop is ever reached.
  ...LEGACY_SMS_HARNESSES,
  "services/clientLoginOtpDeliveryOrchestrator.ts",
  "services/communicationService.ts",
  "services/outboundConsentEnforcementService.ts",
  "services/runtimeCommunicationService.ts",
  // Phase 8A scope.
  WEBHOOK_SRC,
  PHASE5B_SRC,
  ...PHASE_8A_UPDATED_HARNESSES,
];

// ── PHASE 8B-1A AUTHORITY TRANSFER ──────────────────────────────────────────────────────────────────
// Phase 8B-1A binds Meta callbacks to expected identity. It legitimately re-writes the 5F-B harness and the
// D4-B harness (and the webhook service, whose freeze the D1-B harness owns). Their ACTIVE on-disk byte-freeze
// TRANSFERS from the Phase 8B-0 head to the FIXED Phase 8B-1A implementation head (Commit 1). The Phase 8B-0
// layer keeps proving its immutable history and NEVER moves.
const PHASE_8B0_5FB_HISTORICAL_BLOB = "1338002f9a30dd6205fcbc78ef59213407f1d8e5";
const PHASE_8B1A_AUTHORITY_BASE = "95c5e969ce585fd435019fdb17265ece6fdb9c1d";
const PHASE_8B1A_IMPLEMENTATION_HEAD = "fe10c2c70691809952f53c7244b8d3b5cb1a150d";
const PHASE5FD4B_SRC = "scripts/phase5f-d4b-consent-command-response-harness.mjs";
const PHASE8B1A_HARNESS_SRC = "scripts/phase8b1-meta-callback-identity-harness.mjs";
/**
 * EXACT count pin (never a lower bound). Transferred 16 → 17 for exactly ONE reviewed Stage 2E addition:
 * the 8B-1A harness's `D5` check, which proves that passing the callback-identity gate is NOT sufficient on
 * its own — an authorized identity whose provider account is UNOWNED yields ZERO receipt, inbound, delivery,
 * consent-command and acknowledgement effects. The count therefore rose because the harness got STRICTER.
 *
 * This is not a general allowance for future test additions: any further change to this number requires its
 * own explicit authority transfer, exactly as this one did.
 */
const PHASE8B1A_HARNESS_CHECKS = 17;
const PHASE8B1A_HARNESS_MUTATIONS = 16;
const PHASE_8B1A_APPROVED_ROUTE = "app/api/webhooks/whatsapp/meta/route.ts";
/** The EXACT ten files the fixed Phase 8B-1A range (base..head) may contain — nothing more, nothing less. */
const PHASE_8B1A_EXPECTED_FILES = [
  PHASE_8B1A_APPROVED_ROUTE,
  "docs/QF-Meta-Callback-Identity-Phase-8B-1A.md",
  "lib/communication/providers/metaCallbackIdentity.ts",
  "lib/communication/providers/metaCloudWhatsAppConfig.ts",
  "lib/communication/providers/metaWebhookRawBody.ts",
  "lib/communication/providers/metaWhatsAppWebhook.ts",
  PHASE5FB_SRC,
  PHASE5FD4B_SRC,
  PHASE8B1A_HARNESS_SRC,
  WEBHOOK_SRC,
];
/**
 * The Commit-1 blobs the Phase 8B-1A implementation head resolves each frozen file to. IMMUTABLE HISTORY
 * (both 5F-B and D4-B): these commit-blob facts NEVER move, whatever later phases do. The ACTIVE on-disk
 * 5F-B freeze has TRANSFERRED to the Phase 8B-1B-B authority (provePhase8B1BBOutboundAccountAttributionAuthority);
 * D4-B's active on-disk freeze STAYS with Phase 8B-1A. See PHASE_8B1A_ONDISK_TRANSFERRED below.
 */
const PHASE_8B1A_FROZEN_BLOBS = [
  [PHASE5FB_SRC, "0af67dd47d380f9c09698fbc4f8fc983974c125c"],
  [PHASE5FD4B_SRC, "5cf652122fa0c12f5137c8d9b157b4156ce56abd"],
];
/** Phase 8B-1B-B TRANSFERRED the ACTIVE on-disk 5F-B freeze out of Phase 8B-1A — exactly ONE path (5F-B).
 *  D4-B does NOT transfer; no other Phase 8B-1A file transfers. */
const PHASE_8B1A_ONDISK_TRANSFERRED = [PHASE5FB_SRC];
/** What Phase 8B-1A STILL freezes on-disk: the historical set MINUS the transferred paths (⇒ D4-B only).
 *  The historical commit-blob facts above continue to cover BOTH files unconditionally. */
const PHASE_8B1A_ACTIVE_ONDISK_BLOBS = PHASE_8B1A_FROZEN_BLOBS.filter(
  ([p]) => !PHASE_8B1A_ONDISK_TRANSFERRED.includes(p)
);

// ============================================================================
// PHASE 8B-1B-C — D4-B GOVERNANCE-HARNESS AUTHORITY (a PARALLEL layer, Item 3).
// Phase 8B-1B-C re-aligned the D4-B harness (D2-E delta authority 159->166 exact-line fragments + an added
// byte freeze for services/consentCommandResponseService.ts). Its on-disk pin is DELEGATED to this layer.
//
// This deliberately does NOT route through PHASE_8B1A_ONDISK_TRANSFERRED. That list, its exact length/order
// pin, the "D4-B stays active" assertion, the 5F-B absence assertion and the unlisted-transfer sweep are all
// left literally untouched — emptying the 8B-1A active set would make the sweep vacuously true and silently
// retire the model. Instead the historical 8B-1A record STANDS, and this layer supersedes only the on-disk
// comparison for exactly ONE named path, and only after proving itself.
// ============================================================================
const PHASE_8B1BC_IMPLEMENTATION_HEAD = "e742bb149b635f63b00975fa93be0a5fc14a2e24";
/** The historical D4-B blob 8B-1A recorded. Re-stated here so a silent rewrite of history is detectable. */
const PHASE_8B1BC_D4B_HISTORICAL_BLOB = "5cf652122fa0c12f5137c8d9b157b4156ce56abd";
/** The finalized, reviewed C8B-1B-C D4-B governance harness blob. PRESERVED as the predecessor record. */
const PHASE_8B1BC_D4B_HARNESS_BLOB = "d7e54e4d0f830858fbe2d56d36131bc2f7fdaee9";
/**
 * C8B-1B-D6 WAVE 2A-R1 — the successor D4-B governance-harness blob, and the CURRENT on-disk authority.
 *
 * WHY IT MOVED. Wave 2A-R1 closed the Class L runtime gap in services/consentCommandResponseService.ts:
 * an UNBOUND (legacy-NULL) parent inbound row used to be inherited as null and enqueued, producing an
 * acknowledgement intent with provider_account_id = NULL. Binding is now mandatory and such a parent
 * fails closed. Two things in the D4-B harness therefore had to change: its ACC9 check (which asserted
 * the OLD legacy-NULL-enqueues contract) and its byte freeze for the runtime file (re-pinned from the
 * C8B-1B-C blob to the Wave 2A-R1 blob).
 *
 * The C8B-1B-C and 8B-1A records above are UNCHANGED and still verified — history is preserved, not
 * rewritten. This layer supersedes only the ON-DISK comparison, and only after proving itself.
 */
const PHASE_8B1BD6W2AR1_IMPLEMENTATION_HEAD = "8a81dcd37e406f39c070a95c0c326732e5550cd2";
/** The Wave 2A-R1 D4-B blob as first reviewed. PRESERVED as the predecessor of the evidence repair. */
const PHASE_8B1BD6W2AR1_D4B_HARNESS_BLOB = "81175f6e19af1d09f1485ad9762626323e28efb3";
/**
 * C8B-1B-D6 WAVE 2A-R1 EVIDENCE REPAIR - the CURRENT on-disk D4-B authority.
 *
 * WHY IT MOVED AGAIN. The independent audit of PR #16 found two checks in the dedicated Wave 2A-R1
 * harness that could not fail: both searched a string-ERASING view for evidence carried by string
 * literals (a Supabase table name, a module specifier), so an injected
 * `.from("communication_provider_accounts")` and an injected resolver import were both accepted.
 * The repair rewrote those predicates to read a string-PRESERVING view, added self-tests proving
 * they can fail, and added the missing direct-query mutation family (M13a-e).
 *
 * D4-B consequently gained an EXACT BLOB PIN for the successor harness plus anti-vacuity assertions
 * - content checks alone had not caught it, because the checks were present and simply did nothing.
 * That changed D4-B's own bytes, so this delegated pin advances with it.
 *
 * Both earlier blobs above remain recorded and asserted: history is preserved, never rewritten.
 */
const PHASE_8B1BD6W2AR1R_D4B_HARNESS_BLOB = "8c514f7a19403272ee9c87b4b64439a99e64ab35";

/**
 * QF-MVP-40.1-R - the CURRENT on-disk D4-B authority.
 *
 * WHY IT MOVED AGAIN. D4-B carries an exact blob pin for the Wave 2A-R1 successor harness. That
 * successor proved a HISTORICAL narrowness claim over a range ending at a moving `HEAD`, so it
 * re-asserted the claim against every later phase and began failing once QF-MVP-20/30 landed.
 * QF-MVP-40.1-R pinned both range endpoints to literals and added an ancestry assertion, which
 * changed the successor's bytes and therefore D4-B's pin of it - so this delegated pin advances too.
 *
 * NOTHING WAS WEAKENED. No assertion was deleted, downgraded or made conditional; D4-B's
 * anti-vacuity content checks are unchanged and still enforced independently of any blob value.
 *
 * Every earlier blob above remains recorded and asserted: history is preserved, never rewritten.
 */
const PHASE_QFMVP401R_D4B_HARNESS_BLOB = "dd6956d0fe740121fbc8aca095d5ff55c2d1f56d";
/** EXACTLY the paths whose 8B-1A on-disk comparison is delegated to this layer. Exactly one, by identity. */
const PHASE_8B1BC_DELEGATED_ONDISK_AUTHORITIES = [PHASE5FD4B_SRC];

/**
 * The PROOF TOKEN. Null until the prover has passed EVERY assertion below. The delegated branch of the
 * 8B-1A active loop requires it to equal the reviewed blob, so deleting, bypassing or short-circuiting the
 * prover makes that loop FAIL rather than silently skip — the delegation is load-bearing, not a hole.
 */
let phase8B1BCD4BAuthorityToken = null;

function provePhase8B1BCD4BGovernanceAuthority() {
  phase8B1BCD4BAuthorityToken = null;   // never inherit a token from a previous call

  // Structural validity of the delegation set — exactly one path, no duplicates, no substitution.
  assert(Array.isArray(PHASE_8B1BC_DELEGATED_ONDISK_AUTHORITIES), "the delegated-authority set is an array");
  assert(PHASE_8B1BC_DELEGATED_ONDISK_AUTHORITIES.length === 1, "exactly ONE on-disk authority is delegated to Phase 8B-1B-C");
  assert(PHASE_8B1BC_DELEGATED_ONDISK_AUTHORITIES[0] === PHASE5FD4B_SRC, "the sole delegated path is the D4-B governance harness");
  assert(new Set(PHASE_8B1BC_DELEGATED_ONDISK_AUTHORITIES).size === PHASE_8B1BC_DELEGATED_ONDISK_AUTHORITIES.length, "the delegated set contains no duplicates");

  // Provenance: the implementation commit exists, is forward-only from the 8B-1A head, and precedes HEAD.
  assert(execFileSync("git", ["cat-file", "-t", PHASE_8B1BC_IMPLEMENTATION_HEAD], { encoding: "utf8" }).trim() === "commit",
    "the C8B-1B-C implementation commit " + PHASE_8B1BC_IMPLEMENTATION_HEAD.slice(0, 12) + " must exist");
  execFileSync("git", ["merge-base", "--is-ancestor", PHASE_8B1A_IMPLEMENTATION_HEAD, PHASE_8B1BC_IMPLEMENTATION_HEAD]); // throws if not
  execFileSync("git", ["merge-base", "--is-ancestor", PHASE_8B1BC_IMPLEMENTATION_HEAD, "HEAD"]);                          // throws if not

  // HISTORY IS PRESERVED, NOT REWRITTEN: the 8B-1A record for D4-B must still hold its original blob.
  const historical = PHASE_8B1A_FROZEN_BLOBS.find(([p]) => p === PHASE5FD4B_SRC);
  assert(historical && historical[1] === PHASE_8B1BC_D4B_HISTORICAL_BLOB,
    "the historical Phase 8B-1A D4-B blob must remain recorded and unrewritten");
  assert(PHASE_8B1BC_D4B_HISTORICAL_BLOB !== PHASE_8B1BC_D4B_HARNESS_BLOB,
    "the transfer genuinely moves the on-disk pin to a NEW reviewed blob");

  // ── C8B-1B-D6 WAVE 2A-R1 SUCCESSOR PROVENANCE ────────────────────────────────────────────────────
  // Forward-only: 8B-1A head → C8B-1B-C head → Wave 2A-R1 head → HEAD. Each throws if violated.
  assert(execFileSync("git", ["cat-file", "-t", PHASE_8B1BD6W2AR1_IMPLEMENTATION_HEAD], { encoding: "utf8" }).trim() === "commit",
    "the C8B-1B-D6 Wave 2A-R1 implementation commit " + PHASE_8B1BD6W2AR1_IMPLEMENTATION_HEAD.slice(0, 12) + " must exist");
  execFileSync("git", ["merge-base", "--is-ancestor", PHASE_8B1BC_IMPLEMENTATION_HEAD, PHASE_8B1BD6W2AR1_IMPLEMENTATION_HEAD]); // throws if not
  execFileSync("git", ["merge-base", "--is-ancestor", PHASE_8B1BD6W2AR1_IMPLEMENTATION_HEAD, "HEAD"]);                          // throws if not
  assert(PHASE_8B1BD6W2AR1_D4B_HARNESS_BLOB !== PHASE_8B1BC_D4B_HARNESS_BLOB,
    "the Wave 2A-R1 transfer genuinely moves the on-disk pin to a NEW reviewed blob");
  assert(PHASE_8B1BD6W2AR1_D4B_HARNESS_BLOB !== PHASE_8B1BC_D4B_HISTORICAL_BLOB,
    "the Wave 2A-R1 pin is not a silent revert to the 8B-1A historical blob");

  // EVIDENCE-REPAIR SUCCESSOR - must differ from EVERY predecessor, so no pin is a silent revert.
  for (const [prior, label] of [
    [PHASE_8B1BD6W2AR1_D4B_HARNESS_BLOB, "the Wave 2A-R1 reviewed blob"],
    [PHASE_8B1BC_D4B_HARNESS_BLOB, "the C8B-1B-C reviewed blob"],
    [PHASE_8B1BC_D4B_HISTORICAL_BLOB, "the 8B-1A historical blob"],
  ]) {
    assert(PHASE_8B1BD6W2AR1R_D4B_HARNESS_BLOB !== prior,
      "the evidence-repair pin is not a silent revert to " + label);
  }
  for (const [prior, label] of [
    [PHASE_8B1BD6W2AR1R_D4B_HARNESS_BLOB, "the evidence-repair blob"],
    [PHASE_8B1BD6W2AR1_D4B_HARNESS_BLOB, "the Wave 2A-R1 reviewed blob"],
    [PHASE_8B1BC_D4B_HARNESS_BLOB, "the C8B-1B-C reviewed blob"],
    [PHASE_8B1BC_D4B_HISTORICAL_BLOB, "the 8B-1A historical blob"],
  ]) {
    assert(PHASE_QFMVP401R_D4B_HARNESS_BLOB !== prior,
      "the QF-MVP-40.1-R pin is not a silent revert to " + label);
  }

  // Fixed-literal self-proof, following the 8B-1B-A / 8B-1B-B convention. EVERY generation of the
  // pin - historical, C8B-1B-C, Wave 2A-R1 and the evidence repair - stays an exact fixed literal.
  const selfSrc = readF(HARNESS_SRC);
  for (const blob of [
    PHASE_8B1BC_D4B_HISTORICAL_BLOB,
    PHASE_8B1BC_D4B_HARNESS_BLOB,
    PHASE_8B1BD6W2AR1_D4B_HARNESS_BLOB,
    PHASE_8B1BD6W2AR1R_D4B_HARNESS_BLOB,
    PHASE_QFMVP401R_D4B_HARNESS_BLOB,
  ]) {
    assert(selfSrc.includes('"' + blob + '"'), "the pinned blob " + blob.slice(0, 12) + " is an exact fixed literal");
  }

  // THE ACTIVE ON-DISK FREEZE for the delegated path — exact blob equality, same strength as 8B-1A.
  // The CURRENT authority is the Wave 2A-R1 successor; the C8B-1B-C blob above remains the verified
  // predecessor record.
  const onDisk = execFileSync("git", ["hash-object", PHASE5FD4B_SRC], { encoding: "utf8" }).trim();
  assert(onDisk === PHASE_QFMVP401R_D4B_HARNESS_BLOB,
    PHASE5FD4B_SRC + " is not byte-identical to its reviewed QF-MVP-40.1-R blob. " +
    "A change — dirty OR committed — requires an EXPLICIT AUTHORITY TRANSFER " +
    "(on-disk " + onDisk.slice(0, 12) + " != pinned " + PHASE_QFMVP401R_D4B_HARNESS_BLOB.slice(0, 12) + ").");

  phase8B1BCD4BAuthorityToken = PHASE_QFMVP401R_D4B_HARNESS_BLOB;   // set ONLY after every assertion passed
  return phase8B1BCD4BAuthorityToken;
}

// ============================================================================
// PHASE 8B-1B-A — PROVIDER-ACCOUNT BINDING AUTHORITY.
// The reviewed implementation commit is FROZEN here: its exact four-file range, its exact 3A/1M status
// composition, and the byte-identity of all four reviewed files. This CLOSES a real gap: before this
// transfer the implementation was protected only while DIRTY (by the generic scope loop in B4). Once
// committed it became invisible — the migration could have been rewritten and re-committed with nothing
// detecting it. The Phase 8A / 8B-0 / 8B-1A authorities above are untouched and never move.
// ============================================================================
const PHASE_8B1BA_AUTHORITY_BASE = "1fd6e99d7f2ab65d7bc66908dea20a8d258318fa";
const PHASE_8B1BA_IMPLEMENTATION_HEAD = "73201296ef4206e8d505f7a94cfbfcfb68edf9ec";
const PHASE_8B1BA_OWNERSHIP_SRC = "lib/communication/providers/providerAccountOwnership.ts";
const PHASE_8B1BA_HARNESS_SRC = "scripts/phase8b1ba-provider-account-binding-harness.mjs";
const PHASE_8B1BA_RUNTIME_SRC = "services/communicationProviderRuntimeService.ts";
const PHASE_8B1BA_MIGRATION_SRC = "supabase/migrations/20260716000100_communication_provider_account_binding.sql";
/** The EXACT four files the fixed Phase 8B-1B-A range (base..head) may contain — nothing more, nothing less. */
const PHASE_8B1BA_EXPECTED_FILES = [
  PHASE_8B1BA_OWNERSHIP_SRC,
  PHASE_8B1BA_HARNESS_SRC,
  PHASE_8B1BA_RUNTIME_SRC,
  PHASE_8B1BA_MIGRATION_SRC,
];
/** The reviewed blobs at the implementation head. A change — dirty OR later COMMITTED — fails here until
 *  an EXPLICIT authority transfer re-pins them. This is the primary authority. */
const PHASE_8B1BA_FROZEN_BLOBS = [
  [PHASE_8B1BA_OWNERSHIP_SRC, "5197d132b8a7f33061590c282693a70fe1bae13e"],
  [PHASE_8B1BA_HARNESS_SRC, "14b5ecdefe16b32fe613d27f6acc2eae10b6b398"],
  [PHASE_8B1BA_RUNTIME_SRC, "0c8874692b0a4072eb04ba10b935fb0d2e2bcc82"],
  [PHASE_8B1BA_MIGRATION_SRC, "aa5d5a1f0f8883de744531cdb358d72d8b598375"],
];
/** The dedicated harness's executable shape — defence in depth for any future EXPLICIT re-pin, so a
 *  re-pinned harness can never quietly drop its evidence. Counts are supplemental to the anchors. */
const PHASE8B1BA_HARNESS_CHECKS = 16;
const PHASE8B1BA_HARNESS_MUTATIONS = 48;
const PHASE8B1BA_INFRA_SELF_TESTS = 4;
const PHASE8B1BA_MUTATION_FAMILIES = [["OWN-", 2], ["DBR-", 3], ["RES-", 4], ["QRY-", 8], ["PRJ-", 5], ["GRM-", 6], ["SQL-", 20]];

// ============================================================================
// PHASE 8B-1B-B — OUTBOUND PROVIDER-ACCOUNT ATTRIBUTION AUTHORITY.
// The reviewed implementation commit (51b251d) is FROZEN here: its exact six-file range, its exact 2A/4M
// composition, and the byte-identity of all six reviewed files — AND it RECEIVES the transferred active
// on-disk 5F-B freeze. Every prior authority (8A / 8B-0 / 8B-1A / 8B-1B-A) is untouched and never moves.
// ============================================================================
const PHASE_8B1BB_AUTHORITY_BASE = "bef87673ad6b867f200d27d2fa79dd7f1fd595bd";
const PHASE_8B1BB_IMPLEMENTATION_HEAD = "51b251d3dc790494c33028827a9aaec1bd9418dc";
const PHASE_8B1BB_TYPES_SRC = "lib/communication/types.ts";
const PHASE_8B1BB_ATTRIBUTION_SRC = "lib/communication/outboundProviderAccountAttribution.ts";
const PHASE_8B1BB_PHASE5FB_SRC = "scripts/phase5f-b-whatsapp-cloud-api-harness.mjs";
const PHASE_8B1BB_HARNESS_SRC = "scripts/phase8b1bb-outbound-account-attribution-harness.mjs";
const PHASE_8B1BB_COMM_SRC = "services/communicationService.ts";
const PHASE_8B1BB_RUNTIME_SRC = "services/runtimeCommunicationService.ts";
/** The EXACT six files the fixed Phase 8B-1B-B range (base..head) may contain — nothing more, nothing less. */
const PHASE_8B1BB_EXPECTED_FILES = [
  PHASE_8B1BB_ATTRIBUTION_SRC,   // A
  PHASE_8B1BB_HARNESS_SRC,       // A
  PHASE_8B1BB_TYPES_SRC,         // M
  PHASE_8B1BB_PHASE5FB_SRC,      // M
  PHASE_8B1BB_COMM_SRC,          // M
  PHASE_8B1BB_RUNTIME_SRC,       // M
];
/** The exact composition: two ADDITIONS, four MODIFICATIONS. */
const PHASE_8B1BB_ADDED_FILES = [PHASE_8B1BB_ATTRIBUTION_SRC, PHASE_8B1BB_HARNESS_SRC];
const PHASE_8B1BB_MODIFIED_FILES = [PHASE_8B1BB_TYPES_SRC, PHASE_8B1BB_PHASE5FB_SRC, PHASE_8B1BB_COMM_SRC, PHASE_8B1BB_RUNTIME_SRC];
/** The reviewed implementation-head blobs — derived via `git rev-parse 51b251d:<path>`. A change — dirty OR
 *  later COMMITTED — fails until another EXPLICIT authority transfer re-pins them. This is the primary authority. */
const PHASE_8B1BB_FROZEN_BLOBS = [
  [PHASE_8B1BB_ATTRIBUTION_SRC, "09b8e68d665224b544cc005044c0b79cdc7892bc"],
  [PHASE_8B1BB_TYPES_SRC, "47e0637980395c0f39ccceebb66914ab5d9998ee"],
  [PHASE_8B1BB_PHASE5FB_SRC, "811aa832cb2bcbdae7f9d3b178cf23c62bdbebe4"],
  [PHASE_8B1BB_HARNESS_SRC, "8634bbe267c05c681c0186f59edf9675eeec0bc9"],
  [PHASE_8B1BB_COMM_SRC, "8d24e0a1a6430b2bde1957af641232e3522b5d15"],
  [PHASE_8B1BB_RUNTIME_SRC, "af5f19f4877f56822ccae8f996e425491f91152b"],
];
/** The NEW ACTIVE Phase 5F-B blob — the byte the TRANSFERRED on-disk freeze now pins (== the 8B-1B-B 5F-B pin). */
const PHASE_8B1BB_ACTIVE_5FB_BLOB = "811aa832cb2bcbdae7f9d3b178cf23c62bdbebe4";
/** The dedicated harness's executable shape (defence in depth for a future EXPLICIT re-pin). Counts are the
 *  ACTUAL reviewed registrations: 16 functional check() + 4 INFRA self-tests = 20 functional; 31 mutations. */
const PHASE8B1BB_HARNESS_CHECKS = 16;
const PHASE8B1BB_INFRA_SELF_TESTS = 4;
const PHASE8B1BB_FUNCTIONAL_TOTAL = 20;
const PHASE8B1BB_HARNESS_MUTATIONS = 31;
/** Every ACTUAL mutation-family prefix and count from the committed harness. The family sum MUST equal 31. */
const PHASE8B1BB_MUTATION_FAMILIES = [["CAS", 5], ["DEP", 4], ["FIL", 4], ["MAP", 5], ["ORD", 3], ["RTE", 1], ["RUN", 6], ["VAL", 3]];
/** Phase 5F-B totals — the updated test-only wiring leaves both totals unchanged. */
const PHASE_8B1BB_5FB_CHECKS = 60;
const PHASE_8B1BB_5FB_MUTATIONS = 63;

// ----------------------------------------------------------------------------
// PHASE 8B-1B-D6 WAVE 1 — DELIVERY-EVENT PROVIDER-ACCOUNT CONSTRAINT AUTHORITY.
//
// Wave 1 adds a database-level guarantee that every communication_delivery_events row carries a
// non-NULL provider_account_id. It introduces exactly TWO NEW files and modifies NO existing
// runtime or harness file, so it takes a NARROW, INDIVIDUALLY-NAMED carve-out in the dirty-scope
// loop below rather than any category-level widening.
//
// The carve-out is deliberately per-path, not `^supabase/migrations/`: a blanket migration
// allowance would let ANY future migration through the D3-B gate, which is precisely the property
// this harness exists to deny. Both paths are additionally BYTE-FROZEN, so the carve-out admits
// exactly the reviewed bytes and nothing else.
// ----------------------------------------------------------------------------
/** The reviewed C8B-1B-D6 Wave 1 IMPLEMENTATION commit (migration + dedicated harness). */
/** The C8B-1B-C INTEGRATION merge Wave 1 branched from. This — not the C8B-1B-C implementation
 *  head — is the correct range base: the 8B-1B-C governance commit sits between them, and using the
 *  implementation head would fold its three files into the Wave 1 range. */
const PHASE_8B1BD6W1_BASE = "503c00ecf8e82cf24a6dc13d60d5ff6b21439d1c";
/** Wave 1 landed in TWO implementation commits: 1b8cd90 (migration + harness) and f7b973f
 *  (the mandatory database proofs A-H). The authority pins the LATTER, because the freeze must
 *  match the bytes on disk. The 503c00e..f7b973f range is still exactly the same two files. */
const PHASE_8B1BD6W1_IMPLEMENTATION_HEAD = "f7b973fa651ae70f1bd8083e2055ed885d594d02";
const PHASE_8B1BD6W1_MIGRATION_SRC = "supabase/migrations/20260720000100_communication_delivery_event_provider_account_required.sql";
const PHASE_8B1BD6W1_HARNESS_SRC = "scripts/phase8b1bd6w1-delivery-event-account-constraint-harness.mjs";
/** The exact two paths Wave 1 is authorised to introduce. Any third path is unauthorised. */
const PHASE_8B1BD6W1_EXPECTED_FILES = [PHASE_8B1BD6W1_MIGRATION_SRC, PHASE_8B1BD6W1_HARNESS_SRC];
/** Reviewed implementation-head blobs — `git rev-parse 1b8cd90:<path>`. A change (dirty OR later
 *  COMMITTED) fails until another EXPLICIT authority transfer re-pins them. */
const PHASE_8B1BD6W1_FROZEN_BLOBS = [
  [PHASE_8B1BD6W1_MIGRATION_SRC, "f2b4b8c9620e1805760c8bf45fb4bafa138df201"],
  [PHASE_8B1BD6W1_HARNESS_SRC, "414295cd787157a8d656f8edc4d95fc1122a7e30"],
];
/**
 * QF-MVP-40.1-R AUTHORITY TRANSFER — the CURRENT on-disk Wave 1 bytes.
 *
 * Until now the historical blob and the on-disk blob were the same value, so one table served both
 * assertions. They must now diverge, and the HISTORICAL record above is deliberately left untouched:
 * `git rev-parse <implementation-head>:<path>` is a fact about a past commit and rewriting it would
 * be falsifying history, which this harness explicitly forbids.
 *
 * WHAT MOVED, AND WHY. Only the Wave 1 HARNESS. The Wave 1 MIGRATION blob is unchanged, and the
 * enforced table, constraint name and predicate are unchanged. Wave 1 assertion 5.5 read "no Wave 2
 * / Wave 3 constraint migration present" — written while Wave 1 was the newest wave. Wave 2A-R2 has
 * since been reviewed and merged, so that fence rejected an APPROVED successor. It was re-expressed
 * as an exact-identity invariant: exactly the one approved Wave 2A-R2 migration may exist, matched
 * by full filename. An unapproved Wave 2B/Wave 3 sibling still fails — the property the original
 * fence actually protected. Verified by negative test: adding an unapproved sibling fails 5.5.
 */
const PHASE_8B1BD6W1_ACTIVE_BLOBS = [
  [PHASE_8B1BD6W1_MIGRATION_SRC, "f2b4b8c9620e1805760c8bf45fb4bafa138df201"],
  [PHASE_8B1BD6W1_HARNESS_SRC, "4698c68584de0c0b0f5d6276bab774a5257e4f9a"],
];
/** The EXACT enforced object. A rename, a re-table or a re-predicate is an authority change. */
const PHASE_8B1BD6W1_TARGET_TABLE = "communication_delivery_events";
const PHASE_8B1BD6W1_CONSTRAINT_NAME = "communication_delivery_events_provider_account_required_check";
const PHASE_8B1BD6W1_PREDICATE = "check (provider_account_id is not null)";
/** Published ONLY after every Wave 1 assertion passes. The dirty-scope carve-out below requires it. */
let phase8B1BD6W1AuthorityToken = null;

/**
 * PHASE 8B-1B-D6 WAVE 1 AUTHORITY. Ancestry + the fixed two-file range + the byte-freeze of both
 * files + the EXECUTABLE shape of the enforced DDL. Runs BEFORE the generic dirty-scope loop, so a
 * dirty OR later-committed change to the migration or the dedicated harness fails with a clear
 * authority-transfer error instead of a generic scope message — or, once committed, instead of
 * passing silently.
 */
function provePhase8B1BD6W1DeliveryEventConstraintAuthority() {
  // 1) THE RANGE IS FIXED AND MINIMAL.
  assert(Array.isArray(PHASE_8B1BD6W1_EXPECTED_FILES), "the Wave 1 range is an array");
  assert(PHASE_8B1BD6W1_EXPECTED_FILES.length === 2, "Wave 1 introduces EXACTLY two files");
  assert(new Set(PHASE_8B1BD6W1_EXPECTED_FILES).size === 2, "the Wave 1 range contains no duplicates");
  assert(PHASE_8B1BD6W1_FROZEN_BLOBS.length === PHASE_8B1BD6W1_EXPECTED_FILES.length,
    "every Wave 1 range file is byte-frozen (no unfrozen member)");
  for (const [path] of PHASE_8B1BD6W1_FROZEN_BLOBS) {
    assert(PHASE_8B1BD6W1_EXPECTED_FILES.includes(path), `a frozen Wave 1 blob is outside the range: ${path}`);
  }

  // 2) ANCESTRY — Wave 1 descends from the C8B-1B-C implementation head and is reachable from HEAD.
  assert(execFileSync("git", ["cat-file", "-t", PHASE_8B1BD6W1_IMPLEMENTATION_HEAD], { encoding: "utf8" }).trim() === "commit",
    "the C8B-1B-D6 Wave 1 implementation commit " + PHASE_8B1BD6W1_IMPLEMENTATION_HEAD.slice(0, 12) + " must exist");
  assert(execFileSync("git", ["cat-file", "-t", PHASE_8B1BD6W1_BASE], { encoding: "utf8" }).trim() === "commit",
    "the C8B-1B-C integration base " + PHASE_8B1BD6W1_BASE.slice(0, 12) + " must exist");
  execFileSync("git", ["merge-base", "--is-ancestor", PHASE_8B1BC_IMPLEMENTATION_HEAD, PHASE_8B1BD6W1_BASE]);            // throws if not
  execFileSync("git", ["merge-base", "--is-ancestor", PHASE_8B1BD6W1_BASE, PHASE_8B1BD6W1_IMPLEMENTATION_HEAD]);         // throws if not
  execFileSync("git", ["merge-base", "--is-ancestor", PHASE_8B1BD6W1_IMPLEMENTATION_HEAD, "HEAD"]);                          // throws if not

  // 3) THE COMMITTED RANGE IS EXACTLY THOSE TWO FILES — no unauthorized extra file rode along.
  const ranged = execFileSync("git", ["diff", "--name-only", PHASE_8B1BD6W1_BASE + "..." + PHASE_8B1BD6W1_IMPLEMENTATION_HEAD],
    { encoding: "utf8" }).split("\n").map((x) => x.trim()).filter(Boolean);
  assert(ranged.length === 2, `the Wave 1 commit range must contain exactly two files (found ${ranged.length})`);
  for (const f of ranged) assert(PHASE_8B1BD6W1_EXPECTED_FILES.includes(f), `unauthorized file in the Wave 1 range: ${f}`);

  // 4) BYTE-FREEZE — historical commit blobs AND the active on-disk bytes. Fixed literals, so a
  //    STALE or SUCCESSOR-MISMATCHED pin cannot be smuggled in by computing it at runtime.
  const selfSrc = readFileSync(resolve(HARNESS_SRC), "utf8");
  // 4a-i) HISTORICAL record — a fact about the implementation-head commit. Never rewritten.
  for (const [path, expected] of PHASE_8B1BD6W1_FROZEN_BLOBS) {
    assert(selfSrc.includes('"' + expected + '"'), "the Wave 1 blob " + expected.slice(0, 12) + " is an exact fixed literal");
    const historical = execFileSync("git", ["rev-parse", PHASE_8B1BD6W1_IMPLEMENTATION_HEAD + ":" + path], { encoding: "utf8" }).trim();
    assert(historical === expected,
      `the Wave 1 historical blob for ${path} must be permanently unchanged (got ${historical.slice(0, 12)}, expected ${expected.slice(0, 12)}).`);
  }
  // 4a-ii) ACTIVE on-disk freeze — same strength, but re-pinned by an EXPLICIT authority transfer.
  for (const [path, expected] of PHASE_8B1BD6W1_ACTIVE_BLOBS) {
    assert(selfSrc.includes('"' + expected + '"'), "the active Wave 1 blob " + expected.slice(0, 12) + " is an exact fixed literal");
    const onDisk = execFileSync("git", ["hash-object", path], { encoding: "utf8" }).trim();
    assert(onDisk === expected,
      `${path} is not byte-identical to its reviewed QF-MVP-40.1-R Wave 1 blob. This is an AUTHORITY TRANSFER, ` +
      `not a routine edit (on-disk ${onDisk.slice(0, 12)} != pinned ${expected.slice(0, 12)}).`);
  }
  assert(PHASE_8B1BD6W1_FROZEN_BLOBS[0][1] !== PHASE_8B1BD6W1_FROZEN_BLOBS[1][1],
    "the migration and the harness must not share a blob (a duplicate pin is a stale-authority smell)");
  assert(PHASE_8B1BD6W1_ACTIVE_BLOBS[0][1] !== PHASE_8B1BD6W1_ACTIVE_BLOBS[1][1],
    "the active migration and harness pins must not share a blob");
  // The Wave 1 MIGRATION must NOT have moved — only the harness was re-pinned.
  assert(PHASE_8B1BD6W1_ACTIVE_BLOBS[0][1] === PHASE_8B1BD6W1_FROZEN_BLOBS[0][1],
    "the Wave 1 migration blob must be identical in the historical and active records");

  // 4b) RAW-BYTE LINE-ENDING FREEZE. `git hash-object` NORMALISES CRLF to LF, so a CRLF-only
  //     rewrite of a Wave 1 file yields an IDENTICAL blob and slips past the freeze above. Read the
  //     raw bytes and require LF-only, so a line-ending rewrite is caught as the working-tree
  //     contamination it is rather than being laundered by git normalisation.
  for (const [path] of PHASE_8B1BD6W1_FROZEN_BLOBS) {
    const rawBytes = readFileSync(resolve(path));
    assert(!rawBytes.includes(0x0d),
      `${path} contains CR bytes. Wave 1 files are LF-only; a CRLF rewrite is an authority change ` +
      `even though git hash-object would normalise it to the same blob.`);
  }

  // 5) THE ENFORCED DDL — executable shape, read from the frozen migration itself. A wrong table, a
  //    wrong predicate, a missing constraint, a silent-skip guard or NOT VALID staging fails HERE.
  const sql = readFileSync(resolve(PHASE_8B1BD6W1_MIGRATION_SRC), "utf8");
  const code = sql.split("\n").map((l) => l.split("--")[0]).join(" ").replace(/\s+/g, " ").trim().toLowerCase();
  assert(code.includes("alter table public." + PHASE_8B1BD6W1_TARGET_TABLE + " "),
    "the Wave 1 migration must target " + PHASE_8B1BD6W1_TARGET_TABLE);
  assert(code.includes("add constraint " + PHASE_8B1BD6W1_CONSTRAINT_NAME + " "),
    "the Wave 1 constraint must carry its exact reviewed name");
  assert(code.includes(PHASE_8B1BD6W1_PREDICATE), "the Wave 1 predicate must be exactly `provider_account_id is not null`");
  assert(!/if\s+not\s+exists|if\s+exists/.test(code), "the Wave 1 migration must not silently skip");
  assert(!/not\s+valid/.test(code), "the Wave 1 constraint must be added VALIDATED");
  assert(!/created_at|readiness_status|\bor\b/.test(code),
    "the Wave 1 predicate must carry no timestamp exemption, no readiness condition and no OR-widening");
  assert(!/\binsert\b|\bupdate\b|\bdelete\b|set\s+not\s+null/.test(code),
    "the Wave 1 migration must perform no DML and must not set the column NOT NULL");
  // ONE executable statement only — a second statement is an unauthorized scope expansion.
  assert(code.split(";").filter((x) => x.trim().length > 0).length === 1,
    "the Wave 1 migration must contain exactly ONE executable statement");
  // NO OTHER communication table may appear in the executable DDL.
  for (const other of ["communication_messages", "communication_webhook_receipts",
                       "communication_inbound_messages", "communication_consent_ack_intents"]) {
    assert(!code.includes(other), `Wave 1 must not touch ${other} (that is Wave 2 / Wave 3)`);
  }

  // 6) MODELLED SELF-PROOF of the carve-out decision. Synthetic inputs, so a future weakening —
  //    broadening to all migrations, dropping the token gate, admitting a third path — is caught here.
  const admits = (path, token) =>
    token === PHASE_8B1BD6W1_FROZEN_BLOBS[0][1] && PHASE_8B1BD6W1_EXPECTED_FILES.includes(path);
  const goodToken = PHASE_8B1BD6W1_FROZEN_BLOBS[0][1];
  assert(admits(PHASE_8B1BD6W1_MIGRATION_SRC, goodToken) === true, "the reviewed migration path is admitted");
  assert(admits(PHASE_8B1BD6W1_HARNESS_SRC, goodToken) === true, "the reviewed harness path is admitted");
  assert(admits("supabase/migrations/20260901000001_other.sql", goodToken) === false,
    "a DIFFERENT migration is rejected (the carve-out is per-path, never category-wide)");
  assert(admits("supabase/migrations/20260720000100_communication_delivery_event_provider_account_required.sql.bak", goodToken) === false,
    "a near-miss migration path is rejected");
  assert(admits("scripts/phase8b1bd6w2-ack-intent-constraint-harness.mjs", goodToken) === false,
    "a Wave 2 harness is rejected (Wave 1 authority does not extend to it)");
  assert(admits(PHASE_8B1BD6W1_MIGRATION_SRC, null) === false, "a MISSING token rejects the migration (no proof-map bypass)");
  assert(admits(PHASE_8B1BD6W1_MIGRATION_SRC, "0000000000000000000000000000000000000000") === false,
    "a WRONG token rejects the migration (successor blob mismatch)");

  // 6b) THE MODEL MUST MATCH THE REAL CODE. The `admits` model above proves the DECISION SHAPE, but
  //     it is a local function — deleting the real token gate in the dirty-scope loop would not move
  //     it. Assert the gate literally exists in BOTH carve-outs in this harness's own source, so a
  //     proof-map bypass (dropping the gate and admitting the paths unconditionally) fails HERE.
  const GATE = "phase8B1BD6W1AuthorityToken === PHASE_8B1BD6W1_FROZEN_BLOBS[0][1]";
  const gateCount = selfSrc.split(GATE).length - 1;
  assert(gateCount >= 3,
    `the Wave 1 token gate must appear in the model AND in BOTH dirty-scope carve-outs ` +
    `(found ${gateCount} occurrences, expected at least 3). A missing gate is a proof-map bypass.`);
  assert(selfSrc.includes("p === PHASE_8B1BD6W1_MIGRATION_SRC && " + GATE),
    "the migration carve-out must be per-path AND token-gated (never a bare path match)");
  assert(selfSrc.includes(GATE + " && PHASE_8B1BD6W1_EXPECTED_FILES.includes(p)"),
    "the D3-B scope carve-out must be token-gated before it consults the Wave 1 path set");
  // A category-wide widening would replace the exact path comparison with a regex test. Plain
  // substring, not a regex literal, so this proof cannot itself be broken by escaping subtleties.
  // The needle is ASSEMBLED FROM FRAGMENTS: written as one literal it would appear verbatim in this
  // very file, and selfSrc reads this file — the proof would then always fire on itself.
  const WIDENED_GATE = ".test(p)" + " && " + "phase8B1BD6W1AuthorityToken";
  assert(!selfSrc.includes(WIDENED_GATE),
    "the carve-out must never be widened from a single path to a pattern over the migrations directory");

  phase8B1BD6W1AuthorityToken = PHASE_8B1BD6W1_FROZEN_BLOBS[0][1];   // set ONLY after every assertion passed
}


function compileTo(outDir) {
  rmSync(outDir, { recursive: true, force: true });
  const tsconfigPath = resolve(`${outDir}.tsconfig.json`);
  writeFileSync(tsconfigPath, JSON.stringify({
    compilerOptions: {
      module: "commonjs", target: "ES2020", moduleResolution: "node",
      skipLibCheck: true, esModuleInterop: true, strict: true, jsx: "preserve",
      outDir, rootDir: ".", baseUrl: ".", paths: { "@/*": ["./*"] }, lib: ["ES2021", "DOM"],
    },
    files: TS_FILES,
  }, null, 2));
  try { execFileSync(process.execPath, [tsc, "-p", tsconfigPath], { stdio: "pipe" }); }
  finally { rmSync(tsconfigPath, { force: true }); }
  return outDir;
}

/** The live fake ledger the stubbed Supabase writes through. Reset per test. */
let TABLE = [];
let DB_THROWS = false;

/**
 * A compare-and-set fake of PostgREST, modelling ONLY what the dispatch path uses. `.eq()` filters are
 * ANDed, exactly as PostgREST does — so `.eq(id).eq(status)` updates ZERO rows when another worker
 * already moved the row. That is what makes the lost-race test real rather than decorative.
 */
function fakeAdminClient() {
  return () => ({
    from: () => {
      const state = { op: null, updates: null, filters: {} };
      const run = () => {
        if (DB_THROWS) throw new Error("db down: SQLSTATE 08006 connection reset by peer");
        const matches = TABLE.filter((r) => Object.entries(state.filters).every(([c, v]) => r[c] === v));
        if (state.op === "update") for (const row of matches) Object.assign(row, state.updates);
        return matches.map((r) => ({ ...r }));
      };
      const builder = {
        update(u) { state.op = "update"; state.updates = u; return builder; },
        insert(r) { state.op = "insert"; state.row = r; return builder; },
        select() { state.selected = true; return builder; },
        eq(col, val) { state.filters[col] = val; return builder; },
        // `.single()` collapses to ONE row (PostgREST semantics) — used by applyMessageUpdate.
        single() { return Promise.resolve().then(() => { const rows = run(); return { data: rows[0] ?? null, error: null }; }); },
        limit() { return Promise.resolve().then(() => ({ data: run(), error: null })); },
        then(onF, onR) {
          return Promise.resolve().then(() => ({ data: run(), error: null })).then(onF, onR);
        },
      };
      return builder;
    },
  });
}

function wireBuild(outDir) {
  const req = createRequire(`${outDir}/`);
  const Module = req("module");
  const original = Module._load;
  const STUBS = {
    "../lib/supabase": { adminClient: fakeAdminClient() },
  };
  Module._load = function (request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
    return original.apply(this, [request, parent, isMain]);
  };
  return {
    Scope: req("./lib/communication/outboundConsentScope.js"),
    Coord: req("./services/outboundConsentEnforcementService.js"),
    Comm: req("./services/communicationService.js"),
  };
}

const readF = (f) => readFileSync(f, "utf8");
const stripTs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/[^\n]*/gm, "");
function safeStringify(v) { try { return JSON.stringify(v); } catch { return String(v); } }
/**
 * Decide whether a `git status --porcelain=v1` line describes a PERMITTED, genuinely UNTRACKED artifact that
 * is out of governance scope. STATUS-AWARE by construction: the first two characters are the porcelain status,
 * and ONLY an untracked ('??') entry may ever be ignored. A TRACKED change — staged OR unstaged, M/A/D/R —
 * under these very paths is NEVER ignored; it stays dirty and is caught by the B4 scope loop. The permitted
 * set is this harness's own temp build artifacts, the founder-permitted .mcp.json, and the founder-permitted
 * .claude/skills tooling — nothing else. The whole .claude tree is deliberately NOT ignored (an untracked
 * .claude/settings.json stays dirty), and no path is ever added to the D3B_EXPECTED_FILES allowlist.
 */
function shouldIgnoreDirtyLine(line) {
  const status = line.slice(0, 2);
  const path = line.slice(3).trim().replace(/\\/g, "/");
  if (status !== "??") return false;                                   // a TRACKED status is never ignored
  if (path.startsWith(".phase5fd3b")) return true;                     // this harness's own temp build artifacts
  if (path === ".mcp.json") return true;                               // the founder-permitted MCP config
  if (path === ".claude/skills" || path.startsWith(".claude/skills/")) return true; // founder-permitted skills tooling
  return false;
}

function gitDirty() {
  return execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean)
    .filter((line) => !shouldIgnoreDirtyLine(line))
    .map((line) => line.slice(3).trim().replace(/\\/g, "/"));
}

const checks = [];
function check(name, fn) { checks.push({ name, fn }); }
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function has(re, s, msg) { assert(re.test(s), msg); }
function hasNot(re, s, msg) { assert(!re.test(s), msg); }

const MAIN_DIR = resolve(".phase5fd3b-build-main");
compileTo(MAIN_DIR);
const M = wireBuild(MAIN_DIR);

// ============================================================================
// FIXTURES
// ============================================================================
const HASH = "a".repeat(64);
const UUID = "11111111-2222-4333-8444-555555555555";
const PROVIDER_KEY = "mock";
/** The REAL destination + its REAL sha256 — the dispatch path verifies the hash against the row. */
const DEST = "+919812345678";
const DEST_HASH = createHash("sha256").update(DEST).digest("hex");

/** A fake WhatsApp provider that COUNTS network calls. Zero-call assertions are therefore provable. */
function fakeProvider(over = {}) {
  const calls = { send: 0 };
  return {
    calls,
    provider: {
      providerKey: PROVIDER_KEY,
      channel: "whatsapp",
      templateResolutionMode: over.templateResolutionMode ?? "provider_template_name",
      async sendTemplateMessage() { calls.send++; return { accepted: true, providerMessageId: "pm-1", outcomeCertainty: "accepted" }; },
      async sendAuthenticationMessage() { calls.send++; return { accepted: true, providerMessageId: "pm-1", outcomeCertainty: "accepted" }; },
      async sendResolvedTemplate() { calls.send++; return { accepted: true, providerMessageId: "pm-1", outcomeCertainty: "accepted" }; },
    },
  };
}

const fakeResolver = { resolverKey: "fake", async resolveDestination() { return { ok: true, data: DEST }; } };

/** An enforcer that returns a scripted outcome and counts how many times it was consulted. */
function fakeEnforcer(outcome) {
  const calls = [];
  return {
    calls,
    enforcer: {
      async authorize(input) {
        calls.push(input);
        if (typeof outcome === "function") return outcome(input);
        return outcome;
      },
    },
  };
}

const ALLOW = { kind: "allow", scope: "transactional" };
const DENY_SUPPRESSED = { kind: "deny", code: "CONSENT_SUPPRESSED", retryable: false };
const DENY_NOT_GRANTED = { kind: "deny", code: "CONSENT_NOT_GRANTED", retryable: false };
const UNAVAILABLE = { kind: "unavailable", code: "CONSENT_AUTHORITY_UNAVAILABLE", retryable: true };
const INVALID = { kind: "invalid", code: "CONSENT_ENFORCEMENT_INVALID", retryable: false };
const INTEGRITY = { kind: "invalid", code: "CONSENT_AUTHORITY_INTEGRITY", retryable: false };

/** A business (transactional) ledger row, in whatever status the test needs. */
function row(over = {}) {
  return {
    id: "msg-1",
    message_type: "lead_received",
    lane: "business",
    channel: "whatsapp",
    recipient_type: "client",
    recipient_id: UUID,
    destination_source: "recipient_reference",
    destination_hash: DEST_HASH,
    destination_masked: "+91******5678",
    template_key: "lead_received",
    status: "queued",
    attempt_count: 0,
    max_attempts: 5,
    next_retry_at: null,
    scheduled_at: null,
    provider: PROVIDER_KEY,
    failure_code: null,
    failure_reason_sanitized: null,
    failed_at: null,
    variables: {},
    metadata: {},
    ...over,
  };
}
const authRow = (over = {}) => row({
  id: "msg-auth", message_type: "client_login_otp", lane: "authentication",
  template_key: "client_login_otp", destination_source: "ephemeral_auth_destination",
  recipient_id: null, max_attempts: 1, ...over,
});

/**
 * PHASE 8A — drive one dispatch attempt with a RAW, UNSANITIZED 4th constructor argument.
 *
 * `dispatch()` below always passes a well-formed enforcer. This helper passes whatever the caller gives it
 * — no argument at all, `null`, `undefined`, a primitive, an array, an object with no callable `authorize`
 * — which is EXACTLY what TypeScript cannot prevent from plain JavaScript, `as any`, or reflection. Every
 * one of these must still reach ZERO provider calls, which is the Phase 8A security invariant.
 *
 * `omit: true` constructs with genuinely THREE arguments, so the parameter is absent rather than explicitly
 * undefined — the closest reachable analogue of a pre-Phase-8A `new CommunicationService(provider)`.
 */
async function dispatchRawEnforcer(message, rawEnforcer, { omit = false } = {}) {
  TABLE = [{ ...message }];
  DB_THROWS = false;
  const p = fakeProvider();
  const svc = omit
    ? new M.Comm.CommunicationService(p.provider, fakeResolver, null)
    : new M.Comm.CommunicationService(p.provider, fakeResolver, null, rawEnforcer);
  const res = await svc.dispatchMessage(message, {
    rawVariables: message.lane === "authentication" ? { otp: "123456" } : undefined,
    providerTemplateName: "tpl",
    preResolvedDestination: DEST,
    templateLanguage: "en",
  });
  return { res, providerCalls: p.calls.send, stored: TABLE[0] };
}

/** Build a service + drive one dispatch attempt against the fake ledger. */
async function dispatch(message, outcome, over = {}) {
  TABLE = [{ ...message }];
  DB_THROWS = false;
  const p = over.provider ?? fakeProvider();
  const e = fakeEnforcer(outcome);
  const svc = new M.Comm.CommunicationService(p.provider, fakeResolver, null, e.enforcer);
  const res = await svc.dispatchMessage(message, {
    rawVariables: over.rawVariables ?? (message.lane === "authentication" ? { otp: "123456" } : undefined),
    providerTemplateName: "tpl",
    preResolvedDestination: over.preResolvedDestination ?? DEST,
    templateLanguage: "en",
  });
  return { res, providerCalls: p.calls.send, consentCalls: e.calls, stored: TABLE[0] };
}

// ============================================================================
// SCOPE REGISTRY
// ============================================================================
const AUTH_TYPES = ["client_login_otp", "vendor_whatsapp_verify", "vendor_password_reset"];
const TRANSACTIONAL_TYPES = [
  "lead_received", "vendor_new_lead", "clarification_request", "clarification_reminder",
  "lead_assignment_alert", "low_credit_warning", "recharge_reminder",
  "admin_policy_block_alert", "admin_assignment_failure_alert",
  "admin_provider_outage_alert", "admin_automation_failure_alert",
  // ---- QF-MVP-40.6 AUTHORITY TRANSFER -------------------------------------------------------
  // Five reviewed TRANSACTIONAL types from the QF-MVP-40.4 catalogue. Each was added to the
  // registry by exact key (no prefix, no pattern) and is asserted here so the "exactly the
  // approved set" invariant keeps its full strength rather than being loosened to a minimum.
  "client_lead_status_update", "client_matching_update", "vendor_response_reminder",
  "vendor_onboarding_reminder", "vendor_package_expiry_warning",
];
// QF-MVP-40.6 AUTHORITY TRANSFER — vendor_crm_promotion is the admin-approved CRM campaign
// message. It is MARKETING, so marketing default-deny applies exactly as for the two
// founder-ratified re-engagement types. Classifying the type creates no dispatcher: campaign
// orchestration and the per-recipient loop remain QF-MVP-50.
const MARKETING_TYPES = [
  "client_nurture_followup", "dormant_requirement_reactivation", "vendor_crm_promotion",
];

check("R1. all 3 authentication message types resolve to the authentication scope (lane: authentication)", () => {
  for (const t of AUTH_TYPES) {
    const r = M.Scope.resolveOutboundConsentScope({ messageType: t, templateKey: t, lane: "authentication" });
    assert(r.ok && r.scope === "authentication", `${t} → authentication`);
  }
  assert(AUTH_TYPES.length === 3, "exactly three authentication types");
});

check("R2. all 16 transactional message types resolve to the transactional scope (lane: business)", () => {
  for (const t of TRANSACTIONAL_TYPES) {
    const r = M.Scope.resolveOutboundConsentScope({ messageType: t, templateKey: t, lane: "business" });
    assert(r.ok && r.scope === "transactional", `${t} → transactional`);
  }
  assert(TRANSACTIONAL_TYPES.length === 16, "exactly sixteen transactional types");
});

check("R3. FOUNDER-RATIFIED: every marketing type is MARKETING (not transactional)", () => {
  for (const t of MARKETING_TYPES) {
    const r = M.Scope.resolveOutboundConsentScope({ messageType: t, templateKey: t, lane: "business" });
    assert(r.ok && r.scope === "marketing", `${t} → marketing`);
    assert(r.scope !== "transactional", `${t} must NEVER be transactional`);
  }
  assert(MARKETING_TYPES.includes("client_nurture_followup"), "client_nurture_followup is marketing");
  assert(MARKETING_TYPES.includes("dormant_requirement_reactivation"), "dormant_requirement_reactivation is marketing");
});

check("R4. the registry is EXACTLY the 22 approved types and its lane⟷scope invariant holds", () => {
  const all = [...AUTH_TYPES, ...TRANSACTIONAL_TYPES, ...MARKETING_TYPES];
  const registered = [...M.Scope.REGISTERED_MESSAGE_TYPES].sort();
  assert(JSON.stringify(registered) === JSON.stringify([...all].sort()), `registry must be exactly the 22 approved types (got ${registered.length})`);
  assert(M.Scope.assertRegistryInvariants().length === 0, "authentication⟺auth lane, transactional/marketing⟺business lane");
});

check("R5. an UNKNOWN message type is BLOCKED — never transactional, never marketing", () => {
  for (const t of ["", "unknown_thing", "promo_blast", "lead_receive", "LEAD_RECEIVED", "admin_new_alert", null, undefined, 42, {}]) {
    const r = M.Scope.resolveOutboundConsentScope({ messageType: t, templateKey: t, lane: "business" });
    assert(r.ok === false && r.reason === "UNCLASSIFIED_MESSAGE_TYPE", `unknown blocked: ${safeStringify(t)}`);
    assert(!("scope" in r), "an unclassified type NEVER yields a scope");
  }
});

check("R6. NO wildcard / prefix classification (`admin_*` is not a pattern)", () => {
  // Every admin alert is registered EXPLICITLY…
  for (const t of ["admin_policy_block_alert", "admin_assignment_failure_alert", "admin_provider_outage_alert", "admin_automation_failure_alert"]) {
    assert(M.Scope.resolveOutboundConsentScope({ messageType: t, templateKey: t, lane: "business" }).ok, `${t} is explicitly registered`);
  }
  // …and an unregistered `admin_`-prefixed type is still BLOCKED.
  for (const t of ["admin_", "admin_anything", "admin_new_marketing_blast"]) {
    const r = M.Scope.resolveOutboundConsentScope({ messageType: t, templateKey: t, lane: "business" });
    assert(r.ok === false && r.reason === "UNCLASSIFIED_MESSAGE_TYPE", `no prefix rule: ${t}`);
  }
  // The source contains no wildcard/regex/prefix classification.
  const src = stripTs(readF(SCOPE_SRC));
  hasNot(/startsWith\(|\.test\(|RegExp|endsWith\(|includes\(.*admin/, src, "no prefix/regex classification in the registry");
});

check("R7. a message/template MISMATCH is BLOCKED", () => {
  const r = M.Scope.resolveOutboundConsentScope({ messageType: "lead_received", templateKey: "client_nurture_followup", lane: "business" });
  assert(r.ok === false && r.reason === "MESSAGE_TYPE_TEMPLATE_MISMATCH", "a swapped template never inherits another type's scope");
  for (const bad of ["", "other", null, undefined, 42]) {
    const x = M.Scope.resolveOutboundConsentScope({ messageType: "lead_received", templateKey: bad, lane: "business" });
    assert(x.ok === false && x.reason === "MESSAGE_TYPE_TEMPLATE_MISMATCH", `template mismatch: ${safeStringify(bad)}`);
  }
});

check("R8. a WRONG LANE is BLOCKED", () => {
  const a = M.Scope.resolveOutboundConsentScope({ messageType: "client_login_otp", templateKey: "client_login_otp", lane: "business" });
  assert(a.ok === false && a.reason === "MESSAGE_LANE_SCOPE_MISMATCH", "an auth type declared as business is blocked");
  const b = M.Scope.resolveOutboundConsentScope({ messageType: "client_nurture_followup", templateKey: "client_nurture_followup", lane: "authentication" });
  assert(b.ok === false && b.reason === "MESSAGE_LANE_SCOPE_MISMATCH", "a marketing type declared as authentication is blocked");
  // …a marketing type can NEVER be laundered into the authentication scope by a lane swap.
  assert(b.ok === false && !("scope" in b), "no scope is produced on a lane mismatch");
});

check("R9. the registry is PURE (no I/O, no db, no env, no clock)", () => {
  const src = stripTs(readF(SCOPE_SRC));
  hasNot(/adminClient|supabase|fetch\(|process\.env|console\.|Date\.now\(|Math\.random|import .*services\//i, src, "the registry is pure");
});

// ============================================================================
// COORDINATOR
// ============================================================================
const capture = () => {
  const seen = [];
  return { seen, deps: (outcome) => ({ decide: async (i) => { seen.push(i); return typeof outcome === "function" ? outcome(i) : outcome; } }) };
};
const decided = (o) => ({ decide: async () => o });
const ok2 = (disposition) => ({ ok: true, disposition, reasonCode: "x", policyVersion: "qf-consent-v1", principalConfidence: "exact", matchedPreferenceId: "pref-1", matchedSuppressionId: "supp-1", suppressionReason: "user_stop", reconsent: "self_service_allowed" });

const enforce = (over, deps) => M.Coord.authorizeOutboundConsent({
  channel: "whatsapp", messageType: "lead_received", templateKey: "lead_received", lane: "business",
  destinationHash: HASH, destinationSource: "recipient_reference", recipientType: "client", recipientId: UUID,
  ...over,
}, deps);

check("C1. AUTHENTICATION: no_consent_objection → allow; blocked → deny", async () => {
  const base = { messageType: "client_login_otp", templateKey: "client_login_otp", lane: "authentication" };
  const a = await enforce(base, decided(ok2("no_consent_objection")));
  assert(a.kind === "allow" && a.scope === "authentication", "auth no_consent_objection allows the CONSENT LAYER");
  const b = await enforce(base, decided(ok2("blocked")));
  assert(b.kind === "deny" && b.code === "CONSENT_SUPPRESSED", "auth blocked → deny");
});

check("C2. AUTHENTICATION: any unexpected disposition FAILS CLOSED", async () => {
  const base = { messageType: "client_login_otp", templateKey: "client_login_otp", lane: "authentication" };
  for (const d of ["marketing_opted_in", "unknown", "allowed", "", null, undefined, 42]) {
    const r = await enforce(base, decided(ok2(d)));
    assert(r.kind === "invalid" && r.code === "CONSENT_ENFORCEMENT_INVALID", `auth unexpected '${safeStringify(d)}' fails closed`);
    assert(r.kind !== "allow", "an unexpected disposition NEVER allows");
  }
});

check("C3. TRANSACTIONAL: no_consent_objection → allow; blocked → deny; unexpected fails closed", async () => {
  const a = await enforce({}, decided(ok2("no_consent_objection")));
  assert(a.kind === "allow" && a.scope === "transactional", "transactional no_consent_objection allows");
  const b = await enforce({}, decided(ok2("blocked")));
  assert(b.kind === "deny" && b.code === "CONSENT_SUPPRESSED", "transactional blocked → deny");
  for (const d of ["marketing_opted_in", "unknown", "yes"]) {
    const r = await enforce({}, decided(ok2(d)));
    assert(r.kind === "invalid", `transactional unexpected '${d}' fails closed`);
  }
});

check("C4. MARKETING DEFAULT-DENY: only marketing_opted_in allows; unknown + blocked deny", async () => {
  const base = { messageType: "client_nurture_followup", templateKey: "client_nurture_followup", lane: "business" };
  const a = await enforce(base, decided(ok2("marketing_opted_in")));
  assert(a.kind === "allow" && a.scope === "marketing", "an explicit opt-in allows");
  const u = await enforce(base, decided(ok2("unknown")));
  assert(u.kind === "deny" && u.code === "CONSENT_NOT_GRANTED", "unknown → DENY (absence of consent is never consent)");
  const b = await enforce(base, decided(ok2("blocked")));
  assert(b.kind === "deny" && b.code === "CONSENT_SUPPRESSED", "blocked → deny");
  for (const d of ["no_consent_objection", "allowed", null]) {
    const r = await enforce(base, decided(ok2(d)));
    assert(r.kind === "invalid", `marketing unexpected '${safeStringify(d)}' fails closed`);
  }
});

check("C5. a STALE marketing preference (D2-C 'unknown') NEVER authorizes marketing", async () => {
  // D2-C returns `unknown` + `preference_policy_version_mismatch` for a stale allowed preference.
  const stale = { ...ok2("unknown"), reasonCode: "preference_policy_version_mismatch" };
  const r = await enforce({ messageType: "dormant_requirement_reactivation", templateKey: "dormant_requirement_reactivation", lane: "business" }, decided(stale));
  assert(r.kind === "deny" && r.code === "CONSENT_NOT_GRANTED", "a stale opt-in is NOT an opt-in");
});

check("C6. D2-C failure mapping: invalid / unavailable / integrity / thrown", async () => {
  const i = await enforce({}, decided({ ok: false, code: "INVALID_DECISION_INPUT" }));
  assert(i.kind === "invalid" && i.code === "CONSENT_ENFORCEMENT_INVALID" && i.retryable === false, "INVALID_DECISION_INPUT → invalid, not retryable");
  const u = await enforce({}, decided({ ok: false, code: "AUTHORITY_LOOKUP_FAILED" }));
  assert(u.kind === "unavailable" && u.code === "CONSENT_AUTHORITY_UNAVAILABLE" && u.retryable === true, "AUTHORITY_LOOKUP_FAILED → unavailable, RETRYABLE");
  const g = await enforce({}, decided({ ok: false, code: "AUTHORITY_INTEGRITY_VIOLATION" }));
  assert(g.kind === "invalid" && g.code === "CONSENT_AUTHORITY_INTEGRITY" && g.retryable === false, "AUTHORITY_INTEGRITY_VIOLATION → invalid, NOT retryable");
  const t = await enforce({}, { decide: async () => { throw new Error("db down: SQLSTATE 08006"); } });
  assert(t.kind === "unavailable" && t.retryable === true, "a THROWN dependency → unavailable, retryable");
  assert(!safeStringify(t).includes("SQLSTATE"), "no raw error leaks");
  const un = await enforce({}, decided({ ok: false, code: "SOMETHING_NEW" }));
  assert(un.kind === "invalid", "an unexpected failure code fails closed");
});

check("C7. an unclassified / mismatched message NEVER reaches D2-C (no DB call at all)", async () => {
  for (const over of [
    { messageType: "promo_blast", templateKey: "promo_blast" },
    { messageType: "lead_received", templateKey: "client_nurture_followup" },
    { messageType: "client_login_otp", templateKey: "client_login_otp", lane: "business" },
  ]) {
    const c = capture();
    const r = await enforce(over, c.deps(ok2("no_consent_objection")));
    assert(r.kind === "deny", "blocked before the authority");
    assert(c.seen.length === 0, `D2-C is NEVER consulted for an unreviewed send: ${safeStringify(over)}`);
  }
  // …and the deny codes are the closed registry reasons.
  const a = await enforce({ messageType: "promo_blast", templateKey: "promo_blast" }, decided(ok2("blocked")));
  assert(a.code === "UNCLASSIFIED_MESSAGE_TYPE", "closed code");
  const b = await enforce({ messageType: "lead_received", templateKey: "x" }, decided(ok2("blocked")));
  assert(b.code === "MESSAGE_TYPE_TEMPLATE_MISMATCH", "closed code");
  const c2 = await enforce({ messageType: "client_login_otp", templateKey: "client_login_otp", lane: "business" }, decided(ok2("blocked")));
  assert(c2.code === "MESSAGE_LANE_SCOPE_MISMATCH", "closed code");
});

check("C8. an EPHEMERAL destination ALWAYS reaches D2-C as unknown/null — recipient_id cannot upgrade it", async () => {
  for (const recipientId of [UUID, null, "not-a-uuid"]) {
    for (const recipientType of ["client", "vendor", "admin"]) {
      const c = capture();
      await M.Coord.authorizeOutboundConsent({
        channel: "whatsapp", messageType: "vendor_whatsapp_verify", templateKey: "vendor_whatsapp_verify",
        lane: "authentication", destinationHash: HASH,
        destinationSource: "ephemeral_auth_destination", recipientType, recipientId,
      }, c.deps(ok2("no_consent_objection")));
      assert(c.seen.length === 1, "D2-C consulted once");
      assert(c.seen[0].identityConfidence === "unknown", `ephemeral is ALWAYS unknown (${recipientType}/${recipientId})`);
      assert(c.seen[0].principal === null, "ephemeral ALWAYS carries a null principal");
    }
  }
  // The pure derivation says the same thing.
  const d = M.Coord.deriveConsentIdentity({ destinationSource: "ephemeral_auth_destination", recipientType: "vendor", recipientId: UUID });
  assert(d.identityConfidence === "unknown" && d.principal === null, "a vendor id NEVER upgrades an ephemeral destination");
});

check("C9. a recipient_reference destination CAN be exact — but only when the binding is provable", async () => {
  const c = capture();
  await enforce({}, c.deps(ok2("no_consent_objection")));
  assert(c.seen[0].identityConfidence === "exact", "recipient_reference + client + UUID → exact");
  assert(c.seen[0].principal.type === "client" && c.seen[0].principal.id === UUID, "the principal is carried");
  // …and anything unprovable stays unknown. Never guessed, never a first match.
  for (const bad of [
    { recipientType: "client", recipientId: null },
    { recipientType: "client", recipientId: "not-a-uuid" },
    { recipientType: "integration", recipientId: UUID },
    { recipientType: "system", recipientId: UUID },
    { recipientType: "", recipientId: UUID },
  ]) {
    const d = M.Coord.deriveConsentIdentity({ destinationSource: "recipient_reference", ...bad });
    assert(d.identityConfidence === "unknown" && d.principal === null, `unprovable stays unknown: ${safeStringify(bad)}`);
  }
});

check("C10. the coordinator OUTPUT leaks nothing (no hash, phone, principal id, matched ids, raw error)", async () => {
  const outcomes = [
    await enforce({}, decided(ok2("no_consent_objection"))),
    await enforce({}, decided(ok2("blocked"))),
    await enforce({ messageType: "client_nurture_followup", templateKey: "client_nurture_followup" }, decided(ok2("unknown"))),
    await enforce({}, decided({ ok: false, code: "AUTHORITY_LOOKUP_FAILED" })),
    await enforce({}, { decide: async () => { throw new Error("boom SQLSTATE 08006 at Object.x"); } }),
    await enforce({ messageType: "promo_blast", templateKey: "promo_blast" }, decided(ok2("blocked"))),
  ];
  for (const o of outcomes) {
    const s = safeStringify(o);
    assert(!s.includes(HASH), "no destination hash");
    assert(!s.includes("+9198"), "no plaintext phone");
    assert(!s.includes(UUID), "no principal id");
    assert(!s.includes("pref-1") && !s.includes("supp-1"), "no matched preference/suppression id");
    assert(!/SQLSTATE|boom|at Object\.|stack|user_stop/i.test(s), "no raw db error / stack / D2-C reason");
    assert(!/disposition|reasonCode|policyVersion/i.test(s), "no D2-C row / disposition leaks into the closed outcome");
  }
});

check("C11. invalid enforcement input fails closed WITHOUT touching the authority", async () => {
  for (const over of [
    { channel: "rcs" }, { channel: "" }, { destinationHash: "nope" }, { destinationHash: "A".repeat(64) },
    { destinationSource: "made_up" },
  ]) {
    const c = capture();
    const r = await enforce(over, c.deps(ok2("no_consent_objection")));
    assert(r.kind === "invalid" && r.code === "CONSENT_ENFORCEMENT_INVALID", `invalid input fails closed: ${safeStringify(over)}`);
    assert(c.seen.length === 0, "no authority call for invalid input");
  }
  // RCS is EXCLUDED from D3-B.
  const rcs = await enforce({ channel: "rcs" }, decided(ok2("no_consent_objection")));
  assert(rcs.kind !== "allow", "RCS is never authorized by D3-B");
});

// ============================================================================
// COMMUNICATIONSERVICE — the one authoritative gate
// ============================================================================
check("S1. ALLOW reaches the claim and the provider; consent is consulted EXACTLY ONCE", async () => {
  const d = await dispatch(row(), ALLOW);
  assert(d.res.ok === true, `the dispatch succeeds (got ${safeStringify(d.res)})`);
  assert(d.consentCalls.length === 1, "EXACTLY ONE consent decision per dispatch attempt");
  assert(d.providerCalls === 1, "the provider was called");
  assert(d.stored.status !== "cancelled", "not cancelled");
});

check("S2. consent runs AFTER destination resolution and BEFORE the claim (source order + behaviour)", async () => {
  const src = readF(COMM_SRC);
  const iResolve = src.indexOf("await this.resolveDispatchDestination(");
  const iConsent = src.indexOf("await this.enforceOutboundConsent(");
  const iClaim = src.indexOf("await this.claimMessageForDispatch(");
  const iInvoke = src.indexOf("await this.invokeProvider(");
  assert(iResolve > 0 && iConsent > 0 && iClaim > 0 && iInvoke > 0, "all four steps exist");
  assert(iResolve < iConsent, "consent runs AFTER destination resolution");
  assert(iConsent < iClaim, "consent runs BEFORE the atomic claim");
  assert(iClaim < iInvoke, "the provider call remains AFTER the claim");
  // Behavioural: a denial leaves the row un-claimed (never 'dispatching').
  const d = await dispatch(row(), DENY_SUPPRESSED);
  assert(d.stored.status === "cancelled", "denied before the claim → cancelled, never dispatching");
});

check("S3. there is NO pre-insert consent read (exactly one gate, in dispatch)", () => {
  const src = stripTs(readF(COMM_SRC));
  const occurrences = (src.match(/this\.enforceOutboundConsent\(/g) || []).length;
  assert(occurrences === 1, `exactly ONE consent gate call site (found ${occurrences})`);
  // …and it is not inside send()'s insert path: the gate sits after resolveDispatchDestination.
  const iInsert = src.indexOf('.from("communication_messages")\n        .insert(');
  const iGate = src.indexOf("this.enforceOutboundConsent(");
  assert(iGate > 0, "the gate exists");
  if (iInsert > 0) assert(iGate > iInsert, "the gate is in the dispatch path, not before the insert");
});

check("S4. BLOCKED → cancelled, ZERO provider calls", async () => {
  const d = await dispatch(row(), DENY_SUPPRESSED);
  assert(d.providerCalls === 0, "ZERO provider calls");
  assert(d.stored.status === "cancelled", "queued → cancelled");
  assert(d.stored.failure_code === "CONSENT_SUPPRESSED", "sanitized closed code");
  assert(d.stored.failed_at === null, "cancelled does NOT stamp failed_at (nothing failed; we declined)");
  assert(d.stored.next_retry_at === null, "next_retry_at cleared");
  assert(d.res.ok === true && d.res.data.status === "cancelled", "the cancelled message is returned");
});

check("S5. MARKETING NOT GRANTED → cancelled, ZERO provider calls", async () => {
  const d = await dispatch(row({ message_type: "client_nurture_followup", template_key: "client_nurture_followup" }), DENY_NOT_GRANTED);
  assert(d.providerCalls === 0, "ZERO provider calls");
  assert(d.stored.status === "cancelled" && d.stored.failure_code === "CONSENT_NOT_GRANTED", "cancelled with the closed code");
});

check("S6. INVALID and INTEGRITY → failed (with failed_at), ZERO provider calls", async () => {
  const i = await dispatch(row(), INVALID);
  assert(i.providerCalls === 0 && i.stored.status === "failed", "invalid → failed");
  assert(i.stored.failed_at !== null, "failed stamps failed_at");
  assert(i.stored.failure_code === "CONSENT_ENFORCEMENT_INVALID", "closed code");
  const g = await dispatch(row(), INTEGRITY);
  assert(g.providerCalls === 0 && g.stored.status === "failed", "integrity → failed");
  assert(g.stored.failure_code === "CONSENT_AUTHORITY_INTEGRITY", "closed code");
});

check("S7. AUTHORITY UNAVAILABLE: an AUTH message FAILS (the OTP can never be re-dispatched)", async () => {
  const d = await dispatch(authRow(), UNAVAILABLE);
  assert(d.providerCalls === 0, "ZERO provider calls");
  assert(d.stored.status === "failed", "an authentication row becomes failed, never left queued");
  assert(d.stored.failure_code === "CONSENT_AUTHORITY_UNAVAILABLE", "closed code");
  assert(d.res.ok === true && d.res.data.status === "failed", "the failed message is returned");
});

check("S8. AUTHORITY UNAVAILABLE: a BUSINESS message is LEFT UNCHANGED and is retryable", async () => {
  for (const status of ["queued", "retry_scheduled"]) {
    const d = await dispatch(row({ status }), UNAVAILABLE);
    assert(d.providerCalls === 0, "ZERO provider calls");
    assert(d.stored.status === status, `a transient authority blip must NOT destroy a business message (stayed ${status})`);
    assert(d.stored.failure_code === null, "the ledger is not written at all");
    assert(d.res.ok === false && d.res.code === "CONSENT_AUTHORITY_UNAVAILABLE", "a sanitized RETRYABLE failure is returned");
  }
});

check("S9. cancellation is legal from BOTH queued and retry_scheduled", async () => {
  for (const status of ["queued", "retry_scheduled"]) {
    const d = await dispatch(row({ status }), DENY_SUPPRESSED);
    assert(d.stored.status === "cancelled", `${status} → cancelled is legal`);
    assert(d.providerCalls === 0, "ZERO provider calls");
  }
});

check("S10. a retry dispatch and a scheduled dispatch BOTH re-evaluate consent", async () => {
  // retry_scheduled row (a retry) → consent is consulted again
  const retry = await dispatch(row({ status: "retry_scheduled", attempt_count: 2 }), ALLOW);
  assert(retry.consentCalls.length === 1, "a RETRY dispatch re-evaluates consent");
  // a previously-scheduled row that has come due → consent is consulted at dispatch, not at enqueue
  const scheduled = await dispatch(row({ status: "queued", scheduled_at: "2020-01-01T00:00:00.000Z" }), ALLOW);
  assert(scheduled.consentCalls.length === 1, "a SCHEDULED dispatch re-evaluates consent");
});

check("S11. consent CHANGED between enqueue and dispatch is observed (STOP after enqueue)", async () => {
  // The row was enqueued while consent allowed. By dispatch time a STOP exists → the authority now blocks.
  const d = await dispatch(row({ status: "queued" }), DENY_SUPPRESSED);
  assert(d.consentCalls.length === 1, "consent is re-read at dispatch time, not trusted from enqueue");
  assert(d.stored.status === "cancelled" && d.providerCalls === 0, "the post-enqueue STOP is observed and nothing is sent");
});

check("S12. terminalization is COMPARE-AND-SET on (id, exact current status)", async () => {
  const src = readF(COMM_SRC);
  const start = src.indexOf("private async terminalizeBeforeClaim");
  assert(start > 0, "the helper exists");
  const body = src.slice(start, src.indexOf("\n  private async claimMessageForDispatch", start));
  has(/\.eq\("id", message\.id\)/, body, "filters by id");
  has(/\.eq\("status", message\.status\)/, body, "AND by the EXACT status we read (compare-and-set)");
  hasNot(/\.neq\(|\.in\(/, body, "no unconditional / widened update");
  has(/updated\.length !== 1/, body, "zero rows updated ⇒ a lost race, not a clobber");
});

check("S13. a LOST terminalization race never calls the provider and never clobbers", async () => {
  // Model the race: the row we read as `queued` is already `dispatching` in the table.
  TABLE = [{ ...row(), status: "dispatching" }];
  DB_THROWS = false;
  const p = fakeProvider();
  const e = fakeEnforcer(DENY_SUPPRESSED);
  const svc = new M.Comm.CommunicationService(p.provider, fakeResolver, null, e.enforcer);
  const res = await svc.dispatchMessage(row({ status: "queued" }), { preResolvedDestination: DEST, providerTemplateName: "tpl" });
  assert(p.calls.send === 0, "ZERO provider calls after a lost terminalization race");
  assert(res.ok === false && res.code === "MESSAGE_ALREADY_CLAIMED", "the safe concurrent-claim outcome is returned");
  assert(TABLE[0].status === "dispatching", "the other worker's claim is NOT clobbered");
});

check("S14. the existing final template/runtime/provider gates remain AFTER consent", () => {
  const src = readF(COMM_SRC);
  const iConsent = src.indexOf("await this.enforceOutboundConsent(");
  const iForeignChannel = src.indexOf("this.isForeignChannel(message.channel)");
  const iForeignProvider = src.indexOf("this.isForeignProvider(message.provider)");
  const iInvoke = src.indexOf("await this.invokeProvider(");
  assert(iForeignChannel < iConsent && iForeignProvider < iConsent, "the channel/provider fences still run first (fail closed earliest)");
  assert(iConsent < iInvoke, "the approved-mapping/provider gates inside invokeProvider still run AFTER consent");
  // The mapping gate is still reached on an allowed send.
  has(/requiresApprovedMapping\(\)/, src, "the approved-mapping gate is intact");
});

check("S16. RCS / any unknown channel can NEVER be coerced to WhatsApp — it fails closed", async () => {
  // (a) The closed map is total and refuses everything except the two enforced channels.
  const map = M.Comm.toEnforcementChannel;
  assert(map("whatsapp") === "whatsapp", "whatsapp maps only to whatsapp");
  assert(map("sms") === "sms", "sms maps only to sms");
  for (const bad of ["rcs", "RCS", "email", "telegram", "", null, undefined, "whatsapp ", "WhatsApp"]) {
    assert(map(bad) === null, `an unsupported channel is NEVER coerced to whatsapp: ${safeStringify(bad)}`);
  }
  // (b) The source contains no coercing ternary any more.
  hasNot(/message\.channel === "sms" \? "sms" : "whatsapp"/, readF(COMM_SRC), "the silent channel coercion is gone");
  hasNot(/channel:\s*"whatsapp"\s*(\/\/|$)/m, stripTs(readF(COMM_SRC)), "no hard-coded whatsapp channel is passed to the enforcer");

  // (c) BEHAVIOURAL: an `rcs` row reaching the gate is terminalized BEFORE consent, claim and provider.
  // (A provider whose own channel is `rcs` gets past the foreign-channel guard, so this is the second,
  // independent fence — it proves the row can never inherit WhatsApp's consent decision.)
  const rcsRow = row({ channel: "rcs" });
  TABLE = [{ ...rcsRow }];
  DB_THROWS = false;
  const p = fakeProvider();
  p.provider.channel = "rcs";                 // so the foreign-channel guard does not short-circuit first
  const e = fakeEnforcer(ALLOW);              // even a permissive enforcer must never be consulted
  const svc = new M.Comm.CommunicationService(p.provider, fakeResolver, null, e.enforcer);
  const res = await svc.dispatchMessage(rcsRow, { preResolvedDestination: DEST, providerTemplateName: "tpl" });
  assert(e.calls.length === 0, "the consent authority is NEVER asked about an unsupported channel");
  assert(p.calls.send === 0, "ZERO provider calls for an unsupported channel");
  assert(TABLE[0].status === "failed", "the row fails closed (never dispatched, never cancelled-as-consented)");
  assert(TABLE[0].failure_code === "UNSUPPORTED_DISPATCH_CHANNEL", "a sanitized, closed failure code");
  assert(res.ok === true && res.data.status === "failed", "the failed message is returned");
});

check("S15. this service NEVER interprets consent (no D2-C import, no suppression/preference read)", () => {
  const code = stripTs(readF(COMM_SRC));
  hasNot(/communicationConsentDecisionService|decideCommunicationConsent/, code, "no D2-C import");
  hasNot(/communication_suppressions|communication_preferences/, code, "never reads a consent table");
  hasNot(/marketing_opted_in|no_consent_objection|disposition/, code, "never sees a disposition");
  has(/this\.consentEnforcer/, code, "it consumes only the closed enforcer outcome");
  hasNot(/policy_decision_id:\s*consent|metadata.*consent/i, code, "no policy_decision_id reuse, no consent stored in metadata");
});

// ============================================================================
// SMS AUTHENTICATION FALLBACK
// ============================================================================
check("F1. the SMS fallback has its OWN channel=sms decision, BEFORE the fallback claim", () => {
  const src = readF(ORCH_SRC);
  const iBody = src.indexOf("deps.resolveAuthenticationSmsContent(");
  const iConsent = src.indexOf("smsConsent = await authorize({");
  const iDeadline = src.indexOf("input.deadline.remainingNetworkBudgetMs()");
  const iClaim = src.indexOf("deps.claimFallbackAttempt(");
  const iSend = src.indexOf("smsProvider.sendResolvedAuthenticationSms(");
  assert(iBody > 0 && iConsent > 0 && iDeadline > 0 && iClaim > 0 && iSend > 0, "all five steps exist");
  assert(iBody < iConsent, "consent runs after the reviewed body resolves");
  assert(iConsent < iDeadline, "consent runs before the deadline check");
  assert(iConsent < iClaim, "consent runs BEFORE the fallback claim");
  assert(iClaim < iSend, "the provider call remains after the claim");
  // …with channel sms, an ephemeral source, and the already-computed hash — never the plaintext phone.
  const block = src.slice(iConsent, iConsent + 500);
  has(/channel: "sms"/, block, "channel: sms — a WhatsApp decision NEVER authorizes SMS");
  has(/destinationSource: "ephemeral_auth_destination"/, block, "ephemeral source ⇒ unknown identity");
  has(/destinationHash,/, block, "the already-computed sha256 is passed");
  hasNot(/phoneE164|input\.otp/, block, "NEVER the plaintext phone or the OTP");
});

check("F2. every non-allow SMS outcome blocks with a closed, sanitized reason", () => {
  const src = readF(ORCH_SRC);
  for (const r of ["SMS_CONSENT_DENIED", "SMS_CONSENT_AUTHORITY_UNAVAILABLE", "SMS_CONSENT_ENFORCEMENT_INVALID"]) {
    has(new RegExp(`${r}:\\s*"${r}"`), src, `the closed reason ${r} exists`);
    has(new RegExp(`OrchestratorFallbackBlockReason\\.${r}`), src, `${r} is actually used`);
  }
  // The block branch returns BEFORE the claim/provider — proven by source ordering in F1 and by the
  // early `return blocked(...)` on a non-allow.
  const i = src.indexOf('if (smsConsent.kind !== "allow")');
  assert(i > 0, "a non-allow short-circuits");
  const branch = src.slice(i, i + 420);
  has(/return blocked\(/, branch, "it returns a blocked result");
  hasNot(/claimFallbackAttempt|sendResolvedAuthenticationSms/, branch, "no claim and no provider call on a non-allow");
});

check("F3. the SMS fallback leaks no OTP / phone / hash / D2-C detail in its block reasons", () => {
  // Assert on the CODE, not the prose: the surrounding comment legitimately NAMES the things it must
  // not carry ("carries NO phone, hash, OTP, …"), which is documentation, not a leak. So strip the
  // comments FIRST, then take the window — otherwise the prose eats the branch.
  const stripped = stripTs(readF(ORCH_SRC));
  const i = stripped.indexOf('if (smsConsent.kind !== "allow")');
  assert(i > 0, "the non-allow short-circuit exists");
  const branch = stripped.slice(i, i + 520);
  hasNot(/\botp\b|phoneE164|destinationHash|suppressionId|matchedPreferenceId|reasonCode|disposition/i, branch, "the block reason carries nothing sensitive");
  // The only things the branch returns are the three closed block reasons.
  const returns = branch.match(/return blocked\(([^)]*)\)/g) || [];
  assert(returns.length === 3, `exactly the three closed SMS consent block reasons (got ${returns.length})`);
  for (const r of returns) assert(/SMS_CONSENT_(DENIED|AUTHORITY_UNAVAILABLE|ENFORCEMENT_INVALID)/.test(r), `closed reason only: ${r}`);
});

check("F4. the REAL coordinator is bound by default (lazily); DI stays available; NO production fail-open", () => {
  const raw = readF(ORCH_SRC);
  const src = stripTs(raw);

  // (1) THE DEFAULT DEPENDENCIES BIND THE REAL COORDINATOR.
  // The import is LAZY — a dynamic import INSIDE the closure — so an isolated legacy harness build that
  // does not contain the coordinator module never has to resolve it at load time. What it loads when it
  // DOES run is the real coordinator and nothing else.
  has(/authorizeOutboundConsent:\s*async \(enforcementInput\) => \{[\s\S]{0,240}await import\("\.\/outboundConsentEnforcementService"\)[\s\S]{0,160}authorizeOutboundConsent\(enforcementInput\)/,
    src, "defaultClientOtpDeliveryDeps() LAZILY binds the REAL outbound consent coordinator");
  has(/import type \{[\s\S]{0,120}OutboundConsentEnforcer[\s\S]{0,120}\} from "\.\/outboundConsentEnforcementService"/, raw,
    "only the TYPE is statically imported (erased at compile time)");
  hasNot(/^import \{[^}]*\bauthorizeOutboundConsent\b[^}]*\} from "\.\/outboundConsentEnforcementService"/m, src,
    "the coordinator VALUE is not statically imported (that is what broke the isolated legacy builds)");

  // (2) DEPENDENCY INJECTION REMAINS AVAILABLE FOR TESTS.
  has(/readonly authorizeOutboundConsent\?: OutboundConsentEnforcer\["authorize"\]/, src, "the enforcer is injectable");

  // (3) THE ORCHESTRATOR NEVER INTERPRETS CONSENT ITSELF — it goes through the ONE coordinator.
  hasNot(/decideCommunicationConsent|communicationConsentDecisionService/, src, "the orchestrator never calls D2-C directly");
  hasNot(/communication_suppressions|communication_preferences|marketing_opted_in|no_consent_objection/, src,
    "the orchestrator never reads a consent row or a disposition");

  // (4) ★ ZERO IMPLICIT ALLOW ★ — ABSENCE IS NEVER AUTHORIZATION.
  // There is NO `{ kind: "allow" }` literal anywhere in the orchestrator. When the dependency is absent it
  // LAZILY LOADS THE REAL COORDINATOR; it does not fabricate a decision. This is the single most important
  // property in this file, and it is asserted as an absolute.
  hasNot(/kind:\s*"allow"/, src, "the orchestrator NEVER constructs an allow outcome — absence is never authorization");
  has(/const authorize: OutboundConsentEnforcer\["authorize"\] =\s*deps\.authorizeOutboundConsent \?\?\s*\(async \(enforcementInput\) => \{[\s\S]{0,220}await import\("\.\/outboundConsentEnforcementService"\)/, src,
    "an ABSENT dependency falls back to the REAL coordinator (never to an allow)");
  hasNot(/deps\.authorizeOutboundConsent\s*\?\s*await/, src, "the old permissive ternary is gone");

  // The production entry point uses the DEFAULTS and never overrides the enforcer.
  const hook = readF("services/supabaseSendSmsHookService.ts");
  has(/deliverClientLoginOtp\(\{/, hook, "the production entry point calls the orchestrator");
  hasNot(/authorizeOutboundConsent/, hook, "…and NEVER overrides the enforcer ⇒ the real coordinator always applies in production");

  // (5) A FAILING COORDINATOR CAN NEVER AUTHORIZE AN SMS.
  // A dynamic-import failure or a thrown coordinator is caught and mapped to the SAFE UNAVAILABLE outcome
  // — never to an allow. There is no catch-to-allow path anywhere.
  has(/try \{\s*smsConsent = await authorize\(\{/, src, "the authorization call is guarded");
  has(/\} catch \{[\s\S]{0,200}return blocked\(OrchestratorFallbackBlockReason\.SMS_CONSENT_AUTHORITY_UNAVAILABLE\)/, src,
    "an import failure / thrown coordinator BLOCKS the SMS (mapped to the safe unavailable outcome)");
  hasNot(/catch[\s\S]{0,200}kind: "allow"/, src, "there is NO catch-to-allow path");
  hasNot(/smsConsent\.kind !== "allow"[\s\S]{0,120}(claimFallbackAttempt|sendResolvedAuthenticationSms)/, src,
    "a non-allow never continues to the claim or the provider");
  for (const kind of ["deny", "unavailable"]) {
    has(new RegExp(`smsConsent\\.kind === "${kind}"`), src, `the '${kind}' outcome is handled explicitly (blocked)`);
  }
  // …and the `invalid` outcome (invalid request OR authority integrity violation) is the closed default.
  has(/return blocked\(OrchestratorFallbackBlockReason\.SMS_CONSENT_ENFORCEMENT_INVALID\)/, src,
    "an invalid / integrity outcome BLOCKS the SMS");

  // (6) THE GATE STAYS BEFORE THE FALLBACK CLAIM AND THE PROVIDER CALL.
  const iConsent = src.indexOf("deps.authorizeOutboundConsent");
  const iClaim = src.indexOf("deps.claimFallbackAttempt(");
  const iSend = src.indexOf("smsProvider.sendResolvedAuthenticationSms(");
  assert(iConsent > 0 && iClaim > 0 && iSend > 0, "all three steps exist");
  assert(iConsent < iClaim, "the consent gate precedes the fallback claim");
  assert(iClaim < iSend, "the provider call remains after the claim");
});

// ============================================================================
// BOUNDARIES
// ============================================================================
check("B1. the runtime factory ALWAYS injects the real enforcer (the production construction boundary)", () => {
  const src = readF(RUNTIME_SRC);
  has(/consentEnforcer: OutboundConsentEnforcer = createOutboundConsentEnforcer\(\)/, src, "defaulted to the REAL enforcer");
  // PHASE 8B-1B-B — the EXACT five-argument production construction. The consent enforcer is STILL passed
  // (the 4th argument); the account-attribution dependency is appended as the 5th. This anchor names every
  // argument exactly, so it can never be satisfied by a broad `new CommunicationService(...)` shape.
  has(/new CommunicationService\(\s*context\.data\.provider,\s*getActiveRecipientResolver\(\),\s*resolvedCoordinator,\s*consentEnforcer,\s*context\.data\.attribution\s*\)/, src,
    "the consent enforcer is passed as the 4th argument of the exact five-argument construction (provider, recipient resolver, coordinator, consent enforcer, account attribution)");
  hasNot(/process\.env\.[A-Z_]*CONSENT/, src, "no new environment variable");
});

check("B2. EVERY production send path builds its service via the runtime factory (no direct construction)", () => {
  const out = execFileSync("git", ["grep", "-n", "new CommunicationService(", "--", "services/", "app/", "lib/"], { encoding: "utf8" })
    .split("\n").map((s) => s.trim()).filter(Boolean)
    // A COMMENT that merely mentions the constructor is documentation, not a construction.
    .filter((l) => {
      const code = l.replace(/^[^:]+:\d+:/, "").trim();
      return !code.startsWith("//") && !code.startsWith("*") && !code.startsWith("/*");
    });
  for (const line of out) {
    const file = line.split(":")[0];
    // The ONLY permitted direct constructions: the runtime factory itself, and the webhook service
    // (which processes DELIVERY RECEIPTS and never sends).
    assert(
      file === RUNTIME_SRC || file === "services/metaWhatsAppWebhookService.ts",
      `a production direct construction bypasses consent enforcement: ${line}`
    );
  }
  // …and the webhook service really does not send.
  const hook = stripTs(readF("services/metaWhatsAppWebhookService.ts"));
  hasNot(/\.send\(|dispatchMessage\(|dispatchPersistedMessage\(/, hook, "the webhook service never sends");
  // The three real send callers all use the factory.
  for (const f of ["services/clientLoginOtpDeliveryOrchestrator.ts", "services/vendorPasswordResetService.ts", "services/vendorVerificationService.ts"]) {
    has(/createRuntimeCommunicationService\(/, readF(f), `${f} uses the runtime factory`);
  }
});

check("B3. the ONLY direct provider call outside CommunicationService is the D3-B-gated SMS fallback", () => {
  const out = execFileSync("git", ["grep", "-n", "-E", "\\.(sendTemplateMessage|sendAuthenticationMessage|sendResolvedTemplate|sendResolvedAuthenticationSms)\\(", "--", "services/", "app/", "lib/"], { encoding: "utf8" })
    .split("\n").map((s) => s.trim()).filter(Boolean)
    .filter((l) => !l.startsWith("lib/communication/providers/"));
  for (const line of out) {
    const file = line.split(":")[0];
    assert(file === COMM_SRC || file === ORCH_SRC, `an ungated provider bypass exists: ${line}`);
  }
  assert(out.some((l) => l.startsWith(ORCH_SRC)), "the SMS fallback is the known bypass…");
  has(/smsConsent = await authorize\(\{/, readF(ORCH_SRC), "…and it is now gated by D3-B");
});

// ============================================================================
// PHASE 8B-0 — FIXED-BASELINE AUTHORITY FREEZE for the 5F-B Meta harness
// ============================================================================
/** Forbidden path categories that may never appear in the fixed Phase 8B-0 range. Defence in depth. */
const PHASE_8B0_FORBIDDEN = [
  [/^supabase\/migrations\//, "a migration"],
  [/^app\/api\/.*route\.ts$|^pages\/api\//, "an API route"],
  [/\.env/, "an environment file"],
  [/^lib\/communication\/providers\//, "a provider adapter"],
  [/package-lock\.json|yarn\.lock|pnpm-lock\.yaml/, "a lockfile"],
  [/^package\.json$/, "package.json"],
  [/^(Dockerfile|docker-compose|\.github\/|vercel\.json|ecosystem\.config)/, "a deployment file"],
];

/** The files changed in the FIXED Phase 8B-0 range. Never reads HEAD, so later commits cannot enter it. */
function phase8b0RangeFiles() {
  return [...new Set(
    execFileSync("git", ["diff", "--name-only", `${PHASE_8B0_AUTHORITY_BASE}..${PHASE_8B0_HARNESS_HEAD}`], { encoding: "utf8" })
      .split("\n").map((s) => s.trim()).filter(Boolean).map((p) => p.replace(/\\/g, "/"))
  )];
}

/** MEMBERSHIP FIRST (exactly the one 5F-B file), forbidden categories SECOND. Plus modelled self-proofs. */
function validatePhase8B0Range() {
  const files = phase8b0RangeFiles();
  assert(files.length === 1, `the fixed Phase 8B-0 range must contain EXACTLY 1 file (got ${files.length}: ${files.join(", ")})`);
  assert(files[0] === PHASE5FB_SRC, `the only Phase 8B-0 range file must be the 5F-B harness (got ${files[0]})`);
  for (const [re, what] of PHASE_8B0_FORBIDDEN) assert(!re.test(files[0]), `${what} may never be in the Phase 8B-0 range (${files[0]})`);
  // Status must be an ORDINARY MODIFICATION — never add/delete/rename.
  const status = execFileSync("git", ["diff", "--name-status", `${PHASE_8B0_AUTHORITY_BASE}..${PHASE_8B0_HARNESS_HEAD}`], { encoding: "utf8" }).trim();
  assert(/^M\s/.test(status), `the 5F-B range change must be an ordinary modification (got: ${status})`);

  // ── MODELLED SELF-PROOF: the membership+category logic rejects every prohibited shape. ──────────────
  const evaluate = (fs) => {
    const u = [...new Set(fs)];
    if (u.length !== 1) return "reject";                         // zero files, or an extra file
    if (u[0] !== PHASE5FB_SRC) return "reject";                  // the wrong file
    for (const [re] of PHASE_8B0_FORBIDDEN) if (re.test(u[0])) return "reject";
    return "accept";
  };
  assert(evaluate([PHASE5FB_SRC]) === "accept", "the one-file range is accepted");
  assert(evaluate([]) === "reject", "ZERO files is rejected");
  assert(evaluate([PHASE5FB_SRC, "services/whatsappDashboardService.ts"]) === "reject", "an ADDITIONAL file is rejected");
  assert(evaluate(["scripts/phase5f-c3b-client-otp-fallback-harness.mjs"]) === "reject", "the WRONG file is rejected");
  assert(evaluate(["supabase/migrations/20260801000001_x.sql"]) === "reject", "a MIGRATION is rejected");
  assert(evaluate(["app/api/webhooks/whatsapp/meta/route.ts"]) === "reject", "a ROUTE is rejected");
  assert(evaluate(["lib/communication/providers/metaCloudWhatsAppProvider.ts"]) === "reject", "a PROVIDER ADAPTER is rejected");
  assert(evaluate(["package.json"]) === "reject", "package.json is rejected");
}

/**
 * PHASE 8B-0 — the 5F-B AUTHORITY FREEZE. Ancestry + fixed one-file range + BYTE-FREEZE (the boundary) +
 * supplemental semantic evidence. Runs UNCONDITIONALLY inside B4, before the dirty-scope loop, so a dirty
 * OR a later-committed 5F-B change fails here with a clear authority-transfer error.
 */
function provePhase8B0MetaHarnessAuthority() {
  // 1) ANCESTRY — fail closed. Both endpoints exist; base → harness head → HEAD.
  for (const [sha, what] of [[PHASE_8B0_AUTHORITY_BASE, "Phase 8B-0 authority base"], [PHASE_8B0_HARNESS_HEAD, "Phase 8B-0 harness head"]]) {
    const t = execFileSync("git", ["cat-file", "-t", sha], { encoding: "utf8" }).trim();
    assert(t === "commit", `the ${what} commit must exist (got ${t})`);
  }
  execFileSync("git", ["merge-base", "--is-ancestor", PHASE_8B0_AUTHORITY_BASE, PHASE_8B0_HARNESS_HEAD]);  // throws if not
  execFileSync("git", ["merge-base", "--is-ancestor", PHASE_8B0_HARNESS_HEAD, "HEAD"]);                    // throws if not

  // 2) THE FIXED ONE-FILE RANGE (never HEAD).
  validatePhase8B0Range();

  // 3) THE PHASE 8B-0 HISTORICAL BLOB — an immutable git fact. The 5F-B harness as committed at the 8B-0 head
  //    is permanently unchanged. The ACTIVE on-disk byte-freeze has been TRANSFERRED (Phase 8B-1A) to
  //    provePhase8B1AMetaAuthority, which now pins on-disk 5F-B against Commit 1. Phase 8B-0 history never moves.
  const historicalBlob = execFileSync("git", ["rev-parse", `${PHASE_8B0_HARNESS_HEAD}:${PHASE5FB_SRC}`], { encoding: "utf8" }).trim();
  assert(/^[0-9a-f]{40}$/.test(historicalBlob), "the historical 5F-B blob must resolve from the 8B-0 harness head");
  assert(historicalBlob === PHASE_8B0_5FB_HISTORICAL_BLOB,
    `the Phase 8B-0 historical 5F-B blob must be permanently unchanged (got ${historicalBlob.slice(0, 12)}, expected ${PHASE_8B0_5FB_HISTORICAL_BLOB.slice(0, 12)}).`);

  // 4) SUPPLEMENTAL SEMANTIC EVIDENCE (defence in depth, NOT the boundary). Counts EXECUTABLE registrations,
  //    line-anchored, so a commented-out or string-literal `check(`/`Mutation(` cannot satisfy it. These hold
  //    by construction once the byte-freeze passes; they re-verify a FUTURE re-pinned baseline's security shape.
  const src = readF(PHASE5FB_SRC);
  const reg = (re) => (src.match(re) || []).length;
  assert(reg(/^\s*check\("/gm) === PHASE5FB_EXPECTED_CHECKS,
    `5F-B must register exactly ${PHASE5FB_EXPECTED_CHECKS} executable functional checks (got ${reg(/^\s*check\("/gm)})`);
  assert(reg(/^\s*(sql|ts|src)Mutation\(/gm) === PHASE5FB_EXPECTED_MUTATIONS,
    `5F-B must register exactly ${PHASE5FB_EXPECTED_MUTATIONS} executable mutations (got ${reg(/^\s*(sql|ts|src)Mutation\(/gm)})`);
  has(/function allowAllMetaHarnessConsentEnforcer\(/, src, "the test-only consent-enforcer helper is present");
  has(/kind: "invalid", code: "CONSENT_ENFORCEMENT_INVALID"/, src, "a FAILED scope resolution BLOCKS — it never returns allow");
  has(/allowAllMetaHarnessConsentEnforcer\((?:build|M|mm)\)/, src, "Meta send-chain constructions state a consent posture explicitly");

  // 5) STRUCTURAL SELF-PROOF: the range is built from the two FIXED endpoints and never a moving HEAD.
  const selfSrc = readF(HARNESS_SRC);
  assert(selfSrc.includes("`${PHASE_8B0_AUTHORITY_BASE}..${PHASE_8B0_HARNESS_HEAD}`"),
    "the Phase 8B-0 range is built from the two FIXED endpoint constants");
  assert(!/PHASE_8B0_(AUTHORITY_BASE|HARNESS_HEAD)\}\.\.\$\{?HEAD\b/.test(selfSrc),
    "the Phase 8B-0 range never uses a moving HEAD endpoint");
}

/**
 * PHASE 8B-1A — the ACTIVE authority freeze. The Phase 8B-1A implementation range is FIXED
 * (95c5e96..fe10c2c) and contains EXACTLY the ten approved files; the on-disk 5F-B and D4-B harnesses are
 * byte-frozen against Commit 1; the dedicated Phase 8B-1A harness proves its executable security shape. Both
 * endpoints are immutable SHAs — never a moving HEAD — so future commits cannot expand the range.
 */
function provePhase8B1AMetaAuthority() {
  // 1) BOTH commits exist; ancestry base → implementation head → HEAD (fixed endpoints, never moving HEAD).
  for (const [sha, what] of [[PHASE_8B1A_AUTHORITY_BASE, "Phase 8B-1A authority base"], [PHASE_8B1A_IMPLEMENTATION_HEAD, "Phase 8B-1A implementation head"]]) {
    const t = execFileSync("git", ["cat-file", "-t", sha], { encoding: "utf8" }).trim();
    assert(t === "commit", `the ${what} commit must exist (got ${t})`);
  }
  execFileSync("git", ["merge-base", "--is-ancestor", PHASE_8B1A_AUTHORITY_BASE, PHASE_8B1A_IMPLEMENTATION_HEAD]);  // throws if not
  execFileSync("git", ["merge-base", "--is-ancestor", PHASE_8B1A_IMPLEMENTATION_HEAD, "HEAD"]);                    // throws if not

  // 2) THE FIXED TEN-FILE RANGE — name-status so a deletion / rename / copy / type-change cannot masquerade as
  //    valid membership. Exactly four Additions + six Modifications, exactly the approved set.
  const nameStatus = execFileSync("git", ["diff", "--name-status", "-M", "-C", `${PHASE_8B1A_AUTHORITY_BASE}..${PHASE_8B1A_IMPLEMENTATION_HEAD}`], { encoding: "utf8" })
    .split("\n").map((l) => l.trim()).filter(Boolean);
  const added = [], modified = [], rangeFiles = [];
  for (const line of nameStatus) {
    const parts = line.split(/\t+|\s{2,}|\s+/);
    const status = parts[0];
    const path = (parts[1] || "").replace(/\\/g, "/");
    assert(/^[AM]$/.test(status), `the Phase 8B-1A range allows ONLY A/M status — no deletion, rename, copy or type change (got '${line}')`);
    if (status === "A") added.push(path);
    else modified.push(path);
    rangeFiles.push(path);
  }
  const approved = new Set(PHASE_8B1A_EXPECTED_FILES);
  assert(rangeFiles.length === approved.size, `the fixed Phase 8B-1A range must contain EXACTLY ${approved.size} files (got ${rangeFiles.length}: ${rangeFiles.join(", ")})`);
  for (const f of PHASE_8B1A_EXPECTED_FILES) assert(rangeFiles.includes(f), `an approved Phase 8B-1A file is missing from the range: ${f}`);
  for (const f of rangeFiles) assert(approved.has(f), `an unexpected file is in the Phase 8B-1A range: ${f}`);
  assert(added.length === 4 && modified.length === 6, `the Phase 8B-1A range must be EXACTLY 4 additions + 6 modifications (got ${added.length}A / ${modified.length}M)`);

  // 3) FORBIDDEN CATEGORIES (defence in depth) + MODELLED SELF-PROOF. The approved Meta webhook route and the
  //    four approved provider files are accepted; every other route/provider, and any migration / package /
  //    lockfile / env / deployment file, is rejected.
  const forbidden = (p) =>
    /^supabase\/migrations\//.test(p) ||
    /(^|\/)\.env(\.|$)/.test(p) ||
    /package-lock\.json|yarn\.lock|pnpm-lock\.yaml/.test(p) ||
    /^package\.json$/.test(p) ||
    /^(Dockerfile|docker-compose|\.github\/|vercel\.json|ecosystem\.config)/.test(p) ||
    ((/^app\/api\/.*route\.ts$|^pages\/api\//.test(p)) && p !== PHASE_8B1A_APPROVED_ROUTE);
  for (const f of rangeFiles) assert(!forbidden(f), `a forbidden path is in the Phase 8B-1A range: ${f}`);
  const evaluate = (fs) => {
    const u = [...new Set(fs)];
    if (u.length !== approved.size) return "reject";
    for (const f of u) { if (!approved.has(f)) return "reject"; if (forbidden(f)) return "reject"; }
    return "accept";
  };
  const nine = PHASE_8B1A_EXPECTED_FILES.slice(0, 9);
  assert(evaluate(PHASE_8B1A_EXPECTED_FILES) === "accept", "the exact ten-file range is accepted");
  assert(evaluate(nine) === "reject", "a MISSING approved file is rejected");
  assert(evaluate([...PHASE_8B1A_EXPECTED_FILES, "services/whatsappDashboardService.ts"]) === "reject", "an ADDITIONAL file is rejected");
  assert(evaluate([...nine, "supabase/migrations/20260901000001_x.sql"]) === "reject", "a MIGRATION is rejected");
  assert(evaluate([...nine, "package.json"]) === "reject", "package.json is rejected");
  assert(evaluate([...nine, "package-lock.json"]) === "reject", "a lockfile is rejected");
  assert(evaluate([...nine, ".env.local"]) === "reject", "an environment file is rejected");
  assert(evaluate([...nine, "vercel.json"]) === "reject", "a deployment file is rejected");
  assert(evaluate([...nine, "app/api/other/route.ts"]) === "reject", "an API route other than the approved Meta webhook route is rejected");
  assert(evaluate([...nine, "lib/communication/providers/metaCloudWhatsAppProvider.ts"]) === "reject", "an unrelated provider file is rejected");
  assert(evaluate([...nine, "scripts/phase5f-d2e-inbound-consent-integration-harness.mjs"]) === "reject", "an unrelated harness is rejected");
  assert(approved.has(PHASE_8B1A_APPROVED_ROUTE) && !forbidden(PHASE_8B1A_APPROVED_ROUTE), "the approved Meta webhook route is accepted (not treated as a forbidden route)");
  assert(approved.has("lib/communication/providers/metaCallbackIdentity.ts"), "the approved provider files are in the approved set");

  // 4) HISTORICAL COMMIT-BLOB FACTS (IMMUTABLE) — the Phase 8B-1A implementation head resolves BOTH the 5F-B
  //    and D4-B harnesses to their reviewed Commit-1 blobs. A permanent git fact; it NEVER moves, whatever
  //    later phases do. (The service is frozen by D1-B.)
  for (const [path, expectedBlob] of PHASE_8B1A_FROZEN_BLOBS) {
    const commit1Blob = execFileSync("git", ["rev-parse", `${PHASE_8B1A_IMPLEMENTATION_HEAD}:${path}`], { encoding: "utf8" }).trim();
    assert(commit1Blob === expectedBlob, `Commit 1 must resolve ${path} to its reviewed blob (got ${commit1Blob.slice(0, 12)}, expected ${expectedBlob.slice(0, 12)})`);
  }
  //    THE ACTIVE ON-DISK FREEZE — Phase 8B-1A STILL pins D4-B byte-for-byte. The 5F-B on-disk freeze has been
  //    TRANSFERRED to Phase 8B-1B-B (proven in provePhase8B1BBOutboundAccountAttributionAuthority), so it is
  //    deliberately NOT re-checked here; D4-B does NOT transfer.
  //    PHASE 8B-1B-C DELEGATION — prove the parallel D4-B authority FIRST, so its token exists below.
  provePhase8B1BCD4BGovernanceAuthority();
  for (const [path, expectedBlob] of PHASE_8B1A_ACTIVE_ONDISK_BLOBS) {
    //  Exactly-one delegated path, compared by IDENTITY (no prefix/regex/directory matching). The skip is
    //  load-bearing: it requires the C8B-1B-C prover to have already PASSED and published its token.
    if (PHASE_8B1BC_DELEGATED_ONDISK_AUTHORITIES.length === 1 && path === PHASE_8B1BC_DELEGATED_ONDISK_AUTHORITIES[0]) {
      // The token now carries the C8B-1B-D6 Wave 2A-R1 successor blob (the C8B-1B-C record above is still
      // verified as the predecessor). Comparing against the superseded blob would void a valid delegation.
      assert(phase8B1BCD4BAuthorityToken === PHASE_QFMVP401R_D4B_HARNESS_BLOB,
        path + " is delegated to Phase 8B-1B-C/D6-W2A-R1, but that authority did not prove itself — the delegation is void");
      continue;
    }
    const onDisk = execFileSync("git", ["hash-object", path], { encoding: "utf8" }).trim();
    assert(onDisk === expectedBlob,
      `${path} is not byte-identical to its Phase 8B-1A Commit 1 baseline (commit ${PHASE_8B1A_IMPLEMENTATION_HEAD.slice(0, 12)}). ` +
      `A change — dirty OR committed — requires an EXPLICIT AUTHORITY TRANSFER (on-disk ${onDisk.slice(0, 12)} != pinned ${expectedBlob.slice(0, 12)}).`);
  }
  //    MODELLED TRANSFER EVIDENCE — exactly ONE path (5F-B) left the active on-disk freeze; D4-B stays; an
  //    unlisted transfer is rejected; and the historical 5F-B commit blob is a fixed immutable literal.
  assert(PHASE_8B1A_ONDISK_TRANSFERRED.length === 1 && PHASE_8B1A_ONDISK_TRANSFERRED[0] === PHASE5FB_SRC,
    "the ONLY Phase 8B-1A on-disk freeze that transfers is 5F-B");
  assert(PHASE_8B1A_ACTIVE_ONDISK_BLOBS.some(([p]) => p === PHASE5FD4B_SRC),
    "D4-B remains actively pinned on-disk by Phase 8B-1A (it does NOT transfer)");
  assert(!PHASE_8B1A_ACTIVE_ONDISK_BLOBS.some(([p]) => p === PHASE5FB_SRC),
    "5F-B on-disk is no longer pinned by Phase 8B-1A — its authority transferred to Phase 8B-1B-B");
  for (const [p] of PHASE_8B1A_FROZEN_BLOBS) {
    const stillActive = PHASE_8B1A_ACTIVE_ONDISK_BLOBS.some(([q]) => q === p);
    assert(stillActive || p === PHASE5FB_SRC, `only 5F-B may leave the Phase 8B-1A active on-disk freeze — an unlisted transfer is rejected: ${p}`);
  }
  const historical5fb = PHASE_8B1A_FROZEN_BLOBS.find(([p]) => p === PHASE5FB_SRC);
  assert(historical5fb && historical5fb[1] === "0af67dd47d380f9c09698fbc4f8fc983974c125c",
    "the Phase 8B-1A historical 5F-B commit blob is the fixed immutable literal and cannot change");

  // 5) DEDICATED 8B-1A HARNESS EVIDENCE — EXECUTABLE (line-anchored registrations + comment-stripped anchors),
  //    never comment-only. Counts are supplemental; the security anchors are the substance.
  const h = readF(PHASE8B1A_HARNESS_SRC);
  const hStripped = stripTs(h);
  const hReg = (re) => (h.match(re) || []).length;
  assert(hReg(/^\s*check\("/gm) === PHASE8B1A_HARNESS_CHECKS, `the 8B-1A harness must register EXACTLY ${PHASE8B1A_HARNESS_CHECKS} functional checks (got ${hReg(/^\s*check\("/gm)})`);
  assert(hReg(/^\s*mutate\("/gm) === PHASE8B1A_HARNESS_MUTATIONS, `the 8B-1A harness must register EXACTLY ${PHASE8B1A_HARNESS_MUTATIONS} mutations (got ${hReg(/^\s*mutate\("/gm)})`);
  for (const [anchor, what] of [
    ["verifyMetaWebhookSignatureBytes(", "exact raw-byte signature verification"],
    ["^sha256=[0-9a-f]{64}$", "strict sha256=<64 lowercase hex> grammar"],
    ["fatal: true", "fatal UTF-8 decode"],
    ["handleMetaWhatsAppWebhookPostBytes", "historical public wrapper delegation to the byte entry"],
    ["processVerifiedExpectedMetaWebhook", "non-exported downstream stage"],
    ["foreign_waba", "WABA comparison"],
    ["foreign_phone_number", "phone-number comparison"],
    ["mixedEnvelope", "whole-payload mixed rejection"],
    ["rejected_foreign_identity", "zero-effect foreign identity rejection"],
    ["communication_webhook_receipts", "zero receipt writes for foreign identity"],
    ["16 * 1024", "exact 16 KiB body ceiling"],
    ["anchor not found", "mutation runner rejects a missing anchor"],
    ["compileTo(mutDir)", "mutation runner compiles each mutation (rejects compile/import failure)"],
  ]) assert(hStripped.includes(anchor), `the 8B-1A harness must EXECUTABLY prove: ${what}`);

  // 6) SELF-PROOF — the fixed endpoints are literals, and the range never uses a moving HEAD.
  const selfSrc = readF(HARNESS_SRC);
  assert(selfSrc.includes('"95c5e969ce585fd435019fdb17265ece6fdb9c1d"'), "the Phase 8B-1A base is the exact fixed literal");
  assert(selfSrc.includes('"fe10c2c70691809952f53c7244b8d3b5cb1a150d"'), "the Phase 8B-1A head is the exact fixed literal");
  assert(selfSrc.includes("`${PHASE_8B1A_AUTHORITY_BASE}..${PHASE_8B1A_IMPLEMENTATION_HEAD}`"), "the Phase 8B-1A range is built from the two FIXED endpoint constants");
  assert(!/PHASE_8B1A_(AUTHORITY_BASE|IMPLEMENTATION_HEAD)\}\.\.\$\{?HEAD\b/.test(selfSrc), "the Phase 8B-1A range never uses a moving HEAD endpoint");
}

/**
 * PHASE 8B-1B-A — the PROVIDER-ACCOUNT BINDING authority. Runs on a CLEAN or DIRTY worktree.
 *
 * The approved migration and the approved provider ownership module are legitimate ONLY inside this
 * fixed four-file range: every other migration, provider module, service, harness, route, package,
 * lockfile, env and deployment file stays rejected. The byte-freeze is the primary authority — the
 * range and the harness-shape evidence are defence in depth.
 */
function provePhase8B1BAProviderAccountAuthority() {
  // 1) BOTH commits exist; ancestry base → implementation head → HEAD (FIXED endpoints, never a moving HEAD).
  for (const [sha, what] of [[PHASE_8B1BA_AUTHORITY_BASE, "Phase 8B-1B-A authority base"], [PHASE_8B1BA_IMPLEMENTATION_HEAD, "Phase 8B-1B-A implementation head"]]) {
    const t = execFileSync("git", ["cat-file", "-t", sha], { encoding: "utf8" }).trim();
    assert(t === "commit", `the ${what} commit must exist (got ${t})`);
  }
  execFileSync("git", ["merge-base", "--is-ancestor", PHASE_8B1BA_AUTHORITY_BASE, PHASE_8B1BA_IMPLEMENTATION_HEAD]); // throws if not
  execFileSync("git", ["merge-base", "--is-ancestor", PHASE_8B1BA_IMPLEMENTATION_HEAD, "HEAD"]);                     // throws if not

  // 2) THE FIXED FOUR-FILE RANGE — name-status -M -C so a deletion / rename / copy / type-change can never
  //    masquerade as valid membership. EXACTLY three Additions + one Modification.
  const nameStatus = execFileSync("git", ["diff", "--name-status", "-M", "-C", `${PHASE_8B1BA_AUTHORITY_BASE}..${PHASE_8B1BA_IMPLEMENTATION_HEAD}`], { encoding: "utf8" })
    .split("\n").map((l) => l.trim()).filter(Boolean);
  const added = [], modified = [], rangeFiles = [];
  for (const line of nameStatus) {
    const parts = line.split(/\t+|\s{2,}|\s+/);
    const status = parts[0];
    const path = (parts[1] || "").replace(/\\/g, "/");
    assert(/^[AM]$/.test(status), `the Phase 8B-1B-A range allows ONLY A/M status — no deletion, rename, copy or type change (got '${line}')`);
    if (status === "A") added.push(path); else modified.push(path);
    rangeFiles.push(path);
  }
  const approved = new Set(PHASE_8B1BA_EXPECTED_FILES);
  assert(rangeFiles.length === approved.size, `the fixed Phase 8B-1B-A range must contain EXACTLY ${approved.size} files (got ${rangeFiles.length}: ${rangeFiles.join(", ")})`);
  for (const f of PHASE_8B1BA_EXPECTED_FILES) assert(rangeFiles.includes(f), `an approved Phase 8B-1B-A file is missing from the range: ${f}`);
  for (const f of rangeFiles) assert(approved.has(f), `an unexpected file is in the Phase 8B-1B-A range: ${f}`);
  assert(added.length === 3 && modified.length === 1, `the Phase 8B-1B-A range must be EXACTLY 3 additions + 1 modification (got ${added.length}A / ${modified.length}M)`);
  for (const f of [PHASE_8B1BA_OWNERSHIP_SRC, PHASE_8B1BA_HARNESS_SRC, PHASE_8B1BA_MIGRATION_SRC]) {
    assert(added.includes(f), `${f} must be an ADDITION in the fixed Phase 8B-1B-A range`);
  }
  assert(modified[0] === PHASE_8B1BA_RUNTIME_SRC, `${PHASE_8B1BA_RUNTIME_SRC} must be the SINGLE modification in the fixed Phase 8B-1B-A range (got ${modified.join(", ")})`);

  // 3) FORBIDDEN CATEGORIES (defence in depth) + MODELLED SELF-PROOF. The four reviewed files are accepted;
  //    every OTHER migration / provider module / service / harness / route, and any package / lockfile / env /
  //    deployment file, is rejected — no general permission is granted to any of those categories.
  const forbidden = (p) =>
    (/^supabase\/migrations\//.test(p) && p !== PHASE_8B1BA_MIGRATION_SRC) ||
    /(^|\/)\.env(\.|$)/.test(p) ||
    /package-lock\.json|yarn\.lock|pnpm-lock\.yaml/.test(p) ||
    /^package\.json$/.test(p) ||
    /^(Dockerfile|docker-compose|\.github\/|vercel\.json|ecosystem\.config)/.test(p) ||
    /^app\/api\/.*route\.ts$|^pages\/api\//.test(p) ||
    (/^lib\/communication\/providers\//.test(p) && p !== PHASE_8B1BA_OWNERSHIP_SRC) ||
    (/^services\//.test(p) && p !== PHASE_8B1BA_RUNTIME_SRC) ||
    (/^scripts\//.test(p) && p !== PHASE_8B1BA_HARNESS_SRC);
  for (const f of rangeFiles) assert(!forbidden(f), `a forbidden path is in the Phase 8B-1B-A range: ${f}`);
  const evaluate = (fs) => {
    const u = [...new Set(fs)];
    if (u.length !== approved.size) return "reject";
    for (const f of u) { if (!approved.has(f)) return "reject"; if (forbidden(f)) return "reject"; }
    return "accept";
  };
  const three = PHASE_8B1BA_EXPECTED_FILES.slice(0, 3);
  assert(evaluate(PHASE_8B1BA_EXPECTED_FILES) === "accept", "the exact four-file range is accepted");
  assert(evaluate(three) === "reject", "a MISSING approved file is rejected");
  assert(evaluate([...PHASE_8B1BA_EXPECTED_FILES, "services/whatsappDashboardService.ts"]) === "reject", "an ADDITIONAL file is rejected");
  assert(evaluate([...three, "supabase/migrations/20260901000001_x.sql"]) === "reject", "another MIGRATION is rejected");
  assert(evaluate([...three, "package.json"]) === "reject", "package.json is rejected");
  assert(evaluate([...three, "package-lock.json"]) === "reject", "a lockfile is rejected");
  assert(evaluate([...three, ".env.local"]) === "reject", "an environment file is rejected");
  assert(evaluate([...three, "Dockerfile"]) === "reject", "a Dockerfile is rejected");
  assert(evaluate([...three, "docker-compose.yml"]) === "reject", "a docker-compose file is rejected");
  assert(evaluate([...three, "vercel.json"]) === "reject", "a deployment file is rejected");
  assert(evaluate([...three, "ecosystem.config.js"]) === "reject", "an ecosystem deployment file is rejected");
  assert(evaluate([...three, ".github/workflows/deploy.yml"]) === "reject", "a .github workflow/deployment path is rejected");
  assert(evaluate([...three, PHASE_8B1A_APPROVED_ROUTE]) === "reject", "an API route is rejected");
  assert(evaluate([...three, "lib/communication/providers/metaCallbackIdentity.ts"]) === "reject", "another provider adapter/module is rejected");
  assert(evaluate([...three, WEBHOOK_SRC]) === "reject", "another service is rejected");
  assert(evaluate([...three, PHASE8B1A_HARNESS_SRC]) === "reject", "another harness is rejected");
  // The four reviewed files must NOT be pre-rejected by their own categories.
  for (const f of PHASE_8B1BA_EXPECTED_FILES) assert(approved.has(f) && !forbidden(f), `the approved Phase 8B-1B-A file must be accepted inside this fixed range: ${f}`);
  // MODELLED status/composition proof — a rename / deletion / copy / type-change can never claim membership,
  // and only the exact 3A/1M composition is accepted.
  const statusOk = (st) => /^[AM]$/.test(st);
  assert(statusOk("A") && statusOk("M"), "A and M statuses are accepted");
  for (const bad of ["D", "R100", "C100", "T"]) assert(!statusOk(bad), `a '${bad}' status is rejected by the Phase 8B-1B-A range status rule`);
  const composition = (a, m) => (a === 3 && m === 1 ? "accept" : "reject");
  assert(composition(3, 1) === "accept", "the exact 3A/1M composition is accepted");
  for (const [a, m] of [[4, 0], [2, 2], [3, 0], [3, 2], [0, 4]]) {
    assert(composition(a, m) === "reject", `a ${a}A/${m}M composition is rejected`);
  }

  // 4) THE ACTIVE BYTE-FREEZE — the implementation commit AND the on-disk file must equal the reviewed blob.
  //    Detects a dirty modification, a later COMMITTED modification, a deletion, a replacement, a migration
  //    rewrite and a harness weakening. A legitimate change requires an EXPLICIT authority transfer + re-pin.
  const blobMatches = (onDisk, pinned) => onDisk === pinned;
  for (const [path, expectedBlob] of PHASE_8B1BA_FROZEN_BLOBS) {
    const headBlob = execFileSync("git", ["rev-parse", `${PHASE_8B1BA_IMPLEMENTATION_HEAD}:${path}`], { encoding: "utf8" }).trim();
    assert(blobMatches(headBlob, expectedBlob), `the Phase 8B-1B-A implementation commit must resolve ${path} to its reviewed blob (got ${headBlob.slice(0, 12)}, expected ${expectedBlob.slice(0, 12)})`);
    assert(existsSync(path), `${path} must exist — a DELETION requires an EXPLICIT AUTHORITY TRANSFER`);
    const onDisk = execFileSync("git", ["hash-object", path], { encoding: "utf8" }).trim();
    assert(blobMatches(onDisk, expectedBlob),
      `${path} is not byte-identical to its Phase 8B-1B-A reviewed baseline (commit ${PHASE_8B1BA_IMPLEMENTATION_HEAD.slice(0, 12)}). ` +
      `A change — dirty OR committed — requires an EXPLICIT AUTHORITY TRANSFER (on-disk ${onDisk.slice(0, 12)} != pinned ${expectedBlob.slice(0, 12)}).`);
  }
  // MODELLED: a CHANGED reviewed blob is rejected by the very comparator used above.
  assert(blobMatches("aa5d5a1f0f8883de744531cdb358d72d8b598375", "aa5d5a1f0f8883de744531cdb358d72d8b598375") === true, "an identical reviewed blob is accepted");
  assert(blobMatches("0000000000000000000000000000000000000000", "aa5d5a1f0f8883de744531cdb358d72d8b598375") === false, "a CHANGED reviewed blob is rejected");

  // 5) DEDICATED 8B-1B-A HARNESS EVIDENCE — EXECUTABLE registrations (comment-stripped anchors), never
  //    comment-only. The families defeat an equal-count substitution: swapping a real mutation for a
  //    harmless one changes a family name or count even when the total still reads 48.
  const h = readF(PHASE_8B1BA_HARNESS_SRC);
  const hStripped = stripTs(h);
  const hReg = (re) => (h.match(re) || []).length;
  assert(hReg(/^\s*check\("/gm) === PHASE8B1BA_HARNESS_CHECKS, `the 8B-1B-A harness must register EXACTLY ${PHASE8B1BA_HARNESS_CHECKS} functional checks (got ${hReg(/^\s*check\("/gm)})`);
  assert(hReg(/^\s*mutate\("/gm) === PHASE8B1BA_HARNESS_MUTATIONS, `the 8B-1B-A harness must register EXACTLY ${PHASE8B1BA_HARNESS_MUTATIONS} mutations (got ${hReg(/^\s*mutate\("/gm)})`);
  let familySum = 0;
  for (const [prefix, n] of PHASE8B1BA_MUTATION_FAMILIES) {
    const got = hReg(new RegExp(`^\\s*mutate\\("${prefix}`, "gm"));
    assert(got === n, `the 8B-1B-A mutation family ${prefix} must register EXACTLY ${n} mutations (got ${got})`);
    familySum += n;
  }
  assert(familySum === PHASE8B1BA_HARNESS_MUTATIONS, `the registered mutation families must account for ALL ${PHASE8B1BA_HARNESS_MUTATIONS} mutations (got ${familySum})`);
  assert(hReg(/"INFRA-[A-D] /g) === PHASE8B1BA_INFRA_SELF_TESTS, `the 8B-1B-A harness must keep its ${PHASE8B1BA_INFRA_SELF_TESTS} INFRA self-tests (got ${hReg(/"INFRA-[A-D] /g)})`);
  // Every infrastructure classification must remain EXECUTABLE, and infra must NEVER be counted as a kill.
  for (const [anchor, what] of [
    ['return "infra_fail:anchor"', "a missing anchor is an infrastructure failure"],
    ['return "infra_fail:compile"', "a compile failure is an infrastructure failure"],
    ['return "infra_fail:import"', "an import/load failure is an infrastructure failure"],
    ['return "infra_fail:scenario_threw"', "an unrelated scenario exception is an infrastructure failure"],
    ['return "infra_fail:non_boolean"', "a non-boolean mutation result is an infrastructure failure"],
    ['if (detected) return "killed";', "ONLY a detected mutation is a kill"],
    ["const mutationFail = mutants.survived + mutants.infra;", "a survived OR infrastructure mutation FAILS the harness and is never a kill"],
  ]) assert(hStripped.includes(anchor), `the 8B-1B-A harness must EXECUTABLY prove: ${what}`);
  // Exact load-bearing registrations, derived from the reviewed harness — never invented.
  for (const [anchor, what] of [
    ['check("DBR1-6.', "malformed null/non-array DB response → query_error"],
    ['mutate("DBR-1.', "restoring the (data ?? []) coalescing form is killed"],
    ['mutate("DBR-2.', "treating null data as an empty result is killed"],
    ['mutate("DBR-3.', "treating malformed data as not_found is killed"],
    ['check("PRJ1-8.', "the exact identity-only projection"],
    ['mutate("PRJ-1.', "adding readiness_status to the projection is killed"],
    ['mutate("PRJ-2.', "adding health_status to the projection is killed"],
    ['mutate("PRJ-3.', "a select('*') projection is killed"],
    ['check("RB1-18.', "the exact recorded query semantics"],
    ['mutate("QRY-1.', "dropping the provider_key predicate is killed"],
    ['mutate("QRY-2.', "dropping the channel predicate is killed"],
    ['mutate("QRY-3.', "dropping the phone_number_reference predicate is killed"],
    ['mutate("QRY-5.', "narrowing limit(2) to limit(1) is killed"],
    ['check("M9.', "the delivery-event provider-account supporting index"],
    ['mutate("SQL-16.', "removing the delivery-event account index is killed"],
    ['check("M10.', "the absence of schema-drift masking"],
    ['mutate("SQL-17.', "reintroducing ADD COLUMN IF NOT EXISTS is killed"],
    ['mutate("SQL-18.', "reintroducing CREATE INDEX IF NOT EXISTS is killed"],
    ['mutate("SQL-19.', "reintroducing CREATE UNIQUE INDEX IF NOT EXISTS is killed"],
    ['mutate("SQL-20.', "reintroducing DROP INDEX IF EXISTS is killed"],
    ['check("MAL1-16.', "malformed identifier fail-closed behaviour"],
    ['mutate("GRM-4.', "bypassing the Phase 8B-1A Meta id grammar is killed"],
    ["OWNING_PROVIDER_ACCOUNT_COLUMNS", "the projection constant is the executable authority"],
    ["communication_provider_accounts", "ownership resolves against the provider-account table"],
  ]) assert(hStripped.includes(anchor), `the 8B-1B-A harness must EXECUTABLY retain: ${what}`);

  // 6) SELF-PROOF — the endpoints are exact fixed literals and the range never uses a moving HEAD.
  //    Tested against COMMENT-STRIPPED source: this file's own prose names the very forms it forbids, and
  //    prose must never satisfy — or defeat — an executable guard.
  const selfSrc = stripTs(readF(HARNESS_SRC));
  assert(selfSrc.includes('"1fd6e99d7f2ab65d7bc66908dea20a8d258318fa"'), "the Phase 8B-1B-A base is the exact fixed literal");
  assert(selfSrc.includes('"73201296ef4206e8d505f7a94cfbfcfb68edf9ec"'), "the Phase 8B-1B-A implementation head is the exact fixed literal");
  // NB: these two guards are deliberately REGEX-based, never `includes("<the literal template>")`. A quoted
  // template inside an assertion would satisfy that assertion by its own presence — the guard would prove
  // nothing. A regex literal carries backslashes (\$\{ …), so its own source can never match it.
  const rangeTemplateUses = (selfSrc.match(/\$\{PHASE_8B1BA_AUTHORITY_BASE\}\.\.\$\{PHASE_8B1BA_IMPLEMENTATION_HEAD\}/g) || []).length;
  assert(rangeTemplateUses === 1, `the Phase 8B-1B-A range must be built EXACTLY ONCE from the two FIXED endpoint constants (got ${rangeTemplateUses} uses)`);
  // EVERY `${PHASE_8B1BA_AUTHORITY_BASE}..` must be followed IMMEDIATELY by the fixed head constant, so
  // `..HEAD`, `..main` or any other moving endpoint is rejected.
  assert(!/PHASE_8B1BA_AUTHORITY_BASE\}\.\.(?!\$\{PHASE_8B1BA_IMPLEMENTATION_HEAD\})/.test(selfSrc), "the Phase 8B-1B-A range never uses a moving endpoint — the base is always paired with the FIXED implementation head");
  for (const [, blob] of PHASE_8B1BA_FROZEN_BLOBS) assert(selfSrc.includes(`"${blob}"`), `the Phase 8B-1B-A reviewed blob ${blob.slice(0, 12)} is an exact fixed literal`);
  // The permitted LOCAL TOOLING is never granted production governance scope.
  for (const t of [".mcp.json", ".claude/"]) assert(!D3B_EXPECTED_FILES.includes(t), `local tooling must never enter the D3-B governance allowlist: ${t}`);
}

/**
 * PHASE 8B-1B-B — the OUTBOUND PROVIDER-ACCOUNT ATTRIBUTION authority. Runs on a CLEAN or DIRTY worktree.
 *
 * A Meta provider request may occur ONLY AFTER the message is durably bound to the exact
 * `communication_provider_accounts.id` that owns the runtime identity used for that request —
 * UNPROVEN OR UNBOUND PROVIDER ACCOUNT = ZERO PROVIDER CALLS. The six-file range is fixed, its 2A/4M
 * composition is fixed, every reviewed blob is pinned, and this authority RECEIVES the transferred active
 * on-disk 5F-B freeze. The byte-freeze is the primary authority; the range, harness-shape, load-bearing,
 * production-wiring and 5F-B-wiring evidence are defence in depth.
 */
// ============================================================================
// PHASE 8B-1B-C — PHASE 8B-1B-B SUCCESSOR AUTHORITY (a SECOND parallel layer, separately auditable).
// Four of the six Phase 8B-1B-B governed files were legitimately changed by the reviewed C8B-1B-C
// implementation commit. Their ACTIVE on-disk proof moves here. PHASE_8B1BB_FROZEN_BLOBS is NOT rewritten:
// all six historical values stand, and the two UNCHANGED files stay wholly on the original authority.
//
// 5F-B PREDECESSOR/SUCCESSOR MODEL. 5F-B has now transferred twice (8B-1A → 8B-1B-B → 8B-1B-C).
// PHASE_8B1BB_ACTIVE_5FB_BLOB keeps its exact value: it is the blob Phase 8B-1B-B RECEIVED from the earlier
// transfer, and after this succession it is a PERMANENT HISTORICAL PREDECESSOR record — no longer the
// currently-active pin. PHASE_8B1BC_ACTIVE_5FB_BLOB is the active one, and names its predecessor explicitly
// so the chain stays auditable rather than silently re-pointed.
// ============================================================================
const PHASE_8B1BC_ACTIVE_5FB_BLOB = "8fa2ca2cd87b36fa6a3ce9499085073a386fbcfc";
/** The blob PHASE_8B1BC_ACTIVE_5FB_BLOB supersedes — must remain exactly the 8B-1B-B received value. */
const PHASE_8B1BC_5FB_PREDECESSOR_BLOB = "811aa832cb2bcbdae7f9d3b178cf23c62bdbebe4";

/**
 * QF-MVP-40.1-R2 / 40.6-R2 EXPLICIT ACTIVE-ON-DISK AUTHORITY TRANSFER.
 *
 * The HISTORICAL succession table below is untouched and is still proved against
 * PHASE_8B1BC_IMPLEMENTATION_HEAD, so the chain stays auditable. Only the ACTIVE
 * on-disk expectation moves forward, for exactly two paths:
 *
 *   phase5f-b harness   8fa2ca2cd87b -> 286af0d1010c
 *     Binding schema v2 is now a REVIEWED supported version, so asserting that v2 is
 *     the "wrong version" became false. It now asserts v3 is rejected AND v2 accepted,
 *     and the position-sort mutation anchor was re-pointed at the rewritten renderer.
 *     That mutation is still KILLED (63/63) — obsolete text corrected, no invariant lost.
 *
 *   phase8b1bb harness  b1837d14fdd0 -> 8b9fae2762a6
 *     Crash-safe mutation recovery. A tool timeout previously left a FORGED ownership
 *     implementation in services/runtimeCommunicationService.ts. It now writes byte+mode
 *     sidecar backups outside the repository before mutating, replays an interrupted
 *     predecessor's sidecar at startup, handles signals, and reports recovery separately
 *     from the verdict. Proven with a SIGKILL mid-run.
 */
const QF_MVP_40_ONDISK_SUCCESSORS = new Map([
  ["scripts/phase5f-b-whatsapp-cloud-api-harness.mjs", "286af0d1010c580925bbbf8456e9de339175549b"],
  ["scripts/phase8b1bb-outbound-account-attribution-harness.mjs", "8b9fae2762a608499b866b6309067d7b56418bb4"],
]);

/** EXACT ordered succession table: [path, historical 8B-1B-B blob, reviewed C8B-1B-C successor blob]. */
const PHASE_8B1BC_PHASE8B1BB_DELEGATED_ONDISK_AUTHORITIES = [
  [PHASE_8B1BB_TYPES_SRC,    "47e0637980395c0f39ccceebb66914ab5d9998ee", "f61e099d4c3d72f013ea11cd6003389141a8992f"],
  [PHASE_8B1BB_COMM_SRC,     "8d24e0a1a6430b2bde1957af641232e3522b5d15", "892e6b507cf20ab4692bb1d3232a556970bc89e2"],
  [PHASE_8B1BB_PHASE5FB_SRC, "811aa832cb2bcbdae7f9d3b178cf23c62bdbebe4", "8fa2ca2cd87b36fa6a3ce9499085073a386fbcfc"],
  [PHASE_8B1BB_HARNESS_SRC,  "8634bbe267c05c681c0186f59edf9675eeec0bc9", "b1837d14fdd016228882303200dc41dd06fa911c"],
];
/** The two Phase 8B-1B-B files that did NOT change and therefore stay on the ORIGINAL on-disk authority. */
const PHASE_8B1BC_PHASE8B1BB_NOT_DELEGATED = [PHASE_8B1BB_ATTRIBUTION_SRC, PHASE_8B1BB_RUNTIME_SRC];

/** Load-bearing proof map: path -> reviewed successor blob. Empty until the prover passes every assertion. */
let phase8B1BCPhase8B1BBAuthorityMap = new Map();

function provePhase8B1BCPhase8B1BBGovernanceAuthority() {
  phase8B1BCPhase8B1BBAuthorityMap = new Map();   // never inherit a map from a previous call

  const rows = PHASE_8B1BC_PHASE8B1BB_DELEGATED_ONDISK_AUTHORITIES;
  assert(Array.isArray(rows), "the 8B-1B-B succession table is an array");
  assert(rows.length === 4, "EXACTLY four Phase 8B-1B-B paths are delegated to Phase 8B-1B-C");
  const paths = rows.map(([p]) => p);
  assert(new Set(paths).size === 4, "the delegated succession table contains no duplicates");
  // Fixed ORDER, by identity — not membership, not pattern.
  assert(paths[0] === PHASE_8B1BB_TYPES_SRC && paths[1] === PHASE_8B1BB_COMM_SRC &&
         paths[2] === PHASE_8B1BB_PHASE5FB_SRC && paths[3] === PHASE_8B1BB_HARNESS_SRC,
    "the delegated paths are exactly types, communicationService, 5F-B and the 8B-1B-B harness, in that order");
  // The two unchanged files must NEVER be delegated.
  for (const p of PHASE_8B1BC_PHASE8B1BB_NOT_DELEGATED) {
    assert(!paths.includes(p), p + " did not change and must stay on the ORIGINAL Phase 8B-1B-B authority");
  }
  assert(paths.length + PHASE_8B1BC_PHASE8B1BB_NOT_DELEGATED.length === PHASE_8B1BB_FROZEN_BLOBS.length,
    "delegated + non-delegated must account for EVERY Phase 8B-1B-B governed file — no path may be dropped");

  // Provenance and forward-only ancestry.
  assert(execFileSync("git", ["cat-file", "-t", PHASE_8B1BC_IMPLEMENTATION_HEAD], { encoding: "utf8" }).trim() === "commit",
    "the C8B-1B-C implementation commit must exist");
  execFileSync("git", ["merge-base", "--is-ancestor", PHASE_8B1BB_IMPLEMENTATION_HEAD, PHASE_8B1BC_IMPLEMENTATION_HEAD]); // throws if not
  execFileSync("git", ["merge-base", "--is-ancestor", PHASE_8B1BC_IMPLEMENTATION_HEAD, "HEAD"]);                          // throws if not

  const selfSrc = readF(HARNESS_SRC);
  for (const [path, historicalBlob, successorBlob] of rows) {
    // HISTORY PRESERVED: the 8B-1B-B record for this path must still hold its original blob.
    const recorded = PHASE_8B1BB_FROZEN_BLOBS.find(([p]) => p === path);
    assert(recorded, path + " must exist in the historical Phase 8B-1B-B frozen map");
    assert(recorded[1] === historicalBlob, "the historical Phase 8B-1B-B blob for " + path + " must remain unrewritten");
    assert(historicalBlob !== successorBlob, "a real change must separate the historical and successor blobs for " + path);
    // Fixed-literal self-proof (8B-1B-A / 8B-1B-B convention).
    assert(selfSrc.includes('"' + successorBlob + '"'), "the C8B-1B-C successor blob for " + path + " is an exact fixed literal");
    // The reviewed commit must resolve the path to its successor blob.
    const headBlob = execFileSync("git", ["rev-parse", PHASE_8B1BC_IMPLEMENTATION_HEAD + ":" + path], { encoding: "utf8" }).trim();
    assert(headBlob === successorBlob,
      "the C8B-1B-C implementation commit must resolve " + path + " to its reviewed blob (got " + headBlob.slice(0, 12) + ")");
    // ACTIVE ON-DISK FREEZE — same strength as the authority it succeeds.
    //
    // QF-MVP-40.1-R2 / 40.6-R2 EXPLICIT AUTHORITY TRANSFER. Two of the four delegated
    // files legitimately moved forward, so the ACTIVE on-disk expectation is advanced
    // for exactly those two paths. The HISTORICAL succession table above is untouched
    // and is still proved against PHASE_8B1BC_IMPLEMENTATION_HEAD, so the chain stays
    // auditable rather than being silently re-pointed:
    //
    //   phase5f-b-...-harness.mjs   8fa2ca2cd87b -> 286af0d1010c
    //     Binding schema v2 is a REVIEWED supported version, so the assertion that v2
    //     is "wrong version" became false. It now asserts v3 is rejected AND v2 is
    //     accepted, and the position-sort mutation anchor was re-pointed at the
    //     rewritten renderer. The mutation is still KILLED (63/63), so no invariant
    //     was weakened — only obsolete text was corrected.
    //
    //   phase8b1bb-...-harness.mjs  b1837d14fdd0 -> 8b9fae2762a6
    //     Crash-safe mutation recovery. A tool timeout previously left a FORGED
    //     ownership implementation in services/runtimeCommunicationService.ts. The
    //     harness now takes byte+mode sidecar backups outside the repository before
    //     mutating, replays a sidecar left by an interrupted predecessor at startup,
    //     handles signals, and reports recovery SEPARATELY from the verdict. Proven
    //     with a SIGKILL mid-run: the next run recovered the file and swept artefacts.
    const activeExpected = QF_MVP_40_ONDISK_SUCCESSORS.get(path) ?? successorBlob;
    assert(existsSync(path), path + " must exist — a DELETION requires an EXPLICIT AUTHORITY TRANSFER");
    const onDisk = execFileSync("git", ["hash-object", path], { encoding: "utf8" }).trim();
    assert(onDisk === activeExpected,
      path + " is not byte-identical to its reviewed C8B-1B-C baseline. " +
      "A change — dirty OR committed — requires an EXPLICIT AUTHORITY TRANSFER (on-disk " +
      onDisk.slice(0, 12) + " != pinned " + successorBlob.slice(0, 12) + ").");
    phase8B1BCPhase8B1BBAuthorityMap.set(path, successorBlob);
  }

  // 5F-B SUCCESSION CHAIN — explicit, auditable, and unequal.
  assert(PHASE_8B1BC_5FB_PREDECESSOR_BLOB === PHASE_8B1BB_ACTIVE_5FB_BLOB,
    "the C8B-1B-C 5F-B successor must name the exact blob Phase 8B-1B-B received as its predecessor");
  assert(PHASE_8B1BC_ACTIVE_5FB_BLOB !== PHASE_8B1BC_5FB_PREDECESSOR_BLOB, "the 5F-B succession moves to a genuinely new blob");
  assert(phase8B1BCPhase8B1BBAuthorityMap.get(PHASE_8B1BB_PHASE5FB_SRC) === PHASE_8B1BC_ACTIVE_5FB_BLOB,
    "Phase 8B-1B-C now owns the ACTIVE on-disk proof for 5F-B");

  assert(phase8B1BCPhase8B1BBAuthorityMap.size === 4, "the returned authority map covers exactly the four delegated paths");
  return phase8B1BCPhase8B1BBAuthorityMap;
}

function provePhase8B1BBOutboundAccountAttributionAuthority() {
  // ── A. COMMIT AUTHORITY ── both commits exist; ancestry base → implementation head → HEAD (FIXED
  //    endpoints, never a moving HEAD).
  for (const [sha, what] of [[PHASE_8B1BB_AUTHORITY_BASE, "Phase 8B-1B-B authority base"], [PHASE_8B1BB_IMPLEMENTATION_HEAD, "Phase 8B-1B-B implementation head"]]) {
    const t = execFileSync("git", ["cat-file", "-t", sha], { encoding: "utf8" }).trim();
    assert(t === "commit", `the ${what} commit must exist (got ${t})`);
  }
  execFileSync("git", ["merge-base", "--is-ancestor", PHASE_8B1BB_AUTHORITY_BASE, PHASE_8B1BB_IMPLEMENTATION_HEAD]); // throws if not
  execFileSync("git", ["merge-base", "--is-ancestor", PHASE_8B1BB_IMPLEMENTATION_HEAD, "HEAD"]);                     // throws if not
  assert(PHASE_8B1BB_AUTHORITY_BASE === "bef87673ad6b867f200d27d2fa79dd7f1fd595bd", "the Phase 8B-1B-B base is the fixed implementation-parent literal");

  // ── B. THE FIXED SIX-FILE RANGE ── name-status -M -C so a deletion / rename / copy / type-change can never
  //    masquerade as valid membership. EXACTLY two Additions + four Modifications, exactly the approved set.
  const nameStatus = execFileSync("git", ["diff", "--name-status", "-M", "-C", `${PHASE_8B1BB_AUTHORITY_BASE}..${PHASE_8B1BB_IMPLEMENTATION_HEAD}`], { encoding: "utf8" })
    .split("\n").map((l) => l.trim()).filter(Boolean);
  const added = [], modified = [], rangeFiles = [];
  for (const line of nameStatus) {
    const parts = line.split(/\t+|\s{2,}|\s+/);
    const status = parts[0];
    const path = (parts[1] || "").replace(/\\/g, "/");
    assert(/^[AM]$/.test(status), `the Phase 8B-1B-B range allows ONLY A/M status — no deletion, rename, copy or type change (got '${line}')`);
    if (status === "A") added.push(path); else modified.push(path);
    rangeFiles.push(path);
  }
  const approved = new Set(PHASE_8B1BB_EXPECTED_FILES);
  assert(rangeFiles.length === approved.size, `the fixed Phase 8B-1B-B range must contain EXACTLY ${approved.size} files (got ${rangeFiles.length}: ${rangeFiles.join(", ")})`);
  for (const f of PHASE_8B1BB_EXPECTED_FILES) assert(rangeFiles.includes(f), `an approved Phase 8B-1B-B file is missing from the range: ${f}`);
  for (const f of rangeFiles) assert(approved.has(f), `an unexpected file is in the Phase 8B-1B-B range: ${f}`);
  assert(added.length === 2 && modified.length === 4, `the Phase 8B-1B-B range must be EXACTLY 2 additions + 4 modifications (got ${added.length}A / ${modified.length}M)`);

  // ── C. EXACT STATUS BY FILE ── the two additions and the four modifications are pinned individually.
  for (const f of PHASE_8B1BB_ADDED_FILES) assert(added.includes(f), `${f} must be an ADDITION in the fixed Phase 8B-1B-B range`);
  for (const f of PHASE_8B1BB_MODIFIED_FILES) assert(modified.includes(f), `${f} must be a MODIFICATION in the fixed Phase 8B-1B-B range`);
  assert(added.length === PHASE_8B1BB_ADDED_FILES.length && modified.length === PHASE_8B1BB_MODIFIED_FILES.length,
    "the exact 2A/4M file assignment is pinned");

  // ── D. FORBIDDEN CATEGORIES (defence in depth) + MODELLED SELF-PROOF ── the six reviewed files are accepted;
  //    every OTHER migration / provider adapter / webhook route / webhook service / consent authority / service /
  //    harness / lib file, and any package / lockfile / env / deployment / tooling file, is rejected.
  const forbidden = (p) =>
    /^supabase\/migrations\//.test(p) ||
    /(^|\/)\.env(\.|$)/.test(p) ||
    /package-lock\.json|yarn\.lock|pnpm-lock\.yaml/.test(p) ||
    /^package\.json$/.test(p) ||
    /^(Dockerfile|docker-compose|\.github\/|vercel\.json|ecosystem\.config)/.test(p) ||
    /^app\/api\/.*route\.ts$|^pages\/api\//.test(p) ||
    /^\.mcp\.json$|^\.claude\//.test(p) ||
    /^lib\/communication\/providers\//.test(p) ||
    (/^services\//.test(p) && p !== PHASE_8B1BB_COMM_SRC && p !== PHASE_8B1BB_RUNTIME_SRC) ||
    (/^scripts\//.test(p) && p !== PHASE_8B1BB_HARNESS_SRC && p !== PHASE_8B1BB_PHASE5FB_SRC) ||
    (/^lib\//.test(p) && p !== PHASE_8B1BB_ATTRIBUTION_SRC && p !== PHASE_8B1BB_TYPES_SRC);
  for (const f of rangeFiles) assert(!forbidden(f), `a forbidden path is in the Phase 8B-1B-B range: ${f}`);
  const evaluate = (fs) => {
    const u = [...new Set(fs)];
    if (u.length !== approved.size) return "reject";
    for (const f of u) { if (!approved.has(f)) return "reject"; if (forbidden(f)) return "reject"; }
    return "accept";
  };
  const five = PHASE_8B1BB_EXPECTED_FILES.slice(0, 5);
  assert(evaluate(PHASE_8B1BB_EXPECTED_FILES) === "accept", "the exact six-file range is accepted");
  assert(evaluate(five) === "reject", "a MISSING approved file is rejected");
  assert(evaluate([...PHASE_8B1BB_EXPECTED_FILES, "services/whatsappDashboardService.ts"]) === "reject", "an ADDITIONAL file is rejected");
  assert(evaluate([...five, "supabase/migrations/20260901000001_x.sql"]) === "reject", "a MIGRATION is rejected");
  assert(evaluate([...five, "lib/communication/providers/metaCloudWhatsAppProvider.ts"]) === "reject", "a PROVIDER ADAPTER is rejected");
  assert(evaluate([...five, PHASE_8B1A_APPROVED_ROUTE]) === "reject", "a WEBHOOK ROUTE is rejected");
  assert(evaluate([...five, WEBHOOK_SRC]) === "reject", "the WEBHOOK SERVICE is rejected");
  assert(evaluate([...five, D2C_SRC]) === "reject", "a CONSENT AUTHORITY is rejected");
  assert(evaluate([...five, "package.json"]) === "reject", "package.json is rejected");
  assert(evaluate([...five, "package-lock.json"]) === "reject", "a lockfile is rejected");
  assert(evaluate([...five, ".env.local"]) === "reject", "an environment file is rejected");
  assert(evaluate([...five, "vercel.json"]) === "reject", "a deployment file is rejected");
  assert(evaluate([...five, ".mcp.json"]) === "reject", "a tooling file is rejected");
  assert(evaluate([...five, ".claude/skills/x/SKILL.md"]) === "reject", "a tooling skill file is rejected");
  assert(evaluate([...five, PHASE8B1A_HARNESS_SRC]) === "reject", "an UNRELATED harness is rejected");
  assert(evaluate([...five, "services/whatsappDashboardService.ts"]) === "reject", "an UNRELATED service is rejected");
  assert(evaluate([...five, "lib/communication/phone.ts"]) === "reject", "an UNRELATED lib file is rejected");
  for (const f of PHASE_8B1BB_EXPECTED_FILES) assert(approved.has(f) && !forbidden(f), `the approved Phase 8B-1B-B file must be accepted inside this fixed range: ${f}`);
  const statusOk = (st) => /^[AM]$/.test(st);
  for (const bad of ["D", "R100", "C100", "T"]) assert(!statusOk(bad), `a '${bad}' status is rejected by the Phase 8B-1B-B range status rule`);
  const composition = (a, m) => (a === 2 && m === 4 ? "accept" : "reject");
  assert(composition(2, 4) === "accept", "the exact 2A/4M composition is accepted");
  for (const [a, m] of [[3, 3], [1, 5], [2, 3], [2, 5], [6, 0], [0, 6]]) assert(composition(a, m) === "reject", `a ${a}A/${m}M composition is rejected`);

  // ── E. THE ACTIVE BYTE-FREEZE ── for all six files the implementation-head blob AND the on-disk file must
  //    equal the reviewed pinned blob. Detects a dirty edit, a later COMMITTED edit, a deletion or a
  //    replacement. This is where the TRANSFERRED active 5F-B freeze now lives (pinned to the new blob).
  const blobMatches = (onDisk, pinned) => onDisk === pinned;
  //    PHASE 8B-1B-C SUCCESSION — prove the four-path successor authority FIRST; its Map gates delegation.
  const c8b1bcSuccessors = provePhase8B1BCPhase8B1BBGovernanceAuthority();
  for (const [path, expectedBlob] of PHASE_8B1BB_FROZEN_BLOBS) {
    //  Delegate ONLY on an exact key hit in the proved Map, whose value must equal the fixed successor
    //  blob AND the current on-disk bytes. No prefix/regex/directory matching, and never a bare continue:
    //  if the prover is removed, bypassed or returns an empty/short Map, this branch is not taken and the
    //  historical comparison below runs — and fails — for every changed file.
    if (c8b1bcSuccessors.has(path)) {
      // Same explicit QF-MVP-40 transfer as the prover above: the reviewed successor
      // still governs, unless this path was deliberately advanced.
      const successor = QF_MVP_40_ONDISK_SUCCESSORS.get(path) ?? c8b1bcSuccessors.get(path);
      const delegatedOnDisk = execFileSync("git", ["hash-object", path], { encoding: "utf8" }).trim();
      assert(blobMatches(delegatedOnDisk, successor),
        path + " is delegated to Phase 8B-1B-C but does not match its reviewed successor blob (on-disk " +
        delegatedOnDisk.slice(0, 12) + " != " + successor.slice(0, 12) + ")");
      continue;
    }
    const headBlob = execFileSync("git", ["rev-parse", `${PHASE_8B1BB_IMPLEMENTATION_HEAD}:${path}`], { encoding: "utf8" }).trim();
    assert(blobMatches(headBlob, expectedBlob), `the Phase 8B-1B-B implementation commit must resolve ${path} to its reviewed blob (got ${headBlob.slice(0, 12)}, expected ${expectedBlob.slice(0, 12)})`);
    assert(existsSync(path), `${path} must exist — a DELETION requires an EXPLICIT AUTHORITY TRANSFER`);
    const onDisk = execFileSync("git", ["hash-object", path], { encoding: "utf8" }).trim();
    assert(blobMatches(onDisk, expectedBlob),
      `${path} is not byte-identical to its Phase 8B-1B-B reviewed baseline (commit ${PHASE_8B1BB_IMPLEMENTATION_HEAD.slice(0, 12)}). ` +
      `A change — dirty OR committed — requires an EXPLICIT AUTHORITY TRANSFER (on-disk ${onDisk.slice(0, 12)} != pinned ${expectedBlob.slice(0, 12)}).`);
  }
  assert(blobMatches("811aa832cb2bcbdae7f9d3b178cf23c62bdbebe4", PHASE_8B1BB_ACTIVE_5FB_BLOB) === true, "the transferred active 5F-B blob is the reviewed 8B-1B-B pin");
  assert(blobMatches("0000000000000000000000000000000000000000", PHASE_8B1BB_ACTIVE_5FB_BLOB) === false, "a CHANGED reviewed blob is rejected");
  assert(PHASE_8B1BB_FROZEN_BLOBS.find(([p]) => p === PHASE_8B1BB_PHASE5FB_SRC)[1] === PHASE_8B1BB_ACTIVE_5FB_BLOB,
    "the 5F-B blob Phase 8B-1B-B RECEIVED is recorded exactly (a permanent historical transfer receipt; the ACTIVE on-disk proof has since succeeded to Phase 8B-1B-C)");

  // ── F. DEDICATED HARNESS EVIDENCE ── EXECUTABLE registrations (comment-stripped anchors), never comment-only.
  //    20 functional = 16 check() + 4 INFRA self-tests; 31 mutations across the exact reviewed families.
  const h = readF(PHASE_8B1BB_HARNESS_SRC);
  const hStripped = stripTs(h);
  const hReg = (re) => (h.match(re) || []).length;
  assert(hReg(/^\s*check\("/gm) === PHASE8B1BB_HARNESS_CHECKS, `the 8B-1B-B harness must register EXACTLY ${PHASE8B1BB_HARNESS_CHECKS} functional checks (got ${hReg(/^\s*check\("/gm)})`);
  assert(hReg(/"INFRA-[A-D] /g) === PHASE8B1BB_INFRA_SELF_TESTS, `the 8B-1B-B harness must keep its ${PHASE8B1BB_INFRA_SELF_TESTS} INFRA self-tests (got ${hReg(/"INFRA-[A-D] /g)})`);
  assert(PHASE8B1BB_HARNESS_CHECKS + PHASE8B1BB_INFRA_SELF_TESTS === PHASE8B1BB_FUNCTIONAL_TOTAL, `functional total must be ${PHASE8B1BB_FUNCTIONAL_TOTAL} (16 check + 4 infra)`);
  let familySum = 0;
  for (const [prefix, n] of PHASE8B1BB_MUTATION_FAMILIES) {
    const got = hReg(new RegExp(`"${prefix}-[0-9]`, "g"));
    assert(got === n, `the 8B-1B-B mutation family ${prefix} must register EXACTLY ${n} mutations (got ${got})`);
    familySum += n;
  }
  assert(familySum === PHASE8B1BB_HARNESS_MUTATIONS, `the registered mutation families must account for ALL ${PHASE8B1BB_HARNESS_MUTATIONS} mutations (got ${familySum})`);
  // No OTHER 3-letter mutation family may exist: every family tag belongs to a pinned family.
  assert(hReg(/"[A-Z]{3}-[0-9]/g) === PHASE8B1BB_HARNESS_MUTATIONS, `every mutation family tag must belong to a pinned family (got ${hReg(/"[A-Z]{3}-[0-9]/g)} vs ${PHASE8B1BB_HARNESS_MUTATIONS})`);
  // Infrastructure classifications remain EXECUTABLE, and infra is NEVER counted as a kill.
  for (const [anchor, what] of [
    ['return "infra_fail:anchor"', "a missing anchor is an infrastructure failure"],
    ['return "infra_fail:compile"', "a compile failure is an infrastructure failure"],
    ['return "infra_fail:import"', "an import/load failure is an infrastructure failure"],
    ['return "infra_fail:scenario_threw"', "an unrelated scenario exception is an infrastructure failure"],
    ['return "infra_fail:non_boolean"', "a non-boolean mutation result is an infrastructure failure"],
    ['if (s === "killed")', "ONLY a detected mutation is a kill"],
    ["const mFail = mutants.survived + mutants.infra;", "a survived OR infrastructure mutation FAILS the harness and is never a kill"],
  ]) assert(hStripped.includes(anchor), `the 8B-1B-B harness must EXECUTABLY prove: ${what}`);

  // ── G. LOAD-BEARING BEHAVIOR EVIDENCE ── comment-stripped exact anchors: the harness retains executable
  //    proof for every security property of the pre-network ownership fence and the guarded binding CAS.
  for (const [anchor, what] of [
    ["ORD-1. the provider is called BEFORE the binding fence", "ownership is proven BEFORE the provider call"],
    ["providerCalls===0", "provider call count is ZERO at the moment of binding"],
    ["BEFORE sendResolvedTemplate", "durable binding precedes the send"],
    ["VAL-1. the resolved account id is replaced with a constant", "the EXACT resolved account id is bound"],
    ["missing dependency / missing resolver / malformed identity", "missing attribution fails closed (zero calls)"],
    ["resolver throw ⇒ infrastructure failure", "a resolver throw fails closed"],
    ["MAP-1. query_error is collapsed into not_found", "query_error stays DISTINCT from not_found"],
    ["MAP-2. ambiguous is promoted to owned (first row)", "ambiguous NEVER chooses a row"],
    ["same-account idempotent retry proceeds without rewrite", "same-account continuation is idempotent"],
    ["CAS-5. a cross-account row is no longer identified as a MISMATCH", "a cross-account row is REFUSED"],
    ["CAS-3. the provider_account_id IS NULL guard is dropped (permits reassignment)", "no reassignment of an owned row"],
    ["CAS-1. the id predicate is dropped", "the binding CAS pins the id predicate"],
    ["CAS-2. the status=dispatching predicate is dropped", "the binding CAS pins the status=dispatching predicate"],
    ['["is","provider_account_id",null]', "the binding CAS pins the provider_account_id IS NULL predicate"],
    ["CAS-4. a zero-row CAS is treated as success", "a zero-row CAS is a CONFLICT, never success"],
    ["RTE-1. a bind conflict is routed through the id-only recordDispatchFailure", "a conflict never falls back to the id-only overwrite"],
    ["RUN-4. a secret is leaked into the attribution identity", "a secret field in the identity is rejected"],
    ["accessToken: selection.config.accessToken", "the accessToken-leak mutation is executable (and killed)"],
    ["idempotency untouched", "global message idempotency is unchanged"],
  ]) assert(hStripped.includes(anchor), `the 8B-1B-B harness must EXECUTABLY retain: ${what}`);

  // ── H. PRODUCTION WIRING EVIDENCE ── the runtime factory injects the coherent attribution dependency from
  //    the SAME immutable env snapshot, using the frozen resolver and a NON-SECRET four-field identity.
  const runtimeSrc = stripTs(readF(PHASE_8B1BB_RUNTIME_SRC));
  has(/new CommunicationService\(\s*context\.data\.provider,\s*getActiveRecipientResolver\(\),\s*resolvedCoordinator,\s*consentEnforcer,\s*context\.data\.attribution\s*\)/, runtimeSrc,
    "the runtime factory injects provider + recipient resolver + coordinator + consent enforcer + account attribution (exact 5-argument shape)");
  has(/resolveOwnership: resolveOwningProviderAccount/, runtimeSrc, "account attribution uses the FROZEN resolveOwningProviderAccount");
  has(/identity: \{\s*providerKey: selection\.provider\.providerKey,\s*channel: selection\.provider\.channel,\s*phoneNumberReference: selection\.config\.phoneNumberId,\s*expectedWabaId: selection\.config\.wabaId,\s*\}/, runtimeSrc,
    "the safe identity is EXACTLY providerKey + channel + phoneNumberReference + expectedWabaId — nothing else");
  hasNot(/accessToken|appSecret|verifyToken|Authorization|\bheaders\b|\.\.\.selection\.config|\.\.\.config|destination/, runtimeSrc,
    "the runtime factory NEVER copies a secret, an authorization header, a full-config spread or a plaintext destination into the attribution");
  has(/const envSnapshot = Object\.freeze\(\{ \.\.\.env \}\)/, runtimeSrc, "one immutable env snapshot feeds selection, coordinator and identity");
  has(/resolveRuntimeWhatsAppContext\(envSnapshot\)/, runtimeSrc, "the explicit env argument is propagated (snapshot), not re-read from process.env");
  has(/getMetaOutboundCoordinator\(envSnapshot\)/, runtimeSrc, "the coordinator is built from the SAME snapshot");
  hasNot(/resolveRuntimeWhatsAppContext\(process\.env\)|getMetaOutboundCoordinator\(process\.env\)/, runtimeSrc, "no post-snapshot fall back to real process.env");
  has(/return fail\(new AppError\(RUNTIME_PROVIDER_UNAVAILABLE/, runtimeSrc, "a production missing/invalid provider mode remains FAIL-CLOSED");

  // ── I. UPDATED 5F-B TEST WIRING ── the new test-only helper injects the ACTUAL frozen resolver with the
  //    exact safe identity, is used by the direct Meta construction, carries no secret, is NOT exported and
  //    is NOT an allow-all. The 5F-B totals are unchanged.
  const fbSrc = stripTs(readF(PHASE_8B1BB_PHASE5FB_SRC));
  has(/function metaHarnessProviderAccountAttribution\(/, fbSrc, "the test-only attribution helper exists");
  hasNot(/export function metaHarnessProviderAccountAttribution\b/, fbSrc, "the helper is NOT exported for production use");
  has(/metaHarnessProviderAccountAttribution\(provider, build\)/, fbSrc, "the helper is passed to the direct approved-mapping Meta CommunicationService construction");
  has(/resolveOwnership: build\.AccountRuntime\.resolveOwningProviderAccount/, fbSrc, "the helper injects the ACTUAL frozen resolveOwningProviderAccount");
  has(/providerKey: provider\.providerKey,\s*channel: provider\.channel,\s*phoneNumberReference: META_CONFIG\.phoneNumberId,\s*expectedWabaId: META_CONFIG\.wabaId,/, fbSrc, "the helper carries the exact four safe identity fields");
  const helperBody = (fbSrc.match(/function metaHarnessProviderAccountAttribution\([\s\S]*?\n\}/) || [""])[0];
  hasNot(/accessToken|appSecret|verifyToken|Authorization|\bheaders\b/, helperBody, "the helper carries NO secret field");
  hasNot(/kind: "owned"/, helperBody, "the helper is NOT an unconditional always-owned double — a real owning row + a real durable binding are still required");
  assert(PHASE5FB_EXPECTED_CHECKS === PHASE_8B1BB_5FB_CHECKS && PHASE_8B1BB_5FB_CHECKS === 60, "the Phase 5F-B functional total stays 60");
  assert(PHASE5FB_EXPECTED_MUTATIONS === PHASE_8B1BB_5FB_MUTATIONS && PHASE_8B1BB_5FB_MUTATIONS === 63, "the Phase 5F-B mutation total stays 63");

  // ── SELF-PROOF ── the endpoints are exact fixed literals and the range never uses a moving HEAD. Tested on
  //    COMMENT-STRIPPED source so this file's own prose can neither satisfy nor defeat an executable guard.
  const selfSrc = stripTs(readF(HARNESS_SRC));
  assert(selfSrc.includes('"bef87673ad6b867f200d27d2fa79dd7f1fd595bd"'), "the Phase 8B-1B-B base is the exact fixed literal");
  assert(selfSrc.includes('"51b251d3dc790494c33028827a9aaec1bd9418dc"'), "the Phase 8B-1B-B implementation head is the exact fixed literal");
  const rangeTemplateUses = (selfSrc.match(/\$\{PHASE_8B1BB_AUTHORITY_BASE\}\.\.\$\{PHASE_8B1BB_IMPLEMENTATION_HEAD\}/g) || []).length;
  assert(rangeTemplateUses === 1, `the Phase 8B-1B-B range must be built EXACTLY ONCE from the two FIXED endpoint constants (got ${rangeTemplateUses} uses)`);
  assert(!/PHASE_8B1BB_AUTHORITY_BASE\}\.\.(?!\$\{PHASE_8B1BB_IMPLEMENTATION_HEAD\})/.test(selfSrc), "the Phase 8B-1B-B range never uses a moving endpoint — the base is always paired with the FIXED implementation head");
  for (const [, blob] of PHASE_8B1BB_FROZEN_BLOBS) assert(selfSrc.includes(`"${blob}"`), `the Phase 8B-1B-B reviewed blob ${blob.slice(0, 12)} is an exact fixed literal`);
}

check("B4. the frozen consent authorities are UNCHANGED, and no SQL/route/env/provider file is touched", () => {
  // PHASE 8B-0 — the 5F-B AUTHORITY FREEZE runs FIRST and UNCONDITIONALLY, before the dirty-scope loop, so a
  // dirty OR later-committed 5F-B change fails with a clear authority-transfer error rather than the generic
  // "no existing harness may change".
  provePhase8B0MetaHarnessAuthority();
  // PHASE 8B-1A — the ACTIVE 5F-B + D4-B byte-freeze against Commit 1, the fixed ten-file range, and the
  // dedicated Phase 8B-1A harness's executable security shape. Runs whether the tree is clean or dirty.
  provePhase8B1AMetaAuthority();
  // PHASE 8B-1B-A — the fixed four-file range (3A/1M), the reviewed byte-freeze of all four implementation
  // files, and the dedicated harness's executable evidence. Runs BEFORE the generic dirty-scope loop, so a
  // dirty OR later-committed change to the ownership module, the runtime service, the dedicated harness or
  // the migration fails with a clear authority-transfer error instead of a generic scope message — or, once
  // committed, instead of passing silently.
  provePhase8B1BAProviderAccountAuthority();
  // PHASE 8B-1B-B — the fixed six-file range (2A/4M), the reviewed byte-freeze of all six implementation
  // files (INCLUDING the transferred active on-disk 5F-B freeze), the dedicated harness's executable
  // evidence, the production wiring and the updated 5F-B test wiring. Runs BEFORE the generic dirty-scope
  // loop, so a dirty OR later-committed change to any of the six fails with a clear authority-transfer error.
  provePhase8B1BBOutboundAccountAttributionAuthority();
  // PHASE 8B-1B-D6 WAVE 1 — the fixed two-file range (2 ADDED, 0 MODIFIED), the byte-freeze of the
  // migration and the dedicated harness, and the EXECUTABLE shape of the enforced DDL. Runs BEFORE the
  // generic dirty-scope loop so its narrow per-path carve-out below is gated on a token this prover
  // publishes only after every assertion passes.
  provePhase8B1BD6W1DeliveryEventConstraintAuthority();

  // PHASE 8B-1B-B (dirty-filter hardening) — EXECUTABLE self-proof that gitDirty's suppression is STATUS-AWARE.
  // Only a genuinely UNTRACKED ('??') permitted artifact may be ignored; every tracked status (staged OR
  // unstaged M/A/D/R) under those same paths, and every non-permitted untracked path, STAYS dirty. Modelled on
  // synthetic porcelain lines, so a future weakening — dropping the status test, or broadening to the whole
  // .claude tree — is caught right here, before the scope loop ever consumes the filtered list.
  for (const line of ["?? .mcp.json", "?? .claude/skills/example.md", "?? .phase5fd3b-temp.tsconfig.json"]) {
    assert(shouldIgnoreDirtyLine(line), `an untracked permitted artifact must be ignored: "${line}"`);
  }
  for (const line of [
    " M .mcp.json", "M  .mcp.json", "A  .mcp.json", "D  .mcp.json", "R  old -> .mcp.json",
    " M .claude/skills/example.md", "M  .claude/skills/example.md", "A  .claude/skills/example.md",
    "D  .claude/skills/example.md", "R  old -> .claude/skills/example.md",
    "?? .claude/settings.json", "?? unrelated.txt",
    " M .phase5fd3b-temp.tsconfig.json", "A  .phase5fd3b-temp.tsconfig.json",
  ]) {
    assert(!shouldIgnoreDirtyLine(line), `a tracked change or a non-permitted path must STAY dirty: "${line}"`);
  }

  const dirty = gitDirty();
  for (const f of [D2C_SRC, D2D_WRITER_SRC, D2D_COMMAND_SRC, POLICY_SRC, D2E_ORCH_SRC, D2E_INPUT_SRC]) {
    assert(!dirty.includes(f), `a frozen consent authority must not change: ${f}`);
  }
  for (const p of dirty) {
    // PHASE 8B-1B-D6 WAVE 1 — a NARROW, INDIVIDUALLY-NAMED carve-out for the single reviewed Wave 1
    // migration, gated on the authority token published above. Every OTHER migration stays forbidden:
    // this is a per-path exception, never a `^supabase/migrations/` category allowance.
    assert(
      !/^supabase\/migrations\//.test(p) ||
        (p === PHASE_8B1BD6W1_MIGRATION_SRC && phase8B1BD6W1AuthorityToken === PHASE_8B1BD6W1_FROZEN_BLOBS[0][1]),
      `no migration may change (${p})`
    );
    assert(!/^app\/api\/.*route\.ts$|^pages\/api\//.test(p), `no API route may change (${p})`);
    assert(!/\.env/.test(p), `no env file may change (${p})`);
    assert(!/^lib\/communication\/providers\//.test(p), `no provider adapter may change (${p})`);
    assert(!/package-lock\.json|yarn\.lock|pnpm-lock\.yaml/.test(p), `no lockfile may change (${p})`);
    // NO existing harness may change — with the founder-approved exceptions: 5F-B (verified line-by-line
    // below), the legacy SMS harnesses, and — PHASE 8A — the 5B core harness, whose ~60 historical direct
    // constructions must now state their consent posture explicitly because the enforcer became required.
    // 5B's own assertions are unchanged and its count is unchanged; only the constructions gained a 4th
    // argument. Every other historical harness stays frozen.
    // NB: PHASE5FB_SRC is intentionally NOT an exception here — it is pinned by the Phase 8B-0 byte-freeze
    // (proven earlier in this check), so a dirty 5F-B has already failed with a clear authority-transfer
    // error before reaching this loop. It must never be a generally-allowed arbitrary dirty harness.
    assert(
      !/^scripts\/phase5(b|c|d|e|f-(a|b|c|d1|d2))/.test(p) || p === HARNESS_SRC || p === PHASE5B_SRC || PHASE_8A_UPDATED_HARNESSES.includes(p) || LEGACY_SMS_HARNESSES.includes(p),
      `no existing harness may change (${p})`
    );
  }
  // The D3-B delta is within the approved scope.
  // The D3-B delta is within the approved scope. PHASE 8B-1B-D6 WAVE 1 adds its two reviewed paths as an
  // individually-named extension gated on the published authority token — NOT by inserting them into
  // D3B_EXPECTED_FILES, which stays the untouched historical D3-B allowlist.
  const d6w1Admitted = (p) =>
    phase8B1BD6W1AuthorityToken === PHASE_8B1BD6W1_FROZEN_BLOBS[0][1] && PHASE_8B1BD6W1_EXPECTED_FILES.includes(p);
  for (const p of dirty) {
    assert(D3B_EXPECTED_FILES.includes(p) || d6w1Admitted(p), `file outside the approved D3-B scope: ${p}`);
  }
  // The historical allowlist itself must NOT have absorbed the Wave 1 paths — predecessor evidence is
  // preserved, and the two authorities stay separately auditable.
  for (const p of PHASE_8B1BD6W1_EXPECTED_FILES) {
    assert(!D3B_EXPECTED_FILES.includes(p), `Wave 1 must not be absorbed into the D3-B allowlist: ${p}`);
  }

  // The legacy SMS harnesses are approved to INJECT a test enforcer — never to weaken a test.
  // "Removes nothing" is too blunt (instrumenting an existing line legitimately rewrites it), so the
  // guarantee proven here is the one that actually matters: NO TEST WAS WEAKENED OR DELETED.
  //   • no removed line may contain a `check(` or an `assert(`;
  //   • the count of `check(` and `assert(` may only GROW, never shrink, versus HEAD.
  for (const h of LEGACY_SMS_HARNESSES) {
    if (!dirty.includes(h)) continue;
    const diff = execFileSync("git", ["diff", "--unified=0", "--", h], { encoding: "utf8" }).split("\n");

    const removed = diff.filter((l) => l.startsWith("-") && !l.startsWith("---"));
    for (const line of removed) {
      assert(!/\bcheck\(|\bassert\(/.test(line), `${h}: an assertion/check line was REMOVED — a test may have been weakened: ${line.trim().slice(0, 90)}`);
    }

    const before = execFileSync("git", ["show", `HEAD:${h}`], { encoding: "utf8" });
    const after = readF(h);
    const count = (s, re) => (s.match(re) || []).length;
    assert(count(after, /\bcheck\(/g) >= count(before, /\bcheck\(/g),
      `${h}: the number of checks must not shrink (${count(before, /\bcheck\(/g)} → ${count(after, /\bcheck\(/g)})`);
    assert(count(after, /\bassert\(/g) >= count(before, /\bassert\(/g),
      `${h}: the number of assertions must not shrink (${count(before, /\bassert\(/g)} → ${count(after, /\bassert\(/g)})`);

    // …and the only `allow` they gained lives in their dependency object (a TEST DOUBLE), not production.
    const added = diff.filter((l) => l.startsWith("+") && !l.startsWith("+++")).join("\n");
    has(/authorizeOutboundConsent/, added, `${h}: it injects a test consent enforcer`);
    has(/kind: "allow"/, added, `${h}: the allow lives in the HARNESS dependency object, not in production`);
  }

  // PHASE 8B-0 — 5F-B is not validated HERE. Its authority boundary is the BYTE-FREEZE run at the top of this
  // check (provePhase8B0MetaHarnessAuthority), which pins it to a fixed commit and fails any dirty or later
  // committed change. The old count-only bound has been retired as the boundary and folded into that helper
  // as supplemental defence in depth.
});

check("B5. no provider activation, no n8n, no RCS send, no migration, no durable consent storage", () => {
  // Assert on CODE, not prose: several files legitimately DOCUMENT "no n8n" / "no RCS" in comments.
  const all = [SCOPE_SRC, COORD_SRC, COMM_SRC, RUNTIME_SRC, ORCH_SRC].map((f) => stripTs(readF(f))).join("\n");
  hasNot(/is_operationally_enabled\s*=|outbound_enabled\s*=|activation_status\s*=|webhook_processing_enabled\s*=/, all, "no provider activation");
  hasNot(/\bn8n\b/i, all, "no n8n");
  hasNot(/sendRcs|rcsProvider|channel: "rcs"/, all, "no RCS send path");
  hasNot(/create table|alter table|supabase db push|migration up/i, all, "no SQL / migration");
  const coord = stripTs(readF(COORD_SRC));
  hasNot(/\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(/, coord, "the coordinator writes NOTHING (no durable consent record)");
  hasNot(/communication_suppressions|communication_preferences/, coord, "the coordinator never reads a consent table directly");
  has(/decideCommunicationConsent/, coord, "it delegates to D2-C, the sole decision authority");
});

check("B6. wiring: the d3b script + the doc exist and the doc covers the contract", () => {
  const pkg = JSON.parse(readF("package.json"));
  assert(pkg.scripts["test:phase5f:d3b"] === "node scripts/phase5f-d3b-outbound-consent-enforcement-harness.mjs", "d3b script wired");
  for (const f of [SCOPE_SRC, COORD_SRC, HARNESS_SRC, DOC_SRC]) assert(existsSync(f), `${f} exists`);
  const doc = readF(DOC_SRC);
  for (const topic of [
    /founder/i, /client_nurture_followup/, /dormant_requirement_reactivation/, /marketing/i,
    /registry/i, /unclassified|unknown message type/i, /one (authoritative )?check|single gate/i,
    /pre-insert/i, /runtime factory/i, /SMS/i, /bypass/i, /ephemeral/i, /unknown identity/i,
    /disposition/i, /authority[ _]unavailable/i, /compare-and-set/i, /cancelled/i,
    /scheduled|retry/i, /race/i, /no migration/i, /policy_decision_id/i, /rollback/i,
  ]) has(topic, doc, `doc covers ${topic}`);
  hasNot(/atomic(ally)? (across|with) the provider|transactional with the provider/i, doc, "the doc must NOT claim external-provider atomicity");
});

// ============================================================================
// PHASE 8A — FAIL-CLOSED CONSENT AUTHORITY
//
// THE INVARIANT: a missing, null, undefined, malformed or throwing consent authority ⇒ ZERO provider calls.
//
// Every check below drives the REAL CommunicationService dispatch path against a provider that COUNTS its
// calls, so "nothing was sent" is PROVEN by a counter, never asserted from a status string.
// ============================================================================

check("P8A-1. an OMITTED enforcer (3-arg construction) BLOCKS — zero provider calls", async () => {
  // The pre-Phase-8A shape: `new CommunicationService(provider, resolver, null)`. TypeScript now rejects
  // this, but plain JavaScript does not — so the RUNTIME must. It fails closed as `unavailable`.
  const d = await dispatchRawEnforcer(row(), undefined, { omit: true });
  assert(d.providerCalls === 0, `ZERO provider calls (got ${d.providerCalls})`);
  assert(d.res.ok === false, "the dispatch is refused");
  assert(d.res.code === "CONSENT_AUTHORITY_UNAVAILABLE", `unavailable (got ${d.res.code})`);
  assert(d.stored.status === "queued", "a BUSINESS row stays re-dispatchable (not cancelled, not failed)");
});

check("P8A-2. an explicitly `undefined` enforcer BLOCKS — zero provider calls", async () => {
  const d = await dispatchRawEnforcer(row(), undefined);
  assert(d.providerCalls === 0, `ZERO provider calls (got ${d.providerCalls})`);
  assert(d.res.ok === false && d.res.code === "CONSENT_AUTHORITY_UNAVAILABLE", "unavailable");
});

check("P8A-3. an explicitly `null` enforcer BLOCKS — zero provider calls (the old fail-open shape)", async () => {
  // THIS is the exact value the deleted `if (!this.consentEnforcer) return null;` used to wave through.
  const d = await dispatchRawEnforcer(row(), null);
  assert(d.providerCalls === 0, `ZERO provider calls (got ${d.providerCalls})`);
  assert(d.res.ok === false && d.res.code === "CONSENT_AUTHORITY_UNAVAILABLE", "unavailable");
});

check("P8A-4. STRUCTURALLY INVALID enforcers all BLOCK — zero provider calls", async () => {
  for (const bogus of [
    {},                                   // no authorize at all
    { authorize: "not a function" },      // authorize is not callable
    { authorize: null },
    [],                                   // an array
    42, "enforcer", true,                 // primitives
    Object.create(null),                  // no prototype, no authorize
  ]) {
    const d = await dispatchRawEnforcer(row(), bogus);
    assert(d.providerCalls === 0, `ZERO provider calls for ${safeStringify(bogus)} (got ${d.providerCalls})`);
    assert(d.res.ok === false && d.res.code === "CONSENT_AUTHORITY_UNAVAILABLE",
      `a structurally invalid enforcer is fail-closed, not trusted (${safeStringify(bogus)})`);
  }
});

check("P8A-5. a THROWING enforcer is unavailable — zero provider calls", async () => {
  const d = await dispatchRawEnforcer(row(), { authorize: async () => { throw new Error("authority exploded"); } });
  assert(d.providerCalls === 0, `ZERO provider calls (got ${d.providerCalls})`);
  assert(d.res.ok === false && d.res.code === "CONSENT_AUTHORITY_UNAVAILABLE", "a throw is infrastructure, never a decision");
  assert(d.stored.status === "queued", "the business row stays retryable");
});

check("P8A-6. an enforcer RESOLVING `undefined` is a DELIBERATE integrity failure — zero provider calls", async () => {
  // Before Phase 8A this made `outcome.kind` throw a TypeError, which only fail-closed by ACCIDENT of an
  // outer catch — with no consent code and no consent ledger entry. It is now a real, classified outcome.
  //
  // NOTE the Result shape: a terminalization SUCCEEDS (`ok:true` carrying the now-terminal row). The
  // security fact lives in the LEDGER — status + failure_code — not in the Result code. Only the business
  // `unavailable` path returns `fail(code)`, because it deliberately leaves the row untouched.
  const d = await dispatchRawEnforcer(row(), { authorize: async () => undefined });
  assert(d.providerCalls === 0, `ZERO provider calls (got ${d.providerCalls})`);
  assert(d.stored.status === "failed", `an untrustworthy authority is TERMINAL (got ${d.stored.status})`);
  assert(d.stored.failure_code === "CONSENT_AUTHORITY_INTEGRITY",
    `integrity, not an accidental exception (got ${d.stored.failure_code})`);
});

check("P8A-7. MALFORMED outcomes are rejected by the validator — zero provider calls, every time", async () => {
  const MALFORMED = [
    { kind: "allow" },                                                   // no scope — the duck-typed allow
    { kind: "allow", scope: "not_a_scope" },                             // unknown scope
    { kind: "allow", scope: null },
    { kind: "allow", scope: "transactional", code: "CONSENT_SUPPRESSED" }, // contradictory fields
    { kind: "allow", scope: "transactional", retryable: true },            // contradictory fields
    { kind: "ALLOW", scope: "transactional" },                           // wrong case ⇒ unknown kind
    { kind: "permit", scope: "transactional" },                          // unknown kind
    { kind: "deny" },                                                    // no code
    { kind: "deny", code: "NOT_A_REAL_CODE", retryable: false },         // code not in the deny set
    { kind: "deny", code: "CONSENT_SUPPRESSED", retryable: true },       // a RETRYABLE deny is a contradiction
    { kind: "deny", code: "CONSENT_AUTHORITY_UNAVAILABLE", retryable: false }, // wrong variant's code
    { kind: "unavailable", code: "CONSENT_SUPPRESSED", retryable: true },      // wrong variant's code
    { kind: "unavailable", code: "CONSENT_AUTHORITY_UNAVAILABLE", retryable: false }, // wrong retryable
    { kind: "invalid", code: "CONSENT_SUPPRESSED", retryable: false },   // wrong variant's code
    { kind: "invalid", code: "CONSENT_ENFORCEMENT_INVALID", retryable: true },  // wrong retryable
    { kind: "unavailable", code: "CONSENT_AUTHORITY_UNAVAILABLE", retryable: true, scope: "marketing" }, // smuggled scope
    {}, null, [], "allow", 1, true,                                      // not outcomes at all
  ];
  for (const outcome of MALFORMED) {
    const d = await dispatchRawEnforcer(row(), { authorize: async () => outcome });
    assert(d.providerCalls === 0, `ZERO provider calls for ${safeStringify(outcome)} (got ${d.providerCalls})`);
    assert(d.stored.status === "failed", `terminal failed: ${safeStringify(outcome)} (got ${d.stored.status})`);
    assert(d.stored.failure_code === "CONSENT_AUTHORITY_INTEGRITY",
      `malformed ⇒ integrity, never allow: ${safeStringify(outcome)} (got ${d.stored.failure_code})`);
  }
});

check("P8A-8. a fully VALID allow still sends — exactly ONE provider call (the fence is not a blanket block)", async () => {
  // The whole design is worthless if it also blocks legitimate sends. Prove the validated allow path works.
  const d = await dispatchRawEnforcer(row(), { authorize: async () => ({ kind: "allow", scope: "transactional" }) });
  assert(d.providerCalls === 1, `EXACTLY one provider call (got ${d.providerCalls})`);
  assert(d.res.ok === true, "the dispatch succeeded");
});

check("P8A-9. the fail-closed enforcer NEVER allows, whatever it is asked", async () => {
  const e = M.Coord.createFailClosedOutboundConsentEnforcer();
  for (const input of [undefined, null, {}, { lane: "authentication" }, { lane: "business" }]) {
    const out = await e.authorize(input);
    assert(out.kind === "unavailable" && out.code === "CONSENT_AUTHORITY_UNAVAILABLE" && out.retryable === true,
      `always unavailable (got ${safeStringify(out)})`);
  }
  // …and its outcome is frozen, so a caller cannot mutate it into an allow.
  const out = await e.authorize({});
  try { out.kind = "allow"; } catch { /* frozen in strict mode */ }
  assert(out.kind === "unavailable", "the fail-closed outcome cannot be mutated into an allow");
});

check("P8A-10. the LANE semantics are preserved exactly (auth fails, business stays retryable)", async () => {
  // AUTHENTICATION + unavailable ⇒ terminal `failed` (the OTP is never persisted, so it can never be
  // re-dispatched; leaving it queued would leak a permanently undeliverable row).
  const a = await dispatchRawEnforcer(authRow(), null);
  assert(a.providerCalls === 0, "ZERO provider calls (auth)");
  assert(a.stored.status === "failed", `auth + unavailable ⇒ failed (got ${a.stored.status})`);

  // BUSINESS + unavailable ⇒ retryable failure, row UNCHANGED, re-evaluated by a later dispatch.
  const b = await dispatchRawEnforcer(row(), null);
  assert(b.providerCalls === 0, "ZERO provider calls (business)");
  assert(b.stored.status === "queued", `business + unavailable ⇒ unchanged (got ${b.stored.status})`);
  assert(b.stored.failed_at === null, "…and no failed_at is stamped");
});

check("P8A-11. DIRECT construction cannot bypass consent even when TypeScript is circumvented", async () => {
  // The Phase 8A threat model in one check: a future/legacy caller reaches straight for the constructor and
  // forces past the type system. Every circumvention still reaches zero provider calls.
  const circumventions = [
    ["omitted argument", undefined, { omit: true }],
    ["null as any", null, {}],
    ["undefined as any", undefined, {}],
    ["{} as any", {}, {}],
    ["a lying enforcer that returns a bare allow", { authorize: async () => ({ kind: "allow" }) }, {}],
  ];
  for (const [label, enforcer, opts] of circumventions) {
    const d = await dispatchRawEnforcer(row(), enforcer, opts);
    // THE invariant. Everything else is commentary.
    assert(d.providerCalls === 0, `ZERO provider calls — ${label} (got ${d.providerCalls})`);
    // …and the row never reached a sent/in-flight state: it is either terminal, or left safely dispatchable.
    assert(["queued", "failed", "cancelled"].includes(d.stored.status),
      `never sent, never left dispatching — ${label} (got ${d.stored.status})`);
    assert(d.stored.status !== "sent", `never sent — ${label}`);
  }
});

check("P8A-12. RETRY and SCHEDULED dispatch each RE-EVALUATE consent at dispatch time", async () => {
  // A retry attempt consults the authority again — a STOP created after the first attempt IS observed.
  const retryRow = row({ status: "retry_scheduled", attempt_count: 2 });
  const e1 = fakeEnforcer(DENY_SUPPRESSED);
  TABLE = [{ ...retryRow }];
  const p1 = fakeProvider();
  const s1 = new M.Comm.CommunicationService(p1.provider, fakeResolver, null, e1.enforcer);
  await s1.dispatchMessage(retryRow, { providerTemplateName: "tpl", preResolvedDestination: DEST, templateLanguage: "en" });
  assert(e1.calls.length === 1, `the RETRY consulted consent (got ${e1.calls.length})`);
  assert(p1.calls.send === 0, "ZERO provider calls on a suppressed retry");
  assert(TABLE[0].status === "cancelled", "…and it is cancelled, not sent");

  // A SCHEDULED row is evaluated when it actually dispatches, not when it was enqueued.
  const schedRow = row({ status: "queued", scheduled_at: "2020-01-01T00:00:00.000Z" });
  const e2 = fakeEnforcer(DENY_SUPPRESSED);
  TABLE = [{ ...schedRow }];
  const p2 = fakeProvider();
  const s2 = new M.Comm.CommunicationService(p2.provider, fakeResolver, null, e2.enforcer);
  await s2.dispatchMessage(schedRow, { providerTemplateName: "tpl", preResolvedDestination: DEST, templateLanguage: "en" });
  assert(e2.calls.length === 1, `the SCHEDULED dispatch consulted consent (got ${e2.calls.length})`);
  assert(p2.calls.send === 0, "ZERO provider calls on a suppressed scheduled send");

  // Consent is consulted ONCE PER ATTEMPT — two attempts, two authorizations.
  const e3 = fakeEnforcer(ALLOW);
  const p3 = fakeProvider();
  for (const st of ["queued", "retry_scheduled"]) {
    const r = row({ status: st });
    TABLE = [{ ...r }];
    const s3 = new M.Comm.CommunicationService(p3.provider, fakeResolver, null, e3.enforcer);
    await s3.dispatchMessage(r, { providerTemplateName: "tpl", preResolvedDestination: DEST, templateLanguage: "en" });
  }
  assert(e3.calls.length === 2, `consent is re-evaluated on EVERY attempt (got ${e3.calls.length})`);
});

check("P8A-13. AUTHENTICATION dispatch evaluates consent BEFORE the provider is invoked", async () => {
  const order = [];
  const p = fakeProvider();
  const spyProvider = {
    ...p.provider,
    async sendAuthenticationMessage() { order.push("provider"); p.calls.send++; return { accepted: true, providerMessageId: "pm-1", outcomeCertainty: "accepted" }; },
  };
  const enforcer = { async authorize() { order.push("consent"); return { kind: "allow", scope: "authentication" }; } };
  const a = authRow();
  TABLE = [{ ...a }];
  const svc = new M.Comm.CommunicationService(spyProvider, fakeResolver, null, enforcer);
  await svc.dispatchMessage(a, { rawVariables: { otp: "123456" }, providerTemplateName: "tpl", preResolvedDestination: DEST, templateLanguage: "en" });
  assert(order[0] === "consent", `consent runs FIRST (got ${safeStringify(order)})`);
  assert(order[1] === "provider" && p.calls.send === 1, "…and exactly one provider call follows");
});

// ---- STRUCTURAL: the source itself must keep the guarantee -------------------------------------------
check("P8A-14. STRUCTURAL: the constructor requires an enforcer and the property is non-nullable", () => {
  const src = readF(COMM_SRC);
  has(/private readonly consentEnforcer: OutboundConsentEnforcer;/, src, "the property is NON-NULLABLE");
  hasNot(/private readonly consentEnforcer: OutboundConsentEnforcer \| null/, src, "…never nullable again");
  // PHASE 8B-1B-B — consentEnforcer is STILL required (no default). The 5th constructor argument added by
  // 8B-1B-B is the account-attribution dependency; this anchor pins that the ONLY parameter after the
  // required enforcer is that optional dependency, so nothing was inserted that could bypass consent.
  has(/consentEnforcer: OutboundConsentEnforcer,\n(?:\s*\/\/.*\n)*\s*accountAttribution: OutboundAccountAttributionDependency \| null = null\n\s*\)/, src,
    "consentEnforcer is REQUIRED (no default) and is followed ONLY by the optional accountAttribution parameter");
  hasNot(/consentEnforcer: OutboundConsentEnforcer \| null = null/, src, "…and never optional-nullable again");
  // THE FAIL-OPEN BRANCH IS GONE.
  hasNot(/if \(!this\.consentEnforcer\) return null;/, src, "the missing-enforcer fail-open return is DELETED");
  // The constructor NORMALIZES anything invalid to fail-closed.
  has(/isOutboundConsentEnforcer\(consentEnforcer\)\s*\n?\s*\?\s*consentEnforcer\s*\n?\s*:\s*createFailClosedOutboundConsentEnforcer\(\)/, src,
    "the constructor normalizes an invalid enforcer to the FAIL-CLOSED one");
  // The outcome is VALIDATED, never trusted.
  has(/normalizeOutboundConsentOutcome\(/, src, "the enforcer's outcome is VALIDATED");
  has(/outcome\.kind === "allow"/, src, "…and only a validated allow continues");
});

check("P8A-15. STRUCTURAL: the consent gate still precedes the claim and the provider", () => {
  const src = stripTs(readF(COMM_SRC));
  const gate = src.indexOf("await this.enforceOutboundConsent(message)");
  const claim = src.indexOf("await this.claimMessageForDispatch(message)");
  const invoke = src.indexOf("await this.invokeProvider(");
  assert(gate > 0 && claim > 0 && invoke > 0, "all three stages exist");
  assert(gate < claim, "the consent gate runs BEFORE the claim");
  assert(claim < invoke, "…and the claim runs BEFORE the provider");
  // The ONLY provider send calls live inside invokeProvider, and invokeProvider has ONE caller.
  const invokeDef = src.indexOf("private async invokeProvider(");
  for (const m of ["this.provider.sendResolvedTemplate(", "this.provider.sendAuthenticationMessage(", "this.provider.sendTemplateMessage("]) {
    const at = src.indexOf(m);
    assert(at > invokeDef, `${m} is inside invokeProvider, never before the gate`);
  }
  assert((src.match(/await this\.invokeProvider\(/g) ?? []).length === 1, "invokeProvider has exactly ONE call site");
});

check("P8A-16. STRUCTURAL: production states its consent posture everywhere, and has NO allow-all helper", () => {
  // The runtime factory binds the REAL authority — never the fail-closed placeholder.
  const runtime = readF(RUNTIME_SRC);
  has(/consentEnforcer: OutboundConsentEnforcer = createOutboundConsentEnforcer\(\)/, runtime, "the factory defaults to the REAL enforcer");
  hasNot(/createFailClosedOutboundConsentEnforcer/, runtime, "the factory NEVER uses the fail-closed placeholder");

  // The webhook binds the FAIL-CLOSED enforcer explicitly — safe by construction, not by usage.
  const hook = readF(WEBHOOK_SRC);
  has(/createFailClosedOutboundConsentEnforcer\(\)/, hook, "the webhook explicitly binds the FAIL-CLOSED enforcer");
  hasNot(/new CommunicationService\(provider\)\s*;/, hook, "…and no longer constructs with a bare provider");

  // NO production allow-all enforcer may exist anywhere.
  // `git grep` EXITS 1 WHEN THERE ARE NO MATCHES — and no matches is exactly the outcome we want, so an
  // exit-1 throw must be read as "clean", not as an error. (Getting this backwards would make the check
  // pass for the wrong reason the moment someone DID add an allow-all helper.)
  let prodAllowAll = [];
  try {
    prodAllowAll = execFileSync("git", ["grep", "-lE", "allowAll|alwaysAllow|permitAll", "--", "services/", "app/", "lib/"], { encoding: "utf8" })
      .split("\n").map((s) => s.trim()).filter(Boolean);
  } catch (e) {
    if (e.status !== 1) throw e;          // 1 = no matches (good). Anything else is a real failure.
    prodAllowAll = [];
  }
  assert(prodAllowAll.length === 0, `NO production allow-all consent helper may exist (found: ${prodAllowAll.join(", ")})`);

  // The test allow-all lives ONLY in the 5B harness.
  has(/function allowAllTestConsentEnforcer\(\)/, readF(PHASE5B_SRC), "the allow-all enforcer is TEST-ONLY (Phase 5B)");
});

check("P8A-17. STRUCTURAL: omitting the enforcer FAILS TYPESCRIPT COMPILATION (a real tsc fixture)", () => {
  // Not a grep — an ACTUAL compile. A fixture that omits the 4th argument must be rejected by tsc, and the
  // same fixture WITH an enforcer must compile. That is the only honest proof that layer 1 exists.
  const dir = resolve(`.phase5fd3b-tsfixture-${Math.random().toString(36).slice(2, 8)}`);
  const badFile = resolve(dir, "omits-enforcer.ts");
  const goodFile = resolve(dir, "states-posture.ts");
  const tsconfigPath = resolve(`${dir}.tsconfig.json`);
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(badFile, [
      `import { CommunicationService } from "../services/communicationService";`,
      `import { getActiveWhatsAppProvider } from "../services/communicationService";`,
      `export const bad = new CommunicationService(getActiveWhatsAppProvider());`,
      ``,
    ].join("\n"));
    writeFileSync(goodFile, [
      `import { CommunicationService, getActiveWhatsAppProvider } from "../services/communicationService";`,
      `import { createFailClosedOutboundConsentEnforcer } from "../services/outboundConsentEnforcementService";`,
      `export const good = new CommunicationService(`,
      `  getActiveWhatsAppProvider(), undefined, undefined, createFailClosedOutboundConsentEnforcer());`,
      ``,
    ].join("\n"));

    const compile = (file) => {
      writeFileSync(tsconfigPath, JSON.stringify({
        compilerOptions: {
          module: "commonjs", target: "ES2020", moduleResolution: "node", skipLibCheck: true,
          esModuleInterop: true, strict: true, noEmit: true, baseUrl: ".", paths: { "@/*": ["./*"] },
          lib: ["ES2021", "DOM"],
        },
        files: [file],
      }, null, 2));
      try { execFileSync(process.execPath, [tsc, "-p", tsconfigPath], { stdio: "pipe" }); return { ok: true, out: "" }; }
      catch (e) { return { ok: false, out: `${e.stdout ?? ""}${e.stderr ?? ""}` }; }
    };

    const bad = compile(badFile);
    assert(bad.ok === false, "omitting the consent enforcer MUST fail TypeScript compilation");
    assert(/Expected 4 arguments|expected 4 arguments|TS2554/i.test(bad.out),
      `…and it must fail on the ARITY of the constructor, not something incidental (got: ${bad.out.slice(0, 300)})`);

    const good = compile(goodFile);
    assert(good.ok === true, `a construction that STATES its posture must still compile (got: ${good.out.slice(0, 300)})`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(tsconfigPath, { force: true });
  }
});

// ============================================================================
// MUTATIONS
// ============================================================================
// ----------------------------------------------------------------------------
// THE MUTATION CONTRACT
//
// A mutation is load-bearing ONLY when the mutated code still BUILDS and RUNS, and a real security property
// then goes red. It is NOT load-bearing because the file stopped parsing, an import broke, an anchor moved,
// or a scenario threw for some unrelated reason — those are accidents, and scoring them as proof is how a
// broken mutation hides. (MUT 21 did exactly that: its replacement was unbalanced, tsc threw, and the old
// `catch { violation = true }` recorded a PASS while proving nothing about outcome validation.)
//
// `expectCompileFailure` is the ONLY way a mutation may claim a build break as its intended result, and even
// then the runner verifies the failure really is a COMPILE failure and not something else.
// ----------------------------------------------------------------------------
const mutationChecks = [];
function srcMutation(name, file, from, to, scenario, opts = {}) {
  mutationChecks.push({ name, kind: "src", edits: [{ file, from, to }], scenario, expectCompileFailure: opts.expectCompileFailure === true });
}
/** A PAIRED mutation: some guards are defended in depth, so proving one load-bearing needs both removed. */
function srcMutationN(name, edits, scenario, opts = {}) {
  mutationChecks.push({ name, kind: "src", edits, scenario, expectCompileFailure: opts.expectCompileFailure === true });
}

/** The identifier a mutation is referred to by ("MUT 21"), so a failure is attributable at a glance. */
function mutId(name) {
  const m = name.match(/^(MUT \d+[a-z]?)/);
  return m ? m[1] : name.split(":")[0];
}

/**
 * Is this exception a TYPESCRIPT COMPILE failure (as opposed to any other throw)?
 *
 * `compileTo` shells out to tsc through execFileSync, so a compile failure arrives as a non-zero exit with
 * `error TS####` on stdout/stderr. Anything else — a TypeError in a scenario, a missing module, a bad
 * anchor — is NOT a compile failure and must never be mistaken for one.
 */
function isCompileFailure(e) {
  const text = `${e?.stdout ?? ""}${e?.stderr ?? ""}${e?.message ?? ""}`;
  return /error TS\d+/.test(text) || /did not transpile/.test(text);
}

/** Rebuild from the mutated sources and re-drive the scenario. */
async function withMutatedBuild(fn) {
  const dir = resolve(`.phase5fd3b-mut-${Math.random().toString(36).slice(2, 8)}`);
  try {
    compileTo(dir);
    return await fn(wireBuild(dir));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

async function dispatchWith(mm, message, outcome) {
  TABLE = [{ ...message }];
  DB_THROWS = false;
  const p = fakeProvider();
  const e = fakeEnforcer(outcome);
  const svc = new mm.Comm.CommunicationService(p.provider, fakeResolver, null, e.enforcer);
  const res = await svc.dispatchMessage(message, { rawVariables: { otp: "1" }, providerTemplateName: "tpl", preResolvedDestination: DEST });
  return { res, providerCalls: p.calls.send, consentCalls: e.calls, stored: TABLE[0] };
}

srcMutation("MUT 1: the CommunicationService consent gate is REMOVED (a suppressed destination is sent)",
  COMM_SRC,
  "      const consentDenial = await this.enforceOutboundConsent(message);\n      if (consentDenial) return consentDenial;",
  "",
  () => withMutatedBuild(async (mm) => {
    const d = await dispatchWith(mm, row(), DENY_SUPPRESSED);
    return d.providerCalls > 0; // a BLOCKED destination reached the provider
  }));

srcMutation("MUT 2: the gate is MOVED AFTER the claim (cancellation becomes an illegal transition)",
  COMM_SRC,
  "      const consentDenial = await this.enforceOutboundConsent(message);\n      if (consentDenial) return consentDenial;\n\n      // Atomic claim. A loser here has sent nothing and must send nothing.\n      const claim = await this.claimMessageForDispatch(message);\n      if (!claim.ok) return claim;\n      const claimed = claim.data;",
  "      // Atomic claim. A loser here has sent nothing and must send nothing.\n      const claim = await this.claimMessageForDispatch(message);\n      if (!claim.ok) return claim;\n      const claimed = claim.data;\n\n      const consentDenial = await this.enforceOutboundConsent(claimed);\n      if (consentDenial) return consentDenial;",
  () => withMutatedBuild(async (mm) => {
    const d = await dispatchWith(mm, row(), DENY_SUPPRESSED);
    // From `dispatching` there is NO legal edge to `cancelled`, so the denial can no longer be recorded.
    return d.stored.status !== "cancelled";
  }));

srcMutation("MUT 3: a DENY is converted to an ALLOW",
  COMM_SRC,
  `    if (outcome.kind === "deny") {
      return await this.terminalizeBeforeClaim(message, "cancelled", code, reason);
    }`,
  `    if (outcome.kind === "deny") {
      return null;
    }`,
  // A COMPILING mutation. Returning `null` from the gate means CONTINUE, so a definitive consent refusal is
  // waved through to the claim and the provider — precisely "a deny became an allow".
  //
  // (The previous form widened the allow test to `|| outcome.kind === "deny"`, which made the LATER
  // `outcome.kind === "deny"` branch a no-overlap comparison — a TS2367 compile error. tsc threw, and the
  // old runner scored the throw as a pass, so this mutation never actually proved anything either. The
  // strict runner below caught it. The causal proof is unchanged: a denied send must call NO provider.)
  () => withMutatedBuild(async (mm) => {
    const d = await dispatchWith(mm, row(), DENY_SUPPRESSED);
    return d.providerCalls > 0;      // THE PROVIDER WAS CALLED on a suppressed destination
  }));

srcMutation("MUT 4: MARKETING 'unknown' is converted to an ALLOW (default-deny broken)",
  COORD_SRC,
  'if (disposition === "unknown") return deny("CONSENT_NOT_GRANTED");',
  'if (disposition === "unknown") return { kind: "allow", scope };',
  () => withMutatedBuild(async (mm) => {
    const r = await mm.Coord.authorizeOutboundConsent({
      channel: "whatsapp", messageType: "client_nurture_followup", templateKey: "client_nurture_followup",
      lane: "business", destinationHash: HASH, destinationSource: "recipient_reference",
      recipientType: "client", recipientId: UUID,
    }, decided(ok2("unknown")));
    return r.kind === "allow"; // absence of consent became consent
  }));

srcMutation("MUT 5: an AUTHORITY LOOKUP FAILURE is converted to an ALLOW (fail-open)",
  COORD_SRC,
  '      case "AUTHORITY_LOOKUP_FAILED":\n        return unavailable();                                  // retryable: the authority may recover',
  '      case "AUTHORITY_LOOKUP_FAILED":\n        return { kind: "allow", scope };',
  () => withMutatedBuild(async (mm) => {
    const r = await mm.Coord.authorizeOutboundConsent({
      channel: "whatsapp", messageType: "lead_received", templateKey: "lead_received", lane: "business",
      destinationHash: HASH, destinationSource: "recipient_reference", recipientType: "client", recipientId: UUID,
    }, decided({ ok: false, code: "AUTHORITY_LOOKUP_FAILED" }));
    return r.kind === "allow"; // an unreadable authority became permission
  }));

srcMutation("MUT 6: an EPHEMERAL destination is upgraded to EXACT from its recipient_id",
  COORD_SRC,
  '  if (input.destinationSource !== "recipient_reference") return unknown;',
  "  // upgraded",
  () => withMutatedBuild(async (mm) => {
    const d = mm.Coord.deriveConsentIdentity({ destinationSource: "ephemeral_auth_destination", recipientType: "vendor", recipientId: UUID });
    return d.identityConfidence === "exact"; // a caller-supplied number now claims a principal's identity
  }));

// The SMS gate mutations below are REAL bypasses, and each is proven load-bearing by requiring the D3-B
// suite to actually GO RED — not by a string-presence check. If a mutation could reopen the SMS
// direct-provider bypass without any test failing, that mutation would report FAIL.
srcMutation("MUT 7: the SMS consent DENIAL is ignored (a denied/blocked destination proceeds to the claim + provider)",
  ORCH_SRC,
  '  if (smsConsent.kind !== "allow") {',
  "  if (false) {",
  async () => {
    const src = stripTs(readF(ORCH_SRC));
    // The denial short-circuit is gone: a deny / unavailable / invalid outcome now falls straight through
    // to the fallback claim and the SMS provider call.
    const shortCircuitGone = !/if \(smsConsent\.kind !== "allow"\) \{/.test(src);
    return shortCircuitGone && (await suiteGoesRed());
  });

srcMutation("MUT 8: an ABSENT enforcer is treated as an ALLOW again (the implicit-allow bypass is reintroduced)",
  ORCH_SRC,
  "  const authorize: OutboundConsentEnforcer[\"authorize\"] =\n    deps.authorizeOutboundConsent ??\n    (async (enforcementInput) => {\n      const mod = await import(\"./outboundConsentEnforcementService\");\n      return mod.authorizeOutboundConsent(enforcementInput);\n    });",
  "  const authorize: OutboundConsentEnforcer[\"authorize\"] =\n    deps.authorizeOutboundConsent ??\n    (async () => ({ kind: \"allow\", scope: \"authentication\" } as const));",
  async () => {
    const src = stripTs(readF(ORCH_SRC));
    // A missing dependency would once again MEAN AUTHORIZATION — the exact fail-open D3-B exists to close.
    const implicitAllowBack = /kind:\s*"allow"/.test(src)
      && !/await import\("\.\/outboundConsentEnforcementService"\)/.test(src);
    return implicitAllowBack && (await suiteGoesRed());
  });

srcMutation("MUT 8b: an import failure / thrown coordinator is swallowed into an ALLOW (catch-to-allow)",
  ORCH_SRC,
  "  } catch {\n    // NO DECISION COULD BE OBTAINED AT ALL — a dynamic-import failure, or a coordinator that threw.\n    // That is an authority OUTAGE, never an allow. Fail closed onto the existing safe outcome.\n    return blocked(OrchestratorFallbackBlockReason.SMS_CONSENT_AUTHORITY_UNAVAILABLE);\n  }",
  "  } catch {\n    smsConsent = { kind: \"allow\", scope: \"authentication\" } as const;\n  }",
  async () => {
    const src = stripTs(readF(ORCH_SRC));
    // A coordinator that could not even be loaded would now authorize the SMS.
    const catchToAllow = /catch[\s\S]{0,200}kind:\s*"allow"/.test(src);
    return catchToAllow && (await suiteGoesRed());
  });

// ---- MUT 8c: the SMS gate is MOVED AFTER the fallback claim (a genuine RELOCATION, not a deletion) ----
// The whole SMS consent path survives — the decision is still made, still fails closed, still blocks a
// deny. The ONLY thing that changes is its POSITION: it now runs AFTER `claimFallbackAttempt`. That
// violates the security contract, because attempt 2 is consumed (and the single-fallback budget spent)
// BEFORE we know whether consent permits the SMS at all — a denied destination would still burn a claim.
const SMS_CONSENT_BLOCK = `  let smsConsent: OutboundConsentOutcome;
  try {
    smsConsent = await authorize({
      channel: "sms",
      messageType: ORCHESTRATED_AUTH_FLOW,
      templateKey: ORCHESTRATED_AUTH_FLOW,
      lane: "authentication",
      destinationHash,
      destinationSource: "ephemeral_auth_destination",
      recipientType: "client",
      recipientId: null,
    });
  } catch {
    // NO DECISION COULD BE OBTAINED AT ALL — a dynamic-import failure, or a coordinator that threw.
    // That is an authority OUTAGE, never an allow. Fail closed onto the existing safe outcome.
    return blocked(OrchestratorFallbackBlockReason.SMS_CONSENT_AUTHORITY_UNAVAILABLE);
  }

  if (smsConsent.kind !== "allow") {
    // Sanitized + closed. The result carries NO phone, hash, OTP, D2-C reason, suppression id,
    // preference id or raw error — only which of the three closed block reasons applied. The
    // orchestrator NEVER reinterprets a D2-C disposition: it consumes the coordinator's closed outcome.
    if (smsConsent.kind === "deny") return blocked(OrchestratorFallbackBlockReason.SMS_CONSENT_DENIED);
    if (smsConsent.kind === "unavailable") {
      return blocked(OrchestratorFallbackBlockReason.SMS_CONSENT_AUTHORITY_UNAVAILABLE);
    }
    // \`invalid\` — an invalid enforcement request or an untrustworthy authority (integrity violation).
    return blocked(OrchestratorFallbackBlockReason.SMS_CONSENT_ENFORCEMENT_INVALID);
  }
`;
const SMS_CLAIM_GUARD = `  const fallbackAttemptId = fallbackClaim.data.attemptId;
  if (!fallbackAttemptId) return blocked(OrchestratorFallbackBlockReason.FALLBACK_CLAIM_REJECTED);
`;

mutationChecks.push({
  name: "MUT 8c: the SMS consent gate is MOVED AFTER the fallback claim (claim-before-consent)",
  kind: "src",
  edits: [
    // 1) lift the consent decision + gate OUT of its position (the SMS path itself stays intact)…
    { file: ORCH_SRC, from: SMS_CONSENT_BLOCK, to: "" },
    // 2) …and re-insert it AFTER the fallback claim has already been consumed.
    { file: ORCH_SRC, from: SMS_CLAIM_GUARD, to: `${SMS_CLAIM_GUARD}\n${SMS_CONSENT_BLOCK}` },
  ],
  scenario: async () => {
    const src = stripTs(readF(ORCH_SRC));
    const iConsent = src.indexOf("smsConsent = await authorize({");
    const iClaim = src.indexOf("deps.claimFallbackAttempt(");
    const iSend = src.indexOf("smsProvider.sendResolvedAuthenticationSms(");
    // The SMS path is NOT deleted — the decision, the claim and the send all still exist…
    const pathIntact = iConsent > 0 && iClaim > 0 && iSend > 0;
    // …and the gate still blocks a deny (the short-circuit survives the move).
    const gateStillBlocks = /if \(smsConsent\.kind !== "allow"\) \{/.test(src);
    // …but consent now runs AFTER the claim: attempt 2 is burned before consent is even consulted.
    const consentAfterClaim = iClaim < iConsent;
    // That must make the D3-B suite go RED (the ordering assertions are load-bearing).
    return pathIntact && gateStillBlocks && consentAfterClaim && (await suiteGoesRed());
  },
});

srcMutation("MUT 9: an UNKNOWN message type is classified as TRANSACTIONAL",
  SCOPE_SRC,
  "    return { ok: false, reason: ScopeResolutionFailure.UNCLASSIFIED_MESSAGE_TYPE };",
  '    return { ok: true, scope: "transactional", templateKey: String(messageType), lane: "business" };',
  () => withMutatedBuild(async (mm) => {
    const r = mm.Scope.resolveOutboundConsentScope({ messageType: "promo_blast", templateKey: "promo_blast", lane: "business" });
    return r.ok === true && r.scope === "transactional"; // an unreviewed send silently became transactional
  }));

srcMutation("MUT 10: a MESSAGE/TEMPLATE MISMATCH is allowed",
  SCOPE_SRC,
  "  if (typeof input.templateKey !== \"string\" || input.templateKey !== entry.templateKey) {\n    return { ok: false, reason: ScopeResolutionFailure.MESSAGE_TYPE_TEMPLATE_MISMATCH };\n  }",
  "  // mismatch allowed",
  () => withMutatedBuild(async (mm) => {
    const r = mm.Scope.resolveOutboundConsentScope({ messageType: "lead_received", templateKey: "client_nurture_followup", lane: "business" });
    return r.ok === true; // a swapped template inherited another type's consent scope
  }));

// PHASE 8B-1B-B — the runtime factory now builds the EXACT five-argument construction. Omitting the enforcer
// means removing its (4th) argument line; the guard is pinned to the exact 5-argument shape, so a dropped
// enforcer (or any reshaping of the frozen construction) is killed. The mutation's security purpose — proving
// production can never construct the service without the consent enforcer — is unchanged.
srcMutation("MUT 11: the runtime factory OMITS the enforcer (production sends without consent)",
  RUNTIME_SRC,
  "      resolvedCoordinator,\n      consentEnforcer,\n      context.data.attribution",
  "      resolvedCoordinator,\n      context.data.attribution",
  () => {
    const src = readF(RUNTIME_SRC);
    return !/new CommunicationService\(\s*context\.data\.provider,\s*getActiveRecipientResolver\(\),\s*resolvedCoordinator,\s*consentEnforcer,\s*context\.data\.attribution\s*\)/.test(src);
  });

srcMutation("MUT 12: cancellation becomes an UNCONDITIONAL update (it clobbers another worker's claim)",
  COMM_SRC,
  '      .eq("id", message.id)\n      .eq("status", message.status)\n      .select("*");\n\n    if (error) throw error;\n\n    const updated = (data ?? []) as CommunicationMessage[];',
  '      .eq("id", message.id)\n      .select("*");\n\n    if (error) throw error;\n\n    const updated = (data ?? []) as CommunicationMessage[];',
  () => withMutatedBuild(async (mm) => {
    // The row is already `dispatching` (another worker owns it). An unconditional update clobbers it.
    TABLE = [{ ...row(), status: "dispatching" }];
    DB_THROWS = false;
    const p = fakeProvider();
    const e = fakeEnforcer(DENY_SUPPRESSED);
    const svc = new mm.Comm.CommunicationService(p.provider, fakeResolver, null, e.enforcer);
    await svc.dispatchMessage(row({ status: "queued" }), { preResolvedDestination: DEST, providerTemplateName: "tpl" });
    return TABLE[0].status === "cancelled"; // the other worker's claim was clobbered
  }));

// A LOST terminalization race is fenced TWICE — the terminalizer's own zero-row guard, AND the atomic
// claim (which also matches zero rows). Either alone still prevents the provider call, so a load-bearing
// mutation must remove BOTH. That redundancy is the point: no single edit can reopen the hole.
// `updated.length` is unique to terminalizeBeforeClaim (the claim uses `claimed.length`), so this anchor
// is independent of any surrounding doc comment.
const TERMINALIZE_GUARD_EDIT = {
  file: COMM_SRC,
  from: "    if (updated.length !== 1) return fail(commError(\"MESSAGE_ALREADY_CLAIMED\"));\n    return ok(updated[0]);",
  to: "    if (updated.length !== 1) return null as unknown as Result<CommunicationMessage>;\n    return ok(updated[0]);",
};
const CLAIM_GUARD_EDIT = {
  file: COMM_SRC,
  from: "    if (claimed.length !== 1) return fail(commError(\"MESSAGE_ALREADY_CLAIMED\"));\n    return ok(claimed[0]);",
  to: "    if (claimed.length !== 1) return ok(message);\n    return ok(claimed[0]);",
};

/** Drive a DENIED dispatch whose row was already moved to `dispatching` by another worker. */
async function lostRaceDispatch(mm) {
  TABLE = [{ ...row(), status: "dispatching" }];
  DB_THROWS = false;
  const p = fakeProvider();
  const e = fakeEnforcer(DENY_SUPPRESSED);
  const svc = new mm.Comm.CommunicationService(p.provider, fakeResolver, null, e.enforcer);
  await svc.dispatchMessage(row({ status: "queued" }), { preResolvedDestination: DEST, providerTemplateName: "tpl" });
  return p.calls.send;
}

mutationChecks.push({
  name: "MUT 13: BOTH the terminalization guard AND the claim guard removed ⇒ the provider IS invoked after a lost race",
  kind: "src",
  edits: [TERMINALIZE_GUARD_EDIT, CLAIM_GUARD_EDIT],
  scenario: () => withMutatedBuild(async (mm) => (await lostRaceDispatch(mm)) > 0),
});

srcMutation("MUT 13b: the atomic CLAIM alone still blocks the provider when the terminalization guard is removed",
  TERMINALIZE_GUARD_EDIT.file, TERMINALIZE_GUARD_EDIT.from, TERMINALIZE_GUARD_EDIT.to,
  () => withMutatedBuild(async (mm) => (await lostRaceDispatch(mm)) === 0));

srcMutation("MUT 14: the coordinator EXPOSES the destination hash / raw authority detail",
  COORD_SRC,
  'const deny = (code: OutboundConsentDenyCode): OutboundConsentOutcome => ({ kind: "deny", code, retryable: false });',
  'const deny = (code: OutboundConsentDenyCode): OutboundConsentOutcome => ({ kind: "deny", code, retryable: false, hash: HASH_LEAK } as unknown as OutboundConsentOutcome);\nconst HASH_LEAK = "a".repeat(64);',
  () => withMutatedBuild(async (mm) => {
    const r = await mm.Coord.authorizeOutboundConsent({
      channel: "whatsapp", messageType: "lead_received", templateKey: "lead_received", lane: "business",
      destinationHash: HASH, destinationSource: "recipient_reference", recipientType: "client", recipientId: UUID,
    }, decided(ok2("blocked")));
    return safeStringify(r).includes(HASH);
  }));

srcMutation("MUT 15: D2-C authority code is modified (the frozen authority must be byte-unchanged)",
  D2C_SRC,
  "export async function decideCommunicationConsent(",
  "export async function decideCommunicationConsent_MUTATED(",
  () => {
    const dirty = gitDirty();
    return dirty.includes(D2C_SRC); // the boundary check must see a frozen authority go dirty
  });

// ============================================================================
// PHASE 8A MUTATIONS — each one must break a SPECIFIC fail-closed property
//
// A mutation is only load-bearing if it makes a REAL validator go red. `checkFails()` re-runs an actual
// functional check by name against the MUTATED build and requires it to throw — so none of these can pass
// merely because the source string changed or the build broke.
// ============================================================================
async function checkFails(namePrefix, mm) {
  const c = checks.find((x) => x.name.startsWith(namePrefix));
  if (!c) throw new Error(`no such check: ${namePrefix}`);
  // Swap the ENTIRE module map, not just `Comm`. A check may reach for `M.Coord` (the enforcer factory) or
  // `M.Scope`; leaving those pointing at the UNMUTATED build would silently run the check against the old
  // code and report a real mutation as "not load-bearing".
  const saved = { Comm: M.Comm, Coord: M.Coord, Scope: M.Scope };
  try {
    if (mm) { M.Comm = mm.Comm; M.Coord = mm.Coord; M.Scope = mm.Scope; }
    await c.fn();
    return false;
  } catch { return true; }
  finally { M.Comm = saved.Comm; M.Coord = saved.Coord; M.Scope = saved.Scope; }
}

srcMutation("MUT 16 (8A): the constructor parameter is made OPTIONAL and NULLABLE again",
  COMM_SRC,
  "    consentEnforcer: OutboundConsentEnforcer,",
  "    consentEnforcer: OutboundConsentEnforcer | null = null,",
  // The TypeScript compile fixture must go red: omitting the argument would compile again. (PHASE 8B-1B-B:
  // the enforcer is now followed by the optional accountAttribution parameter, so its parameter line ends in
  // a comma; giving it a `| null = null` default still makes an omitting construction compile — P8A-17 fails.)
  () => checkFails("P8A-17."));

srcMutation("MUT 17 (8A): the constructor NORMALIZATION is removed (an invalid enforcer is trusted)",
  COMM_SRC,
  `    this.consentEnforcer = isOutboundConsentEnforcer(consentEnforcer)
      ? consentEnforcer
      : createFailClosedOutboundConsentEnforcer();`,
  "    this.consentEnforcer = consentEnforcer;",
  // A null/undefined/bogus enforcer now reaches the gate unnormalized. `authorize` is not callable, the
  // TypeError escapes as an unclassified failure, and the fail-closed CODE guarantee is gone.
  () => withMutatedBuild(async (mm) => await checkFails("P8A-4.", mm) && await checkFails("P8A-3.", mm)));

srcMutation("MUT 18 (8A): the RUNTIME FALLBACK is changed from fail-closed to ALLOW",
  COORD_SRC,
  `export function createFailClosedOutboundConsentEnforcer(): OutboundConsentEnforcer {
  return { authorize: async () => FAIL_CLOSED_CONSENT_OUTCOME };
}`,
  `export function createFailClosedOutboundConsentEnforcer(): OutboundConsentEnforcer {
  return { authorize: async () => ({ kind: "allow", scope: "transactional" } as OutboundConsentOutcome) };
}`,
  // THE HEADLINE MUTATION. If the fallback allows, then a missing enforcer SENDS. Provider calls stop
  // being zero, and the whole Phase 8A invariant collapses.
  () => withMutatedBuild(async (mm) => await checkFails("P8A-3.", mm) && await checkFails("P8A-9.", mm)));

srcMutation("MUT 19 (8A): the missing-enforcer FAIL-OPEN return is restored",
  COMM_SRC,
  "    // EXPLICIT, CLOSED channel mapping — never a coercion.",
  "    if (!this.consentEnforcer) return null;\n\n    // EXPLICIT, CLOSED channel mapping — never a coercion.",
  // With normalization still in place the field is never falsy, so this alone must NOT resurrect the hole —
  // it is the STRUCTURAL guard that must catch the line's return.
  () => checkFails("P8A-14."));

srcMutationN("MUT 20 (8A): fail-open restored AND normalization removed (the full pre-8A hole returns)",
  [
    {
      file: COMM_SRC,
      from: `    this.consentEnforcer = isOutboundConsentEnforcer(consentEnforcer)
      ? consentEnforcer
      : createFailClosedOutboundConsentEnforcer();`,
      to: "    this.consentEnforcer = consentEnforcer;",
    },
    {
      file: COMM_SRC,
      from: "    // EXPLICIT, CLOSED channel mapping — never a coercion.",
      to: "    if (!this.consentEnforcer) return null;\n\n    // EXPLICIT, CLOSED channel mapping — never a coercion.",
    },
  ],
  // BOTH removed = exactly the merged pre-Phase-8A code. A null enforcer now SENDS — the provider counter
  // proves it, which is precisely the vulnerability this phase closes.
  () => withMutatedBuild(async (mm) => {
    TABLE = [{ ...row() }];
    DB_THROWS = false;
    const p = fakeProvider();
    const svc = new mm.Comm.CommunicationService(p.provider, fakeResolver, null, null);
    await svc.dispatchMessage(row(), { providerTemplateName: "tpl", preResolvedDestination: DEST, templateLanguage: "en" });
    return p.calls.send === 1;      // THE BYPASS IS BACK — a null enforcer sent a real message
  }));

srcMutation("MUT 21 (8A): OUTCOME VALIDATION is removed (the raw outcome is trusted)",
  COMM_SRC,
  "      outcome = normalizeOutboundConsentOutcome(",
  "      outcome = ((x: unknown) => x as OutboundConsentOutcome)(",
  // A BALANCED, COMPILING bypass. The identity arrow takes the authority's raw return value and CASTS it
  // straight to the outcome type — exactly what the code did before Phase 8A. Paren count is unchanged
  // (`ident(` → `((…) => …)(`), so the file still parses and still type-checks; the ONLY thing that changes
  // is that the closed-union validation no longer runs.
  //
  // (The previous version of this mutation was NOT balanced. It produced a syntax error, tsc threw, and the
  // old runner scored the throw as "load-bearing" — so it proved nothing about validation. The runner below
  // now refuses to score an exception as a pass, and this mutation is provably compilable.)
  //
  // WHAT KILLS IT: P8A-7. With validation gone, the duck-typed `{ kind: "allow" }` — no scope, no authority,
  // no decision — satisfies `outcome.kind === "allow"`, the gate returns null, the row is claimed and the
  // PROVIDER IS CALLED. P8A-7 asserts `providerCalls === 0` for that malformed outcome, so it goes red.
  () => withMutatedBuild(async (mm) => await checkFails("P8A-7.", mm)));

srcMutation("MUT 22 (8A): a MALFORMED allow is accepted by the validator",
  COORD_SRC,
  `    case "allow": {
      // An allow MUST carry a scope from the closed registry, and MUST NOT carry deny/failure fields.
      if (typeof o.scope !== "string") return CONSENT_INTEGRITY_OUTCOME;`,
  `    case "allow": {
      // An allow MUST carry a scope from the closed registry, and MUST NOT carry deny/failure fields.
      if (typeof o.scope !== "string") return { kind: "allow", scope: "transactional" };`,
  // A bare `{ kind: "allow" }` is now waved through as a real authorization.
  () => withMutatedBuild(async (mm) => await checkFails("P8A-7.", mm)));

srcMutation("MUT 23 (8A): the CONSENT GATE is removed from dispatchMessage",
  COMM_SRC,
  "      const consentDenial = await this.enforceOutboundConsent(message);\n      if (consentDenial) return consentDenial;",
  "      const consentDenial = null;\n      if (consentDenial) return consentDenial;",
  // No gate at all: a suppressed destination is sent.
  () => withMutatedBuild(async (mm) => await checkFails("P8A-3.", mm) && await checkFails("P8A-12.", mm)));

srcMutation("MUT 24 (8A): the provider is invoked BEFORE the consent gate",
  COMM_SRC,
  "      const consentDenial = await this.enforceOutboundConsent(message);",
  "      await this.provider.sendTemplateMessage(destination, options.providerTemplateName || \"\", {});\n      const consentDenial = await this.enforceOutboundConsent(message);",
  // Every blocked case now makes a provider call, so the zero-call invariant dies. The structural ordering
  // guard must ALSO see the send escape invokeProvider.
  () => withMutatedBuild(async (mm) => await checkFails("P8A-3.", mm) && await checkFails("P8A-15.", mm)));

// MUT 25 — RE-ANCHORED (Stage 2G-D). The previous anchor was the pre-Stage-2C MULTILINE construction; the
// live code is now a single line, so the anchor stopped matching and the mutation silently stopped running.
// The replacement anchor is a REGEXP so formatting can never break it again:
//   • it is scoped to the ENCLOSING defaultMetaWebhookDeps() — not any CommunicationService construction;
//   • `[\s\S]*?` is NON-GREEDY, so it binds to the FIRST construction inside that function;
//   • `\s*` between arguments tolerates LF/CRLF, spaces and line breaks — but NOTHING else;
//   • the argument SEQUENCE is exact (provider, undefined, undefined, enforcer), so a different provider or
//     any reordering does NOT match;
//   • capture group 1 is everything up to the enforcer argument, so the replacement rewrites ONLY the 4th
//     argument and leaves every other argument byte-identical;
//   • the runner requires a regexp anchor to match EXACTLY ONCE, so a second construction is rejected
//     rather than mutated.
srcMutation("MUT 25 (8A): the WEBHOOK's fail-closed enforcer is omitted again",
  WEBHOOK_SRC,
  /(export function defaultMetaWebhookDeps\(\)[\s\S]*?new CommunicationService\(\s*provider\s*,\s*undefined\s*,\s*undefined\s*,\s*)createFailClosedOutboundConsentEnforcer\(\)/,
  "$1undefined as never",
  // The webhook stops stating a consent posture — the structural guard must catch it.
  () => checkFails("P8A-16."));

srcMutation("MUT 26 (8A): the RUNTIME FACTORY binds the fail-closed placeholder instead of the real authority",
  RUNTIME_SRC,
  "  consentEnforcer: OutboundConsentEnforcer = createOutboundConsentEnforcer()",
  "  consentEnforcer: OutboundConsentEnforcer = createFailClosedOutboundConsentEnforcer()",
  // Production would then NEVER send anything — a real outage. The factory guard must catch it.
  () => checkFails("P8A-16."));

srcMutation("MUT 27 (8A): a BLOCKED case is permitted exactly one provider call",
  COMM_SRC,
  "    // The ONLY path to the claim and the provider: a fully validated allow.\n    if (outcome.kind === \"allow\") return null;",
  "    if (outcome.kind === \"allow\" || outcome.kind === \"unavailable\") return null;",
  // `unavailable` now continues to the provider — the exact fail-open shape, one variant deeper.
  () => withMutatedBuild(async (mm) => await checkFails("P8A-3.", mm) && await checkFails("P8A-5.", mm)));

// ============================================================================
// RUNNER
// ============================================================================
async function runFunctional() {
  let passed = 0, failed = 0;
  console.log("Running Phase 5F-D3-B outbound consent enforcement checks...\n");
  for (const c of checks) {
    try { await c.fn(); console.log(`PASS ${c.name}`); passed++; }
    catch (e) { console.log(`FAIL ${c.name}`); console.error(e); failed++; }
  }
  return { passed, failed };
}
async function suiteGoesRed() { for (const c of checks) { try { await c.fn(); } catch { return true; } } return false; }

/**
 * STRICT MUTATION SEMANTICS. A mutation PASSES only when the mutated code still builds and runs, and a real
 * security property then goes red. Every other outcome is a FAILURE OF THE MUTATION, reported with its id,
 * name, cause, message and stack:
 *
 *   anchor missing                → FAIL (the mutation never applied; it proved nothing)
 *   compile / import failure      → FAIL, unless the mutation DECLARED `expectCompileFailure` AND the
 *                                    exception really is a compile failure
 *   any other scenario exception  → FAIL (an accident is not a proof)
 *   scenario returns false and the real suite stays green → FAIL (the guard was not load-bearing)
 *   a real property goes red      → PASS
 */
async function runMutations() {
  let passed = 0;
  const failures = [];
  console.log("\nRunning Phase 5F-D3-B mutation tests...\n");

  for (const mut of mutationChecks) {
    const id = mutId(mut.name);
    const originals = new Map();
    for (const edit of mut.edits) { const p = resolve(edit.file); if (!originals.has(p)) originals.set(p, readFileSync(p, "utf8")); }

    let verdict = null;   // { pass, cause, error }
    try {
      // 1) APPLY. A missing anchor is a mutation failure, never a pass.
      for (const edit of mut.edits) {
        const p = resolve(edit.file);
        const cur = readFileSync(p, "utf8");
        // A STRING anchor keeps its historical semantics (first occurrence). A REGEXP anchor is the
        // formatting-tolerant form: it must match EXACTLY ONCE, so a reformatting that duplicates the
        // shape can never silently mutate the wrong construction.
        const isRe = edit.from instanceof RegExp;
        const hits = isRe
          ? (cur.match(new RegExp(edit.from.source, "g" + edit.from.flags.replace(/g/g, ""))) || []).length
          : (cur.includes(edit.from) ? 1 : 0);
        if (hits === 0) {
          verdict = { pass: false, cause: "anchor not found", error: new Error(`anchor not found in ${edit.file}`) };
          break;
        }
        if (isRe && hits > 1) {
          verdict = { pass: false, cause: "anchor ambiguous", error: new Error(`anchor matched ${hits}x in ${edit.file} — it must be unique`) };
          break;
        }
        writeFileSync(p, cur.replace(edit.from, edit.to));
      }

      // 2) RUN THE SCENARIO. An exception is NOT proof.
      if (!verdict) {
        let violation = false;
        try {
          violation = await mut.scenario();
        } catch (e) {
          if (mut.expectCompileFailure && isCompileFailure(e)) {
            violation = true;                 // the DECLARED, VERIFIED intended result
          } else {
            verdict = {
              pass: false,
              cause: isCompileFailure(e)
                ? "compile failure (not declared via expectCompileFailure) — the mutation proved nothing"
                : "scenario threw an unrelated exception — the mutation proved nothing",
              error: e,
            };
          }
        }

        // 3) A mutation that declared a compile failure must ACTUALLY have produced one.
        if (!verdict && mut.expectCompileFailure && !violation) {
          verdict = { pass: false, cause: "expectCompileFailure was declared but the source still compiled", error: new Error("no compile failure observed") };
        }

        // 4) Last resort: the mutation may still have broken a REAL functional check.
        if (!verdict && !violation) violation = await suiteGoesRed();
        if (!verdict) {
          verdict = violation
            ? { pass: true }
            : { pass: false, cause: "the guard did not prove load-bearing: the mutated source still satisfied every validator", error: null };
        }
      }
    } catch (e) {
      verdict = { pass: false, cause: "the mutation could not be applied", error: e };
    } finally {
      for (const [p, original] of originals) writeFileSync(p, original);
    }

    if (verdict.pass) { console.log(`PASS ${mut.name}`); passed++; }
    else {
      console.log(`FAIL [${id}] ${mut.name}`);
      console.log(`     cause: ${verdict.cause}`);
      if (verdict.error) console.error(verdict.error);
      failures.push({ id, name: mut.name, cause: verdict.cause, error: verdict.error });
    }
  }

  if (failures.length) {
    console.log(`\n──────── FAILED MUTATIONS (${failures.length}) ────────`);
    for (const f of failures) {
      console.log(`\n[${f.id}] ${f.name}`);
      console.log(`  cause  : ${f.cause}`);
      console.log(`  message: ${f.error?.message ?? "(none)"}`);
      if (f.error?.stack) {
        console.log("  stack:");
        for (const line of String(f.error.stack).split("\n")) console.log(`    ${line}`);
      }
    }
  }
  return { passed, failed: failures.length };
}

const functional = await runFunctional();
const mutations = await runMutations();
rmSync(MAIN_DIR, { recursive: true, force: true });
const passed = functional.passed + mutations.passed;
const failed = functional.failed + mutations.failed;
console.log(`\nSummary: ${passed} passed, ${failed} failed (functional: ${functional.passed}/${functional.passed + functional.failed}, mutation: ${mutations.passed}/${mutations.passed + mutations.failed}).`);
process.exit(failed > 0 ? 1 : 0);
