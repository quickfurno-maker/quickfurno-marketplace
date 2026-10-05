import { NextResponse } from "next/server";

const MAX_REPORT_BYTES = 16 * 1024;

async function readBoundedBody(request: Request): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_REPORT_BYTES) {
      await reader.cancel();
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return text;
}

function safeHost(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  try {
    return new URL(value).host || null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_REPORT_BYTES) {
    return new NextResponse(null, { status: 413 });
  }

  const raw = await readBoundedBody(request);
  if (raw === null) return new NextResponse(null, { status: 413 });

  try {
    const parsed = raw ? JSON.parse(raw) : {};
    const report = parsed?.["csp-report"] ?? parsed;
    console.warn("[security:csp-report]", {
      document_host: safeHost(report?.["document-uri"]),
      blocked_host: safeHost(report?.["blocked-uri"]),
      violated_directive:
        typeof report?.["violated-directive"] === "string"
          ? report["violated-directive"].slice(0, 160)
          : null,
      effective_directive:
        typeof report?.["effective-directive"] === "string"
          ? report["effective-directive"].slice(0, 160)
          : null,
      disposition:
        typeof report?.disposition === "string"
          ? report.disposition.slice(0, 32)
          : "report",
    });
  } catch {
    // CSP reporting must never become a parser-error oracle or affect page delivery.
  }

  return new NextResponse(null, { status: 204 });
}
