// ============================================================================
// QuickFurno — lib/google-maps/types.ts
// Google area enhancement; manual fallback preserved.
//
// Minimal, self-contained typings for the tiny slice of the Google Maps
// JavaScript "places" API we actually touch. @types/google.maps is NOT a
// project dependency, so we declare only what we use here. Everything is
// optional/loose so a partially-loaded or blocked API never breaks typecheck.
// ============================================================================

/** One entry from a Google place's `address_components`. */
export interface GoogleAddressComponent {
  long_name: string;
  short_name: string;
  types: string[];
}

export interface GooglePlaceGeometry {
  location?: {
    lat: () => number;
    lng: () => number;
  };
}

/** Raw place object returned by `Autocomplete.getPlace()`. */
export interface GooglePlaceResult {
  place_id?: string;
  name?: string;
  formatted_address?: string;
  address_components?: GoogleAddressComponent[];
  geometry?: GooglePlaceGeometry;
}

export interface GoogleAutocompleteOptions {
  types?: string[];
  fields?: string[];
  componentRestrictions?: { country: string | string[] };
  bounds?: unknown;
  strictBounds?: boolean;
}

export interface GoogleMapsEventListener {
  remove: () => void;
}

/** The legacy `google.maps.places.Autocomplete` widget bound to an <input>. */
export interface GoogleAutocomplete {
  addListener: (event: string, handler: () => void) => GoogleMapsEventListener;
  getPlace: () => GooglePlaceResult;
  setFields?: (fields: string[]) => void;
  setComponentRestrictions?: (restrictions: { country: string | string[] }) => void;
  setBounds?: (bounds: unknown) => void;
}

export interface GoogleAutocompleteConstructor {
  new (input: HTMLInputElement, opts?: GoogleAutocompleteOptions): GoogleAutocomplete;
}

/** The subset of the `google.maps` namespace this feature relies on. */
export interface GoogleMapsApi {
  places?: {
    Autocomplete?: GoogleAutocompleteConstructor;
  };
  event?: {
    clearInstanceListeners: (instance: unknown) => void;
  };
  /** Present on newer loader builds (loading=async); used as a safety net. */
  importLibrary?: (name: string) => Promise<unknown>;
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
  postalCode: string | null;
  lat: number | null;
  lng: number | null;
}
