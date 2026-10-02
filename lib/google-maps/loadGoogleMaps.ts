// ============================================================================
// QuickFurno — lib/google-maps/loadGoogleMaps.ts
// Google area enhancement; manual fallback preserved.
//
// Client-only, best-effort loader for the Google Maps JS bootstrap + the Places
// NEW library (via importLibrary("places")). It is intentionally UNBREAKABLE:
// on ANY problem — no key, blocked script, offline, ad-blocker, wrong domain
// restriction, invalid API setup — it resolves to `null` so every caller keeps
// its normal manual behaviour. It NEVER throws and NEVER logs the API key.
//
// The browser-restricted Google key is public by design. We prefer the normal
// NEXT_PUBLIC_* build-time value when available, but self-hosted production can
// also provide it at request time through /api/public/google-maps-config. This
// avoids silently disabling Places when PM2/runtime env exists but the key was
// not present during `next build`.
// ============================================================================
import type { PlacesLibrary } from "./types";

declare global {
  interface Window {
    google?: { maps?: { importLibrary?: (name: string) => Promise<unknown> } };
    // Single shared promise so concurrent callers/mounts reuse one script load.
    __qfGooglePlacesPromise?: Promise<PlacesLibrary | null>;
  }
}

const SCRIPT_ID = "qf-google-maps-js";
const RUNTIME_CONFIG_URL = "/api/public/google-maps-config";

/** Build-time browser key, trimmed — or null when it was not embedded. */
export function getGoogleMapsBrowserKey(): string | null {
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY;
  return key && key.trim() ? key.trim() : null;
}

/**
 * Resolve the public browser key without assuming it existed during `next build`.
 * The endpoint only returns a browser-restricted public key; it never returns a
 * server credential. Failures deliberately degrade to the manual location flow.
 */
async function resolveGoogleMapsBrowserKey(): Promise<string | null> {
  const buildTimeKey = getGoogleMapsBrowserKey();
  if (buildTimeKey) return buildTimeKey;

  try {
    const response = await fetch(RUNTIME_CONFIG_URL, {
      method: "GET",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;

    const payload = (await response.json()) as {
      configured?: unknown;
      browserKey?: unknown;
    };
    const key = typeof payload.browserKey === "string" ? payload.browserKey.trim() : "";
    return payload.configured === true && key ? key : null;
  } catch {
    return null;
  }
}

/** Runtime check that the loaded library exposes the Places NEW surface we use. */
function isUsablePlaces(lib: unknown): lib is PlacesLibrary {
  const p = lib as Partial<PlacesLibrary> | null | undefined;
  return Boolean(
    p &&
      typeof (p as { AutocompleteSessionToken?: unknown }).AutocompleteSessionToken === "function" &&
      p.AutocompleteSuggestion &&
      typeof p.AutocompleteSuggestion.fetchAutocompleteSuggestions === "function",
  );
}

function cacheRecoverablePlacesPromise(
  promise: Promise<PlacesLibrary | null>,
): Promise<PlacesLibrary | null> {
  let cached: Promise<PlacesLibrary | null>;
  cached = promise.then((places) => {
    // A null result is a transient/fallback outcome, never permanent browser
    // state. Clear it so the next 3+ character interaction can retry.
    if (!places && window.__qfGooglePlacesPromise === cached) {
      window.__qfGooglePlacesPromise = undefined;
    }
    return places;
  });
  window.__qfGooglePlacesPromise = cached;
  return cached;
}

/**
 * Load (once) the Google Maps JS bootstrap and the Places NEW library, resolving
 * the "places" library or `null` if it cannot be used. Safe to call repeatedly;
 * successful/in-flight work is cached on window, while failed/null loads are
 * explicitly recoverable. Does NOT require the legacy
 * google.maps.places.Autocomplete widget.
 */
export function loadGoogleMaps(): Promise<PlacesLibrary | null> {
  // SSR / non-browser — never touch window on the server.
  if (typeof window === "undefined") return Promise.resolve(null);

  // If Google finished booting after a previous failed attempt, recover from
  // the already-loaded global immediately instead of trusting stale cached state.
  if (typeof window.google?.maps?.importLibrary === "function") {
    const recovered = (async (): Promise<PlacesLibrary | null> => {
      try {
        const lib = await window.google!.maps!.importLibrary!("places");
        return isUsablePlaces(lib) ? lib : null;
      } catch {
        return null;
      }
    })();
    return cacheRecoverablePlacesPromise(recovered);
  }

  // A load is already in flight (or previously completed) — reuse it. If an
  // earlier load resolved null, clear the poisoned cache and retry cleanly.
  if (window.__qfGooglePlacesPromise) {
    return window.__qfGooglePlacesPromise.then((places) => {
      if (places) return places;
      window.__qfGooglePlacesPromise = undefined;
      return loadGoogleMaps();
    });
  }

  const promise = (async (): Promise<PlacesLibrary | null> => {
    const key = await resolveGoogleMapsBrowserKey();
    if (!key) return null;

    return new Promise<PlacesLibrary | null>((resolve) => {
      const importPlaces = async () => {
        try {
          const importLibrary = window.google?.maps?.importLibrary;
          if (typeof importLibrary !== "function") {
            resolve(null);
            return;
          }
          const lib = await importLibrary("places");
          resolve(isUsablePlaces(lib) ? lib : null);
        } catch {
          resolve(null);
        }
      };

      try {
        const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
        if (existing) {
          if (typeof window.google?.maps?.importLibrary === "function") {
            void importPlaces();
          } else {
            existing.addEventListener("load", () => void importPlaces(), { once: true });
            existing.addEventListener("error", () => resolve(null), { once: true });
          }
          return;
        }

        const script = document.createElement("script");
        script.id = SCRIPT_ID;
        script.async = true;
        script.defer = true;
        // `loading=async` is the recommended mode for importLibrary(); region/
        // language bias the whole API to India + English.
        script.src =
          "https://maps.googleapis.com/maps/api/js" +
          `?key=${encodeURIComponent(key)}` +
          "&loading=async&language=en&region=IN&libraries=places";
        script.addEventListener("load", () => void importPlaces(), { once: true });
        script.addEventListener("error", () => resolve(null), { once: true });
        document.head.appendChild(script);
      } catch {
        resolve(null);
      }
    });
  })().catch(() => null);

  return cacheRecoverablePlacesPromise(promise);
}
