// ============================================================================
// QuickFurno — lib/google-maps/normalizePlace.ts
// Google area enhancement; manual fallback preserved.
//
// Turns a raw Google place (Places NEW `Place`, or a legacy `PlaceResult`) into
// the app's NormalizedGooglePlace shape: a stable city / area / sublocality /
// neighborhood / state / pincode / lat-lng bundle with a lowercased
// `areaNormalized`. Pure and defensive — any missing piece simply stays null.
//
// Also exposes isPlaceCompatibleWithSelectedCity(): a defensive, case-insensitive
// guard so we NEVER save city = X with coordinates that clearly belong to a
// different city (which would corrupt future distance matching).
// ============================================================================
import type {
  NormalizedGooglePlace,
  PlaceAddressComponentLike,
  PlaceLatLngLike,
  PlaceLike,
} from "./types";

/** Reads a component label in either NEW (longText) or legacy (long_name) casing. */
function componentLabel(component: PlaceAddressComponentLike): string {
  return (component.longText ?? component.long_name ?? "").trim();
}

/** First component whose `types` includes any of the requested type keys. */
function componentFor(
  components: PlaceAddressComponentLike[] | undefined | null,
  ...wanted: string[]
): string | null {
  if (!Array.isArray(components)) return null;
  const match = components.find((c) => Array.isArray(c.types) && c.types.some((t) => wanted.includes(t)));
  if (!match) return null;
  const value = componentLabel(match);
  return value ? value : null;
}

const clean = (value: string | null | undefined): string | null => {
  const v = (value ?? "").trim();
  return v ? v : null;
};

/** Reads a lat or lng that may be a method (google LatLng) or a plain number. */
function readCoord(value: number | (() => number) | undefined): number | null {
  try {
    const n = typeof value === "function" ? value() : value;
    return typeof n === "number" && Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/**
 * Normalize a Google place. `fallbackCity` is the city already chosen in the
 * form — used only when the place itself carries no locality.
 * `mode` mildly changes which field wins for the human-facing `area` label.
 */
export function normalizeGooglePlace(
  place: PlaceLike | null | undefined,
  fallbackCity?: string,
  mode: "locality" | "address" = "locality",
): NormalizedGooglePlace {
  const components = place?.addressComponents ?? place?.address_components ?? null;

  const locality = componentFor(components, "locality");
  const adminArea2 = componentFor(components, "administrative_area_level_2");
  const state = componentFor(components, "administrative_area_level_1");
  const sublocality = componentFor(
    components,
    "sublocality",
    "sublocality_level_1",
    "sublocality_level_2",
  );
  const neighborhood = componentFor(components, "neighborhood");
  const postalCode = componentFor(components, "postal_code");
  const placeName = clean(place?.displayName ?? place?.name);

  // City must be an actual city, never a sublocality: prefer locality, then the
  // administrative district, then whatever the form already had selected.
  const city = locality ?? adminArea2 ?? clean(fallbackCity);

  // Human-facing "area" label. In locality mode the picked prediction name is
  // the best answer (e.g. "Baner"); in address mode prefer the finer locality.
  const area =
    mode === "address"
      ? sublocality ?? neighborhood ?? locality ?? placeName
      : placeName ?? sublocality ?? neighborhood ?? locality;

  const rawLoc: PlaceLatLngLike | null | undefined = place?.location ?? place?.geometry?.location;
  const lat = rawLoc ? readCoord(rawLoc.lat) : null;
  const lng = rawLoc ? readCoord(rawLoc.lng) : null;

  return {
    placeId: clean(place?.id ?? place?.place_id),
    formattedAddress: clean(place?.formattedAddress ?? place?.formatted_address),
    city,
    area,
    areaNormalized: area ? area.toLowerCase() : null,
    sublocality,
    neighborhood,
    state,
    // Keep only a well-formed 6-digit Indian pincode; anything else → null.
    postalCode: postalCode && /^\d{6}$/.test(postalCode) ? postalCode : null,
    lat,
    lng,
  };
}

/** Case/diacritic-insensitive city key: lowercased, single-spaced, trimmed. */
function cityKey(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritics
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Defensive, case-insensitive check that a picked place actually belongs to the
 * city the client selected. Accepts when the normalized place city equals the
 * selected city, OR the formatted address contains the selected city as a whole
 * word (meaningful component — not a loose substring). Rejects when the place
 * clearly resolves elsewhere and there is no evidence it belongs to the city.
 *
 * When no city is selected yet, there is nothing to contradict → returns true.
 */
export function isPlaceCompatibleWithSelectedCity(
  place: Pick<NormalizedGooglePlace, "city" | "formattedAddress">,
  selectedCity: string,
): boolean {
  const wanted = cityKey(selectedCity);
  if (!wanted) return true; // no city chosen yet → nothing to conflict with

  const placeCity = cityKey(place.city);
  if (placeCity && placeCity === wanted) return true;

  const addr = cityKey(place.formattedAddress);
  if (addr) {
    // Whole-word match avoids false positives like "punexyz" matching "pune".
    const escaped = wanted.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\b${escaped}\\b`).test(addr)) return true;
  }
  return false;
}
