// ============================================================================
// QuickFurno AOS — Phase 12: Admin-Controlled AOS / n8n Activation Switch
//
// Admin-only API for the AOS -> n8n master router runtime switch (Lock 2).
//
//   GET  /api/admin/aos-runtime-settings  → safe status snapshot
//   POST /api/admin/aos-runtime-settings  → update enabled + mode
//
// SAFETY:
//   - Superadmin only (reuses the project admin session guard).
//   - Returns booleans/labels only. NEVER exposes the n8n webhook URL,
//     QF_N8N_SECRET, or the service-role key.
//   - The service-role write happens server-side via the runtime utility.
//   - Toggling this switch performs NO WhatsApp send, NO vendor notification,
//     NO credit deduction, NO auto assignment, and NO n8n database writes.
// ============================================================================
import { NextResponse } from "next/server";
import { getAdminSession } from "@/app/actions";
import {
  AOS_SELECTABLE_MODES,
  resolveAosN8nActivation,
  setAosN8nMasterRouterSetting,
  type AosRuntimeMode,
} from "@/lib/aos/runtime/aosRuntimeSettings";

export const dynamic = "force-dynamic";

const SAFETY_STATUS = {
  whatsappSending: "Disabled",
  vendorNotification: "Disabled",
  creditDeduction: "Disabled",
  autoAssignment: "Disabled",
  n8nDatabaseWrites: "Disabled",
} as const;

function buildStatusPayload(activation: Awaited<ReturnType<typeof resolveAosN8nActivation>>) {
  return {
    ok: true,
    // Lock 1 — server env. Booleans only, no secret values.
    envLock: {
      n8nEnabled: activation.envLock.n8nEnabled,
      outboundWebhookEnabled: activation.envLock.outboundWebhookEnabled,
      bothEnabled: activation.envLock.bothEnabled,
    },
    // Lock 2 — admin runtime switch.
    runtime: {
      enabled: activation.runtime.enabled,
      mode: activation.runtime.mode,
      description: activation.runtime.description,
      updatedBy: activation.runtime.updatedBy,
      updatedAt: activation.runtime.updatedAt,
      exists: activation.runtime.exists,
    },
    // Combined gate.
    shouldCallN8n: activation.shouldCallN8n,
    reason: activation.reason,
    selectableModes: AOS_SELECTABLE_MODES,
    safetyStatus: SAFETY_STATUS,
  };
}

export async function GET() {
  const session = await getAdminSession();
  if (!session.isSuperadmin) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 403 });
  }

  const activation = await resolveAosN8nActivation();
  return NextResponse.json(buildStatusPayload(activation), { status: 200 });
}

export async function POST(request: Request) {
  const session = await getAdminSession();
  if (!session.isSuperadmin) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const record = isRecord(body) ? body : {};
  const enabled = record.enabled === true;
  const mode = parseMode(record.mode);

  if (mode === null) {
    return NextResponse.json(
      { ok: false, error: "Invalid mode. Only 'off' or 'preview' are allowed. production_locked is coming soon." },
      { status: 400 },
    );
  }

  const result = await setAosN8nMasterRouterSetting({
    enabled,
    mode,
    updatedBy: session.adminRole ?? "Superadmin",
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error ?? "Could not save the setting." }, { status: 500 });
  }

  // Return the fresh combined status so the UI reflects both locks immediately.
  const activation = await resolveAosN8nActivation();
  return NextResponse.json(buildStatusPayload(activation), { status: 200 });
}

function parseMode(value: unknown): AosRuntimeMode | null {
  if (value === "off" || value === "preview") return value;
  // production_locked and anything else are rejected for now.
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
