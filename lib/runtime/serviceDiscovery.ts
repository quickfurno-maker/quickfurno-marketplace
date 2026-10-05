import { isIP } from "node:net";

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);

export interface PortableServiceUrlOptions {
  readonly allowLoopbackHttp?: boolean;
}

export function resolvePortableServiceBaseUrl(
  raw: string | undefined,
  options: PortableServiceUrlOptions = {},
): string | null {
  const value = raw?.trim();
  if (!value) return null;

  try {
    const url = new URL(value);
    const loopback = LOOPBACK.has(url.hostname);
    const validProtocol =
      url.protocol === "https:" ||
      (options.allowLoopbackHttp === true && loopback && url.protocol === "http:");

    if (
      !validProtocol ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/" ||
      (!loopback && isIP(url.hostname) !== 0)
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function requirePortableServiceBaseUrl(
  raw: string | undefined,
  options: PortableServiceUrlOptions = {},
): string {
  const resolved = resolvePortableServiceBaseUrl(raw, options);
  if (!resolved) throw new Error("PORTABLE_SERVICE_URL_INVALID");
  return resolved;
}
