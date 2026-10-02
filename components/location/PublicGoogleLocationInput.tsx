"use client";

import { useMemo, useState } from "react";
import GooglePlaceAutocomplete from "@/components/location/GooglePlaceAutocomplete";
import { useActiveCities } from "@/lib/locations/useActiveCities";
import { isPlaceCompatibleWithSelectedCity } from "@/lib/google-maps/normalizePlace";
import type { NormalizedGooglePlace } from "@/lib/google-maps/types";

export type PublicGoogleLocationInputProps = {
  city: string;
  id?: string;
  className?: string;
  placeholder?: string;
  ariaLabel?: string;
};

/**
 * Shared public lead-entry location field.
 *
 * It keeps manual typing as a fallback, but when a Google place is selected it
 * exposes the structured identity on data-* attributes. EnquiryModalTrigger
 * reads those attributes at click time, so homepage/category bars can hand the
 * exact place id + coordinates into the canonical enquiry form without inventing
 * a second location state system.
 */
export function PublicGoogleLocationInput({
  city,
  id,
  className,
  placeholder = "Search building, society, street or area",
  ariaLabel = "Project location",
}: PublicGoogleLocationInputProps) {
  const [value, setValue] = useState("");
  const [place, setPlace] = useState<NormalizedGooglePlace | null>(null);
  const { records } = useActiveCities();

  const acceptedLabels = useMemo(() => {
    const record = records.find((item) => item.name.toLowerCase() === city.toLowerCase());
    return record?.acceptedCityLabels ?? [city];
  }, [records, city]);

  function handleManualChange(raw: string) {
    setValue(raw);
    setPlace(null);
  }

  function handlePlaceSelected(next: NormalizedGooglePlace) {
    if (city && !isPlaceCompatibleWithSelectedCity(next, city, acceptedLabels)) {
      // Keep the typed text as manual fallback, but never attach coordinates
      // from a clearly different city to this city-specific public surface.
      setPlace(null);
      return;
    }
    setPlace(next);
    setValue(next.area ?? next.formattedAddress ?? value);
  }

  return (
    <GooglePlaceAutocomplete
      id={id}
      className={className}
      value={value}
      city={city}
      mode="address"
      suggestionsPortal
      placeholder={placeholder}
      aria-label={ariaLabel}
      autoComplete="off"
      onManualChange={handleManualChange}
      onPlaceSelected={handlePlaceSelected}
      data-quote-area=""
      data-quote-city={city}
      data-quote-place-id={place?.placeId ?? undefined}
      data-quote-google-city={place?.city ?? undefined}
      data-quote-formatted-address={place?.formattedAddress ?? undefined}
      data-quote-area-normalized={place?.areaNormalized ?? undefined}
      data-quote-sublocality={place?.sublocality ?? undefined}
      data-quote-neighborhood={place?.neighborhood ?? undefined}
      data-quote-lat={place?.lat ?? undefined}
      data-quote-lng={place?.lng ?? undefined}
      data-quote-location-source={place ? "google_place" : "manual"}
    />
  );
}
