// ============================================================================
// QuickFurno — lib/google-maps/normalizePlace.ts
// Google area enhancement; manual fallback preserved.
//
// Turns a raw Google place (from Autocomplete.getPlace()) into the app's
// NormalizedGooglePlace shape: a stable city / area / sublocality / neighborhood
// / state / pincode / lat-lng bundle with a lowercased `areaNormalized`. Pure
// and defensive — any missing piece simply stays null.
// ============================================================================
import type { GoogleAddressComponent, GooglePlaceResult, NormalizedGooglePlace } from "./types";

/** First component whose `types` includes any of the requested type keys. */
function componentFor(
  components: GoogleAddressComponent[] | undefined,
  ...wanted: string[]
): string | null {
  if (!components) return null;
  const match = components.find((c) => c.types?.some((t) => wanted.includes(t)));
  const value = match?.long_name?.trim();
  return value ? value : null;
}

const clean = (value: string | null | undefined): string | null => {
  const v = (value ?? "").trim();
  return v ? v : null;
};

/**
 * Normalize a Google place. `fallbackCity` is the city already chosen in the
 * form — used only when the place itself carries no locality.
 * `mode` mildly changes which field wins for the human-facing `area` label.
 */
export function normalizeGooglePlace(
  place: GooglePlaceResult | null | undefined,
  fallbackCity?: string,
  mode: "locality" | "address" = "locality",
): NormalizedGooglePlace {
  const components = place?.address_components;

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
  const placeName = clean(place?.name);

  // City must be an actual city, never a sublocality: prefer locality, then the
  // administrative district, then whatever the form already had selected.
  const city = locality ?? adminArea2 ?? clean(fallbackCity);

  // Human-facing "area" label. In locality mode the picked prediction name is
  // the best answer (e.g. "Baner"); in address mode prefer the finer locality.
  const area =
    mode === "address"
      ? sublocality ?? neighborhood ?? locality ?? placeName
      : placeName ?? sublocality ?? neighborhood ?? locality;

  let lat: number | null = null;
  let lng: number | null = null;
  try {
    const loc = place?.geometry?.location;
    if (loc && typeof loc.lat === "function" && typeof loc.lng === "function") {
      const latVal = loc.lat();
      const lngVal = loc.lng();
      lat = Number.isFinite(latVal) ? latVal : null;
      lng = Number.isFinite(lngVal) ? lngVal : null;
    }
  } catch {
    lat = null;
    lng = null;
  }

  return {
    placeId: clean(place?.place_id),
    formattedAddress: clean(place?.formatted_address),
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
