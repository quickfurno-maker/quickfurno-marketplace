import { NextResponse } from "next/server";
import { parseSerializedQfjCoreDecisionCommand, canonicalQfjJson } from "@/lib/jarvis/coreDecisionContract";
import { QFJ_KEY_ID_HEADER, QFJ_SIGNATURE_HEADER, parseQfjVerificationKeys, verifyQfjCoreDecisionSignature } from "@/lib/jarvis/coreDecisionAuth";
import { resolveQfJarvisRuntimePolicy } from "@/lib/jarvis/runtimePolicy";
import { decideJarvisCoreCommand } from "@/services/jarvisCoreDecisionService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_BODY_BYTES = 32_768;
const error = (status: number, code: string) => NextResponse.json({ error: code }, { status });

export async function POST(request: Request): Promise<Response> {
  let raw: Uint8Array;
  try { raw = new Uint8Array(await request.arrayBuffer()); } catch { return error(400, "invalid_request"); }
  if (raw.byteLength < 2 || raw.byteLength > MAX_BODY_BYTES) return error(413, "invalid_request");
  const serialized = Buffer.from(raw).toString("utf8");
  const parsed = parseSerializedQfjCoreDecisionCommand(serialized);
  if (!parsed.ok) return error(400, "invalid_request");

  const keys = parseQfjVerificationKeys(process.env.QF_JARVIS_CORE_VERIFICATION_KEYS_JSON);
  if (!keys) return error(503, "service_unavailable");
  const authenticated = verifyQfjCoreDecisionSignature({ rawBody: raw, command: parsed.command,
    keyId: request.headers.get(QFJ_KEY_ID_HEADER), signature: request.headers.get(QFJ_SIGNATURE_HEADER), keys, now: new Date().toISOString() });
  if (!authenticated) return error(401, "authentication_failed");

  const response = await decideJarvisCoreCommand({ command: parsed.command, policy: resolveQfJarvisRuntimePolicy(), decidedAt: new Date().toISOString() });
  return new Response(canonicalQfjJson(response), { status: 200, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}
