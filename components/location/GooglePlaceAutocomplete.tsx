"use client";

// ============================================================================
// QuickFurno — components/location/GooglePlaceAutocomplete.tsx
// Google area enhancement; manual fallback preserved.
//
// A drop-in replacement for a plain <input> that ALSO offers Google Places
// area/locality suggestions when (and only when) the Google Maps JS API can be
// loaded with a valid public browser key. If Google is missing, blocked, or
// fails for any reason, this renders exactly like a normal controlled input, so
// the surrounding form keeps working and submitting with manually typed text.
//
// It renders ONLY the <input> (no wrapper) so it slots inside existing form
// markup/styling (label + validation icon) without any visual redesign.
// ============================================================================
import {
  InputHTMLAttributes,
  useEffect,
  useRef,
} from "react";
import { loadGoogleMaps } from "@/lib/google-maps/loadGoogleMaps";
import { normalizeGooglePlace } from "@/lib/google-maps/normalizePlace";
import type {
  GoogleAutocomplete,
  GoogleMapsApi,
  NormalizedGooglePlace,
} from "@/lib/google-maps/types";

type NativeInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "onSelect"
>;

export type GooglePlaceAutocompleteProps = NativeInputProps & {
  value: string;
  placeholder?: string;
  /** Currently-selected city; used to bias/normalize the picked place. */
  city?: string;
  /** Fired on every keystroke (manual typing) — the fallback path. */
  onManualChange: (value: string) => void;
  /** Fired once the user picks a Google prediction. */
  onPlaceSelected: (place: NormalizedGooglePlace) => void;
  /** "locality" biases to areas/sublocalities; "address" to full addresses. */
  mode?: "locality" | "address";
};

export default function GooglePlaceAutocomplete({
  value,
  placeholder,
  city,
  onManualChange,
  onPlaceSelected,
  mode = "locality",
  ...inputProps
}: GooglePlaceAutocompleteProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<GoogleAutocomplete | null>(null);
  // Keep the freshest callbacks/props for the Google listener without
  // re-initialising the widget on every render.
  const onPlaceSelectedRef = useRef(onPlaceSelected);
  const cityRef = useRef(city);
  const modeRef = useRef(mode);
  onPlaceSelectedRef.current = onPlaceSelected;
  cityRef.current = city;
  modeRef.current = mode;

  useEffect(() => {
    let cancelled = false;
    let mapsApi: GoogleMapsApi | null = null;

    // Best-effort enhancement. Any failure leaves the plain input untouched.
    loadGoogleMaps()
      .then((maps) => {
        if (cancelled || !maps?.places?.Autocomplete || !inputRef.current) return;
        mapsApi = maps;
        try {
          const autocomplete = new maps.places.Autocomplete(inputRef.current, {
            // Bias to India; "(regions)" keeps predictions to localities /
            // sublocalities / neighborhoods / pincodes, not random businesses.
            componentRestrictions: { country: "in" },
            types: modeRef.current === "address" ? ["geocode"] : ["(regions)"],
            fields: ["place_id", "name", "formatted_address", "address_components", "geometry"],
          });
          autocompleteRef.current = autocomplete;

          autocomplete.addListener("place_changed", () => {
            let raw: ReturnType<GoogleAutocomplete["getPlace"]> | undefined;
            try {
              raw = autocomplete.getPlace();
            } catch {
              return;
            }
            // User pressed Enter without picking a prediction → no structured
            // data. The manual value is already synced via onChange; do nothing.
            if (!raw || (!raw.place_id && !raw.address_components && !raw.geometry)) return;
            const normalized = normalizeGooglePlace(raw, cityRef.current, modeRef.current);
            onPlaceSelectedRef.current(normalized);
          });
        } catch {
          // Autocomplete construction failed (e.g. key lacks Places) — ignore.
          autocompleteRef.current = null;
        }
      })
      .catch(() => {
        /* never throws — manual input remains fully functional */
      });

    return () => {
      cancelled = true;
      try {
        if (autocompleteRef.current && mapsApi?.event) {
          mapsApi.event.clearInstanceListeners(autocompleteRef.current);
        }
      } catch {
        /* no-op */
      }
      autocompleteRef.current = null;
    };
    // Initialise once per mount; live values are read through the refs above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <input
      {...inputProps}
      ref={inputRef}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onManualChange(e.target.value)}
      // Prevent an accidental form submit when picking a prediction with Enter.
      onKeyDown={(e) => {
        if (e.key === "Enter") e.preventDefault();
        inputProps.onKeyDown?.(e);
      }}
    />
  );
}
