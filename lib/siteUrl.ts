// ============================================================================
// QuickFurno — lib/siteUrl.ts
//
// THE canonical public origin of this deployment, and the ONLY source of an
// absolute URL handed to Supabase Auth.
//
// QF-MVP-80.02 GATE-06 REPAIR — why this file exists.
//   The first Gate-06 activation issued a Supabase recovery link carrying
//   `redirect_to=http://localhost:3000` in PRODUCTION. Nothing in the codebase
//   asked for that: `generateLink` was called without `options.redirectTo`, so
//   GoTrue fell back to the project's dashboard-configured Site URL, which was
//   still the local development default. A production credential must never
//   depend on a remote console field being remembered correctly.
//
//   So the origin is now stated explicitly, by this deployment, and a missing
//   or implausible value FAILS CLOSED — no link is issued at all. A link that
//   silently points somewhere useless is worse than no link: it looks like
//   success, and it burns a single-use token.
//
// PURE. No network, no database, no secret. `NEXT_PUBLIC_SITE_URL` is a public
// origin, not a credential — it is exactly the value already visible in every
// address bar.
// ============================================================================

export const SITE_URL_ENV = "NEXT_PUBLIC_SITE_URL";

/** Path that consumes a Supabase recovery session and lets a vendor set a password. */
export const VENDOR_SET_PASSWORD_PATH = "/vendor/set-password";

export const SiteUrlFailure = {
  SITE_URL_MISSING: "SITE_URL_MISSING",
  SITE_URL_MALFORMED: "SITE_URL_MALFORMED",
  SITE_URL_NOT_HTTPS: "SITE_URL_NOT_HTTPS",
  /** localhost / loopback / .local — never a real deployment origin. */
  SITE_URL_NOT_PUBLIC: "SITE_URL_NOT_PUBLIC",
  /** Credentials, query or fragment in an origin are always a mistake. */
  SITE_URL_NOT_AN_ORIGIN: "SITE_URL_NOT_AN_ORIGIN",
} as const;

export type SiteUrlFailureCode = (typeof SiteUrlFailure)[keyof typeof SiteUrlFailure];

export type SiteUrlResolution =
  | { readonly ok: true; readonly origin: string }
  | { readonly ok: false; readonly code: SiteUrlFailureCode };

const NON_PUBLIC_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"]);

function isNonPublicHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (NON_PUBLIC_HOSTS.has(host)) return true;
  if (host.endsWith(".local") || host.endsWith(".localhost")) return true;
  // Private IPv4 ranges — a LAN address is not a public deployment origin.
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[01])\./.test(host)) return true;
  return false;
}

/**
 * Validate a candidate origin. PURE — takes the raw value, never reads
 * `process.env`, so the rules are testable without an environment.
 *
 * Returns the normalized origin (scheme + host + port), with any trailing
 * slash, path, query or fragment rejected rather than quietly trimmed: a
 * configured value that is not what it appears to be is a configuration bug
 * worth surfacing, not something to paper over.
 */
export function resolveCanonicalSiteUrl(raw: string | null | undefined): SiteUrlResolution {
  if (typeof raw !== "string" || raw.trim() === "") {
    return { ok: false, code: SiteUrlFailure.SITE_URL_MISSING };
  }
  const value = raw.trim();

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false, code: SiteUrlFailure.SITE_URL_MALFORMED };
  }

  if (parsed.protocol !== "https:") {
    return { ok: false, code: SiteUrlFailure.SITE_URL_NOT_HTTPS };
  }
  if (parsed.username !== "" || parsed.password !== "" || parsed.search !== "" || parsed.hash !== "") {
    return { ok: false, code: SiteUrlFailure.SITE_URL_NOT_AN_ORIGIN };
  }
  if (parsed.pathname !== "/" && parsed.pathname !== "") {
    return { ok: false, code: SiteUrlFailure.SITE_URL_NOT_AN_ORIGIN };
  }
  if (parsed.hostname === "" || isNonPublicHost(parsed.hostname)) {
    return { ok: false, code: SiteUrlFailure.SITE_URL_NOT_PUBLIC };
  }

  return { ok: true, origin: parsed.origin };
}

/** Read the configured origin from the environment. Fails closed. */
export function canonicalSiteUrl(): SiteUrlResolution {
  return resolveCanonicalSiteUrl(process.env[SITE_URL_ENV]);
}

/**
 * The absolute URL a Supabase recovery link must return the vendor to.
 * Fails closed with the same codes: no origin, no link.
 */
export function vendorSetPasswordUrl(): SiteUrlResolution {
  const site = canonicalSiteUrl();
  if (!site.ok) return site;
  return { ok: true, origin: `${site.origin}${VENDOR_SET_PASSWORD_PATH}` };
}
