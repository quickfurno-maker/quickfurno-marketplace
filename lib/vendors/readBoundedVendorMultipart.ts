/**
 * Enforce a byte limit on the ACTUAL multipart request stream.
 * Content-Length is advisory and can be absent or false; formData() alone
 * would buffer the request without enforcing the vendor evidence ceiling.
 * This helper performs no identity, Storage, or approval operations.
 */
export async function readBoundedVendorMultipart(
  request: Request, maxBytes: number,
): Promise<{ ok: true; form: FormData } | { ok: false; reason: "too_large" | "invalid" }> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1)
    return { ok: false, reason: "invalid" };
  const reader = request.body?.getReader();
  if (!reader) return { ok: false, reason: "invalid" };
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) return { ok: false, reason: "invalid" };
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return { ok: false, reason: "too_large" };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, reason: "invalid" };
  } finally {
    reader.releaseLock();
  }
  if (total === 0) return { ok: false, reason: "invalid" };
  // Allocation never exceeds maxBytes; ignore a potentially forged length.
  const bounded = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bounded.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const contentType = request.headers.get("content-type");
    if (!contentType) return { ok: false, reason: "invalid" };
    const parsed = new Request(request.url, {
      method: "POST",
      headers: { "content-type": contentType },
      body: bounded,
    });
    return { ok: true, form: await parsed.formData() };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}
