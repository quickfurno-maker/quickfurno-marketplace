// ============================================================================
// POST /api/admin/process-due-lead-assignment-queue
// QuickFurno — Phase 2 preferred-vendor delayed-fill processor (cron-ready).
//
// Runs services/delayedLeadFillService.processDueLeadAssignmentQueue(): for every
// queued preferred-vendor lead whose 1-hour window has lapsed, fill the remaining
// slots (up to a HARD cap of 3 total) with the best matching eligible vendors.
//
// This is a SERVER-ONLY endpoint — there is no admin session here, so it is
// gated by a shared secret so it can later be triggered by n8n / a VPS cron.
//   - Requires header `x-qf-cron-secret` matching env `QF_CRON_SECRET`
//     (falls back to `new_n8n_secret` for compatibility).
//   - Missing secret → rejected in production, allowed as a safe mock in dev.
//   - The secret value is never logged.
//
// Nothing here deducts credits or sends live WhatsApp directly — the service
// delegates to the tested credit-safe RPCs and keeps WhatsApp preview/log only.
//
// Status codes: 200 processed · 401 invalid/missing secret · 500 server error.
// ============================================================================
import { NextResponse } from "next/server";
import { processDueLeadAssignmentQueue } from "@/services/delayedLeadFillService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CRON_SECRET_HEADER = "x-qf-cron-secret";
const PRIMARY_SECRET_ENV_KEY = "QF_CRON_SECRET";
const FALLBACK_SECRET_ENV_KEY = "new_n8n_secret";
const MAX_LIMIT = 100;

type SecretCheck =
  | { ok: true; mode: "validated" | "development_mock" }
  | { ok: false; message: string };

function timingSafeEqual(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i += 1) {
    mismatch |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}

function checkSecret(request: Request): SecretCheck {
  const expected =
    process.env[PRIMARY_SECRET_ENV_KEY]?.trim() ||
    process.env[FALLBACK_SECRET_ENV_KEY]?.trim() ||
    "";
  const isProduction = process.env.NODE_ENV === "production";

  if (!expected) {
    if (isProduction) return { ok: false, message: "Processor secret is not configured on the server." };
    return { ok: true, mode: "development_mock" };
  }

  const provided = request.headers.get(CRON_SECRET_HEADER)?.trim() ?? "";
  if (!timingSafeEqual(provided, expected)) return { ok: false, message: "Invalid processor secret." };
  return { ok: true, mode: "validated" };
}

function resolveLimit(request: Request): number | undefined {
  const raw = new URL(request.url).searchParams.get("limit");
  if (!raw) return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.min(Math.floor(parsed), MAX_LIMIT);
}

export async function POST(request: Request) {
  try {
    const secret = checkSecret(request);
    if (!secret.ok) {
      return NextResponse.json({ ok: false, status: "unauthorized", message: secret.message }, { status: 401 });
    }

    const result = await processDueLeadAssignmentQueue(resolveLimit(request));
    if (!result.ok) {
      // MIGRATION_NOT_APPLIED and other service errors are safe to report as 200
      // with ok:false so a cron caller can log without treating it as an outage.
      return NextResponse.json(
        { ok: false, status: result.code, message: result.error, security: { mode: secret.mode } },
        { status: 200 },
      );
    }

    const processed = result.data.processed;
    console.info("[qf-delayed-fill] processed due queue", {
      securityMode: secret.mode,
      rows: processed.length,
      resolved: processed.filter((row) => row.status.startsWith("resolved") || row.status === "preferred_assigned_then_filled").length,
      waiting: processed.filter((row) => row.status.startsWith("waiting")).length,
    });

    return NextResponse.json({ ok: true, status: "processed", processed, security: { mode: secret.mode } }, { status: 200 });
  } catch {
    return NextResponse.json(
      { ok: false, status: "server_error", message: "Unexpected error while processing the delayed-fill queue." },
      { status: 500 },
    );
  }
}
