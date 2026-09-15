import { getAdminSession } from "@/app/actions";
import {
  isAutomationStudioWorkflowKey,
  simulateAutomationStudioDefinition,
  validateAutomationStudioDefinition,
  type AutomationStudioDefinition,
} from "@/lib/automation/studioContract";
import {
  getAutomationStudioOverview,
  publishAutomationStudioDraft,
  rollbackAutomationStudioWorkflow,
  saveAutomationStudioDraft,
  setAutomationStudioGlobalEnabled,
  setAutomationStudioWorkflowEnabled,
} from "@/services/automationStudioService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireSuperadmin(): Promise<{ userId: string } | null> {
  const session = await getAdminSession();
  if (!session.isLoggedIn || !session.isSuperadmin || !session.userId) return null;
  return { userId: session.userId };
}

export async function GET() {
  const session = await requireSuperadmin();
  if (!session) return json({ ok: false, error: "Unauthorized" }, 401);
  try {
    return json(await getAutomationStudioOverview(), 200);
  } catch (error) {
    return json({ ok: false, error: safeError(error, "Could not load Automation Studio.") }, 500);
  }
}
export async function POST(request: Request) {
  const session = await requireSuperadmin();
  if (!session) return json({ ok: false, error: "Unauthorized" }, 401);

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    body = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return json({ ok: false, error: "Invalid JSON body." }, 400);
  }

  const action = typeof body.action === "string" ? body.action : "";
  try {
    if (action === "set_global_enabled") {
      if (typeof body.enabled !== "boolean") return json({ ok: false, error: "enabled must be boolean." }, 400);
      await setAutomationStudioGlobalEnabled(body.enabled, session.userId);
      return json({ ok: true }, 200);
    }

    if (action === "set_workflow_enabled") {
      if (!isAutomationStudioWorkflowKey(body.workflowKey) || typeof body.enabled !== "boolean") {
        return json({ ok: false, error: "Invalid workflow control request." }, 400);
      }
      await setAutomationStudioWorkflowEnabled(body.workflowKey, body.enabled, session.userId);
      return json({ ok: true }, 200);
    }

    if (action === "save_draft" || action === "publish" || action === "simulate") {
      if (!isAutomationStudioWorkflowKey(body.workflowKey) || !body.definition || typeof body.definition !== "object") {
        return json({ ok: false, error: "Invalid workflow definition." }, 400);
      }
      const definition = body.definition as AutomationStudioDefinition;
      const validation = validateAutomationStudioDefinition(definition);
      if (!validation.ok || definition.workflowKey !== body.workflowKey) {
        return json({ ok: false, error: validation.ok ? "Workflow key mismatch." : validation.errors.join(" ") }, 400);
      }
      if (action === "simulate") return json(simulateAutomationStudioDefinition(definition), 200);
      if (action === "save_draft") {
        await saveAutomationStudioDraft(body.workflowKey, definition, session.userId);
        return json({ ok: true }, 200);
      }
      const version = await publishAutomationStudioDraft(
        body.workflowKey,
        definition,
        session.userId,
        typeof body.changeSummary === "string" ? body.changeSummary : "",
      );
      return json({ ok: true, version }, 200);
    }
    if (action === "rollback") {
      if (!isAutomationStudioWorkflowKey(body.workflowKey) || !Number.isInteger(body.version)) {
        return json({ ok: false, error: "Invalid rollback request." }, 400);
      }
      const version = await rollbackAutomationStudioWorkflow(
        body.workflowKey,
        Number(body.version),
        session.userId,
      );
      return json({ ok: true, version }, 200);
    }

    return json({ ok: false, error: "Unknown Automation Studio action." }, 400);
  } catch (error) {
    return json({ ok: false, error: safeError(error, "Automation Studio action failed.") }, 500);
  }
}

function safeError(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback;
  if (error.message.startsWith("AUTOMATION_STUDIO_")) return error.message.replaceAll("_", " ").toLowerCase();
  return fallback;
}

function json(payload: unknown, status: number) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
