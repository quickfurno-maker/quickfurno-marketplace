// ============================================================================
// QuickFurno — lib/analytics/leadTracking.ts
//
// QF-UI-TRACKING-01 — the SINGLE browser authority for homeowner lead attribution.
//
// THE DEFECT THIS REPAIRS
//   Both live lead surfaces (components/ClientEnquiryModal.tsx and
//   components/LeadFunnel.tsx) each carried their own copy of:
//
//       const params = new URLSearchParams(window.location.search);
//
//   sampled ONLY at submit time. A visitor who lands on
//   `/?utm_source=facebook&...` and then navigates anywhere inside QuickFurno —
//   or simply opens the modal from a page without the query string — submits with
//   every utm_* null. The production certification lead proved exactly that:
//   `source_url = https://quickfurno.in/` with utm_source / utm_medium /
//   utm_campaign all null. The campaign was never lost by the ad network; it was
//   discarded by the UI between arrival and submission.
//
// THE FIX
//   Capture the tagged campaign ONCE, as early as the client tree mounts, into
//   sessionStorage; then resolve attribution at submit time from the current URL
//   FIRST and the stored campaign second.
//
// ATTRIBUTION IS ALL-OR-NOTHING PER TAGGED VISIT — deliberately.
//   A URL carrying ANY utm_* replaces the WHOLE stored set. Fields are never
//   merged across visits, because a merge would invent a campaign nobody ran:
//   campaign B's source stitched onto campaign A's medium. One tagged arrival is
//   one attribution record.
//
// WHAT THIS MODULE IS NOT
//   It is not an analytics pipeline, a consent surface, or any kind of backend
//   authority. It performs NO network call, NO Supabase access, NO database
//   write, and imports nothing from services/. It only reads the URL and a single
//   versioned sessionStorage key. It cannot affect lead quality, matching,
//   assignment, credits, communication or provider behaviour.
//
// STORAGE IS BEST-EFFORT.
//   Safari private mode, disabled cookies, quota exhaustion and hardened
//   browsers all make sessionStorage throw on access. Every touch is wrapped, and
//   a failure degrades to current-URL attribution. Attribution must never be able
//   to block a lead.
// ============================================================================

/** Versioned so a future shape change cannot read a stale record. */
export const LEAD_UTM_STORAGE_KEY = "qf_lead_utm_v1";

/** The exact five campaign fields `CreateLeadInput` accepts. */
export const UTM_FIELDS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
] as const;

export type UtmField = (typeof UTM_FIELDS)[number];

/** Only fields that were actually present are set; absent stays absent. */
export type UtmContext = Partial<Record<UtmField, string>>;

/** What a lead submission attaches. `source_url` keeps its existing meaning. */
export type LeadTrackingContext = UtmContext & { source_url?: string };

// ---------------------------------------------------------------------------
// Pure helpers — no globals, so they are directly testable
// ---------------------------------------------------------------------------

/**
 * Extract campaign fields from a query string. Empty and whitespace-only values
 * are treated as ABSENT, so `?utm_source=` can never overwrite a real campaign.
 */
export function readUtmFromSearch(search: string): UtmContext {
  const out: UtmContext = {};
  if (typeof search !== "string" || search === "") return out;
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return out;
  }
  for (const field of UTM_FIELDS) {
    const raw = params.get(field);
    const value = typeof raw === "string" ? raw.trim() : "";
    if (value !== "") out[field] = value;
  }
  return out;
}

/** True when at least one campaign field carries a real value. */
export function hasUtm(context: UtmContext | null | undefined): boolean {
  if (!context) return false;
  return UTM_FIELDS.some((f) => typeof context[f] === "string" && context[f] !== "");
}

/** Keep only known fields with non-empty string values. */
export function sanitizeUtm(value: unknown): UtmContext {
  const out: UtmContext = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  const record = value as Record<string, unknown>;
  for (const field of UTM_FIELDS) {
    const raw = record[field];
    if (typeof raw === "string") {
      const trimmed = raw.trim();
      if (trimmed !== "") out[field] = trimmed;
    }
  }
  return out;
}

/**
 * The attribution decision, as a pure function of the two candidate sets.
 *
 * A tagged current URL WINS outright — including its absent fields. Falling back
 * to `stored` only when the current URL is untagged is what makes an internal
 * navigation non-destructive.
 */
export function chooseAttribution(current: UtmContext, stored: UtmContext): UtmContext {
  return hasUtm(current) ? current : sanitizeUtm(stored);
}

// ---------------------------------------------------------------------------
// Storage — every access is best-effort and can never throw to the caller
// ---------------------------------------------------------------------------

function getStorage(): Storage | null {
  try {
    if (typeof globalThis === "undefined") return null;
    const store = (globalThis as { sessionStorage?: Storage }).sessionStorage;
    return store ?? null;
  } catch {
    // Accessing the property itself throws in some hardened/blocked contexts.
    return null;
  }
}

/** Read the stored campaign. Any failure or malformed record reads as empty. */
export function readStoredUtm(): UtmContext {
  try {
    const store = getStorage();
    if (!store) return {};
    const raw = store.getItem(LEAD_UTM_STORAGE_KEY);
    if (!raw) return {};
    return sanitizeUtm(JSON.parse(raw) as unknown);
  } catch {
    return {};
  }
}

/**
 * Persist a tagged campaign. An UNTAGGED context is never written, so a normal
 * internal navigation cannot erase attribution.
 */
export function persistUtm(context: UtmContext): void {
  try {
    if (!hasUtm(context)) return;
    const store = getStorage();
    if (!store) return;
    store.setItem(LEAD_UTM_STORAGE_KEY, JSON.stringify(sanitizeUtm(context)));
  } catch {
    // Best effort only: a storage failure must never surface to the visitor.
  }
}

// ---------------------------------------------------------------------------
// Browser entry points
// ---------------------------------------------------------------------------

function currentSearch(): string {
  try {
    const w = (globalThis as { location?: Location }).location;
    return typeof w?.search === "string" ? w.search : "";
  } catch {
    return "";
  }
}

function currentHref(): string | undefined {
  try {
    const w = (globalThis as { location?: Location }).location;
    return typeof w?.href === "string" ? w.href : undefined;
  } catch {
    return undefined;
  }
}

/**
 * CAPTURE. Call once as early as the client tree mounts.
 *
 * A tagged arrival is stored immediately, so the campaign survives every later
 * internal navigation. An untagged page stores nothing and erases nothing.
 * Returns the campaign now in effect, purely for callers that want it.
 */
export function captureLeadAttribution(): UtmContext {
  const current = readUtmFromSearch(currentSearch());
  if (hasUtm(current)) {
    persistUtm(current);
    return current;
  }
  return readStoredUtm();
}

/**
 * RESOLVE at submission time. This is the ONLY thing a lead surface should call.
 *
 * `source_url` remains the CURRENT page URL at submission — the existing product
 * contract. This phase deliberately does not redefine it into a landing URL, and
 * adds no new column to carry one.
 */
export function resolveLeadTracking(): LeadTrackingContext {
  const current = readUtmFromSearch(currentSearch());

  // A tagged submission URL is itself a fresh tagged visit; record it so a later
  // submission in the same session agrees with this one.
  if (hasUtm(current)) persistUtm(current);

  const attribution = chooseAttribution(current, readStoredUtm());
  const href = currentHref();

  return href ? { source_url: href, ...attribution } : { ...attribution };
}
