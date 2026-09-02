// ============================================================================
// POST /api/internal/process-lead-assignment-intents
// QuickFurno — QF-MVP-80.13B lead-assignment dispatch trigger (cron-ready).
//
// Runs ONE bounded batch of
// services/leadAssignmentDispatchService.runLeadAssignmentDispatchBatch().
//
// THIS ROUTE IS A TRIGGER, NOT AN AUTHORITY. QF-MVP-80.13A owns the entire lane
// and this file adds nothing to it. Selection, the forward-only activation
// boundary that keeps the six historical intents parked, assignment and vendor
// resolution, the single purpose->template mapping, variable construction,
// outbound consent, runtime policy, provider-account readiness, canary
// enforcement, approved-mapping selection, idempotency and the dispatch itself
// all live inside the already-merged canonical stack and are re-derived inside
// Core on EVERY run.
//
// A caller — including VPS cron, and including anything else that ever learns
// the secret — cannot select WHICH intent runs, WHO it goes to, WHICH template
// is used, WHICH provider sends it, WHERE the activation boundary sits, or HOW
// MANY times anything is attempted. The only thing a caller can influence is the
// batch size, clamped to [1, 25]. Triggering a bounded batch is not
// authorization: every gate still runs, and a lane with no activation boundary
// configured still selects nothing.
//
// There is no admin session on a cron path, so it is gated by a shared secret:
//   - header `x-qf-cron-secret` must match env `QF_CRON_SECRET`;
//   - the comparison is TIMING-SAFE;
//   - an unset server secret, a missing secret and a wrong secret are all rejected;
//   - the secret is NEVER logged and never echoed.
//
// The response carries SANITIZED COUNTS ONLY — no intent, assignment, lead,
// vendor or message id, no destination, no phone, no provider identity and no
// activation-boundary timestamp.
//
// Status codes: 200 processed · 401 missing/invalid secret · 405 wrong method · 500 server error.
// Cron is NOT configured by this file.
// ============================================================================
import { NextResponse } from "next/server";

import { runLeadAssignmentDispatchBatch } from "@/services/leadAssignmentDispatchService";
import {
  CRON_SECRET_ENV_KEY,
  CRON_SECRET_HEADER,
  evaluateCronSecret,
  resolveDispatchLimit,
  sanitizeDispatchSummary,
} from "@/lib/communication/leadAssignmentDispatchTrigger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<NextResponse> {
  const auth = evaluateCronSecret({
    expected: process.env[CRON_SECRET_ENV_KEY],
    provided: req.headers.get(CRON_SECRET_HEADER),
  });
  if (!auth.ok) {
    // The secret value is never echoed, never logged, never hinted at.
    return NextResponse.json({ ok: false, error: auth.message }, { status: 401 });
  }

  // The ONLY caller-influenceable input, and it is clamped. Every other field a
  // body might carry is ignored outright — there is no code path from a request
  // to an intent id, a recipient, a destination, a template or a provider.
  let limit: number;
  try {
    limit = resolveDispatchLimit(await req.json());
  } catch {
    /* no body, or not JSON — the default bounded batch is used */
    limit = resolveDispatchLimit(null);
  }

  try {
    // The service owns EVERYTHING. This route contains no SQL, no provider call,
    // no template choice and no boundary policy — it only asks for one bounded run.
    const summary = await runLeadAssignmentDispatchBatch({ limit });
    // SANITIZED counts only, constructed field by field — never spread.
    return NextResponse.json(sanitizeDispatchSummary(summary), { status: 200 });
  } catch {
    return NextResponse.json({ ok: false, error: "worker_failed" }, { status: 500 });
  }
}

/** POST only. A GET could be triggered by a browser, a crawler or a link preview. */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ ok: false, error: "method_not_allowed" }, { status: 405 });
}
