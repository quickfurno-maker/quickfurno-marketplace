/**
 * Private upload buffers are held only for a single awaited operation.
 * Best-effort memory hygiene: Buffer.fill(0) after every outcome, including
 * validation failures and remote Storage/RPC errors. Does not erase copies
 * held by the original FormData/File or promise that GC memory is scrubbed.
 */
export async function withPrivateEvidenceBuffer<T>(
  bytes: Buffer,
  operation: (bytes: Buffer) => Promise<T>,
): Promise<T> {
  try {
    return await operation(bytes);
  } finally {
    bytes.fill(0);
  }
}
