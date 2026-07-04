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
// Only the PUBLIC browser key (NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY) is used, and
// only on the client. No server key is ever referenced here.
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

/** The public browser key, trimmed — or null when it is missing/blank. */
export function getGoogleMapsBrowserKey(): string | null {
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY;
  return key && key.trim() ? key.trim() : null;
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

/**
 * Load (once) the Google Maps JS bootstrap and the Places NEW library, resolving
 * the "places" library or `null` if it cannot be used. Safe to call repeatedly;
 * the result promise is cached on window. Does NOT require the legacy
 * google.maps.places.Autocomplete widget.
 */
export function loadGoogleMaps(): Promise<PlacesLibrary | null> {
  // SSR / non-browser — never touch window on the server.
  if (typeof window === "undefined") return Promise.resolve(null);

  // A load is already in flight (or previously completed) — reuse it.
  if (window.__qfGooglePlacesPromise) return window.__qfGooglePlacesPromise;

  const key = getGoogleMapsBrowserKey();
  if (!key) {
    // No key configured → silent, safe manual fallback everywhere. Cache the
    // resolved null so we don't re-check on every field mount.
    window.__qfGooglePlacesPromise = Promise.resolve(null);
    return window.__qfGooglePlacesPromise;
  }

  const promise = new Promise<PlacesLibrary | null>((resolve) => {
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
      // Any unexpected DOM error → fall back to manual entry.
      resolve(null);
    }
  }).catch(() => null);

  window.__qfGooglePlacesPromise = promise;
  return promise;
}
