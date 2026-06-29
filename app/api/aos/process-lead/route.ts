// ============================================================================
// POST /api/aos/process-lead — QuickFurno AOS Phase 2 (New Lead Intake preview)
//
// n8n calls this endpoint during the `lead.created` workflow. It runs the
// deterministic, side-effect-free preview in lib/aos/workflows/processLeadWorkflow.
//
// Security:
//   - Requires header `x-qf-n8n-secret` matching env `QF_N8N_SECRET`
//     (falls back to the Phase 1 `QF_N8N_WEBHOOK_SECRET` for compatibility).
//   - Missing secret → rejected in production, allowed as a safe mock in dev.
//   - The secret value is never logged. Client phone numbers are masked.
//
// Status codes:
//   200 — safe processed preview
//   400 — bad / unparseable payload
//   401 — invalid or missing n8n secret (production)
//   500 — unexpected server error only
// ============================================================================

import { NextResponse } from "next/server";
import {
  buildLeadLogSummary,
  runProcessLeadPreview,
  validateProcessLeadInput,
} from "@/lib/aos/workflows/processLeadWorkflow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const N8N_SECRET_HEADER = "x-qf-n8n-secret";
const PRIMARY_SECRET_ENV_KEY = "QF_N8N_SECRET";
const FALLBACK_SECRET_ENV_KEY = "QF_N8N_WEBHOOK_SECRET";

type SecretCheck =
  | { ok: true; mode: "validated" | "development_mock"; message: string }
  | { ok: false; mode: "missing_secret" | "invalid_secret"; message: string };

function timingSafeEqual(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i += 1) {
    mismatch |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Validate the inbound n8n secret. Never logs or returns the secret itself.
 */
function checkN8nSecret(request: Request): SecretCheck {
  const expected =
    process.env[PRIMARY_SECRET_ENV_KEY]?.trim() ||
    process.env[FALLBACK_SECRET_ENV_KEY]?.trim() ||
    "";
  const isProduction = process.env.NODE_ENV === "production";

  if (!expected) {
    if (isProduction) {
      return {
        ok: false,
        mode: "missing_secret",
        message: "n8n secret is not configured on the server.",
      };
    }
    return {
      ok: true,
      mode: "development_mock",
      message:
        "Development mock: QF_N8N_SECRET is not set, so this preview is not a trusted call.",
    };
  }

  const provided = request.headers.get(N8N_SECRET_HEADER)?.trim() ?? "";
  if (!timingSafeEqual(provided, expected)) {
    return { ok: false, mode: "invalid_secret", message: "Invalid n8n secret." };
  }

  return { ok: true, mode: "validated", message: "n8n secret validated." };
}

async function readJsonBody(
  request: Request,
): Promise<{ ok: true; body: unknown } | { ok: false; message: string }> {
  try {
    return { ok: true, body: await request.json() };
  } catch {
    return { ok: false, message: "Invalid JSON payload." };
  }
}

export async function POST(request: Request) {
  try {
    // 1) Security gate.
    const secret = checkN8nSecret(request);
    if (!secret.ok) {
      return NextResponse.json(
        { ok: false, status: "unauthorized", message: secret.message },
        { status: 401 },
      );
    }

    // 2) Parse + validate payload.
    const parsed = await readJsonBody(request);
    if (!parsed.ok) {
      return NextResponse.json(
        { ok: false, status: "bad_request", message: parsed.message },
        { status: 400 },
      );
    }

    const validation = validateProcessLeadInput(parsed.body);
    if (!validation.ok) {
      return NextResponse.json(
        { ok: false, status: "bad_request", message: validation.reason },
        { status: 400 },
      );
    }

    // 3) Deterministic, side-effect-free preview.
    const result = runProcessLeadPreview(validation.input);

    // Log-safe summary only (phone masked, no secret). Never persisted.
    console.info("[qf-aos] process-lead preview", {
      ...buildLeadLogSummary(validation.input),
      securityMode: secret.mode,
      leadQuality: result.leadQuality,
      spamRisk: result.spamRisk,
    });

    return NextResponse.json(
      { ...result, security: { mode: secret.mode, message: secret.message } },
      { status: 200 },
    );
  } catch {
    // Unexpected server error only — never leak details.
    return NextResponse.json(
      {
        ok: false,
        status: "server_error",
        message: "Unexpected error while processing the lead preview.",
      },
      { status: 500 },
    );
  }
}
