// ============================================================================
// QuickFurno — lib/google-maps/loadGoogleMaps.ts
// Google area enhancement; manual fallback preserved.
//
// Client-only, best-effort loader for the Google Maps JavaScript API (Places
// library). It is intentionally UNBREAKABLE: on any problem — no key, blocked
// script, offline, ad-blocker, wrong domain restriction — it resolves to `null`
// so every caller keeps its normal manual behaviour. It NEVER throws.
//
// Only the PUBLIC browser key (NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY) is used, and
// only on the client. No server key is ever referenced here.
// ============================================================================
import type { GoogleMapsApi } from "./types";

declare global {
  interface Window {
    google?: { maps?: GoogleMapsApi };
    // Single shared in-flight promise so multiple mounts never inject the
    // script twice (StrictMode double-mount, multiple autocomplete fields…).
    __qfGoogleMapsPromise?: Promise<GoogleMapsApi | null>;
  }
}

const SCRIPT_ID = "qf-google-maps-places";

/** The public browser key, trimmed — or null when it is missing/blank. */
export function getGoogleMapsBrowserKey(): string | null {
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY;
  return key && key.trim() ? key.trim() : null;
}

/** True when a usable Places Autocomplete is already available on window. */
function placesReady(): boolean {
  return Boolean(typeof window !== "undefined" && window.google?.maps?.places?.Autocomplete);
}

/**
 * Load (once) the Google Maps JS Places library and resolve the `google.maps`
 * namespace, or `null` if it cannot be used. Safe to call repeatedly.
 */
export function loadGoogleMaps(): Promise<GoogleMapsApi | null> {
  // SSR / non-browser — never touch window on the server.
  if (typeof window === "undefined") return Promise.resolve(null);

  // Already fully loaded.
  if (placesReady()) return Promise.resolve(window.google!.maps as GoogleMapsApi);

  // A load is already in flight (or previously completed) — reuse it.
  if (window.__qfGoogleMapsPromise) return window.__qfGoogleMapsPromise;

  const key = getGoogleMapsBrowserKey();
  if (!key) {
    // No key configured → silent, safe manual fallback everywhere. Cache the
    // resolved null so we don't re-check on every field mount.
    window.__qfGoogleMapsPromise = Promise.resolve(null);
    return window.__qfGoogleMapsPromise;
  }

  const promise = new Promise<GoogleMapsApi | null>((resolve) => {
    try {
      // Resolve once the script is loaded AND places is actually usable. On
      // newer async loader builds, importLibrary() finalises the places module.
      const settle = async () => {
        try {
          const maps = window.google?.maps;
          if (!maps) {
            resolve(null);
            return;
          }
          if (!maps.places?.Autocomplete && typeof maps.importLibrary === "function") {
            await maps.importLibrary("places");
          }
          resolve(placesReady() ? (window.google!.maps as GoogleMapsApi) : null);
        } catch {
          resolve(null);
        }
      };

      const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
      if (existing) {
        if (placesReady()) {
          void settle();
        } else {
          existing.addEventListener("load", () => void settle(), { once: true });
          existing.addEventListener("error", () => resolve(null), { once: true });
        }
        return;
      }

      const script = document.createElement("script");
      script.id = SCRIPT_ID;
      script.async = true;
      script.defer = true;
      // Bias the whole API to India + English. `libraries=places` guarantees the
      // load event fires only once Places is ready.
      script.src =
        "https://maps.googleapis.com/maps/api/js" +
        `?key=${encodeURIComponent(key)}` +
        "&libraries=places&language=en&region=IN";
      script.addEventListener("load", () => void settle(), { once: true });
      script.addEventListener("error", () => resolve(null), { once: true });
      document.head.appendChild(script);
    } catch {
      // Any unexpected DOM error → fall back to manual entry.
      resolve(null);
    }
  }).catch(() => null);

  window.__qfGoogleMapsPromise = promise;
  return promise;
}
