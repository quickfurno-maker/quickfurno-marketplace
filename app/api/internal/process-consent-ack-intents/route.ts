// ============================================================================
// POST /api/internal/process-consent-ack-intents
// QuickFurno — Phase 5F-D4-C consent-acknowledgement delivery worker (cron-ready).
//
// Runs ONE bounded batch of services/consentAckWorkerService.processConsentAckIntents(): claim up to 25 due
// acknowledgement intents, open the sealed destination, RE-EVALUATE D2-C, reserve the single provider
// attempt, dispatch through the ordinary CommunicationService path, terminalize and purge.
//
// THIS ROUTE IS A TRIGGER, NOT AN AUTHORITY. It contains NO consent policy, decrypts nothing, calls no
// provider, and exposes no intent row. Every decision is re-derived inside Core by the worker. A caller —
// including VPS cron, and including anything else that ever learns the secret — cannot select WHICH intent
// runs, WHO it goes to, WHAT type is sent, WHICH consent scope applies, or HOW MANY times it is attempted.
// The only thing a caller can influence is the batch size, clamped to [1, 25].
//
// n8n and Jarvis are NOT authorizers here and never can be. Triggering a bounded batch is not authorization:
// the worker still asks D2-C, still honours global suppression, still enforces at-most-once.
//
// There is no admin session on a cron path, so it is gated by a shared secret:
//   - header `x-qf-cron-secret` must match env `QF_CRON_SECRET`;
//   - the comparison is TIMING-SAFE;
//   - a missing or wrong secret is rejected;
//   - the secret is NEVER logged and never echoed.
//
// Status codes: 200 processed · 401 missing/invalid secret · 405 wrong method · 500 server error.
// Cron is NOT configured by this file.
// ============================================================================
import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";

import { processConsentAckIntents } from "@/services/consentAckWorkerService";
import { ACK_CLAIM_BATCH_MAX } from "@/lib/communication/consentAckIntent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CRON_SECRET_HEADER = "x-qf-cron-secret";
const CRON_SECRET_ENV_KEY = "QF_CRON_SECRET";

/** Constant-time comparison. Never short-circuits on the first differing byte. */
function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;   // length is not secret; content is
  return timingSafeEqual(a, b);
}

type SecretCheck = { ok: true } | { ok: false; message: string };

function checkSecret(req: Request): SecretCheck {
  const expected = (process.env[CRON_SECRET_ENV_KEY] ?? "").trim();
  const provided = (req.headers.get(CRON_SECRET_HEADER) ?? "").trim();

  // FAIL CLOSED. An unset server secret does not mean "allow everyone".
  if (expected === "") return { ok: false, message: "worker secret not configured" };
  if (provided === "") return { ok: false, message: "missing worker secret" };
  if (!secretsMatch(provided, expected)) return { ok: false, message: "invalid worker secret" };
  return { ok: true };
}

export async function POST(req: Request): Promise<NextResponse> {
  const auth = checkSecret(req);
  if (!auth.ok) {
    // The secret value is never echoed, never logged, never hinted at.
    return NextResponse.json({ ok: false, error: auth.message }, { status: 401 });
  }

  // The ONLY caller-influenceable input, and it is clamped. There is deliberately NO way to pass a
  // destination, an intent id, an acknowledgement type, a consent scope, a provider, a recipient or a
  // retry count — those are not parameters of this system.
  let limit = ACK_CLAIM_BATCH_MAX;
  try {
    const body = (await req.json()) as unknown;
    const raw = (body as { limit?: unknown } | null)?.limit;
    if (typeof raw === "number" && Number.isInteger(raw)) {
      limit = Math.min(Math.max(raw, 1), ACK_CLAIM_BATCH_MAX);
    }
  } catch {
    /* no body, or not JSON — the default bounded batch is used */
  }

  try {
    // The worker owns EVERYTHING: retention (expiry sweep), recovery (stale dispatch) and delivery. This
    // route contains no SQL, no retention policy and no recovery policy — it only asks for one bounded run.
    const outcome = await processConsentAckIntents({ limit });
    if (!outcome.ok) {
      // Maintenance failed ⇒ the batch failed CLOSED: nothing was claimed and nothing was sent.
      return NextResponse.json({ ok: false, error: "worker_maintenance_failed" }, { status: 500 });
    }
    const r = outcome.result;
    // SANITIZED counts only. No intent rows, no ciphertext, no key ids, no destination hashes, no phones.
    return NextResponse.json(
      {
        ok: true,
        claimed: r.claimed,
        sent: r.sent,
        suppressed: r.suppressed,
        expired: r.expired,
        failed: r.failed,
        uncertain: r.uncertain,
        maintenance: {
          expired: outcome.maintenance.expired,
          recovered_uncertain: outcome.maintenance.recoveredUncertain,
        },
      },
      { status: 200 }
    );
  } catch {
    return NextResponse.json({ ok: false, error: "worker_failed" }, { status: 500 });
  }
}

/** POST only. A GET could be triggered by a browser, a crawler or a link preview. */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ ok: false, error: "method_not_allowed" }, { status: 405 });
}
