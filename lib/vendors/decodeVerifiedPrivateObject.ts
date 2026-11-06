/**
 * Decode a private Storage object only when its observed bytes match the
 * provider's declared size. Fail closed and clear the temporary buffer on
 * mismatch. The caller owns valid returned bytes and must clear them after use.
 */
export async function decodeVerifiedPrivateObject(
  data: Pick<Blob,"size"|"arrayBuffer">,
): Promise<Uint8Array | null> {
  const bytes = new Uint8Array(await data.arrayBuffer());
  if (bytes.byteLength !== data.size) {
    bytes.fill(0);
    return null;
  }
  return bytes;
}
