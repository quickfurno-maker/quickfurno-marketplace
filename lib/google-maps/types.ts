// ============================================================================
// QuickFurno — lib/google-maps/types.ts
// Google area enhancement; manual fallback preserved.
//
// Minimal, self-contained typings for the slice of the Google Maps JavaScript
// "places" API this project uses. @types/google.maps is NOT a dependency, so we
// declare only what we touch. Phase 2 hardening migrates to the Places NEW
// programmatic Autocomplete Data API (AutocompleteSuggestion + Place.fetchFields),
// while the normalizer still tolerates the legacy PlaceResult shape for safety.
// Everything is optional/loose so a partial or blocked API never breaks typecheck.
// ============================================================================

/**
 * A single address component that may arrive in either the Places NEW casing
 * (longText / shortText) or the legacy casing (long_name / short_name).
 */
export interface PlaceAddressComponentLike {
  longText?: string | null;
  shortText?: string | null;
  long_name?: string | null;
  short_name?: string | null;
  types?: string[];
}

/** A LatLng that may expose lat/lng as methods (google LatLng) or plain numbers. */
export interface PlaceLatLngLike {
  lat: number | (() => number);
  lng: number | (() => number);
}

/**
 * A place object the normalizer can read — a defensive superset of the Places
 * NEW `Place` and the legacy `PlaceResult`, so `normalizeGooglePlace` works with
 * either during and after the migration.
 */
export interface PlaceLike {
  // Places NEW
  id?: string | null;
  displayName?: string | null;
  formattedAddress?: string | null;
  addressComponents?: PlaceAddressComponentLike[] | null;
  location?: PlaceLatLngLike | null;
  // Legacy
  place_id?: string | null;
  name?: string | null;
  formatted_address?: string | null;
  address_components?: PlaceAddressComponentLike[] | null;
  geometry?: { location?: PlaceLatLngLike | null } | null;
}

// ---------------------------------------------------------------------------
// Places NEW — programmatic Autocomplete Data API surface (only what we call).
// ---------------------------------------------------------------------------

/** A fully-fetched Place instance (after fetchFields). */
export interface NewPlace extends PlaceLike {
  fetchFields: (options: { fields: string[] }) => Promise<{ place?: NewPlace } | void>;
}

export interface PlacePredictionText {
  text?: string | null;
}

/** One autocomplete prediction; `toPlace()` yields a Place to fetchFields on. */
export interface PlacePrediction {
  placeId?: string | null;
  text?: PlacePredictionText | null;
  mainText?: PlacePredictionText | null;
  secondaryText?: PlacePredictionText | null;
  toPlace: () => NewPlace;
}

export interface AutocompleteSuggestion {
  placePrediction?: PlacePrediction | null;
}

/** Request for AutocompleteSuggestion.fetchAutocompleteSuggestions. */
export interface AutocompleteRequest {
  input: string;
  sessionToken?: unknown;
  /** Region-code restriction, e.g. ["in"] for India. */
  includedRegionCodes?: string[];
  /** Type collection/types, e.g. ["(regions)"] or ["geocode"]. */
  includedPrimaryTypes?: string[];
  language?: string;
  region?: string;
  /**
   * Extension points for FUTURE city-specific biasing (Phase 3+). Intentionally
   * left unset here — we never invent/guess city bounds.
   */
  locationBias?: unknown;
  locationRestriction?: unknown;
  origin?: unknown;
}

/** The subset of the "places" library returned by importLibrary("places"). */
export interface PlacesLibrary {
  AutocompleteSessionToken: new () => unknown;
  AutocompleteSuggestion: {
    fetchAutocompleteSuggestions: (
      request: AutocompleteRequest,
    ) => Promise<{ suggestions?: AutocompleteSuggestion[] | null }>;
  };
  Place?: unknown;
}

/**
 * Normalized, app-friendly shape emitted by GooglePlaceAutocomplete once a user
 * picks a prediction. All fields are nullable so callers stay defensive.
 */
export interface NormalizedGooglePlace {
  placeId: string | null;
  formattedAddress: string | null;
  city: string | null;
  area: string | null;
  areaNormalized: string | null;
  sublocality: string | null;
  neighborhood: string | null;
  state: string | null;
  lat: number | null;
  lng: number | null;
}
